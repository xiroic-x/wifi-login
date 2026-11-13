/*
 * 网络请求的【共享内核】: 超时兜底与响应归一化只在这里实现一次,
 * 平台差异 (RK 的自研 panet 库 / 32 位系统的原生 http 模块) 由 transport 提供。
 *
 * transport(ctx) -> Promise<raw>, raw 可以是各代固件返回的任意形状:
 *   { status|statusCode|code, headers, body|data } 或 { body } 或字符串
 * 归一化后对外契约固定为 (页面/适配器只依赖它):
 *   { ok, statusCode, headerLines, headers(小写键 map), body: Uint8Array, text, error, finalUrl }
 */

/*
 * 当前 WiFi 名: 固件运行环境里就有 (实测 env.custom.wifiSsid = 真机 SSID)。
 * 这是最可靠的来源, 两个平台都能取到, 拿不到再退各平台自己的手段。
 */
export function envSsid() {
  try {
    var f = globalThis.$falcon
    var c = f && f.env && f.env.custom
    var s = c && (c.wifiSsid || c.wifiSsidName || c.ssid)
    if (typeof s === 'string' && s && s !== 'unknown') return s
  } catch (e) {}
  return ''
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

/* Promise 加硬超时: 原生实现挂起时也要能给调用方结论 */
export function raceTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    var done = false
    var timer = setTimeout(function () {
      if (done) return
      done = true
      reject(new Error('请求超时 (' + Math.round(ms / 1000) + 's)'))
    }, ms)
    promise.then(
      function (v) {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(v)
      },
      function (e) {
        if (done) return
        done = true
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

function toStatus(v) {
  if (typeof v === 'number' && v > 0) return v
  if (typeof v === 'string' && /^\d+$/.test(v)) return parseInt(v, 10)
  return 0
}

/* 头部归一: 对象(任意大小写) / ["K: v"] / [[k,v]] / {get(k)} / entries() 全兼容 */
export function normalizeHeaders(raw) {
  var map = {}
  function put(k, v) {
    if (k == null) return
    map[String(k).toLowerCase()] = v == null ? '' : String(v)
  }
  if (!raw) return map
  if (Array.isArray(raw)) {
    for (var i = 0; i < raw.length; i++) {
      var it = raw[i]
      if (Array.isArray(it) && it.length >= 2) {
        put(it[0], it[1])
      } else if (typeof it === 'string') {
        var idx = it.indexOf(':')
        if (idx > 0) put(it.slice(0, idx).trim(), it.slice(idx + 1).trim())
      }
    }
    return map
  }
  if (typeof raw.get === 'function') {
    var keys = ['location', 'content-type', 'content-length', 'set-cookie', 'server']
    for (var k = 0; k < keys.length; k++) {
      try {
        var v = raw.get(keys[k])
        if (v != null) put(keys[k], v)
      } catch (e) {}
    }
    if (typeof raw.entries === 'function') {
      try {
        var ent = raw.entries()
        var nxt = typeof ent.next === 'function' ? ent.next() : null
        while (nxt && !nxt.done) {
          put(nxt.value[0], nxt.value[1])
          nxt = ent.next()
        }
      } catch (e) {}
    }
    return map
  }
  if (typeof raw === 'object') {
    for (var key in raw) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) continue
      put(key, raw[key])
    }
  }
  return map
}

function bytesOf(v) {
  if (v == null) return new Uint8Array(0)
  if (typeof v === 'string') {
    var out = new Uint8Array(v.length)
    for (var i = 0; i < v.length; i++) out[i] = v.charCodeAt(i) & 0xff
    return out
  }
  if (typeof v.byteLength === 'number') {
    try {
      return new Uint8Array(v.buffer ? v.buffer.slice(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength) : v)
    } catch (e) {
      return new Uint8Array(0)
    }
  }
  if (typeof v.length === 'number') {
    var arr = new Uint8Array(v.length)
    for (var j = 0; j < v.length; j++) arr[j] = v[j] & 0xff
    return arr
  }
  return new Uint8Array(0)
}

function latin1(bytes) {
  var s = ''
  var CH = 4096
  for (var i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)))
  }
  return s
}

/*
 * 归一化任意原始响应。requestedUrl 用于识别"模块自己跟随了跳转":
 * 部分固件的 http 模块会自动 follow redirect, 此时最终 URL 与请求 URL 不同,
 * 只要它落在别的 host 上就等价于一次门户跳转 —— 合成 location 供上层识别。
 */
export function normalizeRaw(raw, requestedUrl, maxBytes) {
  var r = raw
  /* 常见包装: { data: {...} } / { result: {...} } */
  if (r && typeof r === 'object' && r.status == null && r.statusCode == null && r.code == null) {
    if (r.data && typeof r.data === 'object') r = r.data
    else if (r.result && typeof r.result === 'object') r = r.result
  }
  var status =
    r && typeof r === 'object'
      ? toStatus(r.status) || toStatus(r.statusCode) || toStatus(r.code)
      : 0
  var headers = normalizeHeaders(r && typeof r === 'object' ? r.headers || r.header : null)
  /*
   * 保留原始响应头行 (数组形态): 同名头 (典型 Set-Cookie 多行) 在 map 里会互相覆盖,
   * 适配器需要完整 Cookie 集合时只能从原始行取。非数组输入则按 map 反生成。
   */
  var rawLines = []
  if (r && typeof r === 'object' && Array.isArray(r.headers || r.header)) {
    var srcLines = r.headers || r.header
    for (var li = 0; li < srcLines.length; li++) {
      var it = srcLines[li]
      if (typeof it === 'string') {
        if (it.indexOf(':') > 0) rawLines.push(it)
      } else if (Array.isArray(it) && it.length >= 2) {
        rawLines.push(String(it[0]) + ': ' + String(it[1]))
      }
    }
  }
  var rawBody = r && typeof r === 'object' ? (r.body != null ? r.body : r.data) : r
  var bytes = bytesOf(rawBody)
  /* 只要前 maxBytes 字节: 检测/门户识别都只看头部, 省掉整篇解码 */
  if (maxBytes > 0 && bytes.length > maxBytes) bytes = bytes.subarray(0, maxBytes)
  var finalUrl = ''
  if (r && typeof r === 'object') finalUrl = String(r.url || r.finalUrl || r.responseURL || '')
  if (!headers.location && finalUrl && requestedUrl && finalUrl !== requestedUrl) {
    var a = String(requestedUrl).replace(/^https?:\/\//i, '').split('/')[0]
    var b = finalUrl.replace(/^https?:\/\//i, '').split('/')[0]
    if (a && b && a !== b) headers.location = finalUrl
  }
  var lines = []
  for (var k in headers) lines.push(k + ': ' + headers[k])
  return {
    ok: true,
    statusCode: status,
    headerLines: rawLines.length ? rawLines : lines,
    headers: headers,
    body: bytes,
    text: latin1(bytes),
    error: '',
    finalUrl: finalUrl,
  }
}

/* 用 transport 造一个 request(): 永不 throw, 结构固定 */
export function createRequest(transport, defaultTimeout) {
  var DEF = defaultTimeout || 8
  return async function request(opts) {
    var url = opts.url
    var method = opts.method || 'GET'
    var timeout = opts.timeout || DEF
    var raw
    try {
      raw = await raceTimeout(
        transport({ url: url, method: method, timeout: timeout, headers: opts.headers, body: opts.body, maxBytes: opts.maxBytes }),
        timeout * 1000 + 500
      )
    } catch (e) {
      return {
        ok: false,
        statusCode: 0,
        headerLines: [],
        headers: {},
        body: new Uint8Array(0),
        text: '',
        error: '网络请求失败: ' + describeErr(e),
        finalUrl: '',
      }
    }
    return normalizeRaw(raw, url, opts.maxBytes)
  }
}

