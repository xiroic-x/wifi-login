/*
 * 系统输入法封装 —— 走系统级 "有道输入法" mini-app (global.startTextEdit 路径),
 * 不使用 textarea 软键盘路径。按 haasui-falcon-app skill 的状态机实现:
 *   1. 全局单例 Global, 打开前先挂 textEditFinished handler (on/off 成对)
 *   2. 打开前关闭旧会话, startTextEdit 同步返回 UUID 并保存
 *   3. 回调先校验 UUID 再 parse; 仅 editConfirmed === true 时写回文本
 *   4. 业务完成后立即 closeTextEdit(uuid)
 *   5. 页面销毁先 off, 再关闭残留会话
 * 真机实测补充: 关闭后立刻重开会被输入法忽略, 需要间隔 (这里取 600ms,
 * 不足则等待), startTextEdit 返回空视为失败并重试一次。
 */

import globalModule from 'global'

var manager = null

function getInputManager() {
  if (!manager) manager = new globalModule.Global()
  return manager
}

function normalizeText(value) {
  if (value && typeof value === 'object') {
    if (typeof value.value === 'string') return value.value
    if (typeof value.text === 'string') return value.text
  }
  return typeof value === 'string' ? value : ''
}

var REOPEN_GAP_MS = 600

export class SystemIme {
  constructor() {
    this.uuid = ''
    this.handler = null
    this.pending = null
    this.attached = false
    this.lastCloseAt = 0
  }

  ensureHandler() {
    var m = getInputManager()
    if (this.attached) return
    var self = this
    this.handler = function (res) {
      self.onFinished(res)
    }
    m.textEditFinished.on(this.handler)
    this.attached = true
    // == DEBUG: 观察其他相关事件 ==
    try {
      var logRaw = function (tag) {
        return function (res) {
          var s
          try {
            s = typeof res === 'string' ? res : JSON.stringify(res)
          } catch (e) {
            s = String(res)
          }
          console.warn('[ime] ' + tag + ' raw=' + s)
        }
      }
      $falcon.on('apolloTextEditClosed', logRaw('apolloTextEditClosed'))
      $falcon.on('textEditFinished', logRaw('falcon.textEditFinished'))
    } catch (e) {
      console.warn('[ime] extra listener err ' + e)
    }
  }

  /*
   * 打开系统输入法, 返回 Promise<string|null>。
   * opts: { text, placeholder, maxlength, enterButtonText, autofocus, showCursor }
   * 确认返回输入文本, 取消/失败返回 null。
   */
  open(opts) {
    var self = this
    this.ensureHandler()
    var wait = 0
    var now = Date.now()
    if (now - this.lastCloseAt < REOPEN_GAP_MS) {
      wait = REOPEN_GAP_MS - (now - this.lastCloseAt)
    }
    return new Promise(function (resolve) {
      setTimeout(function () {
        self.openNow(opts, resolve, 1)
      }, wait)
    })
  }

  openNow(opts, resolve, retriesLeft) {
    var self = this
    var o = opts || {}
    var m = getInputManager()

    // 打开前关闭旧会话
    if (this.uuid) {
      this.close()
    }
    if (this.pending) {
      var old = this.pending
      this.pending = null
      old.resolve(null)
    }

    var config = {
      text: o.text || '',
      placeholder: o.placeholder || '',
      maxlength: o.maxlength || 64,
      autofocus: o.autofocus !== false,
      showCursor: o.showCursor !== false,
      enterButtonText: o.enterButtonText || '确定',
    }

    var uuid = ''
    try {
      uuid = m.startTextEdit(JSON.stringify(config))
      console.warn('[ime] startTextEdit ret=' + JSON.stringify(uuid))
    } catch (e) {
      uuid = ''
      console.warn('[ime] startTextEdit threw ' + e)
    }
    if (uuid && typeof uuid === 'object' && uuid.uuid) uuid = uuid.uuid

    if (!uuid) {
      // 打开失败 (常见于上一次会话刚结束): 间隔后重试一次
      if (retriesLeft > 0) {
        setTimeout(function () {
          self.openNow(opts, resolve, retriesLeft - 1)
        }, REOPEN_GAP_MS)
      } else {
        resolve(null)
      }
      return
    }
    this.uuid = uuid

    this.pending = { resolve: resolve, uuid: uuid }
  }

  onFinished(res) {
    console.warn('[ime] finished raw=' + (function (r) {
      try {
        return typeof r === 'string' ? r : JSON.stringify(r)
      } catch (e) {
        return String(r)
      }
    })(res))
    if (!this.pending) return
    var payload = res
    if (typeof res === 'string') {
      try {
        payload = JSON.parse(res)
      } catch (e) {
        payload = res
      }
    }
    // UUID 校验: 事件带 uuid 时只处理当前会话
    if (payload && typeof payload === 'object' && payload.uuid && this.uuid && payload.uuid !== this.uuid) {
      return
    }
    var confirmed = payload && typeof payload === 'object' && payload.editConfirmed === true
    var text = confirmed ? normalizeText(payload) : ''
    var p = this.pending
    this.pending = null
    // == DEBUG: 观察 closeTextEdit 返回值 (可能携带输入文本) ==
    var closeRet = null
    if (this.uuid) {
      try {
        closeRet = getInputManager().closeTextEdit(this.uuid)
      } catch (e) {
        closeRet = 'throw ' + e
      }
      this.uuid = ''
      this.lastCloseAt = Date.now()
    }
    var cr
    try {
      cr = typeof closeRet === 'string' ? closeRet : JSON.stringify(closeRet)
    } catch (e) {
      cr = String(closeRet)
    }
    console.warn('[ime] closeTextEdit ret=' + cr + ' confirmed=' + confirmed)
    p.resolve(confirmed ? text : null)
  }

  cancel() {
    if (this.pending) {
      var p = this.pending
      this.pending = null
      this.close()
      p.resolve(null)
    } else {
      this.close()
    }
  }

  close() {
    if (!this.uuid) return
    try {
      getInputManager().closeTextEdit(this.uuid)
    } catch (e) {}
    this.uuid = ''
    this.lastCloseAt = Date.now()
  }

  /* 页面销毁: 先 off, 再关闭残留会话 */
  destroy() {
    var m = null
    try {
      m = getInputManager()
    } catch (e) {
      m = null
    }
    if (this.attached && this.handler && m) {
      try {
        m.textEditFinished.off(this.handler)
      } catch (e) {}
    }
    this.attached = false
    this.handler = null
    if (this.pending) {
      var p = this.pending
      this.pending = null
      p.resolve(null)
    }
    this.close()
  }
}
