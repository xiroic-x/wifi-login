/*
 * 网络适配层 (RK / 自研 panet 原生库)。
 * 归一化与超时兜底全在 net-core.js, 本文件只做: 调用原生库 + 解 base64 响应体。
 * 固件不提供系统 http 模块, 网络能力由 libjsapi_panet.so 提供:
 *   request(url, method, timeoutSec) -> Promise<{statusCode, headers:["Name: value"...], body:base64}>
 */
import { Panet } from 'panet'
import { createRequest, describeErr } from './net-core.js'

var _panet = null

function client() {
  if (_panet) return _panet
  _panet = typeof Panet === 'function' ? new Panet() : Panet
  return _panet
}

/* base64 -> bytes; 预建 128 项查表, 大响应体下比 indexOf 快 */
var B64_INDEX = null
function b64Table() {
  if (!B64_INDEX) {
    B64_INDEX = new Int16Array(128)
    var TBL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
    for (var i = 0; i < 128; i++) B64_INDEX[i] = -1
    for (var j = 0; j < TBL.length; j++) B64_INDEX[TBL.charCodeAt(j)] = j
  }
  return B64_INDEX
}

function b64ToBytes(b64) {
  var TBL = b64Table()
  var out = []
  var buf = 0
  var bits = 0
  for (var i = 0; i < b64.length; i++) {
    var c = b64.charCodeAt(i)
    var v = c < 128 ? TBL[c] : -1
    if (v < 0) continue
    buf = (buf << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buf >> bits) & 0xff)
    }
  }
  var arr = new Uint8Array(out.length)
  for (var k = 0; k < out.length; k++) arr[k] = out[k]
  return arr
}

var request = createRequest(async function (ctx) {
  var res = await client().request(ctx.url, ctx.method, ctx.timeout)
  return {
    statusCode: res && res.statusCode,
    headers: res && res.headers,
    body: b64ToBytes(res && typeof res.body === 'string' ? res.body : ''),
    url: res && res.url,
  }
}, 8)

export { request, describeErr }

/* 当前连接的 WiFi 名称 (SSID)。取不到返回空串, 调用方需容忍。 */
export async function wifiSsid() {
  try {
    var c = client()
    if (typeof c.wifiSsid !== 'function') return ''
    var s = await c.wifiSsid()
    return typeof s === 'string' ? s : ''
  } catch (e) {
    return ''
  }
}

/* 检测结果机器可读落盘 (RK: /userdisk/xiro/status.json, 供其他程序读取)。 */
export async function writeStatusFile(content) {
  await client().writeFile('/userdisk/xiro/status.json', content)
  return true
}

