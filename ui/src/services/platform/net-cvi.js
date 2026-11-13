/*
 * 网络适配层 (CVI / 固件原生 JSAPI)。
 *
 * 真机实测依据 (有道词典笔 CVI 机型, 固件 "IoT Miniapp" 1.6.3 / api=1):
 *   - $falcon.jsapi 暴露的模块: **http** 与 **storage**;
 *   - 运行时没有 `require` (调用即 ReferenceError: require is not defined),
 *     也没有 httpbridge / $jsapi / 全局 fetch —— 手册里的动态 require 兜底在本固件不可用;
 *   - http.request 唯一可用签名 (其余形态返回 "url is empty" 或挂起):
 *       http.request({ url, method, timeout, headers: ['Name:value'] })
 *     返回 Promise:
 *       · 成功 (有响应体): { result: '<响应体字符串(已按 UTF-8 解码)>' }
 *       · 204 空响应:     { error: 3, result: { errorMessage: 'curl curl_easy_getinfo failed, res: 0, resCode:204' } }
 *       · 其它失败:       { error: 3, result: { errorMessage: '... resCode:xxx' } } (无 resCode 才是真失败)
 *   - 固件不返回 HTTP 状态码/响应头, 只有响应体或 errorMessage 里的 resCode。
 *
 * 本层职责: 把固件返回"翻译"成 net-core 的统一形态, 让 detect.js / 适配器零感知:
 *   result 字符串            -> { statusCode: 200, body: result }
 *   errorMessage 带 resCode  -> { statusCode: resCode, body: 空 }  (204 即"无需登入"的硬证据)
 *   其它 error               -> 抛错, 由 net-core 归一为 { ok:false, error }
 *
 * 注意: 相对导入按【目标位置】services/net.js 书写 (CI 会用本文件覆盖它)。
 */
import { createRequest, describeErr, envSsid } from './net-core.js'
import { log } from './logger.js'

var _toldTransport = false

function httpModule() {
  try {
    var j = globalThis.$falcon && globalThis.$falcon.jsapi
    var h = j && j.http
    return h && typeof h.request === 'function' ? h : null
  } catch (e) {
    return null
  }
}

/* 固件要求数组形态的 "Name:value" (对象形态会返回 url is empty / 挂起) */
function asHeaderLines(headers) {
  var out = []
  if (!headers) return out
  if (Array.isArray(headers)) {
    for (var i = 0; i < headers.length; i++) out.push(String(headers[i]))
    return out
  }
  for (var k in headers) {
    if (!Object.prototype.hasOwnProperty.call(headers, k)) continue
    var v = headers[k]
    if (v == null) continue
    out.push(k + ':' + String(v).replace(/[\r\n]+/g, ' '))
  }
  return out
}

function parseResCode(msg) {
  var m = /resCode\s*[:=]\s*(\d{3})/.exec(String(msg || ''))
  return m ? parseInt(m[1], 10) : 0
}

/* 固件返回值 -> net-core 的 raw 形态
 * 注意顺序: 204/失败的返回是 { error, result:{errorMessage} }, result 字段也在,
 * 所以必须先认 error, 再认 result, 否则 204 会被误当成 200+空包体(portal)。 */
function toRaw(r) {
  if (r == null) throw new Error('固件 http 无返回')
  var err = r.error
  if (err != null && err !== 0 && err !== false) {
    var msg = ''
    if (r.result && typeof r.result === 'object' && r.result.errorMessage != null) msg = String(r.result.errorMessage)
    else if (typeof r.result === 'string') msg = r.result
    else msg = String(err)
    var code = parseResCode(msg)
    /* 204/其它 resCode: 固件其实完成了请求, 只是空响应体取信息失败 —— 合成状态码 */
    if (code) return { statusCode: code, headerLines: [], body: new Uint8Array(0) }
    throw new Error('固件 http 错误: ' + msg)
  }
  if (r.result != null) {
    var body = r.result
    if (body && typeof body === 'object') {
      var st = body.statusCode != null ? body.statusCode : body.status != null ? body.status : 0
      var hd = body.headers || body.header || []
      var bd = body.body != null ? body.body : body.data
      if (bd != null) return { statusCode: st || 200, headers: hd, body: bd }
      if (typeof body.text === 'string') return { statusCode: st || 200, headers: hd, body: body.text }
    }
    return { statusCode: 200, body: body }
  }
  throw new Error('固件 http 返回未知形态')
}

var request = createRequest(async function (ctx) {
  var http = httpModule()
  if (!http) throw new Error('该机型固件未提供 $falcon.jsapi.http（无法联网认证）')
  if (!_toldTransport) {
    _toldTransport = true
    try {
      if (typeof log === 'function') log('网络', '传输通道=falcon.jsapi.http (CVI 原生 JSAPI)')
    } catch (e) {}
  }
  var opts = { url: ctx.url, method: String(ctx.method || 'GET').toUpperCase(), timeout: ctx.timeout }
  var lines = asHeaderLines(ctx.headers)
  if (lines.length) opts.headers = lines
  if (ctx.body != null) {
    /* 固件文档未写 POST body 字段; 同时给 body/data, 由固件取其一 (实测 GET 官方首页正常) */
    opts.body = ctx.body
    opts.data = ctx.body
  }
  var r
  try {
    r = await http.request(opts)
  } catch (e) {
    throw new Error('固件 http.request 异常: ' + describeErr(e))
  }
  return toRaw(r)
}, 8)

export { request, describeErr }

/* 当前生效的传输通道名 (空串 = 该固件不可用), 供日志/状态页展示 */
export function describeTransport() {
  return httpModule() ? 'falcon.jsapi.http' : ''
}

/*
 * 当前连接的 WiFi 名称。固件 env 是最可靠的来源 (env.custom.wifiSsid);
 * 部分固件另有 wifi 模块, 逐个试常见取法, 取不到返回空 (上层按"网络名未知"处理)。
 */
export async function wifiSsid() {
  var fromEnv = envSsid()
  if (fromEnv) return fromEnv
  var ns = null
  try {
    ns = globalThis.$falcon && globalThis.$falcon.jsapi && globalThis.$falcon.jsapi.wifi
  } catch (e) {}
  if (ns) {
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
