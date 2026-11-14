<template>
  <div class="page">
    <div class="bar">
      <text class="bartitle">问题反馈</text>
      <div class="baractions">
        <div class="btn-ghost" @click="showTerms = true"><text class="btntext">用户条款</text></div>
        <div class="btn-ghost" @click="goBack"><text class="btntext">返回</text></div>
      </div>
    </div>

    <scroller class="body">
      <!-- 引导 -->
      <div class="hint">
        <text class="hinttext">说说你遇到的问题，会自动附上本机的设备信息与运行日志，方便定位。</text>
      </div>

      <!-- 输入区 -->
      <text class="section">问题描述（必填）</text>
      <div class="inputbox" @click="editSummary">
        <text class="inputph" v-if="!summary">点这里输入：例如「连上 WiFi 后一直提示需要认证」</text>
        <text class="inputtext" v-else>{{ summary }}</text>
      </div>

      <text class="section">详细情况（选填）</text>
      <div class="inputbox-small" @click="editDetail">
        <text class="inputph" v-if="!detail">点这里补充：什么时候开始的、哪个网络、点了什么按钮</text>
        <text class="inputtext" v-else>{{ detail }}</text>
      </div>

      <!-- 自动采集清单 -->
      <text class="section">将一并发送的信息</text>
      <div class="collect">
        <div class="collectrow"><text class="dotok">·</text><text class="collecttext">设备型号与系统版本（{{ deviceText }}）</text></div>
        <div class="collectrow"><text class="dotok">·</text><text class="collecttext">当前网络认证状态与认证类型</text></div>
        <div class="collectrow"><text class="dotok">·</text><text class="collecttext">运行日志（最近部分，已自动隐藏密码等敏感内容）</text></div>
        <div class="collectrow"><text class="dotok">·</text><text class="collecttext">本应用版本 {{ version }}{{ logSizeText }}</text></div>
      </div>

      <!-- 结果 -->
      <div :class="resultClass || 'result'" v-if="resultMsg">
        <text class="resulttext">{{ resultMsg }}</text>
      </div>
      <div class="result-ok-box" v-if="resultId">
        <text class="resulttext">工单号：{{ resultId }}</text>
      </div>
    </scroller>

    <div class="foot">
      <div class="btn-ghost" @click="goBack"><text class="btntext">取消</text></div>
      <div class="btn-primary" @click="doSubmit">
        <text class="btntext">{{ busy ? (stage || '提交中…') : '提交反馈' }}</text>
      </div>
    </div>

    <!-- 用户条款 -->
    <div class="mask" v-if="showTerms" @click="showTerms = false">
      <div class="termscard" @click="noop">
        <text class="termstitle">用户条款 · 信息收集说明</text>
        <scroller class="termsscroll">
          <text class="termstext">提交反馈时，本应用会把你填写的内容与下列信息一并发送到反馈服务，用于定位问题：</text>
          <text class="termstext">1) 问题描述：你输入的现象与详细情况。</text>
          <text class="termstext">2) 设备信息：机型 SKU、词典笔系统版本、本应用版本。</text>
          <text class="termstext">3) 网络信息：当前 WiFi 名称、是否需要认证、认证类型、检测结果。</text>
          <text class="termstext">4) 运行日志：本应用自己的日志（启动、检测、适配器、登录、心跳等），最多约 120KB。</text>
          <text class="termstext">5) 能力报告：固件提供的接口与自检结果，用于判断兼容性。</text>
          <text class="termstext">不会收集：你的 WiFi 密码、账号密码、通讯录、位置、照片、其他应用的数据。</text>
          <text class="termstext">日志中形如 password / token / secret 的字段会被服务端自动替换为 ***。</text>
          <text class="termstext">反馈会以公开工单的形式记录在项目仓库，请勿在描述里填写密码等私密信息。</text>
        </scroller>
        <div class="termsdone" @click="showTerms = false"><text class="btntext">我知道了</text></div>
      </div>
    </div>
  </div>
</template>

<script>
import { submitWithContext, collectContext, collectLog } from '../../services/feedback.js'
import { APP_VERSION } from '../../services/version.js'
import { SystemIme } from '../../services/ime.js'
import { log } from '../../services/logger.js'

export default {
  name: 'feedback',
  data() {
    return {
      summary: '',
      detail: '',
      busy: false,
      stage: '',
      resultMsg: '',
      resultClass: '',
      resultId: 0,
      showTerms: false,
      version: APP_VERSION,
      deviceText: '读取中…',
      logSizeText: ''
    }
  },
  methods: {
    noop() {},
    goBack() { this.$page.finish() },

    /* 读取设备信息用于展示(与提交内容一致) */
    async loadDevice() {
      try {
        var ctx = await collectContext({ skipNet: true })
        var si = ctx.system || {}
        var sku = si.sku || ''
        var os = si.osVersion || ''
        if (sku || os) this.deviceText = (sku || '未知机型') + (os ? ' / OS ' + os : '')
        else this.deviceText = '未能读取';
        var lg = await collectLog()
        if (lg) this.logSizeText = '，日志约 ' + Math.round(lg.length / 1024) + 'KB'
      } catch (e) {
        this.deviceText = '未能读取';
      }
    },

    /* 调系统输入法输入: 笔上没有键盘 */
    async askText(title, current, multiline) {
      try {
        var ime = new SystemIme()
        if (ime && typeof ime.edit === 'function') {
          var v = await ime.edit({ title: title, text: current || '', multiline: !!multiline })
          if (v === null || v === undefined) return current
          return String(v)
        }
      } catch (e) {}
      return current
    },

    async editSummary() {
      var v = await this.askText('遇到的问题（一句话）', this.summary, false)
      if (v !== null) this.summary = String(v).slice(0, 120)
    },

    async editDetail() {
      var v = await this.askText('详细情况', this.detail, true)
      if (v !== null) this.detail = String(v).slice(0, 2000)
    },

    /* 提交: 采集设备/日志 -> 发送 */
    async doSubmit() {
      if (this.busy) return
      if (!this.summary || this.summary.length < 2) {
        this.resultMsg = '请先点上面的输入框，写一句问题描述';
        this.resultClass = 'result result-warn';
        return
      }
      this.busy = true;
      this.resultMsg = '';
      this.resultClass = '';
      this.resultId = 0;
      this.stage = '采集信息…';
      try {
        log('反馈', '开始提交 summary=' + this.summary.slice(0, 40));
        this.stage = '提交中…';
        var r = await submitWithContext({
          summary: this.summary,
          description: this.detail
        }, { skipNet: true });
        if (r && r.ok) {
          this.resultMsg = r.duplicate ? '这个问题已有人反馈，已补充到原工单' : '提交成功，感谢反馈！';
          this.resultClass = 'result result-ok';
          this.resultId = r.id || 0;
          log('反馈', '提交成功 id=' + this.resultId + ' dup=' + !!r.duplicate);
        } else {
          this.resultMsg = (r && r.message) ? r.message : '提交失败';
          this.resultClass = 'result result-err';
          log('反馈', '提交失败 ' + this.resultMsg);
        }
      } catch (e) {
        this.resultMsg = '提交异常: ' + (e && e.message ? e.message : e);
        this.resultClass = 'result result-err';
      } finally {
        this.busy = false;
        this.stage = '';
      }
    }
  },
  onShow() {
    this.loadDevice()
  },
  onHide() {},
  onUnload() {}
}
</script>

<style>
.page { width: 100%; height: 100%; background-color: #0b0c0e; flex-direction: column; }

/* 顶栏: 与 diag/index 一致, 高度固定 44, 允许换行避免按钮被挤出 */
.bar {
  width: 100%; height: 44px; background-color: #14161a;
  flex-direction: row; align-items: center; justify-content: space-between;
  padding-left: 14px; padding-right: 12px; flex-wrap: wrap;
}
.bartitle { font-size: 20px; color: #f2f4f8; font-weight: bold; }
.baractions { flex-direction: row; align-items: center; flex-wrap: wrap; }

/* 按钮: 高/圆角在这里定义, 变体只改背景色(Weex 不支持多类名) */
.btn-ghost {
  height: 30px; min-width: 56px; padding-left: 14px; padding-right: 14px;
  border-radius: 15px; background-color: #24272e; margin-left: 8px;
  align-items: center; justify-content: center;
}
.btn-primary {
  height: 30px; min-width: 90px; padding-left: 18px; padding-right: 18px;
  border-radius: 15px; background-color: #4c9aff; margin-left: 8px;
  align-items: center; justify-content: center;
}
.btntext { font-size: 14px; color: #ffffff; }

/* 正文可滚动 */
.body { flex: 1; width: 100%; padding-left: 14px; padding-right: 14px; padding-top: 8px; }
.hint {
  background-color: #14161a; border-radius: 8px;
  padding-left: 10px; padding-right: 10px; padding-top: 8px; padding-bottom: 8px;
  margin-bottom: 6px;
}
.hinttext { font-size: 14px; color: #9aa4b2; line-height: 20px; }
.section {
  font-size: 15px; color: #6ec1ff; font-weight: bold;
  margin-top: 8px; margin-bottom: 4px; line-height: 20px;
}

/* 输入框: 固定高度, 点击区域明确 */
.inputbox {
  width: 100%; height: 44px; background-color: #14161a; border-radius: 8px;
  padding-left: 10px; padding-right: 10px;
  align-items: center;
}
.inputbox-small {
  width: 100%; height: 38px; background-color: #14161a; border-radius: 8px;
  padding-left: 10px; padding-right: 10px; align-items: center;
}
.inputph { font-size: 14px; color: #6b7280; line-height: 20px; }
.inputtext { font-size: 15px; color: #ffffff; line-height: 20px; }

/* 采集清单 */
.collect {
  background-color: #14161a; border-radius: 8px;
  padding-left: 10px; padding-right: 10px; padding-top: 6px; padding-bottom: 6px;
}
.collectrow { flex-direction: row; align-items: flex-start; margin-bottom: 4px; }
.dotok { font-size: 14px; color: #35c46b; margin-right: 4px; line-height: 20px; }
.collecttext { font-size: 13px; color: #9aa4b2; flex: 1; line-height: 20px; }

/* 结果条 */
.result {
  border-radius: 8px; background-color: #14161a;
  padding-left: 10px; padding-right: 10px; padding-top: 8px; padding-bottom: 8px;
  margin-top: 8px;
}
.result-ok { background-color: #10231a; }
.result-ok-box {
  border-radius: 8px; background-color: #10231a;
  padding-left: 10px; padding-right: 10px; padding-top: 8px; padding-bottom: 8px;
  margin-top: 8px;
}
.result-err { background-color: #2a1518; }
.result-warn { background-color: #2a2213; }
.resulttext { font-size: 14px; color: #d8d8d8; line-height: 20px; }

/* 底栏 */
.foot {
  width: 100%; height: 48px; background-color: #14161a;
  flex-direction: row; align-items: center; justify-content: flex-end;
  padding-left: 14px; padding-right: 14px;
}

/* 条款弹层 */
.mask {
  position: absolute; left: 0px; top: 0px; width: 100%; height: 100%;
  background-color: rgba(0, 0, 0, 0.88);
  align-items: center; justify-content: center;
}
.termscard {
  width: 520px; background-color: #14161a; border-radius: 10px;
  padding-left: 14px; padding-right: 14px; padding-top: 12px; padding-bottom: 12px;
  flex-direction: column;
}
.termstitle { font-size: 17px; color: #ffffff; font-weight: bold; margin-bottom: 6px; }
.termsscroll { height: 140px; }
.termstext { font-size: 13px; color: #c8ccd4; line-height: 19px; margin-bottom: 5px; }
.termsdone {
  height: 30px; width: 110px; border-radius: 15px; background-color: #4c9aff;
  align-items: center; justify-content: center; margin-top: 8px;
}
</style>
