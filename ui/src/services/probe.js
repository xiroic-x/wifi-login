/*
 * 环境与能力探测: 产出页面上直接可展示的报告。
 *
 * 全设备通用: 只依赖运行期可探测的事实, 不写死任何机型的宽度/模块名/版本;
 * 每项都带来源或标记, 探不到就如实报 -, 不猜。
 */
import { envSsid } from './net-core.js'

/* 固件可能注册的 JSAPI 模块名(逐项探测; 固件真报名单以 Object.keys 为准) */
var MODULE_CANDIDATES = [
  'http', 'net', 'request', 'download',
  'storage', 'system_kv', 'kv', 'preference',
  'file', 'fs', 'io',
  'system', 'device', 'deviceinfo', 'os', 'global',
  'wifi', 'network', 'bluetooth', 'brightness', 'volume',
  'soundplayer', 'media', 'player', 'recorder', 'audio',
  'gsensor', 'sensor', 'battery', 'power', 'proxy', 'head',
  'nav', 'router', 'ui', 'input', 'keyboard', 'ime'
]

function safe(fn, dflt) {
  try {
    var v = fn()
    return v === undefined ? dflt : v
  } catch (e) {
    return dflt
  }
}

export function typeOf(v) {
  if (v === null) return 'null'
  if (v === undefined) return 'undefined'
  if (Array.isArray(v)) return 'array'
  return typeof v
}

function keysOf(obj, limit) {
  var out = []
  if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return out
  safe(function () {
    var ks = Object.keys(obj)
    for (var i = 0; i < ks.length && out.length < (limit || 24); i++) out.push(ks[i])
  }, null)
  if (!out.length) {
    safe(function () {
      for (var k in obj) {
        if (out.length >= (limit || 24)) break
        out.push(k)
      }
    }, null)
  }
  return out
}

function falcon() {
  return safe(function () { return globalThis.$falcon }, null)
}

function jsapi() {
  var f = falcon()
  return safe(function () { return (f && f.jsapi) || null }, null)
}

/*
 * 系统与设备信息:
 *   真实值来自平台层 systemInfo() —— RK 由原生读 /etc/os-release + device-tree, CVI 探固件
 *   systemInfo/getVersion; 探不到的字段如实留空, 不再用框架值冒充系统/型号。
 *   $falcon.env 里的 platform/version/deviceModel/apiVersion 属于【小程序框架】, 单独一组。
 */
export function frameworkInfo() {
  var f = falcon()
  var env = safe(function () { return f.env || null }, null)
  var custom = safe(function () { return (env && env.custom) || null }, null)
  return {
    runtimePlatform: safe(function () { return env.platform }, '-'),
    runtimeVersion: safe(function () { return env.version }, '-'),
    apiVersion: safe(function () { return String(env.apiVersion) }, '-'),
    frameworkModel: safe(function () { return env.deviceModel }, '-'),
    theme: safe(function () { return custom && custom.theme }, '-'),
    width: safe(function () { return String(env.currentScreenWidth || (custom && custom.currentScreenWidth)) }, '-'),
    height: safe(function () { return String(env.currentScreenHeight || (custom && custom.currentScreenHeight)) }, '-'),
    deviceWidth: safe(function () { return String(env.deviceWidth) }, '-'),
    deviceHeight: safe(function () { return String(env.deviceHeight) }, '-'),
    ssid: safe(function () { return envSsid() }, '') || '-'
  }
}

/* 采集真实系统信息: 平台层没实现/失败时返回空对象, 由页面显示「-」 */
export async function realSystemInfo(getter) {
  try {
    if (typeof getter === 'function') {
      var r = await getter()
      if (r && typeof r === 'object') return r
    }
  } catch (e) {}
  return {}
}


export function jsapiModules() {
  var j = jsapi()
  var registered = keysOf(j, 40)
  var probed = []
  for (var i = 0; i < MODULE_CANDIDATES.length; i++) {
    var name = MODULE_CANDIDATES[i]
    var m = safe(function () { return j ? j[name] : null }, null)
    if (m === null || m === undefined) continue
    probed.push({ name: name, type: typeOf(m), methods: keysOf(m, 12) })
  }
  return { registered: registered, probed: probed }
}

export function nativeModules() {
  var out = []
  var j = jsapi()
  var g = safe(function () { return globalThis }, null)
  var m = safe(function () { return (j && j.panet) || (g && g.panet) || null }, null)
  out.push({ name: 'panet', ok: !!m, methods: m ? keysOf(m, 12) : [] })
  return out
}

export function runtimeObjects() {
  var f = falcon()
  var g = safe(function () { return globalThis }, null)
  return [
    { name: '$falcon', type: typeOf(g && g.$falcon) },
    { name: '$falcon.jsapi', type: typeOf(f && f.jsapi) },
    { name: '$falcon.App', type: typeOf(f && f.App) },
    { name: '$falcon.Page', type: typeOf(f && f.Page) },
    { name: '$jsapi', type: typeOf(g && g.$jsapi) },
    { name: '$dataDir', type: typeOf(g && g.$dataDir) }
  ]
}

export async function selfCheck(deps) {
  var d = deps || {}
  var out = { storage: '-', net: '-', file: '-', account: '-', migrate: '-' }
  async function run(key, fn) {
    if (typeof fn !== 'function') return
    try {
      out[key] = await fn()
    } catch (e) {
      out[key] = '失败'
    }
  }
  await run('storage', d.probeStorage)
  await run('net', d.probeNet)
  await run('file', d.probeFile)
  await run('account', d.probeAccount)
  await run('migrate', d.probeMigrate)
  return out
}

export async function collectReport(deps) {
  var d = deps || {}
  var mods = jsapiModules()
  var real = await realSystemInfo(d.systemInfo)
  return {
    ts: Date.now(),
    system: frameworkInfo(),
    real: real,
    registered: mods.registered,
    probed: mods.probed,
    native: nativeModules(),
    runtime: runtimeObjects(),
    self: await selfCheck(deps)
  }
}

export function reportLines(rep) {
  var L = []
  if (!rep) return L
  var s = rep.system || {}
  var r = rep.real || {}
  L.push('型号=' + (r.modelName || '-') + ' SKU=' + (r.sku || '-') + ' 主机名=' + (r.hostname || '-') + ' PCBA=' + (r.pcbaVersion || '-'))
  L.push('词典笔OS=' + (r.osVersion || '-') + ' 固件=' + (r.firmwareVersion || '-') + ' 应用=' + (r.appVersion || '-') + ' 编译=' + (r.buildTime || '-'))
  L.push('系统=' + (r.osPretty || r.osName || '-') + (r.osVersionId ? ' ' + r.osVersionId : '')
    + ' 内核=' + (r.kernelVersion || '-') + ' 架构=' + (r.arch || '-'))
  L.push('板型=' + (r.boardModel || '-') + (r.cpuHardware ? ' SoC=' + r.cpuHardware : ''))
  L.push('框架=' + s.runtimePlatform + ' / ' + s.runtimeVersion + ' / api ' + s.apiVersion + ' / ' + s.frameworkModel)
  L.push('机型族=' + s.theme + ' 逻辑屏=' + s.width + 'x' + s.height + ' 物理=' + s.deviceWidth + 'x' + s.deviceHeight + ' 网络=' + s.ssid)

  for (var i = 0; i < (rep.probed || []).length; i++) {
    var p = rep.probed[i]
    L.push('  ' + p.name + '(' + p.type + ') ' + (p.methods || []).join(' '))
  }
  for (var j = 0; j < (rep.native || []).length; j++) {
    var n = rep.native[j]
    L.push('原生 ' + n.name + '=' + (n.ok ? '可用' : '无') + (n.methods && n.methods.length ? ' ' + n.methods.join(' ') : ''))
  }
  var self = rep.self || {}
  L.push('自检 存储=' + self.storage + ' 网络=' + self.net + ' 文件=' + self.file + ' 账号=' + self.account + ' 迁移=' + self.migrate)
  return L
}
