/*
 * 本地验证: index.vue 的 wifiManageClosed 事件参数解析。
 * $falcon.trigger 传出的字符串在跨页面回调里可能被包成对象 (真机实测为 [object Object]),
 * 这里把该方法体抽出来单独验证各种形态都能正确判出 failed。
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

/* 从 index.vue 抽出 _manageClosed 方法体, 包一层可测函数 */
const src = readFileSync(join(here, '..', 'ui', 'src', 'pages', 'index', 'index.vue'), 'utf8')
const m = src.match(/\n    _manageClosed\(info\) \{([\s\S]*?)\n    \},/)
if (!m) {
  console.log('FAIL 找不到 _manageClosed 方法体')
  process.exit(1)
}

const logs = []
function makeCtx() {
  logs.length = 0
  const ctx = {
    _manageTries: 0,
    _autoManagedAt: 0,
    _manageCooldownUntil: 0,
    _leftAt: 0,
    setMsg: (t) => logs.push('msg:' + t),
  }
  // eslint-disable-next-line no-new-func
  const fn = new Function('log', 'MANAGE_COOLDOWN_MS', 'return function (info) {' + m[1] + '}')
  ctx._fn = fn((a, b) => logs.push(a + ':' + b), 180000).bind(ctx)
  return ctx
}

/* 1. 字符串 'failed' (原生形态) */
{
  const c = makeCtx()
  c._fn('failed')
  expect("字符串 'failed': 抑制计数", c._manageTries, 2)
  expect("字符串 'failed': 不设 _leftAt (不重检)", c._leftAt, 0)
  expect("字符串 'failed': 设置冷却窗", c._manageCooldownUntil > Date.now(), true)
  expect("字符串 'failed': 给出提示", logs.some((l) => l.startsWith('msg:')), true)
}

/* 2. 真机实测: 对象包装 */
{
  const c = makeCtx()
  c._fn({ 0: 'failed' })
  expect('对象 {0:"failed"}: 抑制计数', c._manageTries, 2)
  expect('对象 {0:"failed"}: 不重检', c._leftAt, 0)
}
{
  const c = makeCtx()
  c._fn({ detail: 'failed' })
  expect('对象 {detail:"failed"}: 抑制计数', c._manageTries, 2)
}
{
  const c = makeCtx()
  c._fn({ data: { value: 'failed' } })
  expect('对象 {data:{value}}: 抑制计数', c._manageTries, 2)
}
{
  const c = makeCtx()
  c._fn({ 0: { 0: 'failed' } })
  expect('嵌套对象: 抑制计数', c._manageTries, 2)
}

/* 3. 正常关闭 'ok': 设置 _leftAt 以便返回重检, 不抑制也不设冷却 */
{
  const c = makeCtx()
  c._fn('ok')
  expect("字符串 'ok': 不抑制", c._manageTries, 0)
  expect("字符串 'ok': 不设冷却", c._manageCooldownUntil, 0)
  expect("字符串 'ok': 设置 _leftAt", c._leftAt > 0, true)
}
{
  const c = makeCtx()
  c._fn({ 0: 'ok' })
  expect("对象 {0:'ok'}: 不抑制", c._manageTries, 0)
  expect("对象 {0:'ok'}: 设置 _leftAt", c._leftAt > 0, true)
}

/* 4. undefined (旧固件未传参): 视为正常关闭 */
{
  const c = makeCtx()
  c._fn(undefined)
  expect('undefined: 不抑制', c._manageTries, 0)
  expect('undefined: 设置 _leftAt', c._leftAt > 0, true)
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS')
process.exit(fail ? 1 : 0)
