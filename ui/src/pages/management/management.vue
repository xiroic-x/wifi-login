<template>
  <div class="page">
    <div class="bar">
      <text class="bartitle">设备管理</text>
      <div class="baractions">
        <div class="btn-ghost" @click="reload">
          <text class="btntext">{{ loading ? '刷新中…' : '刷新' }}</text>
        </div>
        <div class="btn-ghost" @click="confirmOffAll">
          <text class="btntext">全部下线</text>
        </div>
        <div class="btn-ghost" @click="goBack">
          <text class="btntext">返回</text>
        </div>
      </div>
    </div>

    <div class="summary">
      <div class="sumcell">
        <text class="sumk">认证服务器</text>
        <text class="sumv">{{ serverShow || '未知' }}</text>
      </div>
      <div class="sumcell">
        <text class="sumk">本机 IP</text>
        <text class="sumv">{{ selfIp || '—' }}</text>
      </div>
      <div class="sumcell sumcell-num">
        <text class="sumk">在线</text>
        <text class="sumnum">{{ devices.length }}</text>
      </div>
    </div>

    <scroller class="list">
      <div class="item" :class="{ self: d.isSelf }" v-for="(d, i) in devices" :key="d.ipstr || i">
        <div class="itemmain">
          <div class="itemrow">
            <text class="itemname">{{ d.name || '未知设备' }}</text>
            <div class="tag" v-if="d.isSelf"><text class="tagtext">本机</text></div>
          </div>
          <text class="itemmeta">IP {{ d.ipstr }} · MAC {{ d.clntmac || '—' }}{{ d.birth ? ' · ' + d.birth : '' }}</text>
        </div>
        <div class="btn danger sm" v-if="offing !== d.ipstr" @click="confirmOffOne(d)">
          <text class="btntext">下线</text>
        </div>
        <div class="btn ghost sm" v-if="offing === d.ipstr">
          <text class="btntext">下线中…</text>
        </div>
      </div>
      <text class="empty" v-if="!loading && !devices.length">{{ emptyText }}</text>
      <text class="empty" v-if="loading && !devices.length">正在获取设备列表…</text>
      <div style="height: 8px;"></div>
    </scroller>

    <div class="foot">
      <div class="dot" :class="msgClass"></div>
      <text class="foottext" :class="msgClass">{{ msg || '就绪' }}</text>
    </div>

    <div class="mask" v-if="ask.show">
      <div class="dialog">
        <text class="dlgtitle">确认操作</text>
        <text class="dlgtext">{{ ask.text }}</text>
        <div class="dlgbtns">
          <div class="btn-ghost" @click="ask.show = false"><text class="btntext">取消</text></div>
          <div class="btn-danger" @click="ask.confirm()"><text class="btntext">确定</text></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { byId } from '../../services/portal-adapters/registry.js'
import { log } from '../../services/logger.js'

const REFRESH_MS = 15000
/* 列表超过该时长未刷新则视为过期, 回到前台时自动拉取 */
const STALE_MS = 20000
/* 服务器持续不可达时, 连续失败该次数后自动退回主页, 避免用户困在管理页 */
const MAX_FAILS = 2

export default {
  computed: {
    msgClass() { return this.msgType === 'error' ? 'error' : (this.msgType === 'warn' ? 'warn' : 'info') },
  },
  name: 'management',
  data() {
    return {
      serverBase: '',
      serverShow: '',
      selfIp: '',
      /* 当前认证适配器 (主页 navTo 时按 ID 传入; 提供 listDevices 才能进本页) */
      adapter: null,
      devices: [],
      loading: false,
      offing: '', // 正在下线的设备 IP
      msg: '',
      msgType: 'info',
      emptyText: '暂无在线设备',
      ask: { show: false, text: '', confirm: function () {} },
    }
  },
  methods: {
    onShow() {
      if (this._started) {
        // 从其它页/输入法返回: 列表过期才刷新, 避免频繁请求
        if (this.loading || this.offing) return
        var stale = !this._lastLoadAt || Date.now() - this._lastLoadAt > STALE_MS
        if (stale) this.reload()
        return
      }
      this._started = true
      var self0 = this
      var launch = this.readLaunch()
      this.serverBase = launch.serverBase || ''
      this.serverShow = this.serverBase.replace('http://', '')
      this.selfIp = launch.ip || ''
      this.adapter = byId(launch.adapter || '')
      log('管理页', '进入 server=' + this.serverBase + ' ip=' + this.selfIp + ' adapter=' + (this.adapter ? this.adapter.id : '(无)'))
      if (!this.serverBase) {
        this.emptyText = '未获取到认证服务器'
        this.setMsg('缺少认证服务器地址，请返回首页重新检测', 'error')
        return
      }
      if (!this.adapter || !this.adapter.listDevices) {
        /* 适配器未提供设备管理能力 (或未识别): 不空等, 提示后返回 */
        this.emptyText = '该认证类型不支持设备管理'
        this.setMsg(
          '当前认证类型（' + (this.adapter ? this.adapter.name : '未识别') + '）不支持设备管理，请返回',
          'warn'
        )
        var t0 = setTimeout(function () {
          self0.goBack()
        }, 1500)
        this._backTimer = t0
        return
      }
      this.bootstrap()
      this.startTimer()
    },
    onHide() {
      this.stopTimer()
    },
    onUnload() {
      this.stopTimer()
      if (this._backTimer) clearTimeout(this._backTimer)
      this._notifyClosed()
    },

    /* 通知主页: 本页已关闭 (主页据此立即重检) */
    _notifyClosed() {
      if (this._closed) return
      this._closed = true
      /* 判定"服务器不可用"的三种情形:
       *   1) 已明确标记服务器不可达 (_serverDead)
       *   2) 从未成功拉到过设备列表 (_loadedOnce 为假) —— 说明页面开了但没跑通
       * 两者都通知主页进入冷却, 避免系统快速回收页面时主页拿不到失败信号而反复跳。 */
      var bad = this._serverDead || !this._loadedOnce
      try {
        $falcon.trigger('wifiManageClosed', bad ? 'failed' : 'ok')
      } catch (e) {}
    },

    /* 读取外部传入参数 (主页 navTo 时带的 server/ip/adapter) */
    readLaunch() {
      var out = { serverBase: '', ip: '', adapter: '' }
      try {
        var lo = this.$page && this.$page.loadOptions
        var no = this.$page && this.$page.newOptions
        var o = no && this.hasKeys(no) ? no : lo
        if (!o) return out
        if (typeof o === 'string') {
          try {
            o = JSON.parse(o)
          } catch (e) {
            return out
          }
        }
        if (!o || typeof o !== 'object') return out
        if (o.serverBase) out.serverBase = String(o.serverBase)
        if (o.ip) out.ip = String(o.ip)
        if (o.adapter) out.adapter = String(o.adapter)
        return out
      } catch (e) {
        return out
      }
    },
    hasKeys(o) {
      for (var k in o) return true
      return false
    },
    onNewOptions(options) {
      if (!this._started) return
      var o = options
      if (typeof o === 'string') {
        try {
          o = JSON.parse(o)
        } catch (e) {
          return
        }
      }
      if (!o || typeof o !== 'object') return
      if (o.serverBase) {
        this.serverBase = String(o.serverBase)
        this.serverShow = this.serverBase.replace('http://', '')
      }
      if (o.ip) this.selfIp = String(o.ip)
      if (o.adapter) this.adapter = byId(String(o.adapter))
      this.reload()
    },

    setMsg(text, type) {
      this.msg = text || ''
      this.msgType = type || 'info'
    },

    /* 判断是否"连不上服务器"类错误 (区别于业务错误): 这类失败才触发自动退出 */
    _isConnFail(res) {
      var s = ((res && res.msg) || '') + ''
      return /connect failed|timeout|timed out|errno=|无响应|网络请求失败|EHOSTUNREACH|ECONNREFUSED|ETIMEDOUT/i.test(s)
    },

    /* 首次进入: 先确保会话可用 (适配器提供 sync 时), 再拉设备列表 */
    bootstrap() {
      var self = this
      this.loading = true
      this.setMsg('正在同步认证会话…', 'info')
      var pre = this.adapter.sync
        ? this.adapter.sync(this.serverBase, { ip: this.selfIp }, {})
        : Promise.resolve({ ok: true })
      pre.then(function (res) {
        if (res && res.ok && res.code === 200) {
          // MAC 免认证: 无账号会话, 设备列表接口可能仍可用, 继续尝试
          log('管理页', 'sync code=200 (免认证)')
        } else if (res && res.code === -1) {
          self.loading = false
          self._fails = (self._fails || 0) + 1
          self.setMsg('认证服务器无响应（' + res.msg + '）', 'error')
          self.emptyText = '服务器无响应'
          /* sync 连不上: 会话根本没法建立, 设备列表必然也拿不到。
           * 这是最明确的失败信号, 直接视为服务器不可用并退回主页,
           * 不在这里空等 (否则页面会悬空直到被系统回收)。 */
          if (self._isConnFail(res)) {
            self._serverDead = true
            self.emptyText = '服务器不可达，正在返回…'
            self.stopTimer()
            /* 让用户看清错误再退出, 但明显短于系统回收时间 */
            if (self._backTimer) clearTimeout(self._backTimer)
            self._backTimer = setTimeout(function () {
              self.goBack()
            }, 1200)
            return
          }
          /* 非网络类错误: 继续尝试拉列表 */
        }
        self.reload()
      })
    },

    /* 拉取在线设备列表 */
    reload() {
      var self = this
      if (!this.serverBase || !this.adapter) return
      this.loading = true
      this.adapter
        .listDevices(this.serverBase, {
          params: { ip: this.selfIp, wlanuserip: this.selfIp },
        })
        .then(function (res) {
        self.loading = false
        self._lastLoadAt = Date.now()
        if (!res.ok) {
          self._fails = (self._fails || 0) + 1
          log('管理页', 'load_user_list 失败 code=' + res.code + ' msg=' + res.msg + ' (' + self._fails + '/' + MAX_FAILS + ')')
          self.setMsg('获取设备列表失败：' + (res.msg || '未知错误'), 'error')
          self.emptyText = '获取失败，请点刷新'
          /* 网络类失败 (连不上服务器) 连续多次 -> 自动退回主页, 不再空转 */
          if (self._isConnFail(res) && self._fails >= MAX_FAILS) {
            self._serverDead = true
            self.emptyText = '服务器不可达，正在返回…'
            self.stopTimer()
            if (self._backTimer) clearTimeout(self._backTimer)
            self._backTimer = setTimeout(function () {
              self.goBack()
            }, 1200)
          }
          return
        }
        self._fails = 0
        self._loadedOnce = true // 成功拿到过列表: 关闭时不再按"没跑通"处理
        var list = Array.isArray(res.list) ? res.list : []
        var mapped = list.map(function (d) {
          return {
            name: d.name || '',
            ipstr: d.ipstr || '',
            clntmac: d.clntmac || '',
            birth: d.birth || '',
            uid: d.uid || '',
            isSelf: !!self.selfIp && d.ipstr === self.selfIp,
          }
        })
        /* 列表内容未变化时不替换数组: 15s 轮询下避免整列表重渲染与无谓写盘 */
        var sig = JSON.stringify(mapped)
        var changed = sig !== self._lastListSig
        self._lastListSig = sig
        if (changed) {
          self.devices = mapped
          log('管理页', '设备列表 ' + mapped.length + ' 台')
        }
        /* 通知主页: 管理页可用 (服务器正常), 不要因连不上而限制后续自动进入 */
        try {
          $falcon.trigger('wifiManageUsable', '1')
        } catch (e) {}
        if (!mapped.length) {
          self.emptyText = '暂无在线设备'
          self.setMsg('当前无在线设备', 'info')
        } else {
          self.setMsg('共 ' + mapped.length + ' 台在线设备', 'info')
        }
      })
    },

    startTimer() {
      var self = this
      if (this._timer) return
      this._timer = setInterval(function () {
        // 弹层/下线中不打扰
        if (self.ask.show || self.offing) return
        self.reload()
      }, REFRESH_MS)
    },
    stopTimer() {
      if (this._timer) {
        clearInterval(this._timer)
        this._timer = null
      }
    },

    /* ---- 确认弹层 ---- */
    confirmOffOne(d) {
      var self = this
      var label = d.name || d.ipstr
      this.ask = {
        show: true,
        text: '确定下线「' + label + '」(' + d.ipstr + ') ?',
        confirm: function () {
          self.ask.show = false
          self.doOffOne(d)
        },
      }
    },
    confirmOffAll() {
      var self = this
      if (!this.devices.length) {
        this.setMsg('当前无在线设备', 'warn')
        return
      }
      this.ask = {
        show: true,
        text: '确定下线全部 ' + this.devices.length + ' 台设备 ?',
        confirm: function () {
          self.ask.show = false
          self.doOffAll()
        },
      }
    },

    /* ---- 单设备下线 ---- */
    doOffOne(d) {
      var self = this
      if (!this.serverBase || !d.ipstr || !this.adapter) return
      this.offing = d.ipstr
      this.setMsg('正在下线 ' + d.ipstr + ' …', 'info')
      this.adapter.offOne(this.serverBase, { addr: d.ipstr }).then(function (res) {
        self.offing = ''
        log('管理页', 'user_offone ' + d.ipstr + ' code=' + (res && res.code) + ' msg=' + (res && res.msg))
        if (!res.ok) {
          self.setMsg('下线失败：' + (res.msg || '未知错误'), 'error')
          self.reload()
          return
        }
        self.setMsg('已下线 ' + d.ipstr, 'info')
        self.reload()
      })
    },

    /* ---- 全部下线 ---- */
    doOffAll() {
      var self = this
      if (!this.serverBase || !this.adapter) return
      this.setMsg('正在全部下线…', 'info')
      this.adapter
        .offAll(this.serverBase, {
          params: { ip: this.selfIp, wlanuserip: this.selfIp },
        })
        .then(function (res) {
          log('管理页', 'user_offall code=' + (res && res.code) + ' msg=' + (res && res.msg))
          if (!res.ok) {
            self.setMsg('全部下线失败：' + (res.msg || '未知错误'), 'error')
            return
          }
          self.setMsg('已全部下线', 'info')
          self.devices = []
          self.emptyText = '已全部下线'
          // 本机也被下线, 返回主页重新检测
          var t = setTimeout(function () {
            self.goBack()
          }, 900)
          self._backTimer = t
        })
    },

    goBack() {
      this.stopTimer()
      this._notifyClosed()
      this.$page.finish()
    },
  },
}
</script>
<style>
/* 设计语言与其它页一致: 背景 #0b0c0e / 卡片 #14161a / 主色 #4c9aff / 危险 #e5484d
 * 宽度全部百分比 + flex-wrap, 横条屏与竖屏都完整显示 */
.page { width: 100%; height: 100%; background-color: #0b0c0e; flex-direction: column; }
.bar {
  width: 100%; height: 44px; background-color: #14161a;
  flex-direction: row; align-items: center; justify-content: space-between;
  padding-left: 16px; padding-right: 12px; flex-wrap: wrap;
}
.bartitle { font-size: 22px; color: #f2f4f8; font-weight: bold; }
.baractions { flex-direction: row; align-items: center; flex-wrap: wrap; }
.btn {
  height: 30px; padding-left: 14px; padding-right: 14px; border-radius: 15px;
  align-items: center; justify-content: center; margin-left: 8px;
}
.btn-ghost { background-color: #24272e; }
.btn-danger { background-color: #b3261e; }
.btn-sm { height: 28px; padding-left: 12px; padding-right: 12px; border-radius: 14px; margin-left: 8px; }
.btntext { font-size: 14px; color: #f2f4f8; }
.summary {
  width: 100%; flex-direction: row; padding: 8px 16px; flex-wrap: wrap;
  background-color: #101215; border-bottom-width: 1px; border-bottom-color: #24272e;
}
.sumcell { flex-direction: column; margin-right: 24px; }
.sumcell-num { margin-right: 0; }
.sumk { font-size: 12px; color: #6b7480; }
.sumv { font-size: 14px; color: #d7dce4; }
.sumnum { font-size: 18px; color: #4c9aff; font-weight: bold; }
.list { flex: 1; padding-left: 14px; padding-right: 14px; padding-top: 8px; }
.item {
  background-color: #14161a; border-radius: 8px; padding: 8px 10px; margin-bottom: 6px;
  flex-direction: row; align-items: center; border-left-width: 3px; border-left-color: #24272e; flex-wrap: wrap;
}
.item-self { border-left-color: #4c9aff; background-color: #131a24; }
.itemmain { flex: 1; flex-direction: column; }
.itemrow { flex-direction: row; align-items: center; flex-wrap: wrap; }
.itemname { font-size: 15px; color: #f2f4f8; }
.itemmeta { font-size: 12px; color: #9aa4b2; margin-top: 2px; }
.tag {
  padding-left: 8px; padding-right: 8px; height: 18px; border-radius: 9px;
  background-color: #1b2735; align-items: center; justify-content: center; margin-left: 8px;
}
.tagtext { font-size: 11px; color: #4c9aff; }
.empty { font-size: 14px; color: #6b7480; padding-top: 12px; }
.foot {
  width: 100%; height: 34px; flex-direction: row; align-items: center;
  padding-left: 16px; padding-right: 16px; background-color: #101215;
  border-top-width: 1px; border-top-color: #24272e;
}
.dot { width: 7px; height: 7px; border-radius: 4px; margin-right: 8px; background-color: #6b7480; }
.dot-info { background-color: #4c9aff; }
.dot-warn { background-color: #ffb020; }
.dot-error { background-color: #e5484d; }
.foottext { font-size: 13px; color: #9aa4b2; flex: 1; }
.foottext-warn { color: #ffb020; }
.foottext-error { color: #ff8a8d; }
.mask {
  position: absolute; left: 0; top: 0; width: 100%; height: 100%;
  background-color: rgba(0, 0, 0, 0.62); align-items: center; justify-content: center;
}
.dialog {
  width: 66%; max-width: 520px; background-color: #14161a; border-radius: 10px;
  padding: 12px 14px; flex-direction: column;
}
.dlgtitle { font-size: 17px; color: #f2f4f8; font-weight: bold; margin-bottom: 6px; }
.dlgtext { font-size: 14px; color: #d7dce4; margin-bottom: 12px; }
.dlgbtns { flex-direction: row; justify-content: flex-end; flex-wrap: wrap; }
</style>

