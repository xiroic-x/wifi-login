/*
 * 一次性探针: 打印固件可能暴露的系统/版本接口返回值, 用于确定"词典笔 OS 版本"的真实来源。
 * 只在诊断日志里用, 不参与业务。
 */
export async function probeVersionApis() {
  var out = []
  var f = null
  try { f = globalThis.$falcon } catch (e) { f = null }
  var j = (f && f.jsapi) || null
  var cands = []
  function add(label, fn) { if (typeof fn === 'function') cands.push({ label: label, fn: fn }) }
  if (j) {
    add('jsapi.system.getDeviceInfo', j.system && j.system.getDeviceInfo)
    add('jsapi.system.systemInfo', j.system && j.system.systemInfo)
    add('jsapi.system.getVersion', j.system && j.system.getVersion)
    add('jsapi.global.getDeviceInfo', j.global && j.global.getDeviceInfo)
    add('jsapi.getDeviceInfo', j.getDeviceInfo)
  }
  if (f) {
    add('falcon.getDeviceInfo', f.getDeviceInfo)
    add('falcon.getVersion', f.getVersion)
  }
  for (var i = 0; i < cands.length; i++) {
    try {
      var r = await cands[i].fn.call(null)
      var t = ''
      try { t = typeof r === 'string' ? r : JSON.stringify(r) } catch (e2) { t = String(r) }
      out.push(cands[i].label + ' => ' + String(t).slice(0, 240))
    } catch (e3) {
      out.push(cands[i].label + ' => 异常 ' + (e3 && e3.message ? e3.message : e3))
    }
  }
  return out
}

