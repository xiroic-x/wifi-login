/*
 * 账号存储 (32 位 / 原生 JSAPI)。
 *
 * 实测依据 (X5(cv1826) 固件镜像): libjsapi_export.so 注册的模块里**没有 system_kv**,
 * 但 /usr/lib/libfalcon.so 里有 setStorage / getStorage / removeStorage / clearStorage /
 * setGlobalStorage / getSharedStorage —— 键值能力在 falcon 运行时。
 * 因此本文件不再静态导入任何模块名(固件没有该模块会导致整包加载失败), 改为:
 *   1) 共享内核 store-core 里的 $falcon.jsapi.storage 优先路径 (规范 R9, 写 data/sharedpreferences/);
 *   2) 运行时探测全局注入的 KV 模块 (globalThis.$jsapi.system_kv / globalThis.system_kv);
 *   3) 都没有 -> 内存, 保证界面可用。
 * 逻辑(槽位/归一/迁移)全在 store-core.js, 本文件只提供 I/O。
 * 注意: 相对导入按【目标位置】services/store.js 书写 (CI 会用本文件覆盖它)。
 */
import { createStore } from './store-core.js'

var KV_KEY = 'wifi_account'
var _kv = null
var _memText = ''

/* 运行时探测: 不 import, 因此模块不存在也不会影响加载 */
function client() {
  if (_kv) return _kv
  try {
    var j = globalThis.$jsapi
    if (j && j.system_kv) _kv = j.system_kv
    else if (globalThis.system_kv) _kv = globalThis.system_kv
  } catch (e) {}
  return _kv || null
}

async function kvCall(names, key, val) {
  var c = client()
  if (!c) return { ok: false }
  for (var i = 0; i < names.length; i++) {
    var fn = c[names[i]]
    if (typeof fn !== 'function') continue
    try {
      var r = val === undefined ? fn.call(c, key) : fn.call(c, key, val)
      if (r && typeof r.then === 'function') r = await r
      return { ok: true, value: r }
    } catch (e) {
      /* 方法名在但签名不符: 试下一个 */
    }
  }
  return { ok: false }
}

var api = createStore({
  read: async function () {
    var r = await kvCall(['getItem', 'get', 'getValue', 'read'])
    if (!r.ok) return _memText
    var v = r.value
    if (v == null) return _memText
    if (typeof v === 'string') return v === 'undefined' || v === 'null' ? _memText : v
    try {
      return JSON.stringify(v)
    } catch (e) {
      return _memText
    }
  },
  readKey: async function (name) {
    var r = await kvCall(['getItem', 'get'], name)
    if (!r.ok || r.value == null) return ''
    return typeof r.value === 'string' ? r.value : JSON.stringify(r.value)
  },
  writeKey: async function (name, text) {
    var r = await kvCall(['setItem', 'set', 'put'], name, text)
    return !!r.ok
  },

  write: async function (text) {
    var r = await kvCall(['setItem', 'set', 'setValue', 'put'], KV_KEY, text)
    _memText = text
    return true
  },
})

export async function loadAccount(ssid) {
  return api.loadAccount(ssid)
}

export async function saveAccount(acc, ssid) {
  return api.saveAccount(acc, ssid)
}

export async function forgetPassword(ssid) {
  return api.forgetPassword(ssid)
}

export async function clearAccount(ssid) {
  return api.clearAccount(ssid)
}

/* 清除全部网络槽位的账号(设置里"空间清理"入口用) */
export async function clearAllAccounts() {
  return api.clearAllAccounts()
}

export async function readState() {
  return api.readState()
}

export async function writeState(patch) {
  return api.writeState(patch)
}

/*
 * 旧数据迁移:
 * 本平台固件的 JSAPI 模块表里没有独立 file 模块, 但不同固件代次可能挂在
 * falcon.jsapi.file / fs / io 或 system 下面 —— 这里【运行时探测】文件能力,
 * 探到就真迁移(把 /userdisk/xiro/ 下的旧账号/状态搬进 <appid>/data/ 或 KV),
 * 探不到就明确记录原因并返回空结果(不会误删任何东西)。
 * 账号本体一直用同一个 KV 键(wifi_account)与同一份 schema, 数据连续性不受影响。
 */
function fileApi() {
  var names = [file, fs, io,
  try {
    var j = globalThis.$falcon && globalThis.$falcon.jsapi
    if (!j) return null
    for (var i = 0; i < names.length; i++) {
      var ns = j[names[i]]
      if (ns && (typeof ns.readFile === 'function' || typeof ns.read === 'function')) return ns
    }
    if (j.system && (typeof j.system.readFile === 'function' || typeof j.system.read === 'function')) return j.system
    if (typeof j.readFile === 'function') return j
  } catch (e) {}
  return null
}

async function fileRead(ns, path) {
  try {
    var fn = ns.readFile || ns.read
    var r = fn.call(ns, path)
    if (r && typeof r.then === 'function') r = await r
    return typeof r === 'string' ? r : r ? JSON.stringify(r) : ''
  } catch (e) {
    return ''
  }
}

async function fileWrite(ns, path, text) {
  try {
    var fn = ns.writeFile || ns.write
    if (typeof fn !== 'function') return false
    var r = fn.call(ns, path, text)
    if (r && typeof r.then === 'function') await r
    return true
  } catch (e) {
    return false
  }
}

export async function migrateLegacy() {
  var out = { moved: [], skipped: [], reason: '' }
  var ns = fileApi()
  if (!ns) {
    out.reason = '该机型固件未提供文件接口, 无旧文件可迁移(账号走 KV, 键与结构未变)'
    return out
  }
  var dir = ''
  try {
    dir = globalThis.$dataDir || ''
  } catch (e) { dir = '' }
  if (!dir) { out.reason = '无 $dataDir, 跳过文件迁移'; return out }
  var pairs = [
    ['/userdisk/xiro/wifi_account.json', dir + '/wifi_account.json', '账号'],
    ['/userdisk/xiro/status.json', dir + '/status.json', '检测结果'],
    ['/userdisk/xiro/wifi.log', dir + '/wifi.log.legacy', '旧日志']
  ]
  for (var i = 0; i < pairs.length; i++) {
    var content = await fileRead(ns, pairs[i][0])
    if (!content) continue
    var exists = await fileRead(ns, pairs[i][1])
    if (exists) { out.skipped.push(pairs[i][2]); continue }
    if (await fileWrite(ns, pairs[i][1], content)) out.moved.push(pairs[i][2])
  }
  return out
}

