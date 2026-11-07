/*
 * 网络适配层 (32 位 / 固件原生 http 模块)。
 * 归一化与超时兜底全在 net-core.js, 本文件只负责"把请求交给固件模块"。
 *
 * 各代固件暴露的模块形态不一 (对象/构造函数、request(obj)/request(url,opts)/get),
 * 这里运行时逐个探测; 响应形状由 net-core 的归一化统一吃掉。
 * 注意: 相对导入按【目标位置】services/net.js 书写 (CI 会用本文件覆盖它)。
 */
import httpModule from '$jsapi/http'
import { createRequest, describeErr } from './net-core.js'

var _http = null

function client() {
  if (_http) return _http
  if (typeof httpModule === 'function') {
    try {
      _http = new httpModule()
    } catch (e) {
      _http = httpModule
    }
  } else {
    _http = httpModule
  }
  return _http
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

var request = createRequest(async function (ctx) {
  var c = client()
  var payload = { url: ctx.url, method: ctx.method, timeout: ctx.timeout }
  if (ctx.headers) payload.headers = asObject(ctx.headers)
  if (ctx.body != null) payload.data = ctx.body

  /* 形状校验: 拿到"像响应"的结果才认, 否则继续试其它调用形式 */
  var looksLikeResponse = function (r) {
    if (r == null) return false
    if (typeof r === 'string') return true
    return r.status != null || r.statusCode != null || r.code != null || r.body != null || r.data != null
  }
  /* 1) request({...}) / request(url, {...}) —— 最常见 */
  if (c && typeof c.request === 'function') {
    try {
      var r1 = await c.request(payload)
      if (looksLikeResponse(r1)) return r1
    } catch (e) {}
    try {
      var r2 = await c.request(ctx.url, payload)
      if (looksLikeResponse(r2)) return r2
    } catch (e2) {}
  }
  /* 2) get/post(...) */
  var m = String(ctx.method || 'GET').toUpperCase()
  var fn = m === 'POST' && typeof c.post === 'function' ? c.post : c.get
  if (typeof fn === 'function') {
    try {
      return await fn.call(c, ctx.url, payload)
    } catch (e3) {
      try {
        return await fn.call(c, ctx.url)
      } catch (e4) {}
    }
  }
  throw new Error('固件未提供可用的 http 能力 (试过 request/get/post)')
}, 8)

export { request, describeErr }

/* 该平台无"当前连接 SSID"查询接口: 返回空串, 上层按"网络名未知"处理。 */
export async function wifiSsid() {
  return ''
}

/* 该平台无文件模块, status.json 无法写入, 保持接口一致为 no-op。 */
export async function writeStatusFile(content) {
  return false
}

