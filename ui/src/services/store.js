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

function dataDir() {
  try {
    return globalThis.$dataDir || ''
  } catch (e) {
    return ''
  }
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
  readKey: async function (name) {
    var d = dataDir()
    if (!d) return ''
    try {
      return await client().readFile(d + '/' + name + '.json')
    } catch (e) {
      return ''
    }
  },
  writeKey: async function (name, text) {
    var d = dataDir()
    if (!d) return false
    try {
      await client().writeFile(d + '/' + name + '.json', text)
      return true
    } catch (e) {
      return false
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
 * 旧数据迁移: 早期版本把账号/日志/状态写在 /userdisk/xiro/ 下(规范外目录,
 * 既不参与设置"空间清理", 卸载也不清理)。业务数据现已统一到 <appid>/data/,
 * 这里把旧文件搬进来 —— 只在【目标不存在】且【源可读】时搬, 绝不覆盖新数据。
 * 返回 { moved: [名字...], skipped: [名字...] }。
 */
export async function migrateLegacy() {
  var moved = []
  var skipped = []
  var d = dataDir()
  if (!d) return { moved: moved, skipped: skipped }
  var pairs = [
    ['/userdisk/xiro/wifi_account.json', d + '/wifi_account.json', '账号'],
    ['/userdisk/xiro/status.json', d + '/status.json', '检测结果'],
    ['/userdisk/xiro/wifi.log', d + '/wifi.log.legacy', '旧日志']
  ]
  for (var i = 0; i < pairs.length; i++) {
    var src = pairs[i][0]
    var dst = pairs[i][1]
    var label = pairs[i][2]
    try {
      var content = await client().readFile(src)
      if (!content) continue
      var exists = ''
      try { exists = await client().readFile(dst) } catch (e1) { exists = '' }
      if (exists) { skipped.push(label); continue }
      await client().writeFile(dst, content)
      moved.push(label)
    } catch (e2) {}
  }
  return { moved: moved, skipped: skipped }
}

