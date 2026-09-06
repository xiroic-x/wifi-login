<template>
  <div class="wrapper">
    <div class="headbar">
      <text class="title">WiFi 网络认证</text>
      <div class="headbtn" @click="runCheck">
        <text class="headbtn-text">{{ checking ? '检测中…' : '重新检测' }}</text>
      </div>
    </div>

    <div class="statusarea" @click="runCheck">
      <text class="status status-free" v-if="pageState === 'free'">无需登入</text>
      <text class="status status-ok" v-if="pageState === 'ok'">认证成功，无需登入</text>
      <text class="status status-portal" v-if="pageState === 'portal'">需要认证</text>
      <text class="status status-offline" v-if="pageState === 'offline'">无网络连接</text>
      <text class="status status-busy" v-if="pageState === 'busy'">正在检测…</text>
      <text class="status status-busy" v-if="pageState === 'manual'">需要认证（未识别服务器）</text>

      <div class="inforow" v-if="probeName">
        <text class="infolabel">连通性测试</text>
        <text class="infovalue">{{ probeName }}</text>
      </div>
      <div class="inforow" v-if="serverShow">
        <text class="infolabel">认证服务器</text>
        <text class="infovalue">{{ serverShow }}</text>
      </div>
      <div class="inforow" v-if="portalPage">
        <text class="infolabel">跳转页面</text>
        <text class="infovalue">{{ portalPage }}</text>
      </div>
      <div class="inforow" v-if="deviceIp">
        <text class="infolabel">本机参数</text>
        <text class="infovalue">{{ deviceIp }}</text>
      </div>
    </div>

    <div class="formrow" v-if="showForm || canLogout">
      <div class="field" v-if="showForm" @click="editUsername">
        <text class="fieldlabel">账号</text>
        <text class="fieldvalue" v-if="username">{{ username }}</text>
        <text class="fieldvalue fieldplaceholder" v-if="!username">点此输入账号</text>
      </div>
      <div class="field" v-if="showForm" @click="editPassword">
        <text class="fieldlabel">密码</text>
        <text class="fieldvalue" v-if="password">{{ password }}</text>
        <text class="fieldvalue fieldplaceholder" v-if="!password">点此输入密码</text>
      </div>
      <div class="remember" v-if="showForm" @click="toggleRemember">
        <text class="remembertext remembertext-on" v-if="remember">已记住密码</text>
        <text class="remembertext" v-if="!remember">记住密码</text>
      </div>
      <div class="btn btn-login" v-if="showForm && !logging" @click="doLogin">
        <text class="btn-text">登 录</text>
      </div>
      <div class="btn btn-busy" v-if="showForm && logging">
        <text class="btn-text">登录中…</text>
      </div>
      <div class="btn btn-logout" v-if="canLogout" @click="doLogout">
        <text class="btn-text btn-text-logout">下 线</text>
      </div>
    </div>

    <div class="formrow" v-if="showManualServer">
      <div class="field field-wide" @click="editServer">
        <text class="fieldlabel">服务器</text>
        <text class="fieldvalue-wide" v-if="manualServer">{{ manualServer }}</text>
        <text class="fieldvalue-wide fieldplaceholder" v-if="!manualServer">点此输入认证服务器IP[:端口]</text>
      </div>
      <div class="btn btn-login" @click="applyManualServer">
        <text class="btn-text">确 定</text>
      </div>
    </div>

    <div class="msgrow">
      <text class="msg msg-error" v-if="msgType === 'error'">{{ msg }}</text>
      <text class="msg msg-warn" v-if="msgType === 'warn'">{{ msg }}</text>
      <text class="msg msg-info" v-if="msgType === 'info'">{{ msg }}</text>
      <text class="msg msg-info" v-if="!msg">就绪</text>
    </div>
  </div>
</template>

<script>
import { checkPortal } from '../../services/detect.js'
import { loadPortalConf, userLogin, queryAuthStat, logout } from '../../services/portal.js'
import { loadAccount, saveAccount } from '../../services/store.js'
import { log, initLog } from '../../services/logger.js'
import { SystemIme } from '../../services/ime.js'

export default {
  name: 'index',
  data() {
    return {
      pageState: 'busy', // free | ok | portal | offline | busy | manual
      probeName: '',
      serverShow: '',
      serverBase: '',
      portalPage: '',
      deviceIp: '',
      authType: 'panabit',
      sceneStr: '',
      username: '',
      password: '',
      remember: false,
      logging: false,
      checking: false,
      canLogout: false,
      showForm: false,
      showManualServer: false,
      manualServer: '',
      msg: '',
      msgType: 'info',
    }
  },
  computed: {},
  methods: {
    onShow() {
      if (this._started) {
        // 系统输入法面板弹出/收起会让本页 onHide/onShow 一轮;
        // 输入会话中及刚关闭的短暂窗口内不做自动刷新, 否则会把登录表单冲掉
        if (this.logging) return
        if (this._imeBusy) return
        if (this._imeClosedAt && Date.now() - this._imeClosedAt < 3000) return
        // 从后台回来: 认证会话可能已过期, 停留超过 90 秒未同步则自动重新检测
        var stale = !this._lastSyncAt || Date.now() - this._lastSyncAt > 90000
        if ((this.pageState === 'portal' || this.pageState === 'manual') && stale) {
          this.runCheck()
        }
        return
      }
      this._started = true
      this.ime = new SystemIme()
      initLog()
      log('应用', '页面启动')
      var self = this
      // == DEBUG: 真机联调开关, 验证完删除 ==
      var DBG = null // 联调开关: 设为 { server, username, password } 可跳过探测直连指定服务器
      if (DBG) {
        this.username = DBG.username
        this.password = DBG.password
        this.remember = true
        this._lastServer = DBG.server
        this._lastSyncAt = Date.now()
        this.pageState = 'portal'
        this.serverBase = DBG.server
        this.serverShow = DBG.server.replace('http://', '')
        this.authType = 'panabit'
        this.showForm = true
        this.startHeartbeat()
        this.setMsg('[调试] 已指向模拟认证服务器', 'warn')
        return
      }
      loadAccount().then(function (acc) {
        self.username = acc.username
        self.password = acc.password
        self.remember = acc.remember
        self._lastServer = acc.serverBase || ''
        self.runCheck()
      })
    },
    onHide() {
      // 输入会话中 (输入法面板导致的 onHide): 保留会话与心跳, 不当成本页离开
      if (this._imeBusy) return
      this.stopHeartbeat()
      if (this.ime) this.ime.cancel()
    },
    onUnload() {
      this._gen = (this._gen || 0) + 1
      this.stopHeartbeat()
      if (this.ime) {
        this.ime.destroy()
        this.ime = null
      }
    },

    setMsg(text, type) {
      this.msg = text || ''
      this.msgType = type || 'info'
    },

    /* ---- 系统输入法输入 (global.startTextEdit, skill 状态机) ---- */
    openIme(opts) {
      var self = this
      this._imeBusy = true
      return this.ime.open(opts).then(function (v) {
        self._imeBusy = false
        self._imeClosedAt = Date.now()
        return v
      }, function () {
        self._imeBusy = false
        self._imeClosedAt = Date.now()
        return null
      })
    },
    editServer() {
      var self = this
      this.openIme({
        text: this.manualServer,
        placeholder: '例如 192.168.3.12:8080',
        maxlength: 64,
        enterButtonText: '确定',
      }).then(function (v) {
        if (v == null) return
        self.manualServer = v.trim()
      })
    },
    editUsername() {
      var self = this
      this.openIme({
        text: this.username,
        placeholder: '请输入账号',
        maxlength: 64,
        enterButtonText: '下一步',
      }).then(function (v) {
        if (v == null) return
        self.username = v.trim()
        self.editPassword()
      })
    },
    editPassword() {
      var self = this
      this.openIme({
        text: this.password,
        placeholder: '请输入密码',
        maxlength: 64,
        enterButtonText: '确定',
      }).then(function (v) {
        if (v == null) return
        self.password = v.replace(/^\s+|\s+$/g, '')
      })
    },

    /*
     * 会话保活心跳: 网页认证页每 5 秒轮询 query_auth_stat 维持服务器侧
     * 会话 (页面静止几分钟后 token 过期导致"无法登入需刷新")。
     * app 用 30 秒间隔达到同样效果, 同时探测设备是否已在别处完成认证。
     */
    startHeartbeat() {
      var self = this
      if (this._statTimer) return
      this._statTimer = setInterval(function () {
        var gen = self._gen || 0
        queryAuthStat(self.serverBase, {
          ip: self.paramOf('wlanuserip'),
          sceneStr: self.sceneStr,
          type: self.authType,
        }).then(function (res) {
          if (gen !== (self._gen || 0)) return
          if (res.ok && res.data && res.data.stat && res.data.stat != 0) {
            self.stopHeartbeat()
            self._lastSyncAt = Date.now()
            log('心跳', 'stat=' + res.data.stat + ' 已在别处认证')
            self.pageState = 'ok'
            self.showForm = false
            self.canLogout = true
            self.setMsg('该设备已通过认证，无需登入', 'info')
          } else if (res.ok) {
            self._lastSyncAt = Date.now()
          }
        })
      }, 30000)
    },
    stopHeartbeat() {
      if (this._statTimer) {
        clearInterval(this._statTimer)
        this._statTimer = null
      }
    },

    /* ---- 连通性测试 ---- */
    runCheck() {
      var self = this
      var gen = (this._gen = (this._gen || 0) + 1)
      this.stopHeartbeat()
      this.checking = true
      this.pageState = 'busy'
      this.setMsg('正在进行 WiFi 连通性测试…', 'info')
      this.canLogout = false
      this.showForm = false
      this.showManualServer = false

      checkPortal().then(function (det) {
        if (gen !== self._gen) return
        self.checking = false
        self.probeName = det.status === 'offline' ? '全部探测源无响应' : det.probe
        if (det.status === 'free') {
          self.pageState = 'free'
          self.serverBase = ''
          self.serverShow = ''
          self.portalPage = ''
          self.setMsg('网络直连正常，无需登入', 'info')
          return
        }
        if (det.status === 'offline') {
          self.pageState = 'offline'
          self.serverBase = ''
          self.serverShow = ''
          self.portalPage = ''
          if (det.error) {
            self.setMsg('请检查 WiFi 连接 (' + det.error + ')', 'warn')
          } else {
            self.setMsg('请先连接 WiFi（设置 → 网络）', 'warn')
          }
          return
        }
        // 被强制门户拦截
        self.portalPage = det.portalPage || ''
        if (det.pageTitle) {
          self.setMsg('被认证页拦截: ' + det.pageTitle, 'warn')
        } else {
          self.setMsg('检测到需要认证', 'warn')
        }
        self.afterPortal(det.serverBase, det.params, gen)
      })
    },

    afterPortal(serverBase, params, gen) {
      var self = this
      var p = params || {}
      this._params = p
      var ipDesc = []
      if (p.wlanuserip) ipDesc.push('IP ' + p.wlanuserip)
      if (p.clientmac) ipDesc.push('MAC ' + p.clientmac)
      if (p.vlan && p.vlan !== '0.0') ipDesc.push('VLAN ' + p.vlan.split('.').join('/'))
      this.deviceIp = ipDesc.join('  ')

      if (!serverBase) {
        var saved = this._lastServer || ''
        if (saved) {
          serverBase = saved
        } else {
          this.pageState = 'manual'
          this.serverShow = ''
          this.serverBase = ''
          this.showManualServer = true
          this.showForm = false
          this.setMsg('已拦截跳转，但未识别到认证服务器地址，请手动输入', 'warn')
          return
        }
      }

      this.serverBase = serverBase
      this.serverShow = serverBase.replace('http://', '')
      this._lastServer = serverBase
      loadPortalConf(serverBase, {
        ip: p.wlanuserip || '',
        vlan: p.vlan || '',
        mac: p.clientmac || '',
      }).then(function (res) {
        if (gen !== self._gen) return
        if (res.ok && res.code === 200) {
          // MAC 免认证已通过
          log('配置', 'code=200 已通过认证 server=' + serverBase)
          self.pageState = 'ok'
          self.showForm = false
          self.stopHeartbeat()
          self.setMsg('该设备已通过认证，无需登入', 'info')
          return
        }
        if (res.ok && res.code === 0 && res.data && res.data.policy) {
          var policy = res.data.policy
          self.authType = policy.auth1 || 'panabit'
          self.sceneStr = policy.scene_str || ''
          self._lastSyncAt = Date.now()
          log('配置', 'code=0 auth=' + self.authType + ' server=' + serverBase)
          if (self.authType !== 'panabit') {
            self.pageState = 'portal'
            self.showForm = false
            self.startHeartbeat()
            self.setMsg('该网络当前认证方式非账号密码，请在网页认证页操作', 'warn')
            return
          }
          self.pageState = 'portal'
          self.showForm = true
          self.canLogout = false
          self.startHeartbeat()
          if (self.username && self.password) {
            self.setMsg('需要认证，账号密码已就绪，点击登录', 'warn')
          } else {
            self.setMsg('需要认证，请输入账号密码', 'warn')
          }
          return
        }
        if (res.code === -1) {
          log('配置', 'server=' + serverBase + ' 无响应: ' + res.msg)
          // 服务器连不上/响应异常: 地址可能不对, 提供手动输入 (预填当前地址)
          self.pageState = 'manual'
          self.showForm = false
          self.showManualServer = true
          self.manualServer = self.serverShow
          self.setMsg('服务器无响应（' + res.msg + '），可手动输入正确地址', 'warn')
          return
        }
        self.pageState = 'portal'
        self.showForm = true
        log('配置', 'server=' + serverBase + ' code=' + res.code + ' msg=' + res.msg)
        self.setMsg(res.msg, 'error')
      })
    },

    /* ---- 手动服务器 ---- */
    /* 自动探测不到/连不上服务器时, 手动输入 IP[:端口] 或主机名 */
    applyManualServer() {
      var v = (this.manualServer || '').replace(/^\s+|\s+$/g, '')
      if (!v) {
        this.setMsg('请先输入服务器地址', 'warn')
        return
      }
      if (!/^[A-Za-z0-9.\-]+(:\d+)?$/.test(v)) {
        this.setMsg('地址格式应为 IP[:端口] 或主机名', 'error')
        return
      }
      var base = 'http://' + v
      var gen = (this._gen = (this._gen || 0) + 1)
      this.showManualServer = false
      log('手动服务器', base)
      this.saveServer(base)
      this.afterPortal(base, {}, gen)
    },
    saveServer(base) {
      var self = this
      loadAccount().then(function (acc) {
        acc.serverBase = base
        saveAccount(acc)
      })
    },
    toggleRemember() {
      this.remember = !this.remember
    },

    /* ---- 登录 ---- */
    async doLogin() {
      var self = this
      if (this.logging) return
      if (!this.serverBase) {
        this.setMsg('尚未获取认证服务器，请先检测', 'warn')
        return
      }
      if (!this.username || !this.password) {
        this.setMsg('请输入账号和密码', 'warn')
        return
      }
      this.logging = true
      var gen = (this._gen = (this._gen || 0) + 1)
      log('登录', 'user=' + this.username + ' server=' + this.serverBase + ' remember=' + this.remember)
      var loginOpts = function () {
        return {
          authType: self.authType,
          ip: self.paramOf('wlanuserip'),
          mac: self.paramOf('clientmac'),
          code: '',
          username: self.username,
          password: self.password,
          remember: self.remember,
        }
      }
      var syncSession = async function () {
        // 等价网页端"刷新页面": 重新 load_portal_conf 换取新认证会话
        var r = await loadPortalConf(self.serverBase, {
          ip: self.paramOf('wlanuserip'),
          vlan: self.paramOf('vlan'),
          mac: self.paramOf('clientmac'),
        })
        if (r && r.ok && r.code === 0 && r.data && r.data.policy) {
          self.authType = r.data.policy.auth1 || 'panabit'
          self.sceneStr = r.data.policy.scene_str || ''
        }
        self._lastSyncAt = Date.now()
        return r
      }

      // 1) 登录前刷新会话: 页面静止几分钟后服务器侧 token 过期会导致"无法登入需刷新",
      //    打字慢的场景(系统输入法)尤其容易踩中, 所以每次登录前都强制同步一次
      this.setMsg('正在刷新认证会话…', 'info')
      var sync = await syncSession()
      if (gen !== this._gen) return
      if (sync && sync.code === 200) {
        this.logging = false
        this.stopHeartbeat()
        this.pageState = 'ok'
        this.showForm = false
        this.setMsg('该设备已通过认证，无需登入', 'info')
        return
      }

      // 2) 登录
      this.setMsg('正在认证…', 'info')
      var res = await userLogin(this.serverBase, loginOpts())
      if (gen !== this._gen) return

      // 3) 会话过期类失败(code 非 2/3/255 的应用层错误): 自动刷新会话重试一次
      if (!res.ok && res.code >= 0 && res.code !== 2 && res.code !== 3 && res.code !== 255) {
        this.setMsg('认证会话可能已过期，自动刷新后重试…', 'warn')
        await syncSession()
        if (gen !== this._gen) return
        res = await userLogin(this.serverBase, loginOpts())
        if (gen !== this._gen) return
      }

      this.logging = false
      log('登录', '结果 code=' + res.code + ' msg=' + res.msg)
      if (!res.ok) {
        if (res.code === 3 && res.data && res.data.left) {
          this.setMsg('尝试过多，已锁定 ' + res.data.left + ' 秒', 'error')
        } else {
          this.setMsg(res.msg || '认证失败', 'error')
        }
        return
      }
      // 登录成功 → 保存凭据 → 复查连通性确认放行
      if (this.remember) {
        saveAccount({
          username: this.username,
          password: this.password,
          remember: true,
          serverBase: this.serverBase,
        })
      } else {
        loadAccount().then(function (acc) {
          acc.username = self.username
          acc.password = ''
          acc.remember = false
          saveAccount(acc)
        })
      }
      this.verifyOnline(gen)
    },

    paramOf(key) {
      return this._params && this._params[key] ? this._params[key] : ''
    },

    verifyOnline(gen) {
      var self = this
      checkPortal().then(function (det) {
        if (gen !== self._gen) return
        self.logging = false
        log('复查', det.status)
        if (det.status === 'free') {
          self.pageState = 'ok'
          self.showForm = false
          self.canLogout = true
          self.probeName = det.probe
          self.stopHeartbeat()
          self.setMsg('认证成功，已可上网', 'info')
        } else if (det.status === 'portal') {
          self.pageState = 'portal'
          self.showForm = true
          self.startHeartbeat()
          self.setMsg('登录请求已提交，但仍被拦截，可稍后重试', 'warn')
        } else {
          self.pageState = 'offline'
          self.stopHeartbeat()
          self.setMsg('登录请求已提交，网络仍不通', 'warn')
        }
      })
    },

    /* ---- 下线 ---- */
    doLogout() {
      var self = this
      if (!this.serverBase) return
      this.setMsg('正在下线…', 'info')
      logout(this.serverBase, { ip: this.paramOf('wlanuserip') }).then(function (res) {
        log('下线', 'code=' + res.code + ' msg=' + res.msg)
        self.runCheck()
      })
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
.headbtn {
  width: 130px;
  height: 32px;
  border-radius: 16px;
  background-color: #2c5aa0;
  align-items: center;
  justify-content: center;
}
.headbtn-text {
  font-size: 18px;
  color: #ffffff;
}
.statusarea {
  width: 960px;
  height: 96px;
  padding-left: 20px;
  padding-top: 8px;
  flex-direction: column;
}
.status {
  font-size: 34px;
  font-weight: bold;
  height: 42px;
}
.status-free {
  color: #37c2a0;
}
.status-ok {
  color: #37c2a0;
}
.status-portal {
  color: #ffb648;
}
.status-offline {
  color: #ff6b6b;
}
.status-busy {
  color: #8fb7e8;
}
.inforow {
  height: 18px;
  flex-direction: row;
  margin-top: 2px;
}
.infolabel {
  width: 150px;
  font-size: 14px;
  color: #6f8cb0;
}
.infovalue {
  width: 770px;
  font-size: 14px;
  color: #b8cde8;
  lines: 1;
  text-overflow: ellipsis;
}
.formrow {
  width: 960px;
  height: 60px;
  background-color: #16324f;
  flex-direction: row;
  align-items: center;
  padding-left: 16px;
  padding-right: 16px;
}
.field {
  width: 270px;
  height: 42px;
  background-color: #0d1b30;
  border-radius: 8px;
  flex-direction: row;
  align-items: center;
  padding-left: 12px;
  margin-right: 12px;
}
.field-wide {
  width: 560px;
}
.fieldlabel {
  width: 52px;
  font-size: 18px;
  color: #6f8cb0;
}
.fieldvalue {
  width: 190px;
  font-size: 18px;
  color: #e8f1fb;
  lines: 1;
  text-overflow: ellipsis;
}
.fieldvalue-wide {
  width: 480px;
  font-size: 18px;
  color: #e8f1fb;
  lines: 1;
  text-overflow: ellipsis;
}
.fieldplaceholder {
  color: #4a6076;
}
.remember {
  width: 120px;
  height: 42px;
  flex-direction: row;
  align-items: center;
  margin-right: 10px;
}
.remembertext {
  font-size: 18px;
  color: #b8cde8;
}
.remembertext-on {
  color: #37c2a0;
}
.btn {
  height: 42px;
  border-radius: 8px;
  align-items: center;
  justify-content: center;
  margin-right: 10px;
}
.btn-login {
  width: 120px;
  background-color: #2f7bd9;
}
.btn-busy {
  width: 120px;
  background-color: #274d7c;
}
.btn-logout {
  width: 100px;
  background-color: #0d1b30;
}
.btn-text {
  font-size: 20px;
  color: #ffffff;
  font-weight: bold;
}
.btn-text-logout {
  color: #ff8f8f;
  font-weight: normal;
}
.msgrow {
  width: 960px;
  height: 56px;
  padding-left: 20px;
  padding-top: 10px;
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
</style>
