/*
 * H3C iMC Portal 网页认证适配器。
 *
 * 目标网络实测特征 (词典笔真机日志, 两次不同 DHCP 租约):
 *   WiFi SSID `<校园网SSID>`, 被 302 劫持到
 *   http://10.65.x.x:8080/portal/?userip=10.65.x.x&userurl=http://connect.rom.miui.com/generate_204
 *   (另一条日志为 userip=10.65.x.x)
 *   —— 路径 `/portal/` + 参数 userip/userurl 是 H3C iMC 门户页的典型形态
 *   (H3C 文档: IMC 服务器支持参数名 userurl/userip/usermac, 分别对应
 *    original-url/source-address/usermac; 见 docs/h3c-imc-portal.md)。
 *
 * 协议 (从公开的抓包分析/开源脚本交叉核对, 见 docs/h3c-imc-portal.md):
 *   - 门户页:      GET  <serverBase>/portal/?<userip/userurl 等参数>
 *   - 登录:        POST <serverBase>/portal/pws?t=li
 *                  body 为 x-www-form-urlencoded:
 *                    userName=<账号>&userPwd=<base64(密码)>&language=Chinese
 *                    &customPageId=1&pwdMode=0&portalProxyIP=<NAS/门户地址>
 *                    &portalProxyPort=50200&dcPwdNeedEncrypt=1&assignIpType=0
 *                    &appRootUrl=<URL 编码的 /portal/>&userip=<本机IP>&userurl=<原始URL>
 *   - 响应:        base64(百分号编码的 JSON), errorNumber=1 成功 / 7 设备侧失败 / -1 门户错误
 *   - 心跳:        POST <serverBase>/portal/page/doHeartBeat.jsp
 *                  (登录成功返回的 portalLink 里带 serialNo/userDevPort/userStatus/heartBeatCyc)
 *   - 下线:        POST <serverBase>/portal/pws?t=lo
 *
 * 与 Panabit 适配器的差异:
 *   1) 参数必须 URL 编码 (密码 base64 含 +/=, 不编码会被服务器解成空格);
 *   2) 参数同时放在 query 与 body 中 —— 旧版 libjsapi_panet.so 只发 query,
 *      新版本两者都发; 这样同一份 JS 在新旧原生库上都有机会成功;
 *   3) 需要 Referer/Cookie 头 (页面会话): 由传输层第 5 个参数下发, 旧库忽略;
 *   4) 登录成功后仍需心跳维持服务器会话, 因此导出 keepAlive=true,
 *      框架会在"已认证"状态继续调 queryStat (见 index.vue _keepAlive)。
 *
 * ⚠️ 协议细节按公开实现交叉核对得到, 目标学校的 iMC 版本可能略有差异;
 *    所有请求/返回码都会写进日志, 失败时请附日志排障 (见 docs/h3c-imc-portal.md)。
 */
import { request, describeErr } from '../net.js'
import { log } from '../logger.js'

var DEFAULT_PROXY_PORT = '50200'
var DEFAULT_APP_ROOT_PATH = '/portal/'

/* 诊断日志: 真机排障时能区分「服务器拒绝」/「旧 .so 丢了 body 与头」/「网络不通」 */
function diag(msg) {
  try {
    if (typeof log === 'function') log('H3C', String(msg).replace(/[\r\n]+/g, ' ').slice(0, 500))
  } catch (e) {}
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms)
  })
}

/* ------------------------------------------------------------------ *
 * 编码工具 (纯 JS; 设备是 QuickJS, 无 Node/OpenSSL)
 * ------------------------------------------------------------------ */

var B64_TBL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
var B64_IDX = null

function b64Index() {
  if (!B64_IDX) {
    B64_IDX = new Int16Array(256)
    for (var i = 0; i < 256; i++) B64_IDX[i] = -1
    for (var j = 0; j < B64_TBL.length; j++) B64_IDX[B64_TBL.charCodeAt(j)] = j
    B64_IDX['-'.charCodeAt(0)] = 62
    B64_IDX['_'.charCodeAt(0)] = 63
  }
  return B64_IDX
}

/* 字符串 -> UTF-8 字节数组 */
function utf8Bytes(str) {
  var s = String(str == null ? '' : str)
  var out = []
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i)
    if (c < 0x80) out.push(c)
    else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f))
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      var d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00)
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
        i++
        continue
      }
      out.push(0xef, 0xbf, 0xbd)
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out.push(0xef, 0xbf, 0xbd)
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f))
    }
  }
  var arr = new Uint8Array(out.length)
  for (var k = 0; k < out.length; k++) arr[k] = out[k]
  return arr
}

/* base64(UTF-8 bytes) —— 密码字段用 (与网页端 base64.exe/PHP base64_encode 一致) */
export function b64Encode(str) {
  var bytes = utf8Bytes(str)
  var out = ''
  var i = 0
  while (i + 2 < bytes.length) {
    var v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64_TBL[(v >> 18) & 0x3f] + B64_TBL[(v >> 12) & 0x3f] + B64_TBL[(v >> 6) & 0x3f] + B64_TBL[v & 0x3f]
    i += 3
  }
  if (i + 1 === bytes.length) {
    var v1 = bytes[i] << 16
    out += B64_TBL[(v1 >> 18) & 0x3f] + B64_TBL[(v1 >> 12) & 0x3f] + '=='
  } else if (i + 2 === bytes.length) {
    var v2 = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64_TBL[(v2 >> 18) & 0x3f] + B64_TBL[(v2 >> 12) & 0x3f] + B64_TBL[(v2 >> 6) & 0x3f] + '='
  }
  return out
}

/* base64 -> 字节数组 (容忍换行/缺省 padding/URL-safe 变体) */
export function b64Decode(text) {
  var idx = b64Index()
  var s = String(text == null ? '' : text).replace(/\s+/g, '')
  var bytes = []
  var buf = 0
  var bits = 0
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i)
    if (c === 61 /* = */) continue
    var v = c < 256 ? idx[c] : -1
    if (v < 0) continue
    buf = (buf << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buf >> bits) & 0xff)
    }
  }
  return bytes
}

/* 字节数组 -> UTF-8 字符串 (非法序列用 U+FFFD 兜底; 纯 ASCII 原样返回) */
function utf8Decode(bytes) {
  var out = ''
  var i = 0
  while (i < bytes.length) {
    var b = bytes[i]
    if (b < 0x80) {
      out += String.fromCharCode(b)
      i++
    } else if (b >= 0xc2 && b <= 0xdf && i + 1 < bytes.length) {
      var c1 = bytes[i + 1]
      if ((c1 & 0xc0) === 0x80) {
        out += String.fromCharCode(((b & 0x1f) << 6) | (c1 & 0x3f))
        i += 2
      } else {
        out += '\ufffd'
        i++
      }
    } else if (b >= 0xe0 && b <= 0xef && i + 2 < bytes.length) {
      var c2 = bytes[i + 1]
      var c3 = bytes[i + 2]
      if ((c2 & 0xc0) === 0x80 && (c3 & 0xc0) === 0x80) {
        out += String.fromCharCode(((b & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f))
        i += 3
      } else {
        out += '\ufffd'
        i++
      }
    } else if (b >= 0xf0 && b <= 0xf4 && i + 3 < bytes.length) {
      var d2 = bytes[i + 1]
      var d3 = bytes[i + 2]
      var d4 = bytes[i + 3]
      if ((d2 & 0xc0) === 0x80 && (d3 & 0xc0) === 0x80 && (d4 & 0xc0) === 0x80) {
        var cp = ((b & 0x07) << 18) | ((d2 & 0x3f) << 12) | ((d3 & 0x3f) << 6) | (d4 & 0x3f)
        if (cp > 0xffff) {
          cp -= 0x10000
          out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
        } else {
          out += String.fromCharCode(cp)
        }
        i += 4
      } else {
        out += '\ufffd'
        i++
      }
    } else {
      out += '\ufffd'
      i++
    }
  }
  return out
}

function latin1ToBytes(text) {
  var s = String(text == null ? '' : text)
  var out = []
  for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff)
  return out
}

/* %XX 解码 (容忍 '+' 作空格); 输入/输出均为 latin1 字符串 (保留原始字节) */
function percentDecode(text) {
  var s = String(text == null ? '' : text)
  var out = ''
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i)
    if (ch === '%' && i + 3 <= s.length) {
      var hex = s.substr(i + 1, 2)
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16))
        i += 2
        continue
      }
    }
    out += ch === '+' ? ' ' : ch
  }
  return out
}

/* 表单/查询串序列化 (值 URL 编码; 空值保留 = 以贴近网页端请求) */
export function enc(params) {
  var parts = []
  for (var k in params) {
    if (!Object.prototype.hasOwnProperty.call(params, k)) continue
    var v = params[k]
    if (v === undefined || v === null) continue
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)))
  }
  return parts.join('&')
}

/* ------------------------------------------------------------------ *
 * 参数 / 地址归一
 * ------------------------------------------------------------------ */

function baseOf(serverBase) {
  return String(serverBase || '').replace(/\/+$/, '')
}

function appRootOf(serverBase) {
  return baseOf(serverBase) + DEFAULT_APP_ROOT_PATH
}

/* 门户页参数: 检测结果里的 params 已包含 userip/userurl 等原始查询参数 */
function portalQuery(p) {
  var out = {}
  var src = p || {}
  for (var k in src) {
    if (!Object.prototype.hasOwnProperty.call(src, k)) continue
    if (src[k] === undefined || src[k] === null) continue
    out[k] = src[k]
  }
  return out
}

/* 本机在线 IP: iMC 用 userip, 其它门户偶见 wlanuserip/clientip */
function selfIpOf(p) {
  var s = p || {}
  return String(s.userip || s.wlanuserip || s.clientip || s.clientIp || '')
}

/* 原始访问 URL (登录成功后服务器可能要求带回) */
function userUrlOf(p) {
  var s = p || {}
  return String(s.userurl || s.userUrl || s.url || '')
}

/* 从页面/脚本里提取 iMC 的运行时配置 (拿不到就用默认值)。
 * 同时兼容 JS 变量 (`var portalProxyIP = "1.2.3.4"`) 与 JSON 键值 (`"portalProxyIP":"1.2.3.4"`) 形态。 */
export function parsePageConf(text) {
  var t = String(text == null ? '' : text)
  var conf = {}
  var m

  m = t.match(/["']?portalProxyIP["']?\s*[:=]\s*["']?([0-9]{1,3}(?:\.[0-9]{1,3}){3})/i)
  if (!m) m = t.match(/["']?byodserverip["']?\s*[:=]\s*["']?([0-9]{1,3}(?:\.[0-9]{1,3}){3})/i)
  if (!m) m = t.match(/imc_portal_function_readByodServerAddress\s*\(\s*\)[^0-9]{0,40}([0-9]{1,3}(?:\.[0-9]{1,3}){3})/i)
  if (m) conf.portalProxyIP = m[1]

  m = t.match(/["']?portalProxyPort["']?\s*[:=]\s*["']?(\d{2,5})/i)
  if (!m) m = t.match(/["']?byodserverhttpport["']?\s*[:=]\s*["']?(\d{2,5})/i)
  if (m) conf.portalProxyPort = m[1]

  m = t.match(/["']?customPageId["']?\s*[:=]\s*["']?([\w.-]+)/i)
  if (m) conf.customPageId = m[1]

  m = t.match(/["']?pwdMode["']?\s*[:=]\s*["']?(\d+)/i)
  if (m) conf.pwdMode = m[1]

  m = t.match(/["']?dcPwdNeedEncrypt["']?\s*[:=]\s*["']?(\d+)/i)
  if (m) conf.dcPwdNeedEncrypt = m[1]

  m = t.match(/["']?assignIpType["']?\s*[:=]\s*["']?(\d+)/i)
  if (m) conf.assignIpType = m[1]

  m = t.match(/["']?appRootUrl["']?\s*[:=]\s*["'](https?:\/\/[^"']+)["']/i)
  if (m) conf.appRootUrl = m[1]

  m = t.match(/["']?language["']?\s*[:=]\s*["']?(Chinese|English)/i)
  if (m) conf.language = m[1]
  return conf
}

/* Cookie 属性名: 不能作为 Cookie 键值发送 */
function isCookieAttr(name) {
  return /^(path|domain|expires|max-age|httponly|secure|samesite|version|comment|commenturl|discard|port|qop)$/i.test(name)
}

/* 收集响应里的 Set-Cookie (net-core 保留了原始 headerLines; map 里的 set-cookie 仅在没取到时兜底) */
function cookiesFrom(res) {
  var pairs = []
  var lines = (res && res.headerLines) || []
  for (var i = 0; i < lines.length; i++) {
    var m = String(lines[i]).match(/^set-cookie:\s*([^;]+)/i)
    if (m) pairs.push(m[1].replace(/^\s+|\s+$/g, ''))
  }
  /* headerLines 已取到时不再追加 map 里的整条 Set-Cookie (会把 Path/Expires 当 Cookie 发) */
  if (!pairs.length) {
    var mapCookie = res && res.headers && res.headers['set-cookie']
    if (mapCookie) pairs.push(String(mapCookie))
  }
  return pairs.join('; ')
}

function mergeCookie(oldCookie, newCookie) {
  var jar = {}
  var order = []
  function eat(text) {
    var s = String(text || '')
    var pairs = s.split(';')
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].replace(/^\s+|\s+$/g, '')
      if (!kv || kv.indexOf('=') < 0) continue
      var name = kv.slice(0, kv.indexOf('='))
      if (!name || isCookieAttr(name)) continue
      if (!Object.prototype.hasOwnProperty.call(jar, name)) order.push(name)
      jar[name] = kv
    }
  }
  eat(oldCookie)
  eat(newCookie)
  var out = []
  for (var j = 0; j < order.length; j++) out.push(jar[order[j]])
  return out.join('; ')
}

/* ------------------------------------------------------------------ *
 * 响应解码
 * ------------------------------------------------------------------ */

function tryJson(text) {
  var s = String(text == null ? '' : text).replace(/^\s+|\s+$/g, '')
  if (!s) return null
  try {
    var v = JSON.parse(s)
    return v && typeof v === 'object' ? v : null
  } catch (e) {
    return null
  }
}

/*
 * 解码登录/下线响应: 常见为 base64(百分号编码 JSON), 也兼容直接 JSON。
 * net.js 把响应 body 以 latin1 交回 (保留字节), 这里按 UTF-8 还原中文。
 */
export function decodePayload(text) {
  var raw = String(text == null ? '' : text)
  var direct = tryJson(raw)
  if (direct) return direct

  var compact = raw.replace(/\s+/g, '')
  if (!compact) return null
  var latin = utf8Decode(b64Decode(compact))
  if (!latin) return null
  var decoded = percentDecode(latin)
  /* percent 解码后的字节要按 UTF-8 还原, 否则中文会被当成 latin1 变成乱码 (JSON 结构仍合法) */
  var decodedUtf8 = utf8Decode(latin1ToBytes(decoded))
  return tryJson(latin) || tryJson(decodedUtf8) || tryJson(decoded)
}

/* 返回码 -> 本地中文文案 (GBK/UTF-8 乱码时不依赖服务器原文) */
export function failMsg(json) {
  var j = json || {}
  var includeCode = j.portServIncludeFailedCode != null ? String(j.portServIncludeFailedCode) : ''
  var errCode = j.portServErrorCode != null ? String(j.portServErrorCode) : ''
  var reason =
    (j.portServIncludeFailedReason && String(j.portServIncludeFailedReason)) ||
    (j.portServErrorCodeDesc && String(j.portServErrorCodeDesc)) ||
    (j.e_d && j[j.e_d] ? String(j[j.e_d]) : '') ||
    (j.errorDescription && String(j.errorDescription)) ||
    (j.msg && String(j.msg)) ||
    ''

  var map = {
    63013: '用户已被加入黑名单',
    63015: '用户已失效',
    63018: '账号不存在或未开通该服务',
    63024: '端口绑定检查失败',
    63025: 'MAC 地址绑定检查失败',
    63026: '静态 IP 地址绑定检查失败',
    63027: '当前不在允许上网的时段',
    63031: '密码错误且账号已被加入黑名单',
    63032: '账号或密码错误',
    63048: '设备 IP 绑定检查失败',
    63073: '当前场景下不允许该终端接入',
    63100: '无效认证客户端版本',
    63634: '当前场景下绑定终端数已达上限',
  }
  if (includeCode && map[includeCode]) {
    if (includeCode === '63032' && /次/.test(reason)) return '账号或密码错误 (' + reason + ')'
    return map[includeCode]
  }
  if (errCode === '2') return '服务器返回错误码 2（含义未证实，可稍后重试）'
  if (errCode === '3') return '会话已失效，请重试'
  if (reason) return reason
  if (includeCode) return '认证失败 (错误码 ' + includeCode + ')'
  if (errCode) return '认证失败 (服务器错误码 ' + errCode + ')'
  return '认证失败'
}

/* 是否"已在线/无需重复登录"的返回 (iMC: errorNumber=7 + 设备拒绝请求; 部分版本用 -1+描述) */
function isAlreadyOnline(json) {
  if (!json) return false
  var en = String(json.errorNumber)
  if (en === '1') return false
  var code = json.portServErrorCode != null ? String(json.portServErrorCode) : ''
  var desc = String(json.portServErrorCodeDesc || json.portServIncludeFailedReason || json.errorDescription || '')
  if (code === '1') return true
  if (/设备拒绝请求|already|online|已在线|已经在线|已认证/i.test(desc)) return true
  return false
}

/* ------------------------------------------------------------------ *
 * 请求封装: 永不 throw, 返回 { ok, statusCode, headers, text, headerLines, error }
 * ------------------------------------------------------------------ */

async function send(opts) {
  var o = opts || {}
  var r
  try {
    r = await request({
      url: o.url,
      method: o.method || 'GET',
      timeout: o.timeout || 8,
      headers: o.headers,
      body: o.body,
    })
  } catch (e) {
    return { ok: false, statusCode: 0, headers: {}, text: '', headerLines: [], error: describeErr(e) }
  }
  if (!r || !r.ok) {
    return {
      ok: false,
      statusCode: (r && r.statusCode) || 0,
      headers: (r && r.headers) || {},
      text: '',
      headerLines: [],
      error: (r && r.error) || '无法连接认证服务器',
    }
  }
  return {
    ok: true,
    statusCode: r.statusCode || 0,
    headers: r.headers || {},
    text: r.text || '',
    headerLines: r.headerLines || [],
    error: '',
  }
}

/* 取门户页: 建立页面会话 (Cookie) 并解析运行时配置 */
async function fetchPortalPage(serverBase, p, state) {
  var appRoot = appRootOf(serverBase)
  var q = portalQuery(p)
  var url = appRoot + (enc(q) ? '?' + enc(q) : '')
  var res = await send({ url: url, timeout: 8 })
  if (!res.ok) {
    diag('取门户页失败 url=' + url + ' err=' + (res.error || '-'))
    return { ok: false, msg: res.error || '无法连接认证服务器', res: res }
  }
  var page = res.text || ''
  var cookie = mergeCookie((state && state.cookie) || '', cookiesFrom(res))
  /* 外部拉起登录 (action=login) 时框架没有检测参数, 从页面里补 userip */
  var pageIp = ''
  var m = page.match(/userip\s*[:=]\s*["']?([0-9]{1,3}(?:\.[0-9]{1,3}){3})/i)
  if (m) pageIp = m[1]
  if (state) {
    state.cookie = cookie
    state.pageUrl = url
    state.referer = url
    state.conf = parsePageConf(page)
    if (pageIp) state.pageUserip = pageIp
  }
  diag(
    '取门户页 status=' + (res.statusCode || 0) + ' len=' + page.length +
      ' cookie=' + (cookie ? '有' : '无') +
      ' proxy=' + ((state && state.conf && state.conf.portalProxyIP) || '-') +
      ' ip=' + (pageIp || '-')
  )
  return { ok: true, page: page, res: res, cookie: cookie }
}

/* 响应里是否出现"已在线"标识 (仅用于日志, 不据此隐藏登录表单) */
function pageLooksOnline(page) {
  return /portalLink=|online_heartBeat/i.test(String(page || ''))
}

/* 组装请求头 (回退值: 页面未下发 Cookie 时按网页端习惯补 hello1/hello2) */
function headersFor(state, serverBase, username) {
  var h = {}
  var appRoot = appRootOf(serverBase)
  h['Referer'] = (state && state.referer) || appRoot + 'index_default.jsp'
  h['Origin'] = baseOf(serverBase)
  var cookie = mergeCookie((state && state.cookie) || '', '')
  if (username) cookie = mergeCookie(cookie, 'hello1=' + username + '; hello2=false; i_p_c_op=false; i_p_c_un=' + username)
  if (cookie) h['Cookie'] = cookie
  return h
}

/* 登录参数 (网页端字段超集; 多余字段 iMC 会忽略) */
function loginParams(serverBase, o, state) {
  var p = (o && o.params) || {}
  var conf = (state && state.conf) || {}
  var appRoot = conf.appRootUrl || appRootOf(serverBase)
  var host = ''
  var m = baseOf(serverBase).match(/^https?:\/\/([^\/:]+)/i)
  if (m) host = m[1]
  var ip = selfIpOf(p) || (state && state.pageUserip) || ''
  var q = portalQuery(p)
  var params = {
    userName: (o && o.username) || '',
    userPwd: b64Encode((o && o.password) || ''),
    userDynamicPwd: '',
    userDynamicPwdd: '',
    serviceType: '',
    isSavePwd: o && o.remember ? 'on' : '',
    /* 参考实现 (BLOG/GO/TUN) 登录表单里的 userip 恒为空: NAS 按报文源地址识别用户 */
    userurl: userUrlOf(p),
    userip: '',
    basip: q.basip || '',
    language: conf.language || 'Chinese',
    usermac: q.usermac || q.clientmac || '',
    wlannasid: q.wlannasid || q.wlanacname || '',
    wlanssid: q.wlanssid || '',
    entrance: '',
    loginVerifyCode: '',
    userDynamicPwddd: '',
    customPageId: conf.customPageId || '1',
    pwdMode: conf.pwdMode || '0',
    /* portalProxyIP 是门户/NAS 的地址 (IP, 不带端口), 不能回退成本机 IP */
    portalProxyIP: conf.portalProxyIP || host || ip,
    portalProxyPort: conf.portalProxyPort || DEFAULT_PROXY_PORT,
    dcPwdNeedEncrypt: conf.dcPwdNeedEncrypt || '1',
    assignIpType: conf.assignIpType || '0',
    appRootUrl: appRoot,
    manualUrl: '',
    manualUrlEncryptKey: '',
  }
  return params
}

/* ------------------------------------------------------------------ *
 * 适配器接口
 * ------------------------------------------------------------------ */

/*
 * 建会话 + 读页面配置。
 * 只归一化为 ready / manual:
 *   - 页面能打开且像门户页 -> ready (账号密码登录可用)
 *   - 连不上 / 返回异常    -> manual (提示手动输入服务器地址)
 * 刻意不返回 free: 能走到本适配器说明网络正被门户拦截 (真免认证时框架的连通性检测
 * 已经判 free, 不会进到这里), 把登录页误判成"已在线"会隐藏登录表单 —— v1.1.3 修过同类事故。
 */
async function loadConf(serverBase, p, state) {
  var r = await fetchPortalPage(serverBase, p, state)
  if (!r.ok) {
    return { status: 'manual', msg: r.msg || '无法连接认证服务器' }
  }
  var page = r.page || ''
  if (r.res && r.res.statusCode >= 400) {
    return { status: 'manual', msg: '认证服务器返回 HTTP ' + r.res.statusCode }
  }
  if (page.length < 32) {
    return { status: 'manual', msg: '认证页内容异常 (可能不是门户服务器)' }
  }
  if (pageLooksOnline(page)) diag('门户页含在线标识, 仍提供登录表单 (避免误藏表单)')
  return { status: 'ready', code: 0 }
}

/*
 * 账号密码登录。
 * 流程: 刷新门户页 (等价网页端刷新, 拿会话/Cookie/配置) -> POST pws?t=li -> 解析返回。
 * 失败时: 会话类失败 (无返回/解析失败/设备拒绝以外的错误) 刷新页面重试一次;
 *         账密错误等服务端明确错误不重试。
 */
async function login(serverBase, o) {
  var state = (o && o.state) || {}
  var p = (o && o.params) || {}
  if (state) state.username = (o && o.username) || ''

  /* 等价网页端"刷新页面": 重新取门户页, 拿会话 Cookie 与页面下发的运行时配置 */
  var pre = await fetchPortalPage(serverBase, p, state)
  if (!pre.ok) return { ok: false, code: -1, msg: pre.msg || '无法连接认证服务器' }

  var post = async function () {
    var params = loginParams(serverBase, o, state)
    var query = enc(params)
    var appRoot = appRootOf(serverBase)
    var url = appRoot + 'pws?t=li' + (query ? '&' + query : '')
    var headers = headersFor(state, serverBase, (o && o.username) || '')
    diag(
      '登录 POST pws?t=li user=' + (params.userName || '-') +
        ' ip=' + (params.userip || '-') +
        ' proxy=' + (params.portalProxyIP || '-') + ':' + (params.portalProxyPort || '-') +
        ' body=' + query.length + 'B header=' + Object.keys(headers).join('/')
    )
    var res = await send({
      url: url,
      method: 'POST',
      timeout: 10,
      headers: headers,
      body: query,
    })
    if (!res.ok) {
      diag('登录请求失败 status=' + (res.statusCode || 0) + ' err=' + (res.error || '-'))
      return { netFail: true, res: res }
    }
    var json = decodePayload(res.text)
    diag(
      '登录返回 status=' + (res.statusCode || 0) +
        (json
          ? ' errorNumber=' + json.errorNumber +
            (json.portServIncludeFailedCode ? ' code=' + json.portServIncludeFailedCode : '') +
            (json.portServErrorCode ? ' errCode=' + json.portServErrorCode : '')
          : ' 无法解码 text=' + String(res.text || '').slice(0, 80))
    )
    return { netFail: false, res: res, json: json }
  }

  var out = await post()
  var json = out.json

  /* 无响应/解析失败/会话失效: 刷新页面会话后重试一次 */
  var retriable =
    out.netFail ||
    !json ||
    (String(json.errorNumber) !== '1' && !isAlreadyOnline(json) && !failPermanent(json))
  if (retriable) {
    var again = await fetchPortalPage(serverBase, p, state)
    if (again.ok) {
      out = await post()
      json = out.json
    }
  }

  if (out.netFail) {
    return { ok: false, code: -1, msg: out.res.error || '认证服务器无响应' }
  }
  if (!json) {
    return { ok: false, code: -1, msg: '认证响应解析失败 (服务器返回格式与预期不符)' }
  }
  if (String(json.errorNumber) === '1') {
    if (state) state.hb = heartbeatInfo(json)
    /* iMC 放行可能有 1-3 秒延迟, 稍等再让框架复查连通性, 避免误报"仍被拦截" */
    await sleep(800)
    return { ok: true, code: 1, msg: '认证成功' }
  }
  if (isAlreadyOnline(json)) {
    if (state) state.hb = heartbeatInfo(json)
    return { ok: true, code: 200, msg: '该设备已在线，无需重复登入' }
  }
  var msg = failMsg(json)
  diag('登录失败 msg=' + msg)
  return { ok: false, code: json.portServIncludeFailedCode || json.portServErrorCode || -1, msg: msg }
}

/* 服务端明确拒绝的判据: 带业务错误码 (630xx) 一律不重试;
 * portServErrorCode=2/3 语义未证实, 允许刷新会话后重试一次 (不当作永久失败)。 */
function failPermanent(json) {
  var j = json || {}
  return j.portServIncludeFailedCode != null
}

/* 从登录返回里提取心跳所需字段; portalLink 是 base64+URL 编码的 JSON */
function heartbeatInfo(json) {
  var j = json || {}
  var info = {
    userDevPort: j.userDevPort || '',
    userStatus: j.userStatus == null ? '' : String(j.userStatus),
    serialNo: j.serialNo == null ? '' : String(j.serialNo),
    heartBeatCyc: numOrZero(j.heartBeatCyc),
    heartBeatTimeoutMaxTime: numOrZero(j.heartBeatTimeoutMaxTime),
    clientLanguage: j.clientLanguage || 'Chinese',
    ifNeedModifyPwd: j.ifNeedModifyPwd === true,
    portalLink: j.portalLink || '',
  }
  if (info.portalLink) {
    var linkJson = decodePayload(String(info.portalLink))
    if (linkJson) {
      for (var k in linkJson) {
        if (!Object.prototype.hasOwnProperty.call(linkJson, k)) continue
        if (info[k] === '' || info[k] === 0 || info[k] === null) info[k] = linkJson[k]
      }
      if (linkJson.heartBeatCyc != null) info.heartBeatCyc = numOrZero(linkJson.heartBeatCyc)
      if (linkJson.serialNo != null) info.serialNo = String(linkJson.serialNo)
      if (linkJson.userStatus != null) info.userStatus = String(linkJson.userStatus)
      if (linkJson.userDevPort != null) info.userDevPort = String(linkJson.userDevPort)
    }
  }
  if (!info.userStatus) info.userStatus = '99'
  return info
}

function numOrZero(v) {
  var n = Number(v)
  return isFinite(n) && n > 0 ? n : 0
}

/*
 * 心跳/状态查询: 登录返回 heartBeatCyc>0 时必须周期发送 doHeartBeat.jsp,
 * 否则服务器侧会话过期被踢下线。返回 stat=0 让框架保持心跳运行
 * (框架语义: stat!=0 表示"已在别处认证"并停止心跳, 不适合 iMC)。
 */
async function queryStat(serverBase, o) {
  var state = (o && o.state) || {}
  var hb = state && state.hb
  if (!hb || !hb.userDevPort) return { ok: false }
  /* 服务器要求的心跳周期由 heartBeatCyc 下发; 框架固定 30s 调一次,
   * 这里按 60% 周期节流, 既保持存活又不过度请求 (默认 60000ms -> 实际约每 60s 一次) */
  var now = Date.now()
  if (hb.heartBeatCyc > 0 && hb.lastAt && now - hb.lastAt < hb.heartBeatCyc * 0.6) {
    return { ok: true, stat: 0 }
  }
  if (hb.heartBeatCyc > 0 && hb.heartBeatCyc < 30000) {
    diag('注意: 服务器要求心跳周期 ' + hb.heartBeatCyc + 'ms, 框架最小 30s, 可能不足以保活')
  }
  var p = (o && o.params) || {}
  /* 参考实现心跳表单里 userip/basip 恒为空, 用户由 NAS 按源地址识别 */
  var params = {
    userip: '',
    basip: (p && p.basip) || '',
    userStatus: hb.userStatus || '99',
    userDevPort: hb.userDevPort,
    serialNo: hb.serialNo || '',
    language: hb.clientLanguage || 'Chinese',
    e_d: '',
    t: 'hb',
  }
  hb.lastAt = now
  var hbHeaders = headersFor(state, serverBase, state.username || '')
  /* 网页端心跳的 Referer 是 online_heartBeat.jsp?pl=<portalLink>, 部分版本会校验 */
  hbHeaders['Referer'] =
    appRootOf(serverBase) +
    'page/online_heartBeat.jsp?pl=' +
    encodeURIComponent(hb.portalLink || '') +
    '&custompath=&uamInitCustom=0&uamInitLogo=H3C'
  var hbQuery = enc(params)
  var res = await send({
    /* 参数同时放 query 与 body: 旧版 .so 只发 query 也能把心跳字段送到服务器 */
    url: appRootOf(serverBase) + 'page/doHeartBeat.jsp' + (hbQuery ? '?' + hbQuery : ''),
    method: 'POST',
    timeout: 8,
    headers: hbHeaders,
    body: hbQuery,
  })
  if (!res.ok) {
    diag('心跳失败 status=' + (res.statusCode || 0) + ' err=' + (res.error || '-'))
    return heartbeatFail(state, hb, '网络失败')
  }
  var json = decodePayload(res.text)
  if (json && String(json.errorNumber) !== '1' && !isAlreadyOnline(json)) {
    diag('心跳返回异常 errorNumber=' + json.errorNumber + ' code=' + (json.portServErrorCode || json.portServIncludeFailedCode || ''))
    return heartbeatFail(state, hb, '返回异常')
  }
  hb.failCount = 0
  return { ok: true, stat: 0 }
}

/* 心跳失败: 允许连续 3 次网络抖动/异常, 之后才清掉保活信息 (单次失败就清会导致永久静默) */
function heartbeatFail(state, hb, why) {
  hb.failCount = (hb.failCount || 0) + 1
  if (hb.failCount >= 3) {
    diag('心跳连续失败 ' + hb.failCount + ' 次(' + why + '), 停止保活, 需重新认证')
    if (state) state.hb = null
  }
  return { ok: false }
}

/* 下线 (pws?t=lo) —— 尽力而为: 各 iMC 版本下线参数略有差异, 失败只提示不阻断 */
async function logout(serverBase, o) {
  var state = (o && o.state) || {}
  var p = (o && o.params) || {}
  var params = {
    /* 参考实现下线最小集里 userip 为空 (NAS 按源地址识别), 与登录表单保持一致 */
    userip: '',
    userurl: userUrlOf(p),
    basip: (p && p.basip) || '',
    language: 'Chinese',
    appRootUrl: appRootOf(serverBase),
  }
  var query = enc(params)
  var res = await send({
    url: appRootOf(serverBase) + 'pws?t=lo' + (query ? '&' + query : ''),
    method: 'POST',
    timeout: 8,
    headers: headersFor(state, serverBase, ''),
    body: query,
  })
  if (!res.ok) {
    diag('下线请求失败 status=' + (res.statusCode || 0) + ' err=' + (res.error || '-'))
    return { ok: false, code: -1, msg: res.error || '下线请求失败' }
  }
  var json = decodePayload(res.text)
  diag('下线返回 status=' + (res.statusCode || 0) + (json ? ' errorNumber=' + json.errorNumber : ' 无法解码'))
  if (state) state.hb = null
  if (json && String(json.errorNumber) === '1') return { ok: true, code: 1 }
  if (json && String(json.errorNumber) === '7') return { ok: true, code: 7, msg: '本机可能已下线' }
  if (json) return { ok: false, code: -1, msg: failMsg(json) }
  return { ok: true, code: res.statusCode || 0 }
}

/* 保存的服务器在当前网络是否可用 (server-probe 用; 不做副作用) */
async function sync(serverBase, p, state) {
  var r = await fetchPortalPage(serverBase, p && p.ip ? { userip: p.ip } : {}, state)
  if (!r.ok) return { ok: false, code: -1, msg: r.msg || '' }
  return { ok: true, code: 0 }
}

/*
 * 自动识别评分 (0-100):
 *   params 同时有 userip + userurl (iMC 门户跳转参数)   70 分
 *   跳转 URL 路径含 /portal/                            10 分
 *   带 basip/usermac/wlannasid/wlanssid 等门户参数        每个 5 分 (上限 15)
 *   页面标题/片段含 H3C/iMC/门户认证 字样                 15 分
 *   Server 响应头含 iMC/H3C                              10 分
 * 注: 用 params 的 key 判断而不是 URL 子串 —— "wlanuserip=" 里也含 "userip=",
 *     否则会把 Panabit 的网络误判成 H3C。
 */
function match(ctx) {
  var score = 0
  var p = (ctx && ctx.params) || {}
  var u = String((ctx && ctx.portalPage) || '')
  var text = String((ctx && ctx.snippet) || '') + ' ' + String((ctx && ctx.pageTitle) || '')
  var headers = (ctx && ctx.headers) || {}

  var hasIp = !!(p.userip || p.userIp)
  var hasUrl = !!(p.userurl || p.userUrl)
  if (hasIp && hasUrl) score += 70
  else if (hasIp || hasUrl) score += 25

  if (/\/portal\//i.test(u)) score += 10

  var extra = 0
  if (p.basip) extra += 5
  if (p.usermac) extra += 5
  if (p.wlannasid || p.wlanacname) extra += 5
  if (p.wlanssid) extra += 5
  score += Math.min(extra, 15)

  if (/h3c|\bimc\b/i.test(text)) score += 15
  var server = String((headers && (headers.server || headers['x-powered-by'])) || '')
  if (/imc|h3c/i.test(server)) score += 10

  return Math.min(score, 100)
}

export const h3cImc = {
  id: 'h3c-imc',
  name: 'H3C iMC 认证',
  keepAlive: true, // 登录成功后仍需 queryStat 心跳维持会话
  match: match,
  loadConf: loadConf,
  login: login,
  queryStat: queryStat,
  logout: logout,
  sync: sync,
}
