import { BasePage } from './base-page.js'

const DESIGN_WIDTH = 960 // 有道词典笔 melon_pro: 屏幕 960x266 (direction 270)

class App extends $falcon.App {
  constructor() {
    super()
  }

  onLaunch(options) {
    super.onLaunch(options)
    this.setViewPort(DESIGN_WIDTH)
    $falcon.useDefaultBasePageClass(BasePage)
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

// == DEBUG: 真机联调开关 (指向局域网模拟 Panabit 服务器), 验证完删除 ==
globalThis['__WIFI_LOGIN_DEBUG'] = { server: 'http://192.168.1.10:8080', username: 'test', password: '123456' }

export default App
