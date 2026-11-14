<template>
  <div class="page">
    <div class="bar">
      <text class="bartitle">功能检测</text>
      <div class="baractions">
        <div class="btn ghost" @click="refresh"><text class="btntext">{{ busy ? '探测中…' : '重新探测' }}</text></div>
        <div class="btn ghost" @click="goBack"><text class="btntext">返回</text></div>
      </div>
    </div>

    <scroller class="body">
      <!-- 结论条: 一眼看到能不能用 -->
      <div class="verdict" :class="verdictClass">
        <text class="verdicttext">{{ verdictText }}</text>
        <text class="verdictsub" v-if="verdictSub">{{ verdictSub }}</text>
      </div>

      <text class="section">真实系统信息</text>
      <div class="card">
        <div class="kv" v-for="(row, i) in realRows" :key="'rs' + i">
          <text class="k">{{ row.k }}</text>
          <text class="v">{{ row.v }}</text>
        </div>
        <text class="hint" v-if="!realRows.length">该固件未提供系统信息接口，无法读取真实值</text>
      </div>

      <text class="section">框架与屏幕</text>
      <div class="card">
        <div class="kv" v-for="(row, i) in systemRows" :key="'s' + i">
          <text class="k">{{ row.k }}</text>
          <text class="v">{{ row.v }}</text>
        </div>
      </div>

      <text class="section">固件注册的 API（{{ moduleCount }} 个）</text>
      <div class="card">
        <div class="apipill" v-for="(m, i) in probed" :key="'p' + i">
          <text class="apiname">{{ m.name }}</text>
          <text class="apimeta">{{ m.type }}{{ m.methods && m.methods.length ? ' · ' + m.methods.join(' ') : '' }}</text>
        </div>
        <text class="hint" v-if="!probed.length">该固件未暴露可枚举的 JSAPI 模块</text>
      </div>

      <text class="section">运行时对象</text>
      <div class="card">
        <div class="kv" v-for="(r, i) in runtime" :key="'r' + i">
          <text class="k">{{ r.name }}</text>
          <text class="v">{{ r.type }}</text>
        </div>
      </div>

      <text class="section">能力自检</text>
      <div class="card">
        <div class="kv" v-for="(s, i) in selfRows" :key="'x' + i">
          <text class="k">{{ s.k }}</text>
          <text class="v">{{ s.v }}</text>
        </div>
      </div>

      <text class="section">兼容性判定</text>
      <div class="card">
        <div class="kv" v-for="(s, i) in compatRows" :key="'c' + i">
          <text class="k">{{ s.k }}</text>
          <text class="v">{{ s.v }}</text>
        </div>
      </div>

      <text class="section">完整报告</text>
      <div class="card">
        <text class="mono" v-for="(line, i) in lines" :key="'l' + i">{{ line }}</text>
        <text class="hint">探测时间 {{ tsText }}</text>
      </div>
      <div style="height: 12px;"></div>
    </scroller>
  </div>
</template>

<script>
import { collectReport, reportLines } from '../../services/probe.js'
import { readState, writeState, loadAccount, migrateLegacy } from '../../services/store.js'
import { request, systemInfo as platformSystemInfo } from '../../services/net.js'
import { checkCompat, compatLine } from '../../services/compat.js'
import { APP_VERSION } from '../../services/version.js'
import { log } from '../../services/logger.js'
import { probeVersionApis } from '../../services/versionprobe.js'

export default {
  name: 'diag',
  data() {
    return {
      busy: false,
      tsText: '-',
      systemRows: [],
      realRows: [],
      probed: [],
      moduleCount: 0,
      runtime: [],
      selfRows: [],
      compatRows: [],
      lines: [],
      verdictText: '正在探测…',
      verdictSub: '',
      verdictClass: 'busy',
    }
  },
  methods: {
    onShow() {
      var self = this
      /* 先让界面完成首帧: 重活(网络/存储/迁移)延到下一轮事件循环, 避免进页卡住 */
      if (this._pending) return
      this._pending = true
      setTimeout(function () {
        self._pending = false
        self.refresh()
      }, 60)
    },
    onHide() {},
    onUnload() {},
    goBack() { this.$page.finish() },
    fmtTs(ts) {
      try {
        var d = new Date(ts || Date.now())
        function p(n) { return (n < 10 ? '0' : '') + n }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
      } catch (e) { return '-' }
    },
    async refresh() {
      if (this.busy) return
      this.busy = true
      var self = this
      try {
        /* 分两步: 一) 立即拿到系统/框架/模块信息并渲染; 二) 再做自检与兼容性 */
        var rep = await collectReport({
          systemInfo: platformSystemInfo,
          /* 每项都是真实调用: 存储写读回环、网络实打一次探测源、账号查一次、迁移实跑一次 */
          probeStorage: async function () {
            var stamp = 'p' + Date.now()
            await writeState({ probeStamp: stamp })
            var back = await readState()
            return back && back.probeStamp === stamp ? '可用' : '异常(写读不一致)'
          },
          probeNet: async function () {
            var r = await request({ url: 'http://connect.rom.miui.com/generate_204', timeout: 5, maxBytes: 64 })
            var code = r && (r.statusCode || r.status)
            return code ? '可用(HTTP ' + code + ')' : '不可用(无响应)'
          },
          probeFile: async function () {
            var st = await readState()
            return typeof st === 'object' ? '可用(经存储链持久化)' : '不可用'
          },
          probeAccount: async function () {
            var acc = await loadAccount('')
            return acc && acc.username ? '有已存账号' : '无已存账号'
          },
          probeMigrate: async function () {
            var m = await migrateLegacy()
            var moved = (m && m.moved) || []
            var skipped = (m && m.skipped) || []
            if (moved.length) return '已迁移 ' + moved.join('/')
            if (skipped.length) return '无需迁移(已有新数据)'
            return (m && m.reason) ? m.reason : '无旧数据'
          },
        })
        var s = rep.system || {}
        var r = rep.real || {}
        self.realRows = [
          { k: '型号', v: r.modelName || '-' },
          { k: 'SKU', v: r.sku || '-' },
          { k: '词典笔 OS', v: r.osVersion || '-' },
          { k: '固件', v: r.firmwareVersion || '-' },
          { k: '应用版本', v: r.appVersion || '-' },
          { k: '编译时间', v: r.buildTime || '-' },
          { k: '系统底座', v: (r.osPretty || r.osName || '-') + (r.osVersionId ? ' ' + r.osVersionId : '') },
          { k: '内核', v: r.kernelVersion || '-' },
          { k: '架构', v: r.arch || '-' },
          { k: '板型', v: r.boardModel || '-' },
          { k: 'SoC', v: r.cpuHardware || r.boardCompatible || '-' },
        ]
        self.systemRows = [
          { k: '框架平台', v: s.runtimePlatform },
          { k: '框架版本', v: s.runtimeVersion },
          { k: 'API 版本', v: s.apiVersion },
          { k: '框架型号', v: s.frameworkModel },
          { k: '机型族', v: s.theme },
          { k: '逻辑屏幕', v: s.width + ' x ' + s.height },
          { k: '物理屏幕', v: s.deviceWidth + ' x ' + s.deviceHeight },
          { k: '当前网络', v: s.ssid },
          { k: '应用版本', v: 'v' + APP_VERSION },
        ]
        self.probed = rep.probed || []
        self.moduleCount = (rep.registered || []).length
        self.runtime = (rep.runtime || []).filter(function (x) { return x.type !== 'undefined' })
        var sh = rep.self || {}
        self.selfRows = [
          { k: '存储', v: sh.storage },
          { k: '网络', v: sh.net },
          { k: '文件能力', v: sh.file },
          { k: '账号', v: sh.account },
          { k: '旧数据迁移', v: sh.migrate },
        ]
        var comp = await checkCompat({ skipNet: true })
        self.compatRows = [
          { k: '判定', v: compatLine(comp) },
          { k: '传输通道', v: comp.details.native },
          { k: '存储往返', v: comp.details.storage },
          { k: '页面基类', v: comp.details.pageBase },
        ]
        if (comp.level === 'ok') {
          self.verdictText = '本机兼容，功能完整'
          self.verdictSub = ''
          self.verdictClass = 'ok'
        } else if (comp.level === 'degraded') {
          self.verdictText = '本机可用（降级运行）'
          self.verdictSub = (comp.degraded || []).join('；')
          self.verdictClass = 'warn'
        } else {
          self.verdictText = '本机不兼容'
          self.verdictSub = (comp.missing || []).join('；')
          self.verdictClass = 'bad'
        }
        self.lines = reportLines(rep)
        self.lines.push('兼容性: ' + compatLine(comp))
        self.tsText = self.fmtTs(rep.ts)
        log('检测页', self.lines.join(' | ').slice(0, 700))
        probeVersionApis().then(function (arr) {
          if (arr && arr.length) log('版本探针', arr.join(' ;; ').slice(0, 900))
          else log('版本探针', '无可用接口')
        }).catch(function () {})
      } catch (e) {
        self.verdictText = '探测异常'
        self.verdictSub = String((e && e.message) || e)
        self.verdictClass = 'bad'
        self.lines = ['探测异常: ' + String((e && e.message) || e)]
      }
      self.busy = false
    },
  },
}
</script>

<style>
/* 设计语言: 背景 #0b0c0e / 卡片 #14161a / 分隔 #24272e / 主色 #4c9aff
 * 成功 #35c46b / 警示 #ffb020 / 危险 #e5484d · 宽度全部百分比 + wrap */
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
.btn.ghost { background-color: #24272e; }
.btntext { font-size: 15px; color: #f2f4f8; }
.body { flex: 1; padding-left: 14px; padding-right: 14px; padding-top: 8px; }
.verdict { border-radius: 8px; padding: 9px 12px; margin-bottom: 6px; border-left-width: 3px; flex-direction: column; }
.verdict.ok { background-color: #10231a; border-left-color: #35c46b; }
.verdict.warn { background-color: #2a2213; border-left-color: #ffb020; }
.verdict.bad { background-color: #2a1518; border-left-color: #e5484d; }
.verdict.busy { background-color: #14161a; border-left-color: #4c9aff; }
.verdicttext { font-size: 16px; color: #f2f4f8; font-weight: bold; }
.verdictsub { font-size: 13px; color: #b8b2a8; margin-top: 2px; }
.section { font-size: 14px; color: #4c9aff; font-weight: bold; margin-top: 8px; margin-bottom: 4px; }
.card { background-color: #14161a; border-radius: 8px; padding: 8px 10px; flex-direction: column; }
.kv { flex-direction: row; margin-bottom: 2px; flex-wrap: wrap; }
.k { width: 84px; font-size: 13px; color: #6b7480; }
.v { flex: 1; font-size: 13px; color: #d7dce4; }
.apipill { margin-bottom: 5px; flex-direction: column; }
.apiname { font-size: 14px; color: #7fb8ff; font-weight: bold; }
.apimeta { font-size: 12px; color: #9aa4b2; }
.mono { font-size: 12px; color: #c3cbd6; margin-bottom: 1px; }
.hint { font-size: 12px; color: #6b7480; margin-top: 4px; }
</style>
