/*
 * 本地验证: portal.js 的接口参数构造 (load_user_list / user_offone 等)
 * + detect.js 并发竞速判定逻辑 (纯逻辑部分, 用桩替换 http 层)
 *
 * 直接 import 源码不现实 (依赖固件 'panet' 模块), 因此用文本注入桩的方式:
 * 把 import 行替换成注入的 request 桩, 再在 Node 里 eval。
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))

let fail = 0
function expect(name, actual, want) {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`}`)
}

/* ---------- 1. portal.js: 抓取实际请求 URL ---------- */
{
  let src = readFileSync(join(here, '..', 'ui', 'src', 'services', 'portal.js'), 'utf8')
  src = src.replace(/^import .*$/gm, '')
  src = src.replace(/^export function/gm, 'function')
  const captured = []
  const mod = new Function(
    'request',
    'paAesEncode',
    src +
      '\nreturn { loadPortalConf, userLogin, queryAuthStat, logout, loadUserList, userOffOne };'
  )(
    async (opts) => {
      captured.push(opts.url)
      return { ok: true, statusCode: 200, headers: {}, body: new Uint8Array(0), text: '{"msg":"ok","code":0,"data":[]}', error: '' }
    },
    (p) => 'HEX_' + p
  )

  await mod.loadUserList('http://192.168.3.12:8080', { ip: '192.168.50.11' })
  expect(
    'loadUserList url',
    captured.pop(),
    'http://192.168.3.12:8080/api?route=ucenter&action=load_user_list&ip=192.168.50.11'
  )

  await mod.userOffOne('http://192.168.3.12:8080', { addr: '192.168.50.23' })
  expect(
    'userOffOne url',
    captured.pop(),
    'http://192.168.3.12:8080/api?route=ucenter&action=user_offone&addr=192.168.50.23'
  )

  await mod.logout('http://192.168.3.12:8080', { ip: '192.168.50.11' })
  expect(
    'logout(user_offall) url',
    captured.pop(),
    'http://192.168.3.12:8080/api?route=ucenter&action=user_offall&ip=192.168.50.11'
  )

  await mod.queryAuthStat('http://192.168.3.12:8080', { sceneStr: '', ip: '1.2.3.4', type: 'panabit' })
  expect(
    'queryAuthStat url',
    captured.pop(),
    'http://192.168.3.12:8080/api?route=webauth&action=query_auth_stat&scene_str=&ip=1.2.3.4&type=panabit'
  )
}

/* ---------- 2. detect.js: 并发竞速 + abort ---------- */
{
  let src = readFileSync(join(here, '..', 'ui', 'src', 'services', 'detect.js'), 'utf8')
  src = src.replace(/^import .*$/gm, '')
  src = src.replace(/^export /gm, '')
  // 剥离 export 后 checkPortal 仍在源码里; 用函数工厂暴露它 + request 桩

  const build = (requestImpl) =>
    new Function('request', src + '\nreturn { checkPortal };')(requestImpl)

  const resp = (o) => ({
    ok: o.ok !== false,
    statusCode: o.statusCode || 200,
    headers: o.headers || {},
    body: o.body || new Uint8Array(0),
    text: o.text || '',
    error: o.error || '',
  })

  // 场景 A: 最快的探测源返回 204 空包 => free
  {
    const delays = { 小米: 30, vivo: 120, 华为: 90 }
    const mod = build(async (opts) => {
      const name = /miui/.test(opts.url) ? '小米' : /vivo/.test(opts.url) ? 'vivo' : '华为'
      await new Promise((r) => setTimeout(r, delays[name]))
      return resp({ statusCode: 204 })
    })
    const t0 = Date.now()
    const det = await mod.checkPortal()
    const ms = Date.now() - t0
    expect('race: free status', det.status, 'free')
    expect('race: free probe = 最快源', det.probe, '小米')
    const okTime = ms < 90 // 串行实现需要 >= 240ms
    if (!okTime) fail++
    console.log(`${okTime ? 'PASS' : 'FAIL'} race: 耗时 ${ms}ms (期望 < 90ms, 非串行)`)
  }

  // 场景 B: 一个源 302 跳转 => portal, 且解析出服务器与参数
  {
    const mod = build(async (opts) => {
      if (/miui/.test(opts.url)) {
        await new Promise((r) => setTimeout(r, 10))
        return resp({ statusCode: 302, headers: { location: 'http://192.168.3.12:8080/portal.html?wlanuserip=192.168.50.11&paip=192.168.3.12' } })
      }
      await new Promise((r) => setTimeout(r, 200))
      return resp({ statusCode: 204 })
    })
    const det = await mod.checkPortal()
    expect('race: portal status', det.status, 'portal')
    expect('race: portal serverBase', det.serverBase, 'http://192.168.3.12:8080')
    expect('race: portal params', det.params.wlanuserip, '192.168.50.11')
  }

  // 场景 C: 全部失败 => offline (需等所有源都失败)
  {
    let calls = 0
    const mod = build(async () => {
      calls++
      await new Promise((r) => setTimeout(r, 20))
      return resp({ ok: false, error: 'timeout' })
    })
    const det = await mod.checkPortal()
    expect('race: offline status', det.status, 'offline')
    expect('race: offline 探测源全数发起', calls, 3)
  }

  // 场景 D: abort => 不采纳结果
  {
    const signal = { aborted: false }
    const mod = build(async () => {
      await new Promise((r) => setTimeout(r, 30))
      return resp({ statusCode: 204 })
    })
    const p = mod.checkPortal({ signal })
    setTimeout(() => {
      signal.aborted = true
    }, 5)
    const det = await p
    expect('race: abort status', det.status, 'aborted')
  }
}

console.log(fail === 0 ? 'ALL PASS' : `${fail} FAILURES`)
process.exit(fail === 0 ? 0 : 1)
