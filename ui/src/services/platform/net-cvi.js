/*
 * 网络适配层 (32 位 / 固件原生 JSAPI)。
 *
 * 实测依据 (从 X5(cv1826) 固件镜像提取):
 *   - /etc/miniapp/jsapis/libjsapi_export.so 注册的模块是:
 *     wifi / volume / soundplayer / gsensor / global / brightness / bluetooth / battery / system / proxy / head
 *     —— 没有 http, 也没有 net;
 *   - /usr/lib/libfalcon.so 里有 handleHttpRequest / BaseHttpRouter / CurlDownload
 *     —— 网络能力在 falcon 运行时里, 不在 $jsapi 模块里;
 *   - 因此旧版静态导入 $jsapi/http 是"按名字猜"的模块: 固件没有它时, 整个 bundle 在
 *     加载期就会失败(不只是网络不可用)。本版改为运行时探测, 不再静态导入。
 *
 * 探测顺序(命中即用, 命中项可经 describeTransport() 取出写进日志, 便于取证):
 *   $falcon.jsapi.http.request -> $falcon.jsapi.net.* -> $falcon.jsapi.system.*
 *   -> $falcon.jsapi.request  -> $jsapi.http.* -> 全局 httpModule
 * 响应归一化统一交给 net-core。
 * 注意: 相对导入按【目标位置】services/net.js 书写 (CI 会用本文件覆盖它)。
 */
import { createRequest, describeErr, envSsid } from './net-core.js'
import { log } from './logger.js'
var _toldTransport = false

var _transport = null // { label, ns, fn }

function jsapi() {
  try {
    return globalThis.$falcon && globalThis.$falcon.jsapi ? globalThis.$falcon.jsapi : null
  } catch (e) {
    return null
  }
}

function looksLikeResponse(r) {
  if (r == null) return false
  if (typeof r === 'string') return true
  return r.status != null || r.statusCode != null || r.code != null || r.body != null || r.data != null
}

function asObject(headers) {
  var out = {}
  if (Array.isArray(headers)) {
    for (var i = 0; i < headers.length; i++) {
      var idx = String(headers[i]).indexOf(':')
      if (idx > 0) out[String(headers[i]).slice(0, idx).trim()] = String(headers[i]).slice(idx + 1).trim()
    }
    return out
  }
  if (headers && typeof headers === 'object') return headers
  return out
}

/* 逐个候选: 参数形态不合就换下一种, 拿到"像响应"的结果才算命中 */
async function invoke(ns, fn, ctx, payload) {
  var calls = []
  if (ns && typeof ns.request === 'function') {
    calls.push(function () { return ns.request(payload) })
    calls.push(function () { return ns.request(ctx.url, payload) })
  }
  if (ns && typeof ns.get === 'function' && String(ctx.method).toUpperCase() === 'GET') {
    calls.push(function () { return ns.get(ctx.url, payload) })
    calls.push(function () { return ns.get(ctx.url) })
  }
  if (fn) {
    calls.push(function () { return fn(payload) })
    calls.push(function () { return fn(ctx.url, payload) })
    calls.push(function () { return fn(ctx.url) })
  }
  for (var i = 0; i < calls.length; i++) {
    try {
      var r = await calls[i]()
      if (looksLikeResponse(r)) return r
    } catch (e) {
      /* 该形态不成立, 继续 */
    }
  }
  return null
}

function pickTransport() {
  if (_transport) return _transport
  var j = jsapi()
  var list = []
  if (j) {
    list.push({ label: 'falcon.http', ns: j.http })
    list.push({ label: 'falcon.net', ns: j.net })
    list.push({ label: 'falcon.system', ns: j.system })
    if (typeof j.request === 'function') list.push({ label: 'falcon.request', fn: j.request })
    if (typeof j.get === 'function') list.push({ label: 'falcon.get', fn: j.get })
  }
  try {
    var legacy = globalThis.$jsapi
    if (legacy) {
      list.push({ label: 'jsapi.http', ns: legacy.http })
      list.push({ label: 'jsapi.net', ns: legacy.net })
    }
  } catch (e) {}
  list.push({ label: 'global.http', ns: globalThis.httpModule })
  for (var i = 0; i < list.length; i++) {
    var c = list[i]
    var usable =
      (c.ns && (typeof c.ns.request === 'function' || typeof c.ns.get === 'function')) ||
      (typeof c.fn === 'function')
    if (usable) {
      _transport = { label: c.label, ns: c.ns, fn: c.fn }
      return _transport
    }
  }
  _transport = { label: '', ns: null, fn: null }
  return _transport
}

/* 当前生效的传输通道名 (空串 = 该固件未提供可用网络能力), 供日志/状态页展示 */
export function describeTransport() {
  return pickTransport().label
}

var request = createRequest(async function (ctx) {
  var t = pickTransport()
  if (!_toldTransport) {
    _toldTransport = true
    try {
      if (typeof log === 'function') log('网络', '传输通道=' + (t.label || '无'))
    } catch (e) {}
  }
  var payload = { url: ctx.url, method: ctx.method, timeout: ctx.timeout }
  if (ctx.headers) payload.headers = asObject(ctx.headers)
  if (ctx.body != null) payload.data = ctx.body
  var r = await invoke(t.ns, t.fn, ctx, payload)
  if (r != null) return r
  throw new Error(
    t.label
      ? '固件网络接口 ' + t.label + ' 调用失败'
      : '该机型固件未提供可用的网络接口 (已试 falcon.http/net/system/request 与 jsapi.http)'
  )
}, 8)

export { request, describeErr }

/*
 * 当前连接的 WiFi 名称。固件 wifi 模块实测含 ssid 相关能力
 * (libjsapi_export.so: jsapi_wifi_module / ssid / getWifiPassWd / isConnected),
 * 因此不再固定返回空串: 逐个试常见取法, 取不到才返回空 (上层按"网络名未知"处理)。
 */
export async function wifiSsid() {
  /* 固件 env 是最可靠的来源, 两个平台通用 */
  var fromEnv = envSsid()
  if (fromEnv) return fromEnv
  var j = jsapi()
  var nsList = []
  if (j && j.wifi) nsList.push(j.wifi)
  try {
    if (globalThis.$jsapi && globalThis.$jsapi.wifi) nsList.push(globalThis.$jsapi.wifi)
  } catch (e) {}
  nsList.push(globalThis.wifiModule)
  for (var i = 0; i < nsList.length; i++) {
    var ns = nsList[i]
    if (!ns) continue
    var fns = ['getWifiInfo', 'getConnectedWifi', 'getCurrentWifi', 'getSsid', 'getConnectWifiInfo']
    for (var k = 0; k < fns.length; k++) {
      if (typeof ns[fns[k]] !== 'function') continue
      try {
        var r = await ns[fns[k]]()
        var s = pickSsid(r)
        if (s) return s
      } catch (e) {}
    }
    var direct = pickSsid(ns)
    if (direct) return direct
  }
  return ''
}

function pickSsid(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v !== 'object') return ''
  var keys = ['ssid', 'SSID', 'Ssid', 'name', 'wifiName', 'currentSsid']
  for (var i = 0; i < keys.length; i++) {
    var x = v[keys[i]]
    if (typeof x === 'string' && x) return x
  }
  if (v.data) return pickSsid(v.data)
  if (v.wifiInfo) return pickSsid(v.wifiInfo)
  return ''
}

/*
 * 检测结果机器可读落盘。
 * 规范 R5: 业务数据只写 <appid>/data/; 本平台无文件 JS 模块时保持 no-op,
 * 不让上层因为取不到落盘能力而报错。
 */
export async function writeStatusFile(content) {
  return false
}

