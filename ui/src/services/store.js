/*
 * storage-kv 适配: 记住账号密码 (密码 AES 加密后落盘) + 上次认证服务器。
 * 读取失败/损坏一律回退默认值, 不抛异常。
 */

import storage from 'storage'
import { paAesEncode, paAesDecode } from './aes.js'

var KEY_ACCOUNT = 'wifi_account_v1'
var SCHEMA_VERSION = 1

async function getJson(key) {
  try {
    var raw = await storage.getStorage(key)
    if (raw == null) return null
    if (typeof raw === 'object') {
      if (typeof raw.data === 'string') raw = raw.data
      else if (typeof raw.value === 'string') raw = raw.value
      else return null
    }
    return JSON.parse(raw)
  } catch (e) {
    return null
  }
}

async function setJson(key, obj) {
  try {
    await storage.setStorage(key, JSON.stringify(obj))
    return true
  } catch (e) {
    return false
  }
}

export async function loadAccount() {
  var d = await getJson(KEY_ACCOUNT)
  if (!d || d.version !== SCHEMA_VERSION || typeof d !== 'object') {
    return { version: SCHEMA_VERSION, username: '', password: '', remember: false, serverBase: '' }
  }
  var password = ''
  if (d.password) {
    try {
      password = paAesDecode(d.password)
    } catch (e) {
      password = ''
    }
  }
  return {
    version: SCHEMA_VERSION,
    username: typeof d.username === 'string' ? d.username : '',
    password: password,
    remember: d.remember === true,
    serverBase: typeof d.serverBase === 'string' ? d.serverBase : '',
  }
}

/* password 以 AES 密文落盘, 不存明文 */
export function saveAccount(acc) {
  return setJson(KEY_ACCOUNT, {
    version: SCHEMA_VERSION,
    username: acc.username || '',
    password: acc.password ? paAesEncode(acc.password) : '',
    remember: acc.remember === true,
    serverBase: acc.serverBase || '',
  })
}
