/*
 * 应用日志。
 *
 * 落盘位置遵循 miniapp 数据落盘规范 (R5): 业务数据只能写 <appid>/data/,
 * 即 $dataDir (实测 = /userdisk/miniapp/data/mini_app/pkg/<appid>/data/)。
 * 旧版本写 /userdisk/xiro/wifi.log —— 那是规范外的目录, 既不参与设置「空间清理」
 * 统计, 也不随卸载清理, 已改为 $dataDir 下。
 *
 * 走 panet.appendFile (追加写, 超限自动轮转), 异常静默不影响业务;
 * 取不到 $dataDir 时只保留内存日志, 不写规范外的路径。
 */

import { Panet } from 'panet'

var LOG_NAME = '/wifi.log'
var _panet = null
var _dirReady = false

function client() {
  if (!_panet) _panet = typeof Panet === 'function' ? new Panet() : Panet
  return _panet
}

/* $dataDir = <appid>/data/ (规范允许的唯一业务数据位置) */
function dataDir() {
  try {
    return globalThis.$dataDir || ''
  } catch (e) {
    return ''
  }
}

function logPath() {
  var d = dataDir()
  return d ? d + LOG_NAME : ''
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n
}

function timestamp() {
  try {
    var d = new Date()
    return (
      pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
    )
  } catch (e) {
    return ''
  }
}

export function initLog() {
  if (_dirReady) return
  _dirReady = true
  var d = dataDir()
  if (!d) return
  try {
    client().mkdirs(d).catch(function () {})
  } catch (e) {}
}

/* log('检测', 'status=free ...') -> [09-06 12:30:00][检测] ... */
export function log(tag, msg) {
  if (!_dirReady) initLog()
  var p = logPath()
  if (!p) return
  var line =
    '[' + timestamp() + '][' + tag + '] ' +
    String(msg == null ? '' : msg).replace(/[\r\n]+/g, ' ') + '\n'
  try {
    client().appendFile(p, line).catch(function () {})
  } catch (e) {}
}

/* 供日志页读取全文 (CVI 版为内存缓冲, 接口一致) */
export async function readLog() {
  var p = logPath()
  if (!p) return ''
  try {
    var raw = await client().readFile(p)
    return raw || ''
  } catch (e) {
    return ''
  }
}

export async function clearLog() {
  var p = logPath()
  if (!p) return false
  try {
    await client().writeFile(p, '')
    return true
  } catch (e) {
    return false
  }
}

