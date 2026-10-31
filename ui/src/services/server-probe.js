/*
 * 保存的认证服务器在"当前网络"是否真的可用。
 *
 * 背景: 仅凭 SSID 判断不够 —— 同名 SSID 完全可能是另一个网络(实测家庭网络与校园同名 602_5G),
 * 此时上一个网络的门户服务器虽然"属于这个 SSID 槽位", 在当前网络却根本不可达;
 * 若仍据此显示"设备管理/下线"并自动跳进管理页, 就是与当前网络无关的内容。
 * 这里用适配器自身的探测能力做一次轻量确认; 适配器没有对应能力时保持原有行为, 不误伤。
 */
export async function confirmServerUsable(adapter, serverBase, state) {
  if (!adapter || !serverBase) return false
  if (typeof adapter.sync === 'function') {
    try {
      var r = await adapter.sync(serverBase, { ip: '' }, state || {})
      return !!(r && r.ok)
    } catch (e) {
      return false
    }
  }
  if (typeof adapter.loadConf === 'function') {
    try {
      var c = await adapter.loadConf(serverBase, {}, state || {})
      return !!(c && (c.status === 'ready' || c.status === 'free'))
    } catch (e) {
      return false
    }
  }
  return true
}

