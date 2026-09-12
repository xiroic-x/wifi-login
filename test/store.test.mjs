/*
 * 本地验证: store.js 按 WiFi (SSID) 隔离存储账号密码。
 * 直接用文本注入桩替换 panet import: readFile/writeFile 走内存 Map,
 * 同时把 aes 也桩掉 (只关心分桶与序列化结构, 不测加密)。
 */
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))

/* store.js 从 globalThis.$dataDir 取存储目录, 测试里固定为 DIR */
globalThis.$dataDir = 'DIR'

let fail = 0
function expect(name, actual, want) {
  const ok = JSON.stringify(actual) === JSON.stringify(want)
  if (!ok) fail++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` got=${JSON.stringify(actual)} want=${JSON.stringify(want)}`}`)
}

/*
 * AES 桩: 输出不含明文的密文 (base64 反转), 便于断言"落盘无明文";
 * 解码还原。真实实现见 aes.js (AES-128-ECB/ZeroPadding)。
 */
function stubEncode(p) {
  return 'CIPHER<' + Buffer.from(String(p), 'utf8').toString('base64') + '>'
}
function stubDecode(c) {
  const s = String(c)
  if (!s.startsWith('CIPHER<')) return ''
  return Buffer.from(s.slice(7, -1), 'base64').toString('utf8')
}

/* 构造一个干净的 store 模块实例: files 为底层"磁盘", dataDir 决定是否可持久化。
 * 注意: 必须用 Panet 作注入参数名 (源码自身定义了 client() 函数, 用 client 会冲突)。 */
function makeStore(files, initial) {
  let src = readFileSync(join(here, '..', 'ui', 'src', 'services', 'store.js'), 'utf8')
  src = src.replace(/^import .*$/gm, '')
  src = src.replace(/^export async function/gm, 'async function')
  src = src.replace(/^export function/gm, 'function')
  if (initial) files.set('DIR/wifi_account.json', initial)
  const mod = new Function(
    'Panet',
    'paAesEncode',
    'paAesDecode',
    src + '\nreturn { loadAccount, saveAccount, forgetPassword, clearAccount };'
  )(
    {
      readFile: async (p) => (files.has(p) ? files.get(p) : ''),
      writeFile: async (p, t) => {
        files.set(p, t)
        return true
      },
    },
    stubEncode,
    stubDecode
  )
  return mod
}

/* ---------- 1. 不同 WiFi 各存各的密码, 互不覆盖 ---------- */
{
  const files = new Map()
  const s = makeStore(files)

  await s.saveAccount({ username: 'u-home', password: 'pw-home', remember: true }, 'HomeWiFi')
  await s.saveAccount({ username: 'u-shop', password: 'pw-shop', remember: true }, 'ShopWiFi')

  const a = await s.loadAccount('HomeWiFi')
  const b = await s.loadAccount('ShopWiFi')
  expect('分桶: HomeWiFi 账号', a.username, 'u-home')
  expect('分桶: HomeWiFi 密码', a.password, 'pw-home')
  expect('分桶: ShopWiFi 账号', b.username, 'u-shop')
  expect('分桶: ShopWiFi 密码', b.password, 'pw-shop')

  // 落盘结构: 两个槽位并存, 密码为 AES 密文 (桩输出不含明文)
  const disk = JSON.parse(files.get('DIR/wifi_account.json'))
  expect('落盘: version=2', disk.version, 2)
  expect('落盘: 含两个 SSID', Object.keys(disk.accounts).sort(), ['HomeWiFi', 'ShopWiFi'])
  expect('落盘: 密码非明文', disk.accounts.HomeWiFi.password, stubEncode('pw-home'))
  expect('落盘: 无明文泄露', JSON.stringify(disk).includes('pw-home'), false)
}

/* ---------- 2. 未知 SSID (取不到 WiFi 名) 回退到"最近使用"槽位 ---------- */
{
  const files = new Map()
  const s = makeStore(files)
  await s.saveAccount({ username: 'u1', password: 'p1', remember: true }, 'WiFiA')
  await s.saveAccount({ username: 'u2', password: 'p2', remember: true }, 'WiFiB')

  // 取不到 SSID: 应回退到最近写入的 WiFiB
  const fallback = await s.loadAccount('')
  expect('回退: 空 SSID 取最近使用', fallback.username, 'u2')
  expect('回退: 空 SSID 密码', fallback.password, 'p2')

  // 有 SSID 但未存过: 不应串到别的网络
  const other = await s.loadAccount('NeverSeen')
  expect('隔离: 未存过的 SSID 返回空账号', other.username, '')
  expect('隔离: 未存过的 SSID 无密码', other.password, '')
}

/* ---------- 3. version 1 旧数据自动迁移 ---------- */
{
  const files = new Map()
  const legacy = JSON.stringify({
    version: 1,
    username: 'old-user',
    password: stubEncode('old-pass'),
    remember: true,
    serverBase: 'http://10.0.0.1:8080',
  })
  const s = makeStore(files, legacy)
  const acc = await s.loadAccount('AnyWiFi')
  expect('迁移: 旧账号可读', acc.username, 'old-user')
  expect('迁移: 旧密码可解', acc.password, 'old-pass')
  expect('迁移: 服务端保留', acc.serverBase, 'http://10.0.0.1:8080')
  expect('迁移: remember 保留', acc.remember, true)

  // 迁移后再写入新网络, 旧数据仍在
  await s.saveAccount({ username: 'new', password: 'np', remember: true }, 'NewWiFi')
  const disk = JSON.parse(files.get('DIR/wifi_account.json'))
  expect('迁移: 落盘为 version=2', disk.version, 2)
  expect('迁移: 新旧槽位并存', Object.keys(disk.accounts).sort(), ['', 'NewWiFi'])
}

/* ---------- 4. 损坏数据不抛异常, 回退默认值 ---------- */
{
  const files = new Map()
  const s = makeStore(files, '{ this is not json')
  const acc = await s.loadAccount('X')
  expect('损坏: 回退空账号', acc.username, '')
  expect('损坏: 回退无密码', acc.password, '')
  const acc2 = await s.loadAccount('X')
  expect('损坏: 可重复读取', acc2.username, '')
}

/* ---------- 5. forgetPassword 只清密码, 保留用户名 ---------- */
{
  const files = new Map()
  const s = makeStore(files)
  await s.saveAccount({ username: 'keepme', password: 'secret', remember: true }, 'W')
  await s.forgetPassword('W')
  const acc = await s.loadAccount('W')
  expect('忘记密码: 用户名保留', acc.username, 'keepme')
  expect('忘记密码: 密码已清', acc.password, '')
  expect('忘记密码: remember 关闭', acc.remember, false)
}

/* ---------- 6. SSID 空白归一 (前后空格不产生新槽位) ---------- */
{
  const files = new Map()
  const s = makeStore(files)
  await s.saveAccount({ username: 'u', password: 'p', remember: true }, '  WiFiX  ')
  const acc = await s.loadAccount('WiFiX')
  expect('归一: 去空格后命中', acc.username, 'u')
}

console.log(fail ? `\n${fail} FAILED` : '\nALL PASS')
process.exit(fail ? 1 : 0)
