/*
 * 兼容性检测: 判断当前设备/固件能否正常跑本应用。
 *
 * 判据全部是【真实调用】的结果, 不是机型白名单:
 *   - 存储往返(写后读回) 不可用 => unsupported: 账号无法保存, 属致命不兼容
 *   - 页面基类缺失 / 原生模块缺失 / 网络不通 => degraded: 有回退路径, 可用但降级
 * 失败项与降级项都会写进日志与检测页, 便于按机型定位。
 */
import { readState, writeState } from './store.js'
import { request } from './net.js'

var _cache = null

export async function checkCompat(opts) {
  var o = opts || {}
  var out = {
    level: 'ok',
    missing: [],
    degraded: [],
    details: {},
    ts: Date.now(),
  }

  /* 1) 存储: 写-读回环 */
  try {
    var stamp = 'c' + Date.now()
    await writeState({ compatStamp: stamp })
    var st = await readState()
    var okStore = !!(st && st.compatStamp === stamp)
    out.details.storage = okStore ? 'ok' : 'fail'
    if (!okStore) out.missing.push('存储(键值/文件写入无效)')
  } catch (e) {
    out.details.storage = 'fail'
    out.missing.push('存储(异常: ' + (e && e.message ? e.message : e) + ')')
  }

  /* 2) 页面基类: 缺失时有兜底, 记降级 */
  var hasPage = false
  try {
    hasPage = !!(globalThis.$falcon && typeof globalThis.$falcon.Page === 'function')
  } catch (e2) {}
  out.details.pageBase = hasPage ? 'ok' : 'fallback'
  if (!hasPage) out.degraded.push('页面基类缺失(已用兜底)')

  /* 3) 原生扩展(自研库): 缺失时走 JSAPI 探测链, 记降级 */
  var hasNative = false
  try {
    var j = globalThis.$falcon && globalThis.$falcon.jsapi
    hasNative = !!((j && j.panet) || globalThis.panet)
  } catch (e3) {}
  out.details.native = hasNative ? 'ok' : 'none'
  if (!hasNative) out.degraded.push('原生扩展未加载(已用固件 JSAPI)')

  /* 4) 网络: 不通多半是没连上 WiFi, 不是不兼容 */
  if (o.skipNet !== true) {
    try {
      var r = await request({ url: 'http://connect.rom.miui.com/generate_204', timeout: 5, maxBytes: 64 })
      var code = r && (r.statusCode || r.status)
      out.details.net = code ? 'ok(HTTP ' + code + ')' : 'fail'
      if (!code) out.degraded.push('网络探测无响应(可能未连上 WiFi)')
    } catch (e4) {
      out.details.net = 'fail'
      out.degraded.push('网络探测异常(可能未连上 WiFi)')
    }
  } else {
    out.details.net = 'skipped'
  }

  out.level = out.missing.length ? 'unsupported' : (out.degraded.length ? 'degraded' : 'ok')
  _cache = out
  return out
}

/* 启动时算过一次后可直接取, 供页面展示 */
export function getCompat() {
  return _cache
}

export function compatLine(c) {
  if (!c) return '未检测'
  var label = c.level === 'ok' ? '兼容' : (c.level === 'degraded' ? '兼容(降级)' : '不兼容')
  var extra = (c.missing || []).concat(c.degraded || [])
  return label + (extra.length ? ': ' + extra.join('; ') : '')
}
