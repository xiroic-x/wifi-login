/*
 * 功能自检(全项真跑)。
 *
 * 检测页与反馈页共用同一套: 存储写—读回环、网络实打一次探测源、账号查一次、迁移实跑一次,
 * 再由 probe.collectReport 汇总成报告(含真实系统信息 / 固件 API / 运行时对象 / 自检结论)。
 *
 * 原则: 任何一项失败都不抛错, 只把该项标成不可用 —— 自检本身不能挡住反馈提交。
 */
import { collectReport, reportLines } from './probe.js'
import { readState, writeState, loadAccount, migrateLegacy } from './store.js'
import { request } from './net.js'
import { log } from './logger.js'

/* 单项超时: 自检里最慢的是网络探测, 给它一个硬上限, 免得反馈提交被拖住 */
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise(function (resolve) { setTimeout(function () { resolve(fallback) }, ms) })
  ])
}

/* 组装自检依赖: 每项都是真实调用, 不是读缓存标记 */
export function selfCheckDeps() {
  return {
    probeStorage: async function () {
      try {
        var stamp = 'p' + Date.now()
        await writeState({ probeStamp: stamp })
        var back = await readState()
        return back && back.probeStamp === stamp ? '可用' : '异常(写读不一致)'
      } catch (e) {
        return '异常(' + (e && e.message ? e.message : e) + ')'
      }
    },
    probeNet: async function () {
      try {
        var r = await withTimeout(
          request({ url: 'http://connect.rom.miui.com/generate_204', timeout: 5, maxBytes: 64 }),
          7000,
          null
        )
        if (!r) return '超时(无响应)'
        var code = r && (r.statusCode || r.status)
        return code ? '可用(HTTP ' + code + ')' : '不可用(无响应)'
      } catch (e) {
        return '异常(' + (e && e.message ? e.message : e) + ')'
      }
    },
    probeFile: async function () {
      try {
        var st = await readState()
        return typeof st === 'object' ? '可用(经存储链持久化)' : '不可用'
      } catch (e) {
        return '异常(' + (e && e.message ? e.message : e) + ')'
      }
    },
    probeAccount: async function () {
      try {
        var acc = await loadAccount('')
        return acc && acc.username ? '有已存账号' : '无已存账号'
      } catch (e) {
        return '异常(' + (e && e.message ? e.message : e) + ')'
      }
    },
    probeMigrate: async function () {
      try {
        var m = await migrateLegacy()
        var moved = (m && m.moved) || []
        var skipped = (m && m.skipped) || []
        if (moved.length) return '已迁移 ' + moved.join('/')
        if (skipped.length) return '无需迁移(已有新数据)'
        return (m && m.reason) ? m.reason : '无旧数据'
      } catch (e) {
        return '异常(' + (e && e.message ? e.message : e) + ')'
      }
    }
  }
}

/* 跑一次完整自检, 返回报告对象(永不抛错) */
export async function runDiagnostics() {
  try {
    return await collectReport(selfCheckDeps())
  } catch (e) {
    try { log('自检', '执行失败 ' + (e && e.message ? e.message : e)) } catch (e2) {}
    return null
  }
}

/*
 * 把报告逐行写进日志。
 * logger 会把换行压成空格, 所以这里自己按行切开发 —— 保证每条独立成行, 好读也好搜。
 */
export function logReport(report, tag) {
  var t = tag || '自检'
  if (!report) {
    try { log(t, '无报告(自检未产生结果)') } catch (e) {}
    return 0
  }
  var lines = [];
  try { lines = reportLines(report) || [] } catch (e) { lines = [] }
  var n = 0
  for (var i = 0; i < lines.length; i++) {
    var line = String(lines[i] == null ? '' : lines[i])
    if (!line) continue
    /* 过长的行(例如固件模块清单)截断, 避免日志被单行撑爆 */
    if (line.length > 900) line = line.slice(0, 900) + '…'
    try { log(t, line); n++ } catch (e) {}
  }
  try { log(t, '自检完成, 共 ' + n + ' 行') } catch (e) {}
  return n
}

