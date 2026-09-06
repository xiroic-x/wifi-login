/*
 * http JSAPI 适配层。
 * 固件内置 http 模块 (libfalcon.so), 文档形态: http.request({url,method,headers,data,timeout})
 * 返回 Promise。返回值可能是 ArrayBuffer/Uint8Array(二进制 body), 也可能是带
 * statusCode/headers 的对象。这里统一归一化, 页面只消费稳定结构。
 */

import { http } from 'http'

function bytesFromArrayLike(arr) {
  var out = new Uint8Array(arr.length || 0)
  for (var i = 0; i < out.length; i++) out[i] = arr[i] & 0xff
  return out
}

export function toBytes(data) {
  if (data == null) return new Uint8Array(0)
  if (typeof data === 'string') return utf8Bytes(data)
  if (typeof data.length === 'number' && typeof data.byteLength !== 'number') {
    return bytesFromArrayLike(data)
  }
  if (typeof data.byteLength === 'number') {
    var view = data instanceof Uint8Array ? data : new Uint8Array(data)
    return new Uint8Array(view)
  }
  return new Uint8Array(0)
}

function utf8Bytes(str) {
  var out = []
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      var c2 = str.charCodeAt(i + 1)
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00)
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
        i++
      } else out.push(0xef, 0xbf, 0xbd)
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
  }
  return bytesFromArrayLike(out)
}

/* 单字节字符串: 每个字符一个字节, 用于把二进制当 latin1 文本处理 */
export function bytesToLatin1(bytes) {
  var s = ''
  var CHUNK = 4096
  for (var i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length)))
  }
  return s
}

/*
 * 发起请求。
 * 返回: { ok, statusCode, headers, body: Uint8Array, text: latin1 文本, error }
 * 永不 throw, 调用方按 ok 分支处理。
 */
export async function request(opts) {
  var req = {
    url: opts.url,
    method: opts.method || 'GET',
    timeout: opts.timeout || 8,
  }
  if (opts.headers) req.headers = opts.headers
  var res
  try {
    res = await http.request(req)
  } catch (e) {
    return { ok: false, statusCode: 0, headers: null, body: new Uint8Array(0), text: '', error: '网络请求失败: ' + describeErr(e) }
  }
  var statusCode = 0
  var headers = null
  var bodyData = null
  if (res && typeof res === 'object' && typeof res.byteLength !== 'number' && typeof res.length !== 'number') {
    statusCode = numOr(res.statusCode, numOr(res.status, numOr(res.code, 0)))
    headers = res.headers || res.header || null
    bodyData = res.data !== undefined ? res.data : res.body !== undefined ? res.body : res.bytes !== undefined ? res.bytes : null
  } else {
    bodyData = res
  }
  var body = toBytes(bodyData)
  return {
    ok: true,
    statusCode: statusCode,
    headers: headers,
    body: body,
    text: bytesToLatin1(body),
    error: '',
  }
}

function numOr(v, d) {
  return typeof v === 'number' ? v : d
}

export function describeErr(e) {
  if (e == null) return '未知错误'
  if (typeof e === 'string') return e
  if (e.message) return e.message
  try {
    return JSON.stringify(e)
  } catch (err) {
    return String(e)
  }
}
