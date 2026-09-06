/*
 * WiFi 连通性测试 + captive portal 检测。
 * 只使用国内连通性测试端点:
 *   - 小米:   http://connect.rom.miui.com/generate_204  (正常返回 204 空包体)
 *   - vivo:   http://wifi.vivo.com.cn/generate_204
 *   - 华为:   http://connectivitycheck.platform.hicloud.com/generate_204
 *   - 辅助:   http://www.baidu.com  (正常返回含 baidu 标记的页面)
 * 判定逻辑:
 *   204 探测任一返回空包体 + baidu 返回含 baidu 标记      -> free  (无需登入)
 *   204 探测非空包体 / baidu 返回非 baidu 内容            -> portal(被强制门户劫持)
 *   全部请求失败                                          -> offline
 * 被劫持时从响应内容里解析跳转页面 URL (Panabit 302 Location 透传 /
 * meta refresh / location.href / 带 wlanuserip、paip 参数的链接),
 * 得到 portal 服务器 IP:PORT 与认证参数。
 */

import { request } from './net.js'

var PROBES = [
  { name: '小米', url: 'http://connect.rom.miui.com/generate_204' },
  { name: 'vivo', url: 'http://wifi.vivo.com.cn/generate_204' },
  { name: '华为', url: 'http://connectivitycheck.platform.hicloud.com/generate_204' },
]
var BAIDU = { name: '百度', url: 'http://www.baidu.com/' }
var TIMEOUT = 6

/*
 * 返回:
 * {
 *   status: 'free' | 'portal' | 'offline',
 *   probe: 使用的探测源名, portalPage: 跳转页面 URL,
 *   serverIp, serverPort, serverBase,
 *   params: { wlanuserip, clientmac, vlan, iarmdst, paip, clientip, wlanacname },
 *   pageTitle: 拦截页 <title>, snippet: 原始片段(截断)
 * }
 */
export async function checkPortal() {
  var baidu = await request({ url: BAIDU.url, timeout: TIMEOUT })
  var c = classify(baidu)

  // 302 + Location: 直接拿到跳转页面 (panet 不跟随重定向)
  if (c.kind === 'redirect') {
    return portalResult(BAIDU.name, c.url, baidu)
  }
  if (c.kind === 'content' && containsBaiduMarker(baidu.text)) {
    // baidu 正常, 再用 204 探测源双确认
    var p = await firstProbeChecked()
    if (p) return p
    return freeResult(BAIDU.name)
  }

  // baidu 空/被劫持/失败: 逐个 204 探测源判定
  for (var i = 0; i < PROBES.length; i++) {
    var r = await request({ url: PROBES[i].url, timeout: TIMEOUT })
    var rc = classify(r)
    if (rc.kind === 'redirect') return portalResult(PROBES[i].name, rc.url, r)
    if (rc.kind === 'empty') return freeResult(PROBES[i].name)
    if (rc.kind === 'content') return portalResult(PROBES[i].name, extractRedirect(r.text), r)
  }

  return offlineResult()
}

/* 单个响应分类: redirect(302+Location) / empty(204) / content / error */
function classify(r) {
  if (!r.ok) return { kind: 'error' }
  if (r.statusCode >= 300 && r.statusCode < 400 && r.headers && r.headers.location) {
    return { kind: 'redirect', url: trimUrl(r.headers.location) }
  }
  if (r.body.length === 0) return { kind: 'empty' }
  return { kind: 'content' }
}

/* 探测源依次判定, 返回 null 表示全部请求失败 */
async function firstProbeChecked() {
  for (var i = 0; i < PROBES.length; i++) {
    var r = await request({ url: PROBES[i].url, timeout: TIMEOUT })
    var c = classify(r)
    if (c.kind === 'redirect') return portalResult(PROBES[i].name, c.url, r)
    if (c.kind === 'empty') return freeResult(PROBES[i].name)
    if (c.kind === 'content') return portalResult(PROBES[i].name, extractRedirect(r.text), r)
  }
  return null
}

function portalResult(probe, redirectUrl, resp) {
  var bodyText = resp ? resp.text : ''
  var url = redirectUrl || extractRedirect(bodyText)
  var info = parsePortalUrl(url)
  return {
    status: 'portal',
    probe: probe,
    portalPage: url,
    serverIp: info.host,
    serverPort: info.port,
    serverBase: info.base,
    params: info.params,
    pageTitle: extractTitle(bodyText),
    snippet: bodyText.slice(0, 400),
  }
}

function containsBaiduMarker(text) {
  return /baidu\.com|百度|Baidu/i.test(text)
}

function freeResult(probe) {
  return { status: 'free', probe: probe, portalPage: '', serverIp: '', serverPort: '', serverBase: '', params: {}, pageTitle: '', snippet: '' }
}

function offlineResult() {
  return { status: 'offline', probe: '', portalPage: '', serverIp: '', serverPort: '', serverBase: '', params: {}, pageTitle: '', snippet: '' }
}

function extractTitle(text) {
  var m = text.match(/<title[^>]*>([^<]*)<\/title>/i)
  return m ? m[1].trim() : ''
}

/*
 * 从被劫持的响应内容里找跳转目标。
 * 优先级: 含 wlanuserip/paip/clientmac 的完整 URL > meta refresh > location 赋值。
 */
export function extractRedirect(text) {
  if (!text) return ''
  var urls = text.match(/https?:\/\/[A-Za-z0-9\-._~:\/?#@!$&*+,;=%\[\]]+/g) || []
  var best = ''
  var weak = ''
  for (var i = 0; i < urls.length; i++) {
    var u = urls[i]
    if (/wlanuserip=|paip=|clientmac=|clientip=/i.test(u)) return trimUrl(u)
    if (/portal|auth|login/i.test(u) && !weak) weak = u
  }
  if (best) return trimUrl(best)
  var m =
    text.match(/http-equiv\s*=\s*["']?refresh["']?[^>]*url\s*=\s*["']?(https?:\/\/[^"'>\s]+)/i) ||
    text.match(/location(?:\.href)?\s*=\s*["'](https?:\/\/[^"']+)["']/i) ||
    text.match(/location\.replace\(\s*["'](https?:\/\/[^"']+)["']\s*\)/i) ||
    text.match(/window\.open\(\s*["'](https?:\/\/[^"']+)["']/i)
  if (m) return trimUrl(m[1])
  if (weak) return trimUrl(weak)
  // 相对路径跳转 (portal.html?...)
  m = text.match(/["'](\/?[\w./-]*portal[^"']*\?[\w=&%.-]*)["']/i)
  return m ? trimUrl(m[1]) : ''
}

function trimUrl(u) {
  return u.replace(/["'>\s]+$/, '')
}

/* 把跳转 URL 拆成 serverBase + 参数 */
export function parsePortalUrl(url) {
  var out = { host: '', port: '', base: '', params: {} }
  if (!url) return out
  var m = url.match(/^https?:\/\/([^\/?#]+)/i)
  if (!m) return out
  var hostPort = m[1]
  var ipv6 = hostPort.match(/^\[([^\]]+)\](?::(\d+))?$/)
  if (ipv6) {
    out.host = ipv6[1]
    out.port = ipv6[2] || '80'
  } else {
    var parts = hostPort.split(':')
    out.host = parts[0]
    out.port = parts.length > 1 ? parts[1] : '80'
  }
  out.base = 'http://' + out.host + (out.port && out.port !== '80' ? ':' + out.port : '')
  var q = url.indexOf('?')
  if (q > -1) {
    var pairs = url.slice(q + 1).split('&')
    for (var i = 0; i < pairs.length; i++) {
      var kv = pairs[i].split('=')
      if (kv.length === 2 && kv[0]) {
        try {
          out.params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1])
        } catch (e) {
          out.params[kv[0]] = kv[1]
        }
      }
    }
  }
  return out
}
