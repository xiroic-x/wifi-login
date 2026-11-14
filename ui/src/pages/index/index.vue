<template>
  <div class="page">
    <!-- 顶栏 -->
    <div class="bar">
      <div class="brand">
        <div class="logo"><text class="logotext">Wi</text></div>
        <text class="brandname">WiFi 网络认证</text>
      </div>
      <div class="baractions">
        <div class="btn ghost" @click="openDiag"><text class="btntext">检测</text></div>
        <div class="btn ghost" @click="openFeedback"><text class="btntext">反馈</text></div>
        <div class="btn ghost" @click="openAbout"><text class="btntext">关于</text></div>
        <div class="btn primary" @click="runCheck(null, true)">
          <text class="btntext">{{ checking ? '检测中…' : '重新检测' }}</text>
        </div>
      </div>
    </div>

    <!-- 状态卡: 结论 + 依据 -->
    <div class="status" :class="stateClass">
      <div class="statusleft">
        <div class="dot" :class="stateClass"></div>
        <text class="statetext">{{ stateText }}</text>
      </div>
      <div class="statusright">
        <text class="metaline" v-if="probeName">连通性 {{ probeName }}</text>
        <text class="metaline" v-if="serverShow">服务器 {{ serverShow }}</text>
        <text class="metaline warnline" v-if="compatWarn">兼容性 {{ compatWarn }}</text>
        <text class="metaline" v-if="portalPage">跳转 {{ portalPage }}</text>
        <text class="metaline" v-if="deviceIp">本机 {{ deviceIp }}</text>
      </div>
    </div>

    <!-- 登录表单 -->
    <div class="panel" v-if="showForm || canLogout">
      <div class="fields" v-if="showForm">
        <div class="field" @click="editUsername">
          <text class="fieldlabel">账号</text>
          <text class="fieldvalue" v-if="username">{{ username }}</text>
          <text class="fieldvalue placeholder" v-if="!username">点此输入账号</text>
        </div>
        <div class="field" @click="editPassword">
          <text class="fieldlabel">密码</text>
          <!-- 已记住的密码只显示掩码; 新输入的短暂可见 -->
          <text class="fieldvalue" v-if="pwdMask && !pwdRevealed">{{ pwdMask }}</text>
          <text class="fieldvalue" v-if="password && pwdRevealed">{{ password }}</text>
          <text class="fieldvalue placeholder" v-if="!password">点此输入密码</text>
        </div>
        <div class="switch" @click="toggleRemember">
          <div class="switchbox" :class="{ on: remember }"></div>
          <text class="switchtext">{{ remember ? '记住密码' : '不记住密码' }}</text>
        </div>
      </div>
      <div class="actions">
        <div class="btn primary" v-if="showForm && !logging" @click="doLogin">
          <text class="btntext">登 录</text>
        </div>
        <div class="btn ghost" v-if="showForm && logging">
          <text class="btntext">登录中…</text>
        </div>
        <div class="btn ghost" v-if="canLogout && canManage" @click="openManagement">
          <text class="btntext">设备管理</text>
        </div>
        <div class="btn danger" v-if="canLogout" @click="doLogout">
          <text class="btntext">下 线</text>
        </div>
      </div>
    </div>

    <!-- 认证类型手选 -->
    <div class="panel" v-if="showAdapterPick">
      <text class="panellabel">认证类型</text>
      <div class="chips">
        <div class="chip" v-for="a in adapters" :key="a.id" @click="pickAdapter(a)">
          <text class="chiptext" :class="{ on: activeAdapterId === a.id }">{{ a.name }}</text>
        </div>
      </div>
    </div>

    <!-- 手动服务器 -->
    <div class="panel" v-if="showManualServer">
      <div class="field wide" @click="editServer">
        <text class="fieldlabel">服务器</text>
        <text class="fieldvalue" v-if="manualServer">{{ manualServer }}</text>
        <text class="fieldvalue placeholder" v-if="!manualServer">点此输入认证服务器 IP[:端口]</text>
      </div>
      <div class="actions">
        <div class="btn primary" @click="applyManualServer"><text class="btntext">确 定</text></div>
      </div>
    </div>

    <!-- 底部状态条 -->
    <div class="foot">
      <div class="dot sm" :class="msgClass"></div>
      <text class="foottext" :class="msgClass">{{ msg || '就绪' }}</text>
    </div>
  </div>
</template>

<script>
import { checkPortal } from '../../services/detect.js'
import { all as allAdapters, byId, detectAdapter } from '../../services/portal-adapters/registry.js'
import { loadAccount, saveAccount } from '../../services/store.js'
import { getCompat, compatLine } from '../../services/compat.js'
import { wifiSsid, writeStatusFile } from '../../services/net.js'
import { confirmServerUsable } from '../../services/server-probe.js'
import { log, initLog } from '../../services/logger.js'
import { SystemIme } from '../../services/ime.js'

/* 管理页判定"服务器不可用"后, 这段时间内不再自动进入 (用户手动重检可立即解除) */
const MANAGE_COOLDOWN_MS = 180000

/* 检测节流窗口(ms): 期间页面的自动触发不再重启检测, 顶栏按钮不受限 */
var CHECK_THROTTLE_MS = 30000
/* 探测只需响应头部字节: 限制响应体, 避免大页面在 JS 侧整篇解码拖住主线程 */
var PROBE_MAX_BYTES = 4096
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
      /* 模块化适配框架: 本体不依赖具体协议, 认证流程走 activeAdapter */
      adapters: allAdapters(), // 已注册的认证适配器 (认证类型选择列表)
      activeAdapterId: '',
      showAdapterPick: false, // 未识别出认证类型时让用户手选
      username: '',
      password: '',
      /* 已记住的密码来源SSID: 用于掩码显示与"按网络隔离"提示 */
      ssid: '',
      /* 本次新输入的密码短暂明文显示, 记住的密码始终只显示掩码 */
      pwdRevealed: false,
      remember: true,
      logging: false,
      checking: false,
      /* 兼容性提示(启动检测结果, 降级/不兼容时显示) */
      compatWarn: '',
      /* 自动检测节流窗口(ms): 期间的 onShow 不再触发新检测 */
      _lastCheckAt: 0,
      canLogout: false,
      showForm: false,
      showManualServer: false,
      manualServer: '',
      msg: '',
      msgType: 'info',
    }
  },
  computed: {
    /* 状态文案与配色: 与 pageState 一一对应 */
    stateText() {
      var m = {
        free: '无需登入', ok: '认证成功，无需登入', portal: '需要认证',
        offline: '无网络连接', busy: '正在检测…', manual: '需要认证（未识别服务器）',
      }
      return m[this.pageState] || '正在检测…'
    },
    stateClass() { return this.pageState || 'busy' },
    msgClass() { return this.msgType === 'error' ? 'error' : (this.msgType === 'warn' ? 'warn' : 'info') },
    /* 当前使用的认证适配器 (由 activeAdapterId 解析; 未选择时为 null) */
    activeAdapter() {
      return byId(this.activeAdapterId)
    },
    /* 设备管理入口: 适配器提供 listDevices 能力才显示 */
    canManage() {
      var a = byId(this.activeAdapterId)
      return !!(a && a.listDevices)
    },
    /* 已记住密码的掩码: 不泄露真实长度与内容, 固定 8 位圆点 */
    pwdMask() {
      return this.password ? '\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf\u25cf' : ''
    },
  },
  methods: {
    onShow() {
      /* 兼容性: 启动检测已在 app.js 跑过, 这里只取结果; 未出结果就不显示 */
      var c0 = getCompat()
      this.compatWarn = c0 && c0.level !== 'ok' ? compatLine(c0) : ''
      if (this._started) {
        // 系统输入法面板弹出/收起会让本页 onHide/onShow 一轮;
        // 输入会话中及刚关闭的短暂窗口内不做自动刷新, 否则会把登录表单冲掉
        if (this.logging) return
        if (this._imeBusy) return
        if (this._imeClosedAt && Date.now() - this._imeClosedAt < 3000) return
        /* keepAlive 适配器 (如 H3C iMC) 已认证时, 从日志/关于等页面返回不重新检测 ——
         * 检测会判 free 并清掉服务器/停心跳, 导致服务器侧会话过期被踢;
         * 这里直接恢复心跳, 会话是否还有效交给心跳本身判定。 */
        if (this._keepAlive() && this.pageState === 'ok' && this.serverBase) {
          this._leftAt = 0
          this._enteredManageAt = 0
          this._lastSyncAt = Date.now()
          this.startHeartbeat()
          return
        }
        // 从设备管理页返回 (由管理页 trigger('wifiManageClosed') 打标):
        // 立即重新检测本机是否已下线, 不受 90 秒节流限制。
        // _leftAt 只在管理页真正关闭时才被设置, 管理页在前台时不会被误触。
        if (this._leftAt) {
          this._leftAt = 0
          this._enteredManageAt = 0
          this.runCheck(null, false, '返回管理页')
          return
        }
        // 从后台回来: 认证会话可能已过期, 停留超过 90 秒未同步则自动重新检测
        var stale = !this._lastSyncAt || Date.now() - this._lastSyncAt > 90000
        if ((this.pageState === 'portal' || this.pageState === 'manual') && stale) {
          this.runCheck(null, false, '后台回来')
        }
        return
      }
      this._started = true
      this.ime = new SystemIme()
      initLog()
      log('应用', '页面启动')
      // 管理页确认服务器可用时, 重置自动进入次数限制
      var self0 = this
      try {
        this._manageUsableToken = $falcon.on('wifiManageUsable', function () {
          self0._manageUsable()
        })
        this._manageClosedToken = $falcon.on('wifiManageClosed', function (info) {
          self0._manageClosed(info)
        })
      } catch (e) {}
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
        this.activeAdapterId = (byId('panabit') || this.adapters[0]).id
        this._adapterState = { authType: 'panabit' }
        this.showForm = true
        this.startHeartbeat()
        this.setMsg('[调试] 已指向模拟认证服务器', 'warn')
        return
      }
      // 外部小程序调用接口 (见 applyLaunch)
      if (self.applyLaunch(self.readLaunchOptions())) return
      /* 先取当前 WiFi 名称, 再按名称读对应账号 (不同门店/网络各存各的密码) */
      wifiSsid().then(function (ssid) {
        self._ssid = ssid || ''
        self._ssidResolved = true
        return loadAccount(self._ssid)
      }).then(function (acc) {
        self.username = acc.username
        self.password = acc.password
        self.remember = acc.remember
        self.ssid = self._ssid || acc.ssid || ''
        self._lastServer = acc.serverBase || ''
        /* 服务器是否属于当前 WiFi: 换网络时不能用上一个网络的门户服务器 (见 store.loadAccount) */
        self._serverTrusted = acc.trusted === true
        self._rememberedAdapter = acc.adapter || '' // 该 WiFi 上次成功登录用的适配器
        log('配置', 'wifi=' + (self._ssid || '(未知)') + ' 已存账号=' + (acc.username || '无'))
        self.runCheck()
      })
    },

    /* ---- 外部小程序调用接口 ----
     * 其他小程序通过 $falcon.navTo('falcon://8001865309000001/index', {参数}) 调用,
     * 参数 (KV 字符串) 也支持页面已被拉起时通过 newOptions 传入:
     *   action  : 'login' 直接进入登录流程 / 'log' 打开日志页 / 缺省正常检测
     *   server  : 'IP[:端口]' 或 'http://IP[:端口]' (提供则跳过自动探测)
     *   username/password : 预填凭据 (密码明文传输, 仅限调用方可信时)
     *   remember: '1' 记住密码
     *   auto    : '1' 且 server/username/password 齐全时自动提交登录
     */
    readLaunchOptions() {
      try {
        var lo = this.$page && this.$page.loadOptions
        var no = this.$page && this.$page.newOptions
        var o = no && this.hasKeys(no) ? no : lo
        if (!o) return null
        if (typeof o === 'string') {
          try {
            o = JSON.parse(o)
          } catch (e) {
            return null
          }
        }
        if (!o || typeof o !== 'object' || !this.hasKeys(o)) return null
        return o
      } catch (e) {
        return null
      }
    },
    hasKeys(o) {
      for (var k in o) return true
      return false
    },
    safeJson(o) {
      try {
        return JSON.stringify(o)
      } catch (e) {
        return String(o)
      }
    },
    normalizeServer(v) {
      var s = String(v || '').replace(/^\s+|\s+$/g, '')
      if (!s) return ''
      if (/^https:\/\//i.test(s)) return ''
      s = s.replace(/^http:\/\//i, '').replace(/\/+$/, '')
      if (!/^[A-Za-z0-9.\-]+(:\d+)?$/.test(s)) return ''
      return 'http://' + s
    },
    /* 返回 true 表示已按调用参数执行, 跳过默认探测流程 */
    applyLaunch(o) {
      if (!o) return false
      var action = String(o.action || '').toLowerCase()
      /* 外部拉起: 整个生命周期内不自动跳转管理页, 避免打断调用方流程 */
      this._launched = true
      if (action === 'log') {
        log('接口', '外部调用: 打开日志页')
        $falcon.navTo('diag', {})
        return true
      }
      if (action === 'check') {
        // 检测网络是否需要登入, 结果通过 $falcon.trigger 回传给调用方
        var cb = String(o.callback || 'wifiCheckResult')
        log('接口', '外部调用: 检测网络, 回调事件=' + cb)
        this._checkCallback = cb
        this.runCheck(null, false, '外部调用 check')
        return true
      }
      var server = this.normalizeServer(o.server)
      if (action === 'login' || server) {
        if (!server) {
          log('接口', '外部调用缺少有效 server: ' + String(o.server || ''))
          this.runCheck()
          return true
        }
        log('接口', '外部调用: 登录流程 server=' + server + ' auto=' + String(o.auto || ''))
        this._lastServer = server
        this._serverTrusted = true // 调用方显式指定的服务器
        this._lastSyncAt = Date.now()
        this.serverBase = server
        this.serverShow = server.replace('http://', '')
        if (o.username) this.username = String(o.username)
        if (o.password) this.password = String(o.password)
        if (o.remember === '1' || o.remember === 1 || o.remember === true) this.remember = true
        this.pageState = 'portal'
        /* 外部可指定适配器 (adapter=<id>); 未指定时用该 WiFi 记住的, 再退到第一个注册的 */
        var forced = o.adapter ? byId(String(o.adapter)) : null
        if (forced) {
          this.activeAdapterId = forced.id
        } else if (!this.activeAdapterId) {
          var remembered = this._rememberedAdapter ? byId(this._rememberedAdapter) : null
          this.activeAdapterId = (remembered || this.adapters[0]).id
        }
        this._adapterState = this._adapterState || {}
        this.showForm = true
        this.showManualServer = false
        this.startHeartbeat()
        var auto = o.auto === '1' || o.auto === 1 || o.auto === true
        if (auto && this.username && this.password) {
          this.setMsg('外部调用自动登录中…', 'info')
          this.doLogin()
        } else {
          this.setMsg('外部调用：请确认账号密码后点击登录', 'warn')
        }
        return true
      }
      return false
    },
    onNewOptions(options) {
      // 页面已在运行时被外部重新拉起
      var self = this
      if (!this._started) return
      var o = options
      if (o && typeof o === 'string') {
        try {
          o = JSON.parse(o)
        } catch (e) {
          o = null
        }
      }
      if (!o || typeof o !== 'object' || !this.hasKeys(o)) return
      log('接口', '外部重新拉起: ' + safeJson(o))
      if (this.applyLaunch(o)) return
      this.runCheck()
    },
    onHide() {
      // 输入会话中 (输入法面板导致的 onHide): 保留会话与心跳, 不当成本页离开
      if (this._imeBusy) return
      this._leftAt = Date.now()
      this.stopHeartbeat()
      if (this.ime) this.ime.cancel()
    },
    onUnload() {
      this._gen = (this._gen || 0) + 1
      this._destroyed = true
      if (this._detectSignal) this._detectSignal.aborted = true
      if (this._autoManageTimer) clearTimeout(this._autoManageTimer)
      try {
        if (this._manageUsableToken) $falcon.off('wifiManageUsable', this._manageUsableToken)
        if (this._manageClosedToken) $falcon.off('wifiManageClosed', this._manageClosedToken)
      } catch (e) {}
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

    openDiag() {
      $falcon.navTo('diag', {})
    },
    openFeedback() {
      $falcon.navTo('feedback', {})
    },
    openAbout() {
      $falcon.navTo('about', {})
    },

    /* 进入设备管理页: 带上服务器/本机 IP/适配器 ID, 管理页直接复用, 不再重复探测 */
    openManagement() {
      /* 本机 IP 优先取本次检测的 portal 参数 (wlanuserip), 其次取上次记住的 */
      var ip = this.paramOf('wlanuserip') || this._selfIp || this._lastIp || ''
      log('管理页', '打开: server=' + this.serverBase + ' ip=' + ip + ' adapter=' + this.activeAdapterId)
      $falcon.navTo('management', {
        serverBase: this.serverBase,
        ip: ip,
        adapter: this.activeAdapterId,
      })
      // 切走期间停止心跳, 返回时按需重启
      this.stopHeartbeat()
      /* 注意: 这里不设 _leftAt。管理页在前台时本页 onShow 也可能被系统调用,
       * 若提前打上离开标记, 管理页还开着就会被误判为"已返回"而触发重检,
       * 形成 主页->管理页 空转。真正返回时由管理页 trigger('wifiManageClosed') 设置。 */
      this._enteredManageAt = Date.now()
    },

    /*
     * 已认证时自动进入设备管理页。
     * 外部调用 (action=check/login) 场景不自动跳转, 否则会打断调用方的流程/页面。
     * 返回 true 表示已触发跳转。
     */
    _autoManage() {
      if (this._checkCallback) return false // 外部检测接口: 只回调, 不跳页
      if (this._launched) return false // 外部拉起场景: 尊重调用方
      if (this._manual) return false // 用户主动点了重新检测/下线: 保持本页反馈
      if (this._destroyed) return false
      /* 适配器没有设备管理能力 (如 H3C iMC) 时不能跳管理页:
       * 管理页会提示"不支持设备管理"并返回 failed, 主页误报"认证服务器不可达",
       * 且跳转时已 stopHeartbeat, 回来 keepAlive 心跳就断了。 */
      if (!this.canManage) return false
      // 管理页没能用起来 (服务器连不上) 时不要反复来回跳, 最多自动进 2 次
      if ((this._manageTries || 0) >= 2) return false
      /* 冷却窗口: 管理页最近一次是"服务器不可达"退出时, 一段时间内不再自动进入。
       * 用时间窗而非仅计数, 是因为系统可能在管理页开启后很快回收它
       * (实测 3 秒即 onUnload), 那种情况下主页拿不到 failed 标记, 单靠计数会漏。 */
      if (this._manageCooldownUntil && Date.now() < this._manageCooldownUntil) return false
      if (this._autoManagedAt && Date.now() - this._autoManagedAt < 8000) return false // 防抖
      this._autoManagedAt = Date.now()
      this._manageTries = (this._manageTries || 0) + 1
      var self = this
      // 稍作停留让用户看到状态, 再跳转
      this._autoManageTimer = setTimeout(function () {
        if (self._destroyed) return
        if (!self.serverBase) return
        self.openManagement()
      }, 800)
      return true
    },

    /* 管理页成功拉到设备列表后回调, 重置自动进入计数与冷却 */
    _manageUsable() {
      this._manageTries = 0
      this._manageCooldownUntil = 0
    },

    /*
     * 管理页已关闭 (用户点返回 / 全部下线后自动退 / 加载失败兜底退出)。
     * 此时才认为真的"离开过又回来了", 打上 _leftAt 以便 onShow 立即重检。
     * 注意: $falcon 事件回调未必原样传字符串 (实测会拿到对象包装), 两种形态都兼容。
     */
    _manageClosed(info) {
      var failed = false
      if (info === 'failed' || info === undefined) {
        failed = info === 'failed'
      } else if (info && typeof info === 'object') {
        /* 事件系统可能把参数包成 {0:'failed'} / {detail:'failed'} / {data:...} */
        var v = info[0] !== undefined ? info[0] : info.detail !== undefined ? info.detail : info.data
        if (v && typeof v === 'object') v = v[0] !== undefined ? v[0] : v.value
        failed = v === 'failed'
        /* 兜底: 对象里任何字段序列化后含 failed 即视为失败退出 */
        if (!failed) {
          try {
            failed = JSON.stringify(info).indexOf('failed') >= 0
          } catch (e) {}
        }
      } else {
        failed = String(info).indexOf('failed') >= 0
      }
      log('管理页', '已关闭 failed=' + failed)
      /* 管理页明确报告服务器不可用: 抑制后续自动进入, 且不做无意义的重检
       * (此时检测结果必然还是 free, 重检只会再触发一次跳转)。
       * 同时设冷却窗: 服务器没那么快恢复, 短期内不再打扰用户。 */
      if (failed) {
        this._manageTries = 2
        this._autoManagedAt = Date.now()
        this._manageCooldownUntil = Date.now() + MANAGE_COOLDOWN_MS
        this._leftAt = 0
        this.setMsg('认证服务器不可达，已退出设备管理', 'warn')
        return
      }
      this._leftAt = Date.now()
    },

    /* 检测结果机器可读输出: <appid>/data/status.json (规范 R5), 供其他程序读取 */
    writeStatus(det) {
      try {
        var d = new Date()
        var p2 = function (n) {
          return (n < 10 ? '0' : '') + n
        }
        det.time =
          p2(d.getMonth() + 1) +
          '-' +
          p2(d.getDate()) +
          ' ' +
          p2(d.getHours()) +
          ':' +
          p2(d.getMinutes()) +
          ':' +
          p2(d.getSeconds())
        /* 写盘能力平台相关 (RK 写 status.json; CVI 无文件模块为 no-op), 由平台层提供 */
        writeStatusFile(JSON.stringify(det)).catch(function (e) {
          log('状态', 'status.json 写入失败: ' + e)
        })
      } catch (e) {
        log('状态', 'writeStatus 同步异常: ' + e)
      }
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
        /* 用户刚录入的密码明文显示 3 秒便于核对, 之后回到掩码 */
        self.pwdRevealed = true
        if (self._revealTimer) clearTimeout(self._revealTimer)
        self._revealTimer = setTimeout(function () {
          self.pwdRevealed = false
        }, 3000)
      })
    },

    /*
     * 会话保活心跳: 网页认证页每 5 秒轮询认证状态维持服务器侧
     * 会话 (页面静止几分钟后 token 过期导致"无法登入需刷新")。
     * app 用 30 秒间隔达到同样效果, 同时探测设备是否已在别处完成认证。
     * 状态查询走 activeAdapter.queryStat; 适配器不支持时心跳静默。
     */
    startHeartbeat() {
      var self = this
      if (this._statTimer) return
      this._statTimer = setInterval(function () {
        var adapter = self.activeAdapter
        var gen = self._gen || 0
        if (!adapter || !adapter.queryStat || !self.serverBase) return
        adapter
          .queryStat(self.serverBase, {
            params: self._params,
            state: self._adapterState,
          })
          .then(function (res) {
            if (gen !== (self._gen || 0)) return
            if (res && res.ok && res.stat) {
              self.stopHeartbeat()
              self._lastSyncAt = Date.now()
              log('心跳', 'stat=' + res.stat + ' 已在别处认证')
              self.pageState = 'ok'
              self.showForm = false
              self.canLogout = true
              self.setMsg('该设备已通过认证，无需登入，可点「设备管理」查看在线设备', 'info')
            } else if (res && res.ok) {
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

    /*
     * 当前 WiFi 名称: 页面启动链取过就用缓存; 外部调用(navTo action=login)会跳过那条链,
     * 必须在保存账号前补取一次 —— SSID 未知时不能借用别的网络槽位, 否则会串网。
     */
    async resolveSsid() {
      if (this._ssidResolved) return this._ssid || ''
      this._ssidResolved = true
      try {
        this._ssid = (await wifiSsid()) || ''
      } catch (e) {
        this._ssid = ''
      }
      return this._ssid
    },

    /* ---- 连通性测试 ---- */
    /* onDone: 可选, 检测完成后回调 (外部 check 接口用)
     * manual: true 表示用户主动触发 (点按钮), 检测出已认证时不自动跳管理页,
     *         只在当前页给出"设备管理"按钮, 避免界面自己跳走 */
    runCheck(onDone, manual, reason) {
      if (typeof onDone !== 'function') onDone = null
      /* 只有用户主动点按钮的重检才保留 _manual; 自动/外部触发的重检清掉该标记,
         使"从后台返回发现已认证"仍能自动进入管理页 */
      if (manual) {
        this._manual = true
        /* 用户主动重检 = 明确表达"再看看": 解除上一次"服务器不可达"的抑制与冷却,
         * 让服务器恢复后能重新自动进管理页 (本次因 _manual 不会立即跳转)。 */
        this._manageTries = 0
        this._autoManagedAt = 0
        this._manageCooldownUntil = 0
      } else if (!this._leftAt) {
        this._manual = false
      }
      /*
       * 防重入 + 节流: 框架会在输入法开关、前后台切换、导航返回等场景反复触发本页
       * onShow, 若每次都重启检测, 上一次刚跑一半就被作废(bump _gen), 页面会永远停在
       * 「正在检测…」且整机被接连不断的网络探测拖住 —— 用户感受就是"卡死, 只能等"。
       * 自动触发一律不打断在跑的检测, 且 10 秒内不重复; 只有顶栏按钮(manual=true)强制作废重跑。
       */
      if (!manual) {
        if (this.checking) {
          if (!this._skipLogged) { this._skipLogged = true; log('检测', '已在检测中, 忽略本次自动触发 by=' + (reason || '-')) }
          return
        }
        if (this._lastCheckAt && Date.now() - this._lastCheckAt < CHECK_THROTTLE_MS) {
          if (!this._skipLogged) { this._skipLogged = true; log('检测', '节流中(30s内), 忽略本次自动触发 by=' + (reason || '-')) }
          return
        }
      }
      this._skipLogged = false
      this._lastCheckAt = Date.now()
      var self = this
      var gen = (this._gen = (this._gen || 0) + 1)
      this.stopHeartbeat()
      /* 取消上一次仍可能返回的探测, 避免迟到结果覆盖本次状态 */
      if (this._detectSignal) this._detectSignal.aborted = true
      var signal = (this._detectSignal = { aborted: false })
      this.checking = true
      this.pageState = 'busy'
      this.setMsg('正在进行 WiFi 连通性测试…', 'info')
      this.canLogout = false
      this.showForm = false
      this.showManualServer = false

      /* 先让出一帧: 让「正在检测…」真正上屏、框架也能处理点击, 再开始网络探测 */
      new Promise(function (r) { setTimeout(r, 0) })
        .then(function () {
          return checkPortal({ signal: signal, maxBytes: PROBE_MAX_BYTES })
        })
        .then(function (det) {
        if (gen !== self._gen) return
        if (det.status === 'aborted') return
        self.checking = false
        self.probeName = det.status === 'offline' ? '全部探测源无响应' : det.probe + (det.confirm ? ' + 复核:' + det.confirm : '')
        log('检测', 'status=' + det.status + ' probe=' + det.probe + (det.confirm ? ' confirm=' + det.confirm : '') + (det.freeCount ? ' freeCount=' + det.freeCount : '') + (det.portalPage ? ' page=' + det.portalPage : '') + (det.error ? ' err=' + det.error : '') + (reason ? ' by=' + reason : ''))
        self.writeStatus(det)
        if (self._checkCallback) {
          // 外部检测接口: 回传结果 JSON 给调用方 ($falcon.on(回调名) 接收)
          var result = {
            status: det.status,
            needLogin: det.status === 'portal',
            probe: det.probe,
            serverIp: det.serverIp,
            serverPort: det.serverPort,
            serverBase: det.serverBase,
            portalPage: det.portalPage,
            pageTitle: det.pageTitle,
            error: det.error,
          }
          try {
            $falcon.trigger(self._checkCallback, JSON.stringify(result))
            log('接口', '检测结果已回调 ' + self._checkCallback + ' ' + JSON.stringify(result))
          } catch (e) {
            log('接口', '回调失败: ' + e)
          }
          self._checkCallback = null
        }
        if (det.status === 'free') {
          self.pageState = 'free'
          self.portalPage = ''
          self.setMsg('网络直连正常，无需登入', 'info')
          var clearServer = function () {
            self.serverBase = ''
            self.serverShow = ''
            self.canLogout = false
            self._lastServer = ''
          }
          /* 只有本 WiFi 自己记住的认证服务器才进设备管理; 换网络时不能复用上一个网络的服务器 */
          if (!(self._lastServer && self._serverTrusted)) {
            clearServer()
            return
          }
          /* 光"属于本 SSID"还不够: 同名 SSID 也可能是另一个网络(实测家庭网络与校园同名),
           * 必须确认该服务器在当前网络真的可用, 否则不显示设备管理/下线, 更不自动跳进去 */
          var savedServer = self._lastServer
          var probeAdapter =
            (self._rememberedAdapter && byId(self._rememberedAdapter)) || self.activeAdapter || self.adapters[0]
          confirmServerUsable(probeAdapter, savedServer, self._adapterState)
            .then(function (usable) {
              if (gen !== self._gen) return
              if (!usable) {
                log('检测', '保存的认证服务器在当前网络不可用, 不进设备管理 server=' + savedServer)
                clearServer()
                return
              }
              self.serverBase = savedServer
              self.serverShow = savedServer.replace('http://', '')
              self.canLogout = true
              /* 免认证/已认证状态进管理页同样需要适配器:
               * 用该 WiFi 记住的 (缺省回退第一个注册的), 否则管理页会因无适配器而拒绝 */
              if (!self.activeAdapterId) {
                var remembered = self._rememberedAdapter ? byId(self._rememberedAdapter) : null
                self.activeAdapterId = (remembered || self.adapters[0]).id
              }
              self._autoManage()
            })
            .catch(function (e) {
              log('检测', '服务器可用性探测异常: ' + (e && e.message ? e.message : e))
              clearServer()
            })
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
        /* 注意: 这里在 then 回调内, 必须用 self (this 不是 Vue 实例, 会抛错被静默吞掉) */
        self.afterPortal(det.serverBase, det.params, det, gen)
      })
    },

    /* 是否需要在"已认证"状态继续跑 queryStat 心跳:
     * 部分 Portal (如 H3C iMC 网页认证) 要求客户端持续心跳, 否则服务器侧会话过期被踢下线。 */
    _keepAlive() {
      var a = this.activeAdapter
      return !!(a && a.keepAlive && typeof a.queryStat === 'function')
    },

    /*
     * 自动识别认证适配器:
     *   1) 识别特征评分最高者优先 (registry.detectAdapter)
     *   2) 识别不出 (全部 0 分) 用该 WiFi 记住的适配器 (上次成功登录所用)
     *   3) 再不行返回 null, 框架显示"认证类型"选择行让用户手选
     */
    _pickAdapter(det) {
      var ctx = {
        portalPage: det && det.portalPage,
        pageTitle: det && det.pageTitle,
        snippet: det && det.snippet,
        params: det && det.params,
        serverBase: this.serverBase || (det && det.serverBase),
        headers: det && det.headers,
      }
      var best = detectAdapter(ctx)
      if (best && best.score > 0) {
        log('适配器', '自动识别 ' + best.adapter.id + ' score=' + best.score)
        return best.adapter
      }
      var remembered = this._rememberedAdapter ? byId(this._rememberedAdapter) : null
      if (remembered) {
        log('适配器', '识别不出, 用记住的 ' + remembered.id)
        return remembered
      }
      return null
    },

    /*
     * 被强制门户拦截后的入口: 提取参数 -> 识别适配器 -> 走该适配器的 loadConf。
     * loadConf 返回归一化状态 (free/ready/manual/other/error), 框架据此更新 UI;
     * 协议相关语义全部收口在适配器内。
     */
    async afterPortal(serverBase, params, det, gen) {
      try {
        await this._afterPortal(serverBase, params, det, gen)
      } catch (e) {
        /* async 方法内异常若无捕获会静默丢失, 界面会卡在"正在检测…", 这里兜底上报 */
        log('适配器', 'afterPortal 异常: ' + (e && e.message ? e.message : e))
        this.pageState = 'manual'
        this.showManualServer = true
        this.showAdapterPick = true
        this.setMsg('处理认证页时出错，请手动选择认证类型或输入服务器地址', 'error')
      }
    },

    async _afterPortal(serverBase, params, det, gen) {
      var p = params || {}
      this._params = p
      /* 本机 IP 的入口参数各协议不同: Panabit 走 wlanuserip, H3C iMC 门户页走 userip */
      this._selfIp = p.wlanuserip || p.userip || p.clientip || ''
      if (this._selfIp) this._lastIp = this._selfIp
      var ipDesc = []
      if (p.wlanuserip || p.userip) ipDesc.push('IP ' + (p.wlanuserip || p.userip))
      if (p.clientmac) ipDesc.push('MAC ' + p.clientmac)
      if (p.vlan && p.vlan !== '0.0') ipDesc.push('VLAN ' + p.vlan.split('.').join('/'))
      this.deviceIp = ipDesc.join('  ')

      if (!serverBase) {
        /* 被拦截却没拿到服务器地址: 只有本网络自己的服务器才拿来兜底 */
        var saved = this._serverTrusted ? this._lastServer || '' : ''
        if (saved) {
          serverBase = saved
        } else {
          this.pageState = 'manual'
          this.serverShow = ''
          this.serverBase = ''
          this.showManualServer = true
          this.showAdapterPick = true
          this.showForm = false
          this.setMsg('已拦截跳转，但未识别到认证服务器地址，请选择认证类型或手动输入', 'warn')
          return
        }
      }

      log('适配器', '开始识别 serverBase=' + serverBase)
      var adapter = this._pickAdapter(det)
      if (!adapter) {
        this.pageState = 'manual'
        this.showForm = false
        this.showManualServer = true
        this.showAdapterPick = true
        this.setMsg('未识别出认证类型，请点选下方认证类型', 'warn')
        return
      }
      await this.startPortalConf(adapter, serverBase, p, gen)
    },

    /* 用指定适配器获取配置并按归一化状态更新界面 */
    async startPortalConf(adapter, serverBase, p, gen) {
      this.activeAdapterId = adapter.id
      this._adapterState = {}
      this.serverBase = serverBase
      this.serverShow = serverBase.replace('http://', '')
      this._lastServer = serverBase
      this._serverTrusted = true // 服务器来自本网络实时检测或调用方指定
      this.showAdapterPick = false
      this.setMsg('正在获取 ' + adapter.name + ' 配置…', 'info')
      var res = await adapter.loadConf(serverBase, p, this._adapterState)
      if (gen !== this._gen) return
      if (res.status === 'free') {
        // MAC 免认证已通过
        log('配置', '已通过认证 server=' + serverBase)
        this.pageState = 'ok'
        this.showForm = false
        this.canLogout = true
        this.stopHeartbeat()
        this.setMsg('该设备已通过认证，无需登入', 'info')
        /* 已认证: 直接进入设备管理页 (外部调用场景不跳) */
        this._autoManage()
        return
      }
      if (res.status === 'ready') {
        this.pageState = 'portal'
        this.showForm = true
        this.canLogout = false
        this._lastSyncAt = Date.now()
        this.startHeartbeat()
        if (this.username && this.password) {
          this.setMsg('需要认证，账号密码已就绪，点击登录', 'warn')
        } else {
          this.setMsg('需要认证，请输入账号密码', 'warn')
        }
        return
      }
      if (res.status === 'other') {
        this.pageState = 'portal'
        this.showForm = false
        this.startHeartbeat()
        this.setMsg(res.msg || '该网络当前认证方式非账号密码，请在网页认证页操作', 'warn')
        return
      }
      if (res.status === 'manual') {
        // 服务器连不上/响应异常: 地址可能不对, 提供手动输入 (预填当前地址) + 认证类型选择
        this.pageState = 'manual'
        this.showForm = false
        this.showManualServer = true
        this.showAdapterPick = true
        this.manualServer = this.serverShow
        this.setMsg('服务器无响应（' + (res.msg || '') + '），可手动输入正确地址', 'warn')
        return
      }
      this.pageState = 'portal'
      this.showForm = true
      log('配置', 'server=' + serverBase + ' code=' + (res.code == null ? '' : res.code) + ' msg=' + (res.msg || ''))
      this.setMsg(res.msg || '获取配置失败', 'error')
    },

    /* 用户手动点选认证类型 (自动识别不出时) */
    pickAdapter(a) {
      this.activeAdapterId = a.id
      this._adapterState = {}
      this.showAdapterPick = false
      log('适配器', '手动选择 ' + a.id)
      if (!this.serverBase) {
        this.showManualServer = true
        this.setMsg('已选择 ' + a.name + '，请输入认证服务器地址', 'warn')
        return
      }
      this.showManualServer = false
      var gen = (this._gen = (this._gen || 0) + 1)
      this.startPortalConf(a, this.serverBase, this._params || {}, gen)
    },

    /* ---- 手动服务器 ---- */
    /* 自动探测不到/连不上服务器时, 手动输入 IP[:端口] 或主机名;
     * 认证类型也由用户点选 (未选时保留输入的地址, 先让用户选类型) */
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
      var adapter = this.activeAdapter
      if (!adapter) {
        this.showAdapterPick = true
        this.setMsg('请点选下方认证类型', 'warn')
        return
      }
      var base = 'http://' + v
      var gen = (this._gen = (this._gen || 0) + 1)
      this.showManualServer = false
      this.showAdapterPick = false
      log('手动服务器', base + ' adapter=' + adapter.id)
      this.saveServer(base)
      this.startPortalConf(adapter, base, this._params || {}, gen)
    },
    async saveServer(base) {
      var self = this
      var acc = await loadAccount(self._ssid)
      acc.serverBase = base
      var ok = await saveAccount(acc, self._ssid)
      log('配置', '保存认证服务器 wifi=' + (self._ssid || '未知') + ' ok=' + ok)
    },
    toggleRemember() {
      this.remember = !this.remember
    },

    /* ---- 登录 ---- */
    /* 会话建立/刷新与失败重试由适配器自理 (协议相关), 框架只调用一次 adapter.login */
    async doLogin() {
      var self = this
      if (this.logging) return
      var adapter = this.activeAdapter
      if (!adapter) {
        this.setMsg('尚未识别认证类型，请先点选', 'warn')
        return
      }
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
      log('登录', 'user=' + this.username + ' server=' + this.serverBase + ' adapter=' + adapter.id + ' remember=' + this.remember)
      this.setMsg('正在认证…', 'info')
      var res = await adapter.login(this.serverBase, {
        params: this._params,
        username: this.username,
        password: this.password,
        remember: this.remember,
        state: this._adapterState,
      })
      if (gen !== this._gen) return
      this.logging = false
      log('登录', '结果 code=' + (res.code == null ? '' : res.code) + ' msg=' + (res.msg || ''))
      if (!res.ok) {
        this.setMsg(res.msg || '认证失败', 'error')
        return
      }
      if (res.code === 200) {
        // 登录流程刷新会话时发现已 MAC 免认证通过
        if (this._keepAlive()) this.startHeartbeat()
        else this.stopHeartbeat()
        this.pageState = 'ok'
        this.showForm = false
        this.setMsg('该设备已通过认证，无需登入', 'info')
        return
      }
      // 登录成功 → 保存凭据 (按当前 WiFi 分别存储, 记住所用适配器) → 复查连通性确认放行
      var ssidKey = await this.resolveSsid()
      /* 保存必须 await 并回读校验: 之前是即发即忘, 登录后页面很快重建, 写入可能丢失 */
      if (this.remember) {
        var saved = await saveAccount({
          username: this.username,
          password: this.password,
          remember: true,
          serverBase: this.serverBase,
          adapter: adapter.id,
        }, ssidKey)
        var back = await loadAccount(ssidKey)
        var okSave = !!(saved && back && back.password === this.password && back.username === this.username)
        log('配置', '已记住账号 (wifi=' + (ssidKey || '未知') + ' adapter=' + adapter.id +
          ' 密码长度=' + String(this.password || '').length + ' 回读校验=' + (okSave ? '通过' : '失败') + ')')
      } else {
        var acc0 = await loadAccount(ssidKey)
        acc0.username = this.username
        acc0.password = ''
        acc0.remember = false
        acc0.serverBase = this.serverBase
        acc0.adapter = adapter.id
        await saveAccount(acc0, ssidKey)
        log('配置', '仅记住账号(未勾选记住密码) wifi=' + (ssidKey || '未知'))
      }
      this.verifyOnline(gen)
    },

    paramOf(key) {
      return this._params && this._params[key] ? this._params[key] : ''
    },

    verifyOnline(gen) {
      var self = this
      checkPortal({ signal: this._detectSignal }).then(function (det) {
        if (gen !== self._gen) return
        if (det.status === 'aborted') return
        self.logging = false
        log('复查', det.status)
        if (det.status === 'free') {
          self.pageState = 'ok'
          self.showForm = false
          self.canLogout = true
          self.probeName = det.probe
          /* keepAlive 适配器 (如 H3C iMC 门户) 登录成功后仍需心跳维持会话, 不能停 */
          if (self._keepAlive()) self.startHeartbeat()
          else self.stopHeartbeat()
          self.setMsg('认证成功，已可上网', 'info')
          /* 登录成功后已认证: 直接进入设备管理页 (外部调用场景不跳) */
          self._autoManage()
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
      var adapter = this.activeAdapter
      if (!this.serverBase) return
      if (!adapter || !adapter.logout) return
      this.setMsg('正在下线…', 'info')
      adapter
        .logout(this.serverBase, { params: this._params, state: this._adapterState })
        .then(function (res) {
          log('下线', 'code=' + (res && res.code) + ' msg=' + (res && res.msg))
          self.runCheck()
        })
    },
  },
}
</script>
<style>
/* 设计语言: 背景 #0b0c0e / 面板 #14161a / 分隔 #24272e / 主色 #4c9aff
 * 成功 #35c46b / 警示 #ffb020 / 危险 #e5484d / 文字 #f2f4f8 / 次要 #9aa4b2 / 弱 #6b7480
 * 顶栏 44 · 圆角 8 · 间距 8/12/16 · 宽度全部百分比 + flex-wrap(横条屏与竖屏通用) */
.page { width: 100%; height: 100%; background-color: #0b0c0e; flex-direction: column; }
.bar {
  width: 100%; height: 44px; background-color: #14161a;
  flex-direction: row; align-items: center; justify-content: space-between;
  padding-left: 14px; padding-right: 10px; flex-wrap: wrap;
}
.brand { flex-direction: row; align-items: center; }
.logo {
  width: 26px; height: 26px; border-radius: 7px; background-color: #4c9aff;
  align-items: center; justify-content: center; margin-right: 8px;
}
.logotext { font-size: 15px; color: #ffffff; font-weight: bold; }
.brandname { font-size: 20px; color: #f2f4f8; font-weight: bold; }
.baractions { flex-direction: row; align-items: center; flex-wrap: wrap; }
.btn {
  height: 30px; padding-left: 14px; padding-right: 14px; border-radius: 15px;
  align-items: center; justify-content: center; margin-left: 8px;
}
.btn.ghost { background-color: #24272e; }
.btn.primary { background-color: #4c9aff; }
.btn.danger { background-color: #b3261e; }
.btntext { font-size: 14px; color: #ffffff; }
.status {
  width: 100%; flex-direction: row; padding: 8px 14px; flex-wrap: wrap;
  background-color: #101215; border-bottom-width: 1px; border-bottom-color: #24272e;
  border-left-width: 3px; border-left-color: #24272e;
}
.status.free { border-left-color: #35c46b; }
.status.ok { border-left-color: #35c46b; }
.status.portal { border-left-color: #4c9aff; }
.status.offline { border-left-color: #e5484d; }
.status.busy { border-left-color: #ffb020; }
.status.manual { border-left-color: #ffb020; }
.statusleft { flex-direction: row; align-items: center; margin-right: 20px; }
.statusright { flex: 1; flex-direction: row; align-items: center; flex-wrap: wrap; }
.dot { width: 9px; height: 9px; border-radius: 5px; margin-right: 8px; background-color: #6b7480; }
.dot.sm { width: 7px; height: 7px; border-radius: 4px; }
.dot.free { background-color: #35c46b; }
.dot.ok { background-color: #35c46b; }
.dot.portal { background-color: #4c9aff; }
.dot.offline { background-color: #e5484d; }
.dot.busy { background-color: #ffb020; }
.dot.manual { background-color: #ffb020; }
.dot.info { background-color: #4c9aff; }
.dot.warn { background-color: #ffb020; }
.dot.error { background-color: #e5484d; }
.statetext { font-size: 18px; color: #f2f4f8; font-weight: bold; }
.metaline { font-size: 12px; color: #9aa4b2; margin-right: 14px; }
.warnline { color: #ffb020; }
.panel {
  width: 100%; padding: 8px 14px; flex-direction: row; align-items: center; flex-wrap: wrap;
  background-color: #0b0c0e; border-bottom-width: 1px; border-bottom-color: #1b1e24;
}
.panellabel { font-size: 13px; color: #6b7480; margin-right: 10px; }
.fields { flex: 1; flex-direction: row; align-items: center; flex-wrap: wrap; }
.field {
  height: 32px; min-width: 150px; flex: 1; max-width: 240px; margin-right: 10px; margin-bottom: 4px;
  background-color: #14161a; border-radius: 8px; padding-left: 10px; padding-right: 10px;
  flex-direction: row; align-items: center; border-width: 1px; border-color: #24272e;
}
.field.wide { max-width: none; }
.fieldlabel { font-size: 13px; color: #6b7480; margin-right: 8px; }
.fieldvalue { font-size: 14px; color: #f2f4f8; flex: 1; }
.placeholder { color: #5c6470; }
.switch { flex-direction: row; align-items: center; margin-right: 10px; }
.switchbox {
  width: 30px; height: 17px; border-radius: 9px; background-color: #2c3138; margin-right: 7px;
}
.switchbox.on { background-color: #35c46b; }
.switchtext { font-size: 13px; color: #9aa4b2; }
.actions { flex-direction: row; align-items: center; flex-wrap: wrap; }
.chips { flex-direction: row; flex-wrap: wrap; flex: 1; }
.chip {
  height: 28px; padding-left: 12px; padding-right: 12px; border-radius: 14px;
  background-color: #14161a; border-width: 1px; border-color: #24272e;
  align-items: center; justify-content: center; margin-right: 8px; margin-bottom: 4px;
}
.chiptext { font-size: 13px; color: #9aa4b2; }
.chiptext.on { color: #4c9aff; font-weight: bold; }
.foot {
  width: 100%; height: 30px; flex-direction: row; align-items: center;
  padding-left: 14px; padding-right: 14px; background-color: #101215;
  border-top-width: 1px; border-top-color: #24272e;
}
.foottext { font-size: 13px; color: #9aa4b2; flex: 1; }
.foottext.warn { color: #ffb020; }
.foottext.error { color: #ff8a8d; }
</style>

