/*
 * 反馈上报(客户端)。契约见 worker/ 与 docs/api-integration.md:
 *   POST /api/v1/feedback { summary, description, app, device, network, status0, logs, source }
 *   -> 201 { ok, id, urls:{issue}, ai:{view} }
 * 本模块只做三件事: 自动采集(设备/网络/状态/日志) -> 组装请求体 -> 提交并归一化结果。
 * 采集项与「用户条款」页列出的内容一一对应, 不多收集任何东西。
 */
import { request, systemInfo, wifiSsid } from './net.js'
import { readLog } from './logger.js'
import { collectReport } from './probe.js'
import { readState } from './store.js'
import { bodyText as bytesToText } from './net-core.js'
import { APP_VERSION } from './version.js'

/*
 * 反馈服务地址。
 *
 * 必须用 http: 本项目的自研网络库 panet 只实现 POSIX socket, 明确不支持 TLS
 * (native/panet/panet.cpp: "https not supported"), 传 https 会直接失败(HTTP 0)。
 * 该域名 http 直连可达(实测 200, 无 301 跳转), 所以这里固定 http。
 * 本地联调时用 setFeedbackBase('http://<电脑IP>:8790')。
 */
export var FEEDBACK_BASE = 'http://api.wifi.xiro.qzz.io'

export function setFeedbackBase(base) {
  var b = String(base || '').trim().replace(/\/+$/, '')
  /* 传进来的 https 一律降级成 http: panet 不支持 TLS, 否则提交必然 HTTP 0 */
  b = b.replace(/^https:\/\//i, 'http://')
  if (b) FEEDBACK_BASE = b
  return FEEDBACK_BASE
}

/* 官网反馈页: 设备完全没网时, 让用户用电脑/手机去这里手动反馈 */
export var FEEDBACK_SITE = 'https://wifi.xiro.qzz.io/feedback.html'

/*
 * 反馈服务是否可达(轻量探活)。判不出来时按"可达"处理 —— 不能因为探测失败就不让用户提交。
 * 返回 { reachable, reason }: reason 用于给用户解释。
 */
export async function checkReachable(timeoutSec) {
  var sec = timeoutSec || 5
  var r = null
  try {
    /* 必须加硬超时: 断网原生层可能既不 resolve 也不 reject, 页面会一直等不到结论 */
    r = await Promise.race([
      request({ url: FEEDBACK_BASE + '/healthz', method: 'GET', timeout: sec }),
      new Promise(function (resolve) {
        setTimeout(function () { resolve(null) }, sec * 1000 + 500)
      })
    ])
  } catch (e) {
    return { reachable: false, reason: '网络请求失败' }
  }
  if (!r) return { reachable: false, reason: '连接超时' }
  var code = (r && r.statusCode) ? r.statusCode : 0
  var body = String((r && r.body) || '')
  if (code >= 200 && code < 500) return { reachable: true, reason: '' }
  /* 有些固件断网时返回 0 + 空体; 能拿到 healthz 内容才算通 */
  if (code === 0 && body.indexOf('"ok"') >= 0) return { reachable: true, reason: '' }
  return { reachable: false, reason: 'HTTP ' + code }
}

/*
 * 判断当前是否联网(给反馈页顶部提示条用)。
 * 不联网也不发请求 —— 全部走本地快速读取, 断网时必须能立刻给结论:
 *   1) 连不上 WiFi(SSID 为空) -> 直接算断网
 *   2) 上次检测结果 status: free(无需登录能上网) / portal(认证通过能上网) -> 联网
 *   3) 其它 -> 按断网处理(引导去官网), 但提交按钮不禁用
 * 每一步都带硬超时, 任何一项失败都不阻塞返回。
 */
export async function probeNetStatus(deps) {
  var d = deps || {}
  var out = { online: false, status: '', ssid: '', reason: '' }
  var st = null
  try {
    st = await Promise.race([
      readState(),
      new Promise(function (resolve) { setTimeout(function () { resolve(null) }, 2500) })
    ])
  } catch (e) { st = null }
  var status = String((st && st.status) || '')
  out.status = status
  var ssid = ''
  try {
    ssid = await Promise.race([
      wifiSsid(),
      new Promise(function (resolve) { setTimeout(function () { resolve('') }, 2500) })
    ]) || ''
  } catch (e) { ssid = '' }
  out.ssid = ssid
  if (!ssid) {
    out.online = false
    out.reason = '未连接到 WiFi'
    return out
  }
  if (status === 'free' || status === 'portal') {
    out.online = true
    out.reason = status === 'free' ? '无需登录即可上网' : '认证已通过'
    return out
  }
  out.online = false
  out.reason = status ? '上次检测: ' + status : '还没做过连通性检测'
  return out
}

/* 日志上限: 服务端单条 256KB, 这里取 120KB, 足够定位又不会传太久 */
/* 日志上限。原生 POST 上限已放宽到 512KB, 但整包越小上传越快、越不容易超时:
 * 40KB 足以覆盖一次完整的"检测→识别→登录→心跳"过程。 */
var LOG_MAX = 40 * 1024

function pad2(n) { return n < 10 ? '0' + n : '' + n }

export function nowText() {
  var d = new Date()
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
}

/* 采集设备与网络信息(只读, 不含密码) */
export async function collectContext(deps) {
  var d = deps || {}
  var si = {}
  try { si = (await systemInfo()) || {} } catch (e) { si = {} }
  var report = null
  try { report = await collectReport(d) } catch (e) { report = null }
  var st = null
  try { st = await readState() } catch (e) { st = null }
  return { system: si, report: report, state: st }
}

/* 现场快照: 给维护者看当时的状态 */
export function buildSnapshot(ctx, extra) {
  var c = ctx || {}
  var st = c.state || {}
  var rep = c.report || null
  var snap = {
    time: nowText(),
    version: APP_VERSION,
    status: st.status || '',
    server: st.server || '',
    adapter: st.adapter || '',
    probe: st.probe || '',
    selfCheck: (rep && rep.self) ? rep.self : null
  }
  if (st.accounts && st.accounts.length !== undefined) snap.accountCount = st.accounts.length
  if (extra) { for (var k in extra) { if (extra[k] !== undefined && extra[k] !== null) snap[k] = extra[k] } }
  return snap
}

/* 读日志(超长时保留最近部分) */
export async function collectLog(maxChars) {
  var limit = maxChars || LOG_MAX
  var text = ''
  try { text = (await readLog()) || '' } catch (e) { text = '' }
  if (text.length > limit) text = '...(前部已截断)...' + String.fromCharCode(10) + text.slice(text.length - limit)
  return text
}

/* 组织请求体: 摘要/描述来自用户输入, 其余自动采集 */
export async function buildPayload(input, deps) {
  var i = input || {}
  var ctx = await collectContext(deps)
  var si = ctx.system || {}
  var report = ctx.report || {}
  var NL2 = String.fromCharCode(10)
  var lines = []
  if (i.description) lines.push(i.description)
  if (i.steps) lines.push('', '复现步骤:', i.steps)
  if (i.contact) lines.push('', '联系方式: ' + i.contact)
  var logs = []
  var logText = await collectLog()
  if (logText) logs.push({ name: 'wifi.log', content: logText })
  if (report && report.ts) {
    try {
      var rep = JSON.stringify(report)
      if (rep.length > 60000) rep = rep.slice(0, 60000)
      logs.push({ name: 'probe.json', content: rep })
    } catch (e) {}
  }
  var payload = {
    summary: String(i.summary || '').slice(0, 120),
    description: lines.join(NL2).slice(0, 8000),
    steps: String(i.steps || '').slice(0, 4000),
    contact: String(i.contact || '').slice(0, 200),
    source: 'pen',
    app: { version: APP_VERSION, appid: '8001865309000001', build: 'rk' },
    device: { model: si.sku || '', firmware: si.osVersion || '' },
    network: {
      ssid: (ctx.state && ctx.state.ssid) || '',
      needLogin: !!((ctx.state || {}).status === 'portal'),
      adapter: (ctx.state || {}).adapter || '',
      probe: (ctx.state || {}).probe || ''
    },
    status0: buildSnapshot(ctx, i.extra),
    logs: logs,
    meta: { clientVersion: APP_VERSION }
  }
  /* 用户在页面上勾了"想加群联系": 打成标签, 维护者一看就知道要拉群 */
  if (i.wantGroup) payload.tags = ['想加群']
  return { payload: payload, ctx: ctx }
}

/* 提交: 返回 {ok, id, issueUrl, aiUrl, message} */
export async function submitFeedback(payload) {
  var body = JSON.stringify(payload)
  var url = FEEDBACK_BASE + '/api/v1/feedback'
  var res = null
  try {
    /* request 只接受对象参数 { url, method, timeout, body, headers, maxBytes }
     * timeout 取 40s: 上传整份日志(几十 KB)比普通探测慢得多(原生上限 60s) */
    res = await request({
      url: url,
      method: 'POST',
      timeout: 15,
      body: body,
      headers: { 'Content-Type': 'application/json' },
      maxBytes: 8192
    })
  } catch (e) {
    return { ok: false, message: '网络请求失败: ' + (e && e.message ? e.message : e) }
  }
  var out = parseSubmit(res)
  /*
   * panet 不支持 TLS: 若地址被配成 https, 原生层拿不到响应(statusCode 0 且无正文)。
   * 这里自动换 http 再试一次, 用户不用关心协议差异。
   */
  if (!out.ok && (out.status === 0 || out.status === undefined) &&
      String(url).indexOf('https://') >= 0) {
    var httpUrl = String(url).replace(/^https:\/\//i, 'http://')
    try {
      var res2 = await request({
        url: httpUrl,
        method: 'POST',
        timeout: 15,
        body: body,
        headers: { 'Content-Type': 'application/json' },
        maxBytes: 8192
      })
      var out2 = parseSubmit(res2)
      if (out2 && out2.ok) return out2
    } catch (e2) {}
  }
  return out
}

/*
 * 归一化服务端响应。
 *
 * 必须用 res.text(已按 UTF-8 解码的字符串), 不能用 res.body(Uint8Array):
 * 直接 JSON.parse 一个 Uint8Array 会得到 "123,10,32,32,34,..." 这种字节数列,
 * 中文更是乱码。res.text 由 net-core 的 bodyText() 产出, 兼容固件有无 TextDecoder。
 */
export function parseSubmit(res) {
  var status = (res && res.statusCode) ? res.statusCode : 0
  var text = ''
  if (res) {
    if (typeof res.text === 'string' && res.text) text = res.text
    else if (typeof res.body === 'string') text = res.body
    else if (res.body && typeof res.body.length === 'number') text = bytesToText(res.body)
  }
  var data = null
  try { data = JSON.parse(text) } catch (e) { data = null }
  if (!data) {
    return { ok: false, status: status, message: '服务返回异常 (HTTP ' + status + '): ' + String(text).slice(0, 160) }
  }
  if (data.ok === true) {
    var urls = data.urls || {}
    return {
      ok: true,
      id: data.id || '',
      duplicate: !!data.duplicate,
      issueUrl: urls.issue || urls.html || '',
      aiUrl: (data.ai && data.ai.view) || '',
      masked: data.masked || 0,
      message: data.duplicate ? '这个问题已有人反馈, 已补充到原工单' : '反馈已提交'
    }
  }
  return { ok: false, status: status, code: data.error || '', message: friendlyError(data) }
}

/* 服务端错误码 -> 用户能看懂的话 */
export function friendlyError(data) {
  var code = String((data && data.error) || '')
  var msg = String((data && data.message) || '')
  var map = {
    summary_too_short: '问题描述太短了, 请至少写两个字说清现象',
    spam_repetition: '描述像是重复字符, 请具体说明遇到的情况',
    spam_no_text: '描述里需要有文字',
    spam_links: '链接太多了, 请删减后重试',
    rate_limited: '提交太频繁, 请稍后再试',
    ip_budget_exhausted: '今天这台设备的反馈次数用完了, 明天再试',
    daily_budget_exhausted: '今天的反馈总量已满, 明天再试',
    tracker_unavailable: '反馈服务暂时不可用, 请稍后再试'
  }
  if (map[code]) return map[code]
  if (msg) return msg
  return '提交失败' + (code ? ' (' + code + ')' : '')
}

/* 一键: 采集 + 提交 */
export async function submitWithContext(input, deps) {
  var built = await buildPayload(input, deps)
  var payload = built.payload
  if (!payload.summary || payload.summary.length < 2) {
    return { ok: false, message: '请先写一句问题描述' }
  }
  return submitFeedback(payload)
}

