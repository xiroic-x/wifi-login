/*
 * 账号存储的【共享逻辑层】: 槽位/归一/迁移/读写规则只在这里实现一次,
 * 平台差异 (RK 的 panet 文件 / 32 位系统的 system_kv) 由传入的 io 适配器提供。
 *
 * 存储结构 (version 2):
 *   { version:2, accounts:{ "<ssid>": { username, password(密文), remember, adapter, server } }, ssid, serverBase }
 *
 * io 契约:
 *   read()          -> Promise<string>   读取整份 JSON 文本 (不存在返回空串)
 *   write(text)     -> Promise<boolean>  写入整份 JSON 文本
 *   [dir]           -> 可选, 仅用于日志/诊断
 */
import { paAesEncode, paAesDecode } from './aes.js'

var SCHEMA_VERSION = 2
var KV_KEY = 'wifi_account'

export function createStore(io) {
  var _memory = null // 读写缓存

  function normalizeSsid(ssid) {
    var s = ssid == null ? '' : String(ssid)
    return s.replace(/^\s+|\s+$/g, '')
  }

  function emptySlot() {
    return { username: '', password: '', remember: false, adapter: '', server: '' }
  }

  function defaults() {
    return { version: SCHEMA_VERSION, accounts: {}, ssid: '', serverBase: '' }
  }

  function decodeSlot(raw) {
    var out = emptySlot()
    if (!raw || typeof raw !== 'object') return out
    out.username = typeof raw.username === 'string' ? raw.username : ''
    out.remember = raw.remember === true
    out.adapter = typeof raw.adapter === 'string' ? raw.adapter : ''
    out.server = typeof raw.server === 'string' ? raw.server : ''
    if (raw.password) {
      try {
        out.password = paAesDecode(raw.password)
      } catch (e) {
        out.password = ''
      }
    }
    return out
  }

  function normalize(d) {
    var out = defaults()
    if (!d || typeof d !== 'object') return out
    out.serverBase = typeof d.serverBase === 'string' ? d.serverBase : ''
    out.ssid = normalizeSsid(d.ssid)
    if (d.version === 2 && d.accounts && typeof d.accounts === 'object') {
      for (var k in d.accounts) {
        if (!Object.prototype.hasOwnProperty.call(d.accounts, k)) continue
        out.accounts[normalizeSsid(k)] = decodeSlot(d.accounts[k])
      }
      return out
    }
    if (d.version === 1) {
      var legacy = decodeSlot(d)
      if (legacy.username || legacy.password || legacy.remember) out.accounts[out.ssid] = legacy
      return out
    }
    var loose = decodeSlot(d)
    if (loose.username || loose.password) out.accounts[out.ssid] = loose
    return out
  }

  function encodeSlot(slot) {
    return {
      username: slot.username || '',
      password: slot.password ? paAesEncode(slot.password) : '',
      remember: slot.remember === true,
      adapter: slot.adapter || '',
      server: slot.server || '',
    }
  }

  /*
   * 规范 R9: 键值持久化优先走固件的 sharedpreferences 接口
   * ($falcon.jsapi.storage.setItem/getItem 或 setStorage/getStorage -> data/sharedpreferences/preferences.json),
   * 该接口不存在时才退回平台 io (RK 的文件 / 32 位的原生 KV)。
   * 返回 { ok, value } —— ok=false 表示"这套机制不可用", 由调用方继续走后备。
   */
  function falconStorage() {
    try {
      var f = globalThis.$falcon
      var s = f && f.jsapi && f.jsapi.storage
      if (!s) return null
      if (typeof s.getItem === 'function' || typeof s.getStorage === 'function') return s
    } catch (e) {}
    return null
  }

  function unwrapValue(v, key) {
    if (v == null) return null
    if (typeof v === 'string') return v
    if (typeof v === 'object') {
      if (typeof v.value === 'string') return v.value
      if (v.value != null && typeof v.value !== 'object') return String(v.value)
      if (typeof v[key] === 'string') return v[key]
      if (v.data != null) return typeof v.data === 'string' ? v.data : null
    }
    return null
  }

  async function kvRead(key) {
    var s = falconStorage()
    if (!s) return { ok: false, value: null }
    try {
      if (typeof s.getItem === 'function') {
        var r = await s.getItem({ key: key })
        return { ok: true, value: unwrapValue(r, key) }
      }
      var r2 = await s.getStorage(key)
      return { ok: true, value: unwrapValue(r2, key) }
    } catch (e) {
      return { ok: false, value: null }
    }
  }

  async function kvWrite(key, text) {
    var s = falconStorage()
    if (!s) return false
    try {
      if (typeof s.setItem === 'function') {
        await s.setItem({ key: key, value: text })
        return true
      }
      await s.setStorage(key, text)
      return true
    } catch (e) {
      try {
        await s.setItem(key, text)
        return true
      } catch (e2) {
        return false
      }
    }
  }

  async function read() {
    if (_memory) return _memory
    var d = null
    try {
      var kv = await kvRead(KV_KEY)
      var raw = kv.ok ? kv.value : await io.read()
      if (raw) d = JSON.parse(raw)
    } catch (e) {
      d = null
    }
    _memory = normalize(d)
    return _memory
  }

  async function write() {
    var data = { version: SCHEMA_VERSION, accounts: {}, ssid: _memory.ssid, serverBase: _memory.serverBase }
    for (var k in _memory.accounts) {
      if (!Object.prototype.hasOwnProperty.call(_memory.accounts, k)) continue
      data.accounts[k] = encodeSlot(_memory.accounts[k])
    }
    var text = JSON.stringify(data)
    try {
      if (await kvWrite(KV_KEY, text)) return true
    } catch (e) {}
    try {
      return await io.write(text)
    } catch (e2) {
      return false
    }
  }

  /*
   * 读取当前网络的账号。回退规则:
   *   1) 指定网络名有槽位 -> 用它 (exact)
   *   2) 读不到网络名 -> 用专用 '' 槽位; 没有则回退"最近使用"槽位
   *   3) 指定网络名无槽位, 且库里只有遗留的 '' 槽位 (v1 迁移) -> 用遗留槽位
   * 认证服务器跟着网络走: 只认本槽位存的 server; 旧版全局 serverBase 仅在本网络精确命中
   * (或读不到网络名/遗留槽位) 时沿用, 否则返回空 —— 避免把上一个网络的门户服务器当成当前网络的。
   */
  async function loadAccount(ssid) {
    var db = await read()
    var key = normalizeSsid(ssid)
    var slot = null
    var exact = false
    var legacyFallback = false
    if (key && db.accounts[key]) {
      slot = db.accounts[key]
      exact = true
    } else if (!key && db.accounts['']) {
      slot = db.accounts['']
    } else if (!key && db.ssid && db.accounts[db.ssid]) {
      slot = db.accounts[db.ssid]
    } else if (key && db.accounts[''] && Object.keys(db.accounts).length === 1) {
      slot = db.accounts['']
      legacyFallback = true
    }
    var out = slot
      ? { username: slot.username, password: slot.password, remember: slot.remember, adapter: slot.adapter }
      : emptySlot()
    var trusted = exact || legacyFallback || (!key && !!slot)
    out.serverBase = trusted ? (slot && slot.server) || db.serverBase || '' : ''
    out.exact = exact
    out.trusted = trusted
    out.ssid = db.ssid || ''
    return out
  }

  /* 保存当前网络的账号。网络名未知时写专用 '' 槽位, 绝不复用其它网络的槽位。 */
  async function saveAccount(acc, ssid) {
    var db = await read()
    var key = normalizeSsid(ssid)
    if (key) db.ssid = key
    db.accounts[key] = {
      username: acc.username || '',
      password: acc.password || '',
      remember: acc.remember === true,
      adapter: acc.adapter || '',
      server: acc.serverBase || '',
    }
    if (acc.serverBase) db.serverBase = acc.serverBase
    return write()
  }

  async function forgetPassword(ssid) {
    var db = await read()
    var key = normalizeSsid(ssid) || db.ssid || ''
    var slot = db.accounts[key]
    if (slot) {
      slot.password = ''
      slot.remember = false
    }
    return write()
  }

  async function clearAccount(ssid) {
    var db = await read()
    var key = normalizeSsid(ssid)
    if (key && db.accounts[key]) delete db.accounts[key]
    return write()
  }

  return {
    loadAccount: loadAccount,
    saveAccount: saveAccount,
    forgetPassword: forgetPassword,
    clearAccount: clearAccount,
  }
}

