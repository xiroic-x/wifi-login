import { migrateLegacy, readState, writeState } from './services/store.js'
import { APP_VERSION } from './services/version.js'
import { log } from './services/logger.js'
/*
 * 页面基类: 统一管理 $falcon.on 事件 token、setTimeout/setInterval,
 * 页面卸载时全部释放, 防止残留 timer / 订阅。
 */

const DEBUG = false

/* 兼容: 实测 x6pro(OS 4.3.5) 上 $falcon.Page 为空, 直接 extends 会抛
   "cannot read property prototype of undefined", 整个页面加载失败(白屏)。
   这里做兜底, 保证页面能挂载; 真正的框架基类存在时行为不变。 */
const FalconPageBase =
  typeof $falcon !== 'undefined' && $falcon && $falcon.Page ? $falcon.Page : function FalconPageStub() {}

class PageRes extends FalconPageBase {
  constructor() {
    super()
    this.falconOnTokens = [] // [[token, name], ...]
    this.timeoutTokens = new Set()
    this.intervalTokens = new Set()
  }

  on(name, callback) {
    const token = $falcon.on(name, callback)
    this.falconOnTokens.push([token, name])
    return token
  }

  off(name) {
    const kept = []
    for (let i = 0; i < this.falconOnTokens.length; i++) {
      const pair = this.falconOnTokens[i]
      if (pair[1] === name) {
        continue
      }
      kept.push(pair)
    }
    this.falconOnTokens = kept
    $falcon.off(name)
  }

  trigger(name, options) {
    $falcon.trigger(name, options)
  }

  setTimeout(func, ms) {
    const token = setTimeout(() => {
      this.timeoutTokens.delete(token)
      func()
    }, ms)
    this.timeoutTokens.add(token)
    return token
  }

  setInterval(func, ms) {
    const token = setInterval(func, ms)
    this.intervalTokens.add(token)
    return token
  }

  clearTimeout(token) {
    this.timeoutTokens.delete(token)
    clearTimeout(token)
  }

  clearInterval(token) {
    this.intervalTokens.delete(token)
    clearInterval(token)
  }

  release() {
    for (let i = 0; i < this.falconOnTokens.length; i++) {
      const pair = this.falconOnTokens[i]
      DEBUG && console.log(`release $falcon.on token ${pair[0]}`)
      try {
        $falcon.off(pair[1], pair[0])
      } catch (e) {
        console.log(`release token failed: ${e}`)
      }
    }
    this.falconOnTokens.length = 0
    this.timeoutTokens.forEach((token) => {
      clearTimeout(token)
    })
    this.timeoutTokens.clear()
    this.intervalTokens.forEach((token) => {
      clearInterval(token)
    })
    this.intervalTokens.clear()
  }
}

export class BasePage extends PageRes {
  constructor() {
    super()
  }

  async sleep(ms) {
    return new Promise((resolve) => {
      this.setTimeout(() => {
        resolve()
      }, ms)
    })
  }

  onLoad(options) {
    super.onLoad(options)
    this.options = options
  }

  onNewOptions(options) {
    super.onNewOptions(options)
    this.options = options
    if (this.$root && this.$root.onNewOptions) {
      this.$root.onNewOptions(options)
    }
  }


  onShow() {
    super.onShow()
    if (this.$root && this.$root.onShow) {
      this.$root.onShow()
    }
    /* 首个进入的页面触发一次启动检查(迁移/更新提示) */
    startupCheck()
  }

  onHide() {
    super.onHide()
    if (this.$root && this.$root.onHide) {
      this.$root.onHide()
    }
  }

  onUnload() {
    try {
      super.onUnload()
      if (this.$root && this.$root.onUnload) {
        this.$root.onUnload()
      }
    } finally {
      this.release()
    }
  }

  beforeVueInstantiate(Vue) {
    try {
      Vue.prototype.$workspace = globalThis.$workspace
      Vue.prototype.$appid = globalThis.$appid
    } catch (err) {
      console.log(err)
    }
  }
}

/* 启动检查放类外: 类体内不能声明 var/async function */
/*
 * 启动检查(每次启动只做一次, 由首个进入的页面触发):
 *  1) 旧数据迁移 —— 早期版本把数据写在 /userdisk/xiro/ 下, 现搬进应用数据目录;
 *  2) 版本更新 —— 与上次运行记录比对, 版本变了就提示一次。
 * 迁移成功或版本变化时进入「迁移已完成 / 更新完成」页; 全新安装不做打扰。
 */
var _startupChecked = false
async function startupCheck() {
  if (_startupChecked) return
  _startupChecked = true
  try {
    var moved = []
    try {
      var m = await migrateLegacy()
      moved = (m && m.moved) || []
      if (moved.length) log('迁移', '旧数据已迁移: ' + moved.join('/'))
    } catch (e1) {
      log('迁移', '迁移检查异常 ' + (e1 && e1.message ? e1.message : e1))
    }
    var st = await readState()
    var last = st && st.lastVersion
    if (moved.length) {
      await writeState({ lastVersion: APP_VERSION, migratedAt: Date.now(), noticeShownAt: Date.now() })
      if (typeof $falcon !== 'undefined' && $falcon.navTo) {
        $falcon.navTo('migrated', { kind: 'migrate', items: moved.join(',') })
      }
      return
    }
    if (last && last !== APP_VERSION) {
      await writeState({ lastVersion: APP_VERSION, noticeShownAt: Date.now() })
      if (typeof $falcon !== 'undefined' && $falcon.navTo) {
        $falcon.navTo('migrated', { kind: 'update', prev: last })
      }
      return
    }
    if (!last) await writeState({ lastVersion: APP_VERSION })
  } catch (e2) {
    log('启动', '启动检查异常 ' + (e2 && e2.message ? e2.message : e2))
  }
}
