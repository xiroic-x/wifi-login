/*
 * 账号存储 (RK / panet 文件版)。
 * 逻辑全在 store-core.js, 本文件只提供"文件读写"这一层平台差异。
 */
import { Panet } from 'panet'
import { createStore } from './store-core.js'

var _panet = null
var _storePath = null
var _memText = ''

function client() {
  if (!_panet) _panet = typeof Panet === 'function' ? new Panet() : Panet
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

var api = createStore({
  read: async function () {
    var p = storePath()
    if (!p) return _memText
    try {
      return await client().readFile(p)
    } catch (e) {
      return ''
    }
  },
  write: async function (text) {
    var p = storePath()
    if (!p) {
      _memText = text // 无 $dataDir 时退化为内存 (本次运行有效)
      return true
    }
    try {
      await client().writeFile(p, text)
      return true
    } catch (e) {
      return false
    }
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

