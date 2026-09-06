/*
 * 系统输入法封装 —— 走系统级 "有道输入法" mini-app (global.startTextEdit 路径),
 * 不使用 textarea 软键盘路径。按 haasui-falcon-app skill 的状态机实现:
 *   1. 全局单例 Global, 打开前先挂 textEditFinished handler (on/off 成对)
 *   2. 打开前关闭旧会话, startTextEdit 同步返回 UUID 并保存
 *   3. 回调先校验 UUID 再 parse; 仅 editConfirmed === true 时写回文本
 *   4. 业务完成后立即 closeTextEdit(uuid)
 *   5. 页面销毁先 off, 再关闭残留会话
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

export class SystemIme {
  constructor() {
    this.uuid = ''
    this.handler = null
    this.pending = null
    this.attached = false
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
  }

  /*
   * 打开系统输入法, 返回 Promise<string|null>。
   * opts: { text, placeholder, maxlength, enterButtonText, autofocus, showCursor }
   * 确认返回输入文本, 取消/失败返回 null。
   */
  open(opts) {
    var o = opts || {}
    var self = this
    this.ensureHandler()
    var m = getInputManager()

    // 打开前关闭旧会话
    if (this.uuid) {
      try {
        m.closeTextEdit(this.uuid)
      } catch (e) {}
      this.uuid = ''
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
    } catch (e) {
      return Promise.resolve(null)
    }
    if (uuid && typeof uuid === 'object' && uuid.uuid) uuid = uuid.uuid
    if (!uuid) return Promise.resolve(null)
    this.uuid = uuid

    return new Promise(function (resolve) {
      self.pending = { resolve: resolve, uuid: uuid }
    })
  }

  onFinished(res) {
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
    this.close()
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
