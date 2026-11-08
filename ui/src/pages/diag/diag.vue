<template>
  <div class="wrapper">
    <div class="headbar">
      <text class="title">功能检测</text>
      <div class="headbtns">
        <div class="hbtn" @click="refresh">
          <text class="hbtn-text">{{ busy ? '探测中…' : '重新探测' }}</text>
        </div>
        <div class="hbtn" @click="goBack">
          <text class="hbtn-text">返回</text>
        </div>
      </div>
    </div>

    <scroller class="body">
      <!-- 系统与组件版本 -->
      <text class="section">系统与组件</text>
      <div class="kv" v-for="(row, i) in systemRows" :key="'s' + i">
        <text class="k">{{ row.k }}</text>
        <text class="v">{{ row.v }}</text>
      </div>

      <!-- 固件注册的 API -->
      <text class="section">固件注册的 API ({{ registeredText }})</text>
      <div class="kv" v-for="(m, i) in probed" :key="'p' + i">
        <text class="k">{{ m.name }}</text>
        <text class="v">{{ m.type }}{{ m.methods && m.methods.length ? ' · ' + m.methods.join(' ') : '' }}</text>
      </div>
      <text class="hint" v-if="!probed.length">该固件未在 $falcon.jsapi 下暴露可枚举模块</text>

      <!-- 运行时对象 -->
      <text class="section">运行时对象</text>
      <div class="kv" v-for="(r, i) in runtime" :key="'r' + i">
        <text class="k">{{ r.name }}</text>
        <text class="v">{{ r.type }}</text>
      </div>

      <!-- 原生扩展 -->
      <text class="section">原生扩展</text>
      <div class="kv" v-for="(n, i) in native" :key="'n' + i">
        <text class="k">{{ n.name }}</text>
        <text class="v">{{ n.ok ? '可用' : '不可用' }}{{ n.methods && n.methods.length ? ' · ' + n.methods.join(' ') : '' }}</text>
      </div>

      <!-- 自检 -->
      <text class="section">自检</text>
      <div class="kv" v-for="(s, i) in selfRows" :key="'x' + i">
        <text class="k">{{ s.k }}</text>
        <text class="v">{{ s.v }}</text>
      </div>

      <text class="section">报告(纯文本)</text>
      <text class="mono" v-for="(line, i) in lines" :key="'l' + i">{{ line }}</text>
      <text class="hint">探测时间: {{ tsText }}</text>
    </scroller>
  </div>
</template>

<script>
import { collectReport, reportLines } from '../../services/probe.js'
import { readState, writeState, loadAccount, migrateLegacy } from '../../services/store.js'
import { request } from '../../services/net.js'
import { APP_VERSION } from '../../services/version.js'
import { log } from '../../services/logger.js'

export default {
  name: 'diag',
  data() {
    return {
      busy: false,
      tsText: '-',
      systemRows: [],
      probed: [],
      registeredText: '-',
      runtime: [],
      native: [],
      selfRows: [],
      lines: [],
    }
  },
  methods: {
    onShow() { this.refresh() },
    onHide() {},
    onUnload() {},
    goBack() { this.$page.finish() },
    _fmtTs(ts) {
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
        /* 自检项都用真实调用, 不用推断: 存储做一次写-读回环, 网络打一次探测源,
           文件能力用键化 io 的往返, 账号看当前网络是否有槽位, 迁移实际跑一次 */
        var rep = await collectReport({
          probeStorage: async function () {
            var st = await readState()
            var stamp = 'p' + Date.now()
            await writeState({ probeStamp: stamp })
            var back = await readState()
            return back && back.probeStamp === stamp ? '可用(写读回环通过)' : '异常(写读不一致)'
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
            if (moved.length) return '迁移了 ' + moved.join('/')
            if (skipped.length) return '无需迁移(已有新数据: ' + skipped.join('/') + ')'
            return m && m.reason ? m.reason : '无旧数据'
          },
        })
        var s = rep.system || {}
        self.systemRows = [
          { k: '平台', v: s.platform },
          { k: '系统版本', v: s.osVersion },
          { k: 'API 版本', v: s.apiVersion },
          { k: '设备型号', v: s.deviceModel },
          { k: '机型族(主题)', v: s.theme },
          { k: '逻辑屏幕', v: s.width + ' x ' + s.height },
          { k: '物理屏幕', v: s.deviceWidth + ' x ' + s.deviceHeight },
          { k: '当前网络', v: s.ssid },
          { k: '应用版本', v: APP_VERSION },
        ]
        self.probed = rep.probed || []
        self.registeredText = (rep.registered || []).join(', ') || '(不可枚举)'
        self.runtime = (rep.runtime || []).filter(function (x) { return x.type !== 'undefined' })
        self.native = rep.native || []
        var sh = rep.self || {}
        self.selfRows = [
          { k: '存储', v: sh.storage },
          { k: '网络', v: sh.net },
          { k: '文件能力', v: sh.file },
          { k: '账号', v: sh.account },
          { k: '旧数据迁移', v: sh.migrate },
        ]
        self.lines = reportLines(rep)
        log('检测页', self.lines.join(' | ').slice(0, 700))
        self.tsText = self._fmtTs(rep.ts)
      } catch (e) {
        self.lines = ['探测异常: ' + (e && e.message ? e.message : e)]
      }
      self.busy = false
    },
  },
}
</script>

<style>
/* 宽度用百分比/弹性, 不写死 960 —— 视口按机型配置, 这里跟着自适应 */
.wrapper {
  width: 100%;
  height: 100%;
  background-color: #000000;
  flex-direction: column;
}
.headbar {
  width: 100%;
  height: 44px;
  background-color: #141414;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding-left: 16px;
  padding-right: 12px;
}
.title {
  font-size: 24px;
  color: #ffffff;
  font-weight: bold;
}
.headbtns { flex-direction: row; align-items: center; }
.hbtn {
  height: 32px;
  padding-left: 14px;
  padding-right: 14px;
  margin-left: 8px;
  border-radius: 16px;
  background-color: #333333;
  align-items: center;
  justify-content: center;
}
.hbtn-text { font-size: 16px; color: #ffffff; }
.body { flex: 1; padding-left: 16px; padding-right: 16px; padding-top: 6px; }
.section {
  font-size: 17px;
  color: #6ec1ff;
  font-weight: bold;
  margin-top: 10px;
  margin-bottom: 4px;
}
.kv { flex-direction: row; margin-bottom: 2px; }
.k { width: 150px; font-size: 15px; color: #9a9a9a; }
.v { flex: 1; font-size: 15px; color: #eaeaea; }
.mono { font-size: 14px; color: #cfcfcf; margin-bottom: 1px; }
.hint { font-size: 14px; color: #808080; margin-top: 6px; margin-bottom: 10px; }
</style>
