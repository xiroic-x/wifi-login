/*
 * 账号存储 (32 位 / 原生 KV 版)。
 * 逻辑全在 store-core.js, 本文件只提供"键值存储"这一层平台差异。
 *
 * 固件暴露的模块名/方法名各代不一 (system_kv / storage, setItem / set / put),
 * 这里运行时逐个探测并容错; 全都不可用时退化为内存 (本次运行有效), 保证界面不崩。
 * 注意: 相对导入按【目标位置】services/store.js 书写 (CI 会用本文件覆盖它)。
 */
import kvModule from '$jsapi/system_kv'
import { createStore } from './store-core.js'

var KV_KEY = 'wifi_account'
var _kv = null
var _memText = ''

function client() {
  if (_kv) return _kv
  if (typeof kvModule === 'function') {
    try {
      _kv = new kvModule()
    } catch (e) {
      _kv = kvModule
    }
  } else {
    _kv = kvModule || null
  }
  return _kv
}

/* 逐个试方法名; 同步/异步都兼容 */
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
      /* 方法名存在但签名不符: 继续试下一个 */
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
    if (!r.ok) {
      _memText = text // KV 不可用: 内存兜底, 至少本次运行内可用
      return true
    }
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

