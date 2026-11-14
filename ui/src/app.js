import { BasePage } from './base-page.js'
import { log, initLog } from './services/logger.js'
import { checkCompat } from './services/compat.js'
import { systemInfo } from './services/net.js'

/* 设计基准宽度: 仅当固件没给逻辑宽度时兜底 (有道词典笔 melon_pro 960x266) */
const DESIGN_WIDTH = 960
/*
 * 逻辑宽度以【固件配置】为准: $falcon.env.custom.currentScreenWidth 就是各机型自己的值
 * (真机实测 960; 各包 cfg.json 里 640/800/1020 等)。写死一个宽度会在其它机型上错位。
 */
function logicalWidth() {
  try {
    var c = $falcon && $falcon.env && $falcon.env.custom
    var w = c ? parseInt(c.currentScreenWidth, 10) : 0
    if (w > 0) return w
  } catch (e) {}
  return DESIGN_WIDTH
}

/* 同 base-page: 固件可能没有 $falcon.App, 兜底避免加载期抛异常。 */
const FalconAppBase =
  typeof $falcon !== 'undefined' && $falcon && $falcon.App ? $falcon.App : function FalconAppStub() {}

class App extends FalconAppBase {
  constructor() {
    super()
  }

  onLaunch(options) {
    super.onLaunch(options)
    var vw = logicalWidth()
    this.setViewPort(vw)
    $falcon.useDefaultBasePageClass(BasePage)
    initLog()
    log('应用', 'onLaunch appid=' + (globalThis.$appid || ''))
    /* 平台能力探测: 各机型固件暴露的接口不同, 结果直接落日志便于按机型适配 */
    try {
      var f = typeof $falcon !== 'undefined' ? $falcon : null
      var j = f && f.jsapi ? f.jsapi : null
      /* 兼容性检测: 存储/页面基类/原生扩展/网络逐项真调用, 结果写日志供按机型定位 */
      checkCompat().then(function (c) {
        log('兼容性', '等级=' + c.level + (c.missing.length ? ' 缺失=' + c.missing.join(';') : '') +
          (c.degraded.length ? ' 降级=' + c.degraded.join(';') : '') + ' 明细=' + JSON.stringify(c.details))
      }).catch(function (e) {
        log('兼容性', '检测异常 ' + (e && e.message ? e.message : e))
      })
      /* 真实系统信息: 由平台层读取(os-release/device-tree/固件接口), env 里的是框架版本 */
      systemInfo().then(function (si) {
        if (si && (si.osPretty || si.osName)) {
          log('环境', '真实系统=' + (si.osPretty || si.osName) + ' ' + (si.osVersionId || '') +
            ' 内核=' + (si.kernelVersion || '-') + ' 架构=' + (si.arch || '-') + ' 板型=' + (si.boardModel || '-'))
        }
      }).catch(function () {})
      log('环境', 'vw=' + vw + ' theme=' + ((f && f.env && f.env.custom && f.env.custom.theme) || '-') + ' App=' + (f && typeof f.App) + ' Page=' + (f && typeof f.Page)
        + ' jsapi=' + (typeof j)
        + ' storage=' + (j && typeof j.storage)
        + ' http=' + (j && typeof j.http)
        + ' wifi=' + (j && typeof j.wifi)
        + ' env=' + (f && f.env ? JSON.stringify(f.env) : '-'))
    } catch (e) {
      log('环境', '探测异常: ' + (e && e.message ? e.message : e))
    }
    try {
      console.log('[wifi-login] env=' + JSON.stringify($falcon.env))
    } catch (e) {}
  }

  onShow() {
    super.onShow()
  }

  onHide() {
    super.onHide()
  }

  onDestroy() {
    super.onDestroy()
  }
}

try {
  globalThis['window'] = {
    requestAnimationFrame,
    cancelAnimationFrame,
  }
} catch (err) {
  console.log(err)
}

try {
  globalThis['process'] = {
    env: {
      NODE_ENV: 'production',
    },
  }
} catch (err) {
  console.log(err)
}

// 联调开关: 需要跳过连通性测试直连指定服务器时, 设为
// { server: 'http://IP:端口', username: 'x', password: 'y' }
globalThis['__WIFI_LOGIN_DEBUG'] = null

export default App
