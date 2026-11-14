/*
 * 网络适配层 (RK / 自研 panet 原生库)。
 * 归一化与超时兜底全在 net-core.js, 本文件只做: 调用原生库 + 解 base64 响应体。
 * 固件不提供系统 http 模块, 网络能力由 libjsapi_panet.so 提供:
 *   request(url, method, timeoutSec, body, headerText)
 *     -> Promise<{statusCode, headers:["Name: value"...], body:base64}>
 * body / headerText 可选: H3C iMC 等门户登录必须 POST 表单并带 Referer/Cookie 头。
 * 旧版 .so 会忽略第 4/5 个参数 (只发 query 串), 适配器需保证参数在 query 中也有副本。
 */
import { Panet } from 'panet'
import { createRequest, describeErr, envSsid } from './net-core.js'
import { log } from './logger.js'
var _toldTransport = false

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

/*
 * 当前生效的传输通道名 (空串 = 该固件不可用)。
 * 供日志与兼容性检测使用: 原生扩展以 ES 模块注册, 不在 globalThis 上,
 * 只能由平台层自报 —— CVI 平台层同样导出本函数(报告固件 JSAPI 通道)。
 */

/*
 * 真实系统信息(原生读取 /etc/os-release、/proc/version、device-tree、/proc/cpuinfo)。
 * 页面要显示的"系统版本 / 设备型号"只能是这里的值: $falcon.env 里的是小程序框架版本。
 * 返回对象; 原生方法缺失或失败时返回 null, 由上层自行降级展示。
 */
export async function systemInfo() {
  try {
    var c = client()
    if (!c || typeof c.systemInfo !== 'function') return null
    var raw = await c.systemInfo()
    if (!raw) return null
    if (typeof raw === 'string') return JSON.parse(raw)
    return raw
  } catch (e) {
    try { log('系统', 'systemInfo 失败 ' + (e && e.message ? e.message : e)) } catch (e2) {}
    return null
  }
}

export function describeTransport() {
  return client() ? 'panet (自研原生库)' : ''
}
var request = createRequest(async function (ctx) {
  /* 只解前若干字节的 base64: 响应体可能很大, 全解会在 JS 主线程做 O(n) 运算 */
  var cap = ctx.maxBytes > 0 ? Math.ceil((ctx.maxBytes * 4) / 3) + 8 : 0
  if (!_toldTransport) {
    _toldTransport = true
    try {
      if (typeof log === 'function') log('网络', '传输通道=panet (自研原生库)')
    } catch (e) {}
  }
  /* 自定义请求头序列化为 "Name: value\r\n" 文本; 原生层负责过滤非法行 */
  var headerText = ''
  if (ctx.headers) {
    for (var k in ctx.headers) {
      if (!Object.prototype.hasOwnProperty.call(ctx.headers, k)) continue
      var v = ctx.headers[k]
      if (v == null) continue
      headerText += k + ': ' + String(v).replace(/[\r\n]+/g, ' ') + '\r\n'
    }
  }
  var body = ctx.body == null ? '' : String(ctx.body)
  var res = await client().request(ctx.url, ctx.method, ctx.timeout, body, headerText)
  return {
    statusCode: res && res.statusCode,
    headers: res && res.headers,
    body: b64ToBytes(res && typeof res.body === 'string' ? (cap > 0 ? res.body.slice(0, cap) : res.body) : ''),
    url: res && res.url,
  }
}, 8)

export { request, describeErr }

/* 当前连接的 WiFi 名称 (SSID)。取不到返回空串, 调用方需容忍。 */
export async function wifiSsid() {
  /* 固件 env 里就有当前网络名(实测真机 env.custom.wifiSsid), 最先用 */
  var fromEnv = envSsid()
  if (fromEnv) return fromEnv
  try {
    var c = client()
    if (typeof c.wifiSsid !== 'function') return ''
    var s = await c.wifiSsid()
    return typeof s === 'string' ? s : ''
  } catch (e) {
    return ''
  }
}

/* 检测结果机器可读落盘。
 * 规范 R5: 业务数据只写 <appid>/data/ ($dataDir), 供其他程序读取同一路径即可;
 * 取不到 $dataDir 时不写, 不再落到规范外目录。 */
export async function writeStatusFile(content) {
  var dir = ''
  try {
    dir = globalThis.$dataDir || ''
  } catch (e) {
    dir = ''
  }
  if (!dir) return false
  await client().writeFile(dir + '/status.json', content)
  return true
}

