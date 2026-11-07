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

