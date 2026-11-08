import { BasePage } from './base-page.js'
import { log, initLog } from './services/logger.js'

const DESIGN_WIDTH = 960 // 有道词典笔 melon_pro: 屏幕 960x266 (direction 270)

/* 同 base-page: 固件可能没有 $falcon.App, 兜底避免加载期抛异常。 */
const FalconAppBase =
  typeof $falcon !== 'undefined' && $falcon && $falcon.App ? $falcon.App : function FalconAppStub() {}

class App extends FalconAppBase {
  constructor() {
    super()
  }

  onLaunch(options) {
    super.onLaunch(options)
    this.setViewPort(DESIGN_WIDTH)
    $falcon.useDefaultBasePageClass(BasePage)
    initLog()
    log('应用', 'onLaunch appid=' + (globalThis.$appid || ''))
    /* 平台能力探测: 各机型固件暴露的接口不同, 结果直接落日志便于按机型适配 */
    try {
      var f = typeof $falcon !== 'undefined' ? $falcon : null
      var j = f && f.jsapi ? f.jsapi : null
      log('环境', 'App=' + (f && typeof f.App) + ' Page=' + (f && typeof f.Page)
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
