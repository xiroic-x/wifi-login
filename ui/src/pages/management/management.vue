<template>
  <div class="wrapper">
    <div class="headbar">
      <text class="title">设备管理</text>
      <div class="headbtns">
        <div class="hbtn hbtn-refresh" @click="reload">
          <text class="hbtn-text">{{ loading ? '刷新中…' : '刷新' }}</text>
        </div>
        <div class="hbtn hbtn-all" @click="confirmOffAll">
          <text class="hbtn-text">全部下线</text>
        </div>
        <div class="hbtn hbtn-back" @click="goBack">
          <text class="hbtn-text">返回</text>
        </div>
      </div>
    </div>

    <div class="inforow">
      <text class="infolabel">认证服务器</text>
      <text class="infovalue">{{ serverShow || '未知' }}</text>
      <text class="infocount">在线 {{ devices.length }} 台</text>
    </div>

    <scroller class="devscroll">
      <div class="devitem" v-for="(d, i) in devices" :key="i">
        <div class="devmain">
          <text class="devname">{{ d.name || '未知设备' }}</text>
          <text class="devmeta">IP {{ d.ipstr }}  MAC {{ d.clntmac || '—' }}  {{ d.birth || '' }}</text>
        </div>
        <div class="devtag" v-if="d.isSelf">
          <text class="devtag-text">本机</text>
        </div>
        <div class="devbtn" v-if="offing !== d.ipstr" @click="confirmOffOne(d)">
          <text class="devbtn-text">下线</text>
        </div>
        <div class="devbtn devbtn-busy" v-if="offing === d.ipstr">
          <text class="devbtn-text">下线中…</text>
        </div>
      </div>
      <text class="devempty" v-if="!loading && !devices.length">{{ emptyText }}</text>
      <text class="devempty" v-if="loading && !devices.length">正在获取设备列表…</text>
    </scroller>

    <div class="msgrow">
      <text class="msg msg-error" v-if="msgType === 'error'">{{ msg }}</text>
      <text class="msg msg-warn" v-if="msgType === 'warn'">{{ msg }}</text>
      <text class="msg msg-info" v-if="msgType === 'info'">{{ msg }}</text>
      <text class="msg msg-info" v-if="!msg">就绪</text>
    </div>

    <!-- 确认弹层: 替代原生 confirmDialog, 适配横条屏 -->
    <div class="mask" v-if="ask.show">
      <div class="dialog">
        <text class="dlgtext">{{ ask.text }}</text>
        <div class="dlgbtns">
          <div class="dlgbtn dlgbtn-cancel" @click="ask.show = false">
            <text class="dlgbtn-text">取消</text>
          </div>
          <div class="dlgbtn dlgbtn-ok" @click="ask.confirm()">
            <text class="dlgbtn-text">确定</text>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { loadPortalConf, loadUserList, userOffOne, logout } from '../../services/portal.js'
import { log } from '../../services/logger.js'

const REFRESH_MS = 15000
/* 列表超过该时长未刷新则视为过期, 回到前台时自动拉取 */
const STALE_MS = 20000

export default {
  name: 'management',
  data() {
    return {
      serverBase: '',
      serverShow: '',
      selfIp: '',
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
      var launch = this.readLaunch()
      this.serverBase = launch.serverBase || ''
      this.serverShow = this.serverBase.replace('http://', '')
      this.selfIp = launch.ip || ''
      log('管理页', '进入 server=' + this.serverBase + ' ip=' + this.selfIp)
      if (!this.serverBase) {
        this.emptyText = '未获取到认证服务器'
        this.setMsg('缺少认证服务器地址，请返回首页重新检测', 'error')
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
    },

    /* 读取外部传入参数 (主页 navTo 时带的 server/ip) */
    readLaunch() {
      var out = { serverBase: '', ip: '' }
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
      this.reload()
    },

    setMsg(text, type) {
      this.msg = text || ''
      this.msgType = type || 'info'
    },

    /* 首次进入: 先确保会话可用 (load_portal_conf), 再拉设备列表 */
    bootstrap() {
      var self = this
      this.loading = true
      this.setMsg('正在同步认证会话…', 'info')
      loadPortalConf(this.serverBase, {
        ip: this.selfIp,
        vlan: '',
        mac: '',
      }).then(function (res) {
        if (res && res.ok && res.code === 200) {
          // MAC 免认证: 无账号会话, 设备列表接口可能仍可用, 继续尝试
          log('管理页', 'load_portal_conf code=200 (免认证)')
        } else if (res && res.ok && res.code === 0 && res.data && res.data.policy) {
          self.selfIp = self.selfIp || ''
        } else if (res && res.code === -1) {
          self.loading = false
          self.setMsg('认证服务器无响应（' + res.msg + '）', 'error')
          self.emptyText = '服务器无响应'
          return
        }
        self.reload()
      })
    },

    /* 拉取在线设备列表 */
    reload() {
      var self = this
      if (!this.serverBase) return
      this.loading = true
      loadUserList(this.serverBase, { ip: this.selfIp }).then(function (res) {
        self.loading = false
        self._lastLoadAt = Date.now()
        if (!res.ok) {
          log('管理页', 'load_user_list 失败 code=' + res.code + ' msg=' + res.msg)
          self.setMsg('获取设备列表失败：' + (res.msg || '未知错误'), 'error')
          self.emptyText = '获取失败，请点刷新'
          return
        }
        var list = Array.isArray(res.data) ? res.data : []
        self.devices = list.map(function (d) {
          return {
            name: d.name || '',
            ipstr: d.ipstr || '',
            clntmac: d.clntmac || '',
            birth: d.birth || '',
            uid: d.uid || '',
            isSelf: !!self.selfIp && d.ipstr === self.selfIp,
          }
        })
        log('管理页', '设备列表 ' + self.devices.length + ' 台')
        /* 通知主页: 管理页可用 (服务器正常), 不要因连不上而限制后续自动进入 */
        try {
          $falcon.trigger('wifiManageUsable', '1')
        } catch (e) {}
        if (!self.devices.length) {
          self.emptyText = '暂无在线设备'
          self.setMsg('当前无在线设备', 'info')
        } else {
          self.setMsg('共 ' + self.devices.length + ' 台在线设备', 'info')
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
      if (!this.serverBase || !d.ipstr) return
      this.offing = d.ipstr
      this.setMsg('正在下线 ' + d.ipstr + ' …', 'info')
      userOffOne(this.serverBase, { addr: d.ipstr }).then(function (res) {
        self.offing = ''
        log('管理页', 'user_offone ' + d.ipstr + ' code=' + res.code + ' msg=' + res.msg)
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
      if (!this.serverBase) return
      this.setMsg('正在全部下线…', 'info')
      logout(this.serverBase, { ip: this.selfIp }).then(function (res) {
        log('管理页', 'user_offall code=' + res.code + ' msg=' + res.msg)
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
      if (this._backTimer) clearTimeout(this._backTimer)
      this.$page.finish()
    },
  },
}
</script>

<style>
.wrapper {
  width: 960px;
  height: 266px;
  background-color: #10233f;
  flex-direction: column;
}
.headbar {
  width: 960px;
  height: 44px;
  background-color: #16324f;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding-left: 20px;
  padding-right: 16px;
}
.title {
  font-size: 26px;
  color: #e8f1fb;
  font-weight: bold;
}
.headbtns {
  flex-direction: row;
  align-items: center;
}
.hbtn {
  width: 110px;
  height: 32px;
  border-radius: 16px;
  background-color: #2c5aa0;
  align-items: center;
  justify-content: center;
  margin-left: 10px;
}
.hbtn-refresh {
  background-color: #2f7bd9;
}
.hbtn-all {
  background-color: #8a3b3b;
  width: 130px;
}
.hbtn-back {
  background-color: #3f5f85;
}
.hbtn-text {
  font-size: 18px;
  color: #ffffff;
}
.inforow {
  width: 960px;
  height: 24px;
  flex-direction: row;
  align-items: center;
  padding-left: 20px;
  padding-right: 20px;
  margin-top: 4px;
}
.infolabel {
  width: 130px;
  font-size: 15px;
  color: #6f8cb0;
}
.infovalue {
  width: 620px;
  font-size: 15px;
  color: #b8cde8;
  lines: 1;
  text-overflow: ellipsis;
}
.infocount {
  width: 170px;
  font-size: 15px;
  color: #37c2a0;
  text-align: right;
}
.devscroll {
  width: 960px;
  height: 138px;
  padding-left: 16px;
  padding-right: 16px;
  padding-top: 4px;
}

/* 注意: 横条屏可用高度只有 266px, 这里用两行紧凑布局而非卡片 */
.devitem {
  width: 928px;
  height: 46px;
  background-color: #16324f;
  border-radius: 8px;
  flex-direction: row;
  align-items: center;
  padding-left: 12px;
  padding-right: 10px;
  margin-bottom: 6px;
}
.devmain {
  width: 640px;
  flex-direction: column;
  justify-content: center;
}
.devname {
  font-size: 19px;
  color: #e8f1fb;
  lines: 1;
  text-overflow: ellipsis;
  height: 24px;
}
.devmeta {
  font-size: 13px;
  color: #6f8cb0;
  lines: 1;
  text-overflow: ellipsis;
  height: 17px;
}
.devtag {
  width: 62px;
  height: 24px;
  border-radius: 12px;
  background-color: #1f5c4c;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
}
.devtag-text {
  font-size: 14px;
  color: #6fe3c0;
}
.devbtn {
  width: 96px;
  height: 32px;
  border-radius: 8px;
  background-color: #8a3b3b;
  align-items: center;
  justify-content: center;
}
.devbtn-busy {
  background-color: #4a2a2a;
}
.devbtn-text {
  font-size: 17px;
  color: #ffffff;
}
.devempty {
  font-size: 17px;
  color: #4a6076;
  margin-top: 16px;
  text-align: center;
}
.msgrow {
  width: 960px;
  height: 50px;
  padding-left: 20px;
  padding-top: 8px;
  flex-direction: column;
}
.msg {
  font-size: 17px;
  lines: 2;
}
.msg-error {
  color: #ff8f8f;
}
.msg-warn {
  color: #ffd48a;
}
.msg-info {
  color: #9fc3ee;
}

/* 确认弹层 */
.mask {
  position: absolute;
  left: 0;
  top: 0;
  width: 960px;
  height: 266px;
  background-color: rgba(0, 0, 0, 0.55);
  align-items: center;
  justify-content: center;
}
.dialog {
  width: 520px;
  background-color: #16324f;
  border-radius: 12px;
  padding: 18px;
  flex-direction: column;
  align-items: center;
}
.dlgtext {
  font-size: 20px;
  color: #e8f1fb;
  lines: 2;
  text-align: center;
  margin-bottom: 14px;
}
.dlgbtns {
  flex-direction: row;
  align-items: center;
}
.dlgbtn {
  width: 150px;
  height: 40px;
  border-radius: 8px;
  align-items: center;
  justify-content: center;
  margin-left: 10px;
  margin-right: 10px;
}
.dlgbtn-cancel {
  background-color: #3f5f85;
}
.dlgbtn-ok {
  background-color: #8a3b3b;
}
.dlgbtn-text {
  font-size: 19px;
  color: #ffffff;
}
</style>
