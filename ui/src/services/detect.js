/*
 * WiFi 连通性测试 + captive portal 检测。
 * 只使用国内连通性测试端点:
 *   - 小米:   http://connect.rom.miui.com/generate_204  (正常返回 204 空包体)
 *   - vivo:   http://wifi.vivo.com.cn/generate_204
 *   - 华为:   http://connectivitycheck.platform.hicloud.com/generate_204
 * 判定逻辑 (两阶段, 全部探测源并发):
 *   阶段一 并发探测源:
 *     - 3xx + Location                      -> portal (直接拿到跳转页面)
 *     - 其它 3xx / 非 204 空包体 / 无状态码  -> portal 或 error (被改写即认证证据)
 *     - 204 空包体                          -> free 证据 (记一笔, 不等于结论!)
 *     - 任何门户证据优先于 free 证据 (不再"首个结果即定", 判定不被时序左右)
 *   阶段二 独立复核 (探测源端点常被网关免认证放行, 通了不等于能上网):
 *     - 用非探测源站点复核通用连通性, 通过才报 free (并记录 confirm=复核站点)
 *     - 复核被拦截 -> portal; 复核失败 -> offline
 *       (宁可报"网络不通", 也绝不误报"无需登入")
 * 被劫持时从响应内容里解析跳转页面 URL (Panabit 302 Location 透传 /
 * meta refresh / location.href / 带 wlanuserip、paip 参数的链接),
 * 得到 portal 服务器 IP:PORT 与认证参数。
 *
 * 性能/并发设计:
 *  - 原实现逐个探测源串行等待, 最坏 4×TIMEOUT; 现改为同时发起全部请求,
 *    谁先给出确定结论就用谁, 正常网络下耗时 ≈ 单个请求 RTT。
 *  - 失败 (error) 不算结论, 继续等其他探测源, 全部失败才判 offline。
 *  - 支持 abort: 页面切前台/离开时可主动取消, 避免残留请求回来后覆盖新状态。
 *
 * 卡死防护 (实测部分网络下原生 request 会挂起不返回, 固件层超时不可靠):
 *  - 全局兜底 guard: 单源超时后再宽限一段时间, 到点无论请求是否返回都强制判决,
 *    界面不会永久停在"正在检测…"。
 *  - abort 轮询: 取消标记置位后立即结束本次探测, 不必等挂起的请求自然返回。
 */

import { request } from './net.js'

var PROBES = [
  { name: '小米', url: 'http://connect.rom.miui.com/generate_204' },
  { name: 'vivo', url: 'http://wifi.vivo.com.cn/generate_204' },
  { name: '华为', url: 'http://connectivitycheck.platform.hicloud.com/generate_204' },
]
/*
 * 独立复核站点: 刻意【不用】上面三个连网检测端点 —— 探测源端点常被网关免认证放行
 * (探测源通、通用网络不通), 所以 204 只能算"证据", 必须再用普通站点复核才敢说"无需登入"。
 * 任一复核成功即认为通用网络可达; 命中跳转/门户特征则判 portal。
 */
var CONFIRMS = [
  { name: '百度', url: 'http://www.baidu.com/' },
  { name: '腾讯', url: 'http://www.qq.com/' },
]

/* 判定 free 所需的最小独立证据数: 单源 204 不足以证明"整个网络可直连" */
var FREE_QUORUM = 2

var TIMEOUT = 3.5 // 单源超时(秒); 全失败判 offline 的最坏耗时即此值
var GUARD_EXTRA_MS = 1200 // 全局兜底宽限: 单源超时后仍未返回则强制判决
var ABORT_POLL_MS = 250 // abort 轮询间隔

/*
 * 返回:
 * {
 *   status: 'free' | 'portal' | 'offline' | 'aborted',
 *   probe: 使用的探测源名, portalPage: 跳转页面 URL,
 *   serverIp, serverPort, serverBase,
 *   params: { wlanuserip, clientmac, vlan, iarmdst, paip, clientip, wlanacname },
 *   pageTitle: 拦截页 <title>, snippet: 原始片段(截断)
 * }
 *
 * opts.signal: 可选, { aborted: bool } 形式的取消标记 (页面离开/重新检测时置位),
 *   置位后不再采纳迟到的响应, 返回 status='aborted'。
 * opts.timeout: 可选, 覆盖单源超时秒数 (测试用)。
 */
export async function checkPortal(opts) {
  var o = opts || {}
  var signal = o.signal || null
  var timeoutSec = o.timeout || TIMEOUT
  /* 探测只需要响应头部若干字节(状态码/跳转/门户标记都在前面), 限制响应体可显著减少
   * JS 侧解码开销与内存占用, 避免大页面把主线程拖住 */
  var maxBytes = o.maxBytes || 4096
  var aborted = function () {
    return !!(signal && signal.aborted)
  }

  var errors = [] // 各源失败原因, 汇总进 offline 结果便于日志定位
  var freeProbes = [] // 给出 204 证据的探测源
  var portal = null // 任意探测源发现的拦截证据 (优先于 free)
  var settled = false
  var confPromise = null
  var confOk = false
  var startConfirm = null // 在执行器内定义 (需要访问 finish)

  /* 阶段一: 并发探测源; 出现门户证据立即短路, 否则等全部源出结论 */
  await new Promise(function (resolve) {
    var pending = PROBES.length
    var guard = null
    var abortWatch = null
    var finish = function () {
      if (settled) return
      settled = true
      if (guard) clearTimeout(guard)
      if (abortWatch) clearInterval(abortWatch)
      resolve()
    }
    var settleOne = function () {
      pending--
      if (pending <= 0) finish()
    }
    /* 全局兜底: 请求挂起 (原生层不返回) 时到点强制进入判决 */
    guard = setTimeout(finish, timeoutSec * 1000 + GUARD_EXTRA_MS)
    /* abort 轮询: 页面切走/重新检测时立即结束, 不等挂起的请求 */
    abortWatch = setInterval(function () {
      if (aborted()) finish()
    }, ABORT_POLL_MS)

    /* 复核与探测并行: 出现 204 证据就立刻发起复核; 证据足够且复核通过即可提前收尾,
     * 不必干等挂起的探测源 (保留原来的竞速耗时特性) */
    startConfirm = function () {
      if (!confPromise) {
        confPromise = withTimeout(confirmConnectivity(timeoutSec), timeoutSec * 1000 + 800, {
          probe: CONFIRMS[0].name,
          ok: false,
          error: '复核超时',
        })
        confPromise.then(function (c0) {
          confOk = !!(c0 && c0.ok)
          if (confOk && freeProbes.length >= FREE_QUORUM) finish()
        })
      }
      return confPromise
    }

    for (var i = 0; i < PROBES.length; i++) {
      ;(function (probe) {
        request({ url: probe.url, timeout: timeoutSec, maxBytes: maxBytes }).then(
          function (r) {
            if (settled) return
            var c = classify(r)
            if (c.kind === 'portal') {
              /* 门户证据优先: 立刻返回; free 证据不能推翻它
               * (旧实现"首个结果即定", 判定常被响应时序左右) */
              if (!portal) portal = { probe: probe.name, url: c.url, resp: r }
              return finish()
            }
            if (c.kind === 'free') {
              freeProbes.push(probe.name)
              /* 有 204 证据即并行发起复核; 证据足够且复核通过就提前收尾 */
              startConfirm()
              if (confOk && freeProbes.length >= FREE_QUORUM) return finish()
            } else {
              errors.push(probe.name + ': ' + (c.reason || '无响应'))
            }
            settleOne()
          },
          function (e) {
            if (settled) return
            errors.push(probe.name + ': ' + describe(e))
            settleOne()
          }
        )
      })(PROBES[i])
    }
  })

  if (aborted()) return { status: 'aborted' }
  if (portal) return portalResult(portal.probe, portal.url, portal.resp)

  /* 没有任何 204 证据: 网络不可用 */
  if (freeProbes.length === 0) {
    var off = offlineResult()
    off.error = errors.length ? errors.join('; ') : '探测超时无响应'
    return off
  }

  /* 阶段二: 非探测源复核 —— 探测源可能只是被网关放行 */
  var conf = await startConfirm()
  if (aborted()) return { status: 'aborted' }
  if (conf.portal) return portalResult(conf.probe, conf.url, conf.resp)
  if (conf.ok) {
    var fr = freeResult(freeProbes.join('/'))
    fr.freeCount = freeProbes.length
    fr.confirm = conf.probe
    return fr
  }

  /* 探测源通、通用网络不通: 旧实现会误报"无需登入", 这里如实报不通 */
  var off2 = offlineResult()
  off2.freeCount = freeProbes.length
  off2.confirm = conf.probe
  off2.error = '连通性复核未通过 (' + conf.probe + ': ' + (conf.error || '无响应') + ')'
  return off2
}

/*
 * 单个响应分类:
 *   3xx + Location          -> portal (直接拿到跳转页面)
 *   其它 3xx                -> portal (被拦截但没给地址, 交由上层手选服务器)
 *   204 + 空包体            -> free   (真正的"无需登入"证据)
 *   无有效状态码            -> error  (不计入结论)
 *   其余(200 空包体/非空包体) -> portal (探测端点正常只会给 204 空包体, 其它形态都是被改写)
 */
function classify(r) {
  if (!r || !r.ok) return { kind: 'error', reason: (r && r.error) || '请求失败' }
  var code = typeof r.statusCode === 'number' ? r.statusCode : 0
  if (code <= 0) return { kind: 'error', reason: '响应无有效状态码' }
  var hasBody = !!(r.body && r.body.length > 0)
  if (code >= 300 && code < 400) {
    var loc = r.headers && r.headers.location ? trimUrl(r.headers.location) : ''
    return { kind: 'portal', url: loc }
  }
  if (code === 204) {
    return hasBody ? { kind: 'portal', url: extractRedirect(r.text) } : { kind: 'free' }
  }
  if (!hasBody) return { kind: 'portal', url: '' }
  return { kind: 'portal', url: extractRedirect(r.text) }
}

/*
 * 独立复核: 请求非探测源站点。
 * 任何有效 HTTP 状态码都算"路径可达"; 被 3xx 跳转或响应体带门户特征则由上层判 portal;
 * 请求失败算未通过 (继续试下一个复核站点, 全部失败才对外报不通)。
 */
async function confirmConnectivity(timeoutSec) {
  var last = { probe: CONFIRMS[0].name, ok: false, error: '' }
  for (var i = 0; i < CONFIRMS.length; i++) {
    var host = CONFIRMS[i]
    var r = await request({ url: host.url, timeout: timeoutSec })
    if (!r.ok) {
      last = { probe: host.name, ok: false, error: r.error || '无响应' }
      continue
    }
    if (r.statusCode >= 300 && r.statusCode < 400) {
      var loc = r.headers && r.headers.location ? trimUrl(r.headers.location) : ''
      return { probe: host.name, ok: false, portal: true, url: loc, resp: r }
    }
    if (isPortalText(r.text)) {
      return { probe: host.name, ok: false, portal: true, url: extractRedirect(r.text), resp: r }
    }
    if (typeof r.statusCode === 'number' && r.statusCode > 0) return { probe: host.name, ok: true }
    last = { probe: host.name, ok: false, error: '响应无有效状态码' }
  }
  return last
}

/* 给 Promise 加硬超时: 复核请求挂起时也必须给得出结论 (界面永不卡在"正在检测…") */
function withTimeout(p, ms, fallback) {
  return new Promise(function (resolve) {
    var done = false
    var timer = setTimeout(function () {
      if (done) return
      done = true
      resolve(fallback)
    }, ms)
    p.then(
      function (v) {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(v)
      },
      function () {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(fallback)
      }
    )
  })
}

/* 响应体是否带 captive portal 特征 (被透明改写成登录页时用它判定) */
function isPortalText(text) {
  if (!text) return false
  return /wlanuserip=|paip=|clientmac=|clientip=|iarmdst=|panabit|webauth/i.test(text)
}

/* 统一错误描述: request 层不 throw, 这里兜底 Promise 被 reject 的异常路径 */
function describe(e) {
  if (e == null) return '未知错误'
  if (typeof e === 'string') return e
  if (e.message) return e.message
  try {
    return JSON.stringify(e)
  } catch (err) {
    return String(e)
  }
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
    /* 响应头 (小写键): 供适配器 match() 从 Server 等头识别认证类型 */
    headers: resp ? resp.headers : {},
  }
}

function freeResult(probe) {
  return { status: 'free', probe: probe, portalPage: '', serverIp: '', serverPort: '', serverBase: '', params: {}, pageTitle: '', snippet: '' }
}

function offlineResult() {
  return { status: 'offline', probe: '', portalPage: '', serverIp: '', serverPort: '', serverBase: '', params: {}, pageTitle: '', snippet: '', error: '' }
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
