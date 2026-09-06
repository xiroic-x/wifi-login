/*
 * Panabit Portal 认证 API 客户端。
 * 从 portal 页面 (登入/index.html + assert/portal.js + assert/panabit.js) 提取的协议:
 *   - 端点: http://<portal服务器>[:端口]/api?<查询参数>
 *   - 账号密码登录: route=webauth&action=user_login
 *   - 配置/策略:    route=portal&action=load_portal_conf
 *   - 认证状态查询: route=webauth&action=query_auth_stat
 *   - 下线:         route=ucenter&action=user_offall (ucenter 页面提取)
 *   - 响应: JSON, code==0 成功; 中文为 GB2312 编码, 这里只保留 ASCII
 *     (错误文案用本地映射, 避免 GBK 依赖)
 *   - username/password 用 AES-128-ECB/ZeroPadding(密钥 Panabit@1024_key) 加密后传 hex
 */

import { request, describeErr } from './net.js'
import { paAesEncode } from './aes.js'

function qs(params) {
  var parts = []
  for (var k in params) {
    if (params[k] === undefined || params[k] === null) continue
    parts.push(k + '=' + params[k])
  }
  return parts.join('&')
}

/* 服务端 GB2312 中文按 latin1 读入会乱码, 只保留 ASCII 部分用于对照 */
function sanitize(text) {
  return String(text || '').replace(/[^\x20-\x7e]/g, '')
}

function serverMsg(code, msg) {
  var m = sanitize(msg)
  switch (code) {
    case 2:
      return '账号需要修改密码，请在网页认证页处理'
    case 255:
      if (/INV_NAMEORPWD/i.test(m)) return '账号或密码错误'
      break
  }
  return m || '服务器返回 code=' + code
}

async function apiCall(serverBase, params) {
  if (!serverBase) {
    return { ok: false, code: -1, msg: '未获取到认证服务器地址', data: null }
  }
  var url = serverBase + '/api?' + qs(params)
  var r = await request({ url: url, timeout: 8 })
  if (!r.ok) {
    return { ok: false, code: -1, msg: r.error || '无法连接认证服务器', data: null }
  }
  var text = sanitize(r.text)
  if (!text) {
    return { ok: false, code: -1, msg: '服务器返回空响应', data: null }
  }
  try {
    var json = JSON.parse(text)
    return {
      ok: json.code === 0 || json.code === 200,
      code: typeof json.code === 'number' ? json.code : -1,
      msg: serverMsg(json.code, json.msg),
      rawMsg: json.msg,
      data: json.data === undefined ? null : json.data,
    }
  } catch (e) {
    return { ok: false, code: -1, msg: '响应解析失败: ' + describeErr(e), data: null }
  }
}

/*
 * 加载 portal 配置。
 * code 0: 需要认证 (data.policy/data.style)
 * code 200: MAC 免认证已通过
 */
export function loadPortalConf(serverBase, opts) {
  var o = opts || {}
  return apiCall(serverBase, {
    route: 'portal',
    action: 'load_portal_conf',
    ip: o.ip || '',
    vlan: o.vlan || '',
    mac: o.mac || '',
    device: 'mobile',
  })
}

/* 账号密码登录 (auth_type 取 load_portal_conf 返回 policy.auth1, 默认 panabit)
 * 请求格式与网页端抓包一致:
 * /api?route=webauth&action=user_login&auth_type=panabit&ip=&mac=&code=&
 * username=<明文>&password=<AES hex>&remember_me=<0|1>
 */
export function userLogin(serverBase, opts) {
  var o = opts || {}
  return apiCall(serverBase, {
    route: 'webauth',
    action: 'user_login',
    auth_type: o.authType || 'panabit',
    ip: o.ip || '',
    mac: o.mac || '',
    code: o.code || '',
    username: o.username || '',
    password: paAesEncode(o.password || ''),
    remember_me: o.remember ? 1 : 0,
  })
}

/* 认证状态查询: data.stat != 0 即已认证 */
export function queryAuthStat(serverBase, opts) {
  var o = opts || {}
  return apiCall(serverBase, {
    route: 'webauth',
    action: 'query_auth_stat',
    scene_str: o.sceneStr || '',
    ip: o.ip || '',
    type: o.type || 'auth1',
  })
}

/* 下线当前 IP (ucenter user_offall) */
export function logout(serverBase, opts) {
  var o = opts || {}
  return apiCall(serverBase, {
    route: 'ucenter',
    action: 'user_offall',
    ip: o.ip || '',
  })
}
