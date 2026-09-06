/*
 * 持久化适配: 固件不提供 storage JS 模块, 用 panet.writeFile/readFile
 * 把账号数据存到应用私有数据目录 ($dataDir), JSON + 密码 AES 密文。
 * 读取失败/损坏一律回退默认值, 不抛异常。
 */

import { Panet } from 'panet'
import { paAesEncode, paAesDecode } from './aes.js'

var SCHEMA_VERSION = 1
var _panet = null
var _storePath = null
var _memory = null // 读写缓存; $dataDir 不可用时作为唯一存储

function client() {
  if (!_panet) _panet = new Panet()
  return _panet
}

function storePath() {
  if (_storePath !== null) return _storePath
  var dir = ''
  try {
    dir = globalThis.$dataDir || ''
  } catch (e) {
    dir = ''
  }
  _storePath = dir ? dir + '/wifi_account.json' : ''
  return _storePath
}

function defaults() {
  return { version: SCHEMA_VERSION, username: '', password: '', remember: false, serverBase: '' }
}

function normalize(d) {
  if (!d || typeof d !== 'object' || d.version !== SCHEMA_VERSION) return defaults()
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

export async function loadAccount() {
  if (_memory) return _memory
  var path = storePath()
  var d = null
  if (path) {
    try {
      var raw = await client().readFile(path)
      if (raw) d = JSON.parse(raw)
    } catch (e) {
      d = null
    }
  }
  _memory = normalize(d)
  return _memory
}

/* password 以 AES 密文落盘, 不存明文 */
export async function saveAccount(acc) {
  var data = {
    version: SCHEMA_VERSION,
    username: acc.username || '',
    password: acc.password ? paAesEncode(acc.password) : '',
    remember: acc.remember === true,
    serverBase: acc.serverBase || '',
  }
  var mem = defaults()
  mem.username = data.username
  mem.password = acc.password || ''
  mem.remember = data.remember
  mem.serverBase = data.serverBase
  _memory = mem
  var path = storePath()
  if (!path) return false
  try {
    await client().writeFile(path, JSON.stringify(data))
    return true
  } catch (e) {
    return false
  }
}
