<template>
  <div class="page">
    <div class="bar">
      <text class="bartitle">问题反馈</text>
      <div class="baractions">
        <div class="btn-ghost" @click="openTerms"><text class="btntext">用户条款</text></div>
        <div class="btn-ghost" @click="goBack"><text class="btntext">返回</text></div>
      </div>
    </div>

    <scroller class="body">
      <div class="hint">
        <text class="hinttext">说说你遇到的问题，会自动附上本机的设备信息与运行日志，方便定位。</text>
      </div>

      <!-- 网页反馈入口: 设备没网时也能用电脑/手机提交, 不做网络判断 -->
      <div class="webbar">
        <text class="webbartext">设备没网时，请用电脑或手机打开：</text>
        <text class="weblink">{{ siteUrl }}</text>
        <text class="webbarnote">推荐在设备联网后再提交 —— 会自动带上机型与日志，问题更好定位。</text>
      </div>

      <text class="section">问题描述（必填）</text>
      <div class="inputbox" @click="editSummary">
        <text class="inputph" v-if="!summary">点这里输入：例如「连上 WiFi 后一直提示需要认证」</text>
        <text class="inputtext" v-else>{{ summary }}</text>
      </div>

      <text class="section">详细情况（必填）</text>
      <div class="inputbox-small" @click="editDetail">
        <text class="inputph" v-if="!detail">点这里写：什么时候开始的、哪个网络、点了什么</text>
        <text class="inputtext" v-else>{{ detail }}</text>
      </div>

      <text class="section">联系方式（选填，方便回访）</text>
      <div class="inputbox-small" @click="editContact">
        <text class="inputph" v-if="!contact">点这里填 QQ 号或邮箱</text>
        <text class="inputtext" v-else>{{ contact }}</text>
      </div>
      <div class="grouperow" @click="openGroup">
        <text class="grouptext">也可以加入用户群，直接问：</text>
        <text class="agreelink">查看群二维码</text>
      </div>

      <text class="section">将一并发送的信息</text>
      <div class="collect">
        <div class="collectrow"><text class="dotok">·</text><text class="collecttext">设备型号与系统版本（{{ deviceText }}）</text></div>
        <div class="collectrow"><text class="dotok">·</text><text class="collecttext">当前网络认证状态与认证类型</text></div>
        <div class="collectrow"><text class="dotok">·</text><text class="collecttext">运行日志（最近部分，密码等已自动隐藏）</text></div>
        <div class="collectrow"><text class="dotok">·</text><text class="collecttext">本应用版本 {{ version }}{{ logSizeText }}</text></div>
      </div>

      <!-- 同意条款: 勾选后才能提交 -->
      <div class="agreerow" @click="toggleAgree">
        <div :class="agreed ? 'agbox-on' : 'agbox'">
          <text class="agcheck" v-if="agreed">√</text>
        </div>
        <text class="agreetext">我已阅读并同意</text>
        <text class="agreelink" @click.stop="openTerms">《用户条款》</text>
      </div>

      <div :class="resultBox" v-if="resultMsg">
        <text class="resulttext">{{ resultMsg }}</text>
      </div>
      <div class="result-ok-box" v-if="resultId">
        <text class="resulttext">工单号：{{ resultId }}</text>
      </div>
    </scroller>

    <div class="foot">
      <div class="btn-ghost" @click="goBack"><text class="btntext">取消</text></div>
      <div :class="canSubmit ? 'btn-primary' : 'btn-disabled'" @click="doSubmit">
        <text class="btntext">{{ busy ? (stage || '提交中…') : '提交反馈' }}</text>
      </div>
    </div>

    <!-- 用户条款弹层 -->
    <div class="mask" v-if="showTerms" @click="closeTerms">
      <div class="termscard" @click="noop">
        <text class="termstitle">用户条款 · 信息收集说明</text>
        <scroller class="termsscroll">
          <text class="termstext">提交反馈时，本应用会把你填写的内容与下列信息一并发送到反馈服务，用于定位问题：</text>
          <text class="termstext">1) 问题描述：你输入的现象与详细情况。</text>
          <text class="termstext">2) 设备信息：机型 SKU、词典笔系统版本、本应用版本。</text>
          <text class="termstext">3) 网络信息：当前 WiFi 名称、是否需要认证、认证类型、检测结果。</text>
          <text class="termstext">4) 运行日志：本应用自己的日志，最多约 120KB。</text>
          <text class="termstext">5) 能力报告：固件提供的接口与自检结果。</text>
          <text class="termstext">不会收集：WiFi 密码、账号密码、通讯录、位置、照片、其他应用的数据。</text>
          <text class="termstext">日志中 password / token / secret 等字段会被服务端自动替换为 ***。</text>
          <text class="termstext">反馈以公开工单形式记录在项目仓库，请勿填写密码等私密信息。</text>
        </scroller>
        <div class="termsbtns">
          <div class="btn-ghost" @click="closeTerms"><text class="btntext">关闭</text></div>
          <div class="btn-primary" @click="agreeAndClose"><text class="btntext">同意并继续</text></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { submitWithContext, collectContext, collectLog, FEEDBACK_SITE } from '../../services/feedback.js'
import { APP_VERSION } from '../../services/version.js'
import { SystemIme } from '../../services/ime.js'
import { log } from '../../services/logger.js'

/* 输入法会话复用: 关闭后立刻重开会被忽略, 复用同一个实例减少失败 */
var imeInstance = null
function ime() {
  if (!imeInstance) imeInstance = new SystemIme()
  return imeInstance
}

export default {
  name: 'feedback',
  data() {
    return {
      summary: '',
      detail: '',
      busy: false,
      stage: '',
      resultMsg: '',
      resultBox: 'result',
      resultId: 0,
      showTerms: false,
      agreed: false,
      contact: '',
      siteUrl: FEEDBACK_SITE,
      version: APP_VERSION,
      deviceText: '读取中…',
      logSizeText: ''
    }
  },
  computed: {
    canSubmit() {
      return this.agreed && !this.busy
    }
  },
  methods: {
    noop() {},
    goBack() { this.$page.finish() },

    openTerms() { this.showTerms = true },
    closeTerms() { this.showTerms = false },
    agreeAndClose() {
      this.agreed = true;
      this.showTerms = false;
      log('反馈', '用户已同意条款');
    },
    toggleAgree() {
      this.agreed = !this.agreed;
    },

    /* 读取设备信息(仅展示, 与提交内容一致) */
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

    /* 打开系统输入法: 笔上没有键盘, 走 startTextEdit 通道 */
    async askText(placeholder, current, maxlen) {
      try {
        var inst = ime()
        var v = await inst.open({
          text: current || '',
          placeholder: placeholder || '',
          maxlength: maxlen || 120
        })
        if (v === null || v === undefined) return null
        return String(v)
      } catch (e) {
        log('反馈', '输入法异常 ' + (e && e.message ? e.message : e));
        return null
      }
    },

    async editSummary() {
      var v = await this.askText('一句话说清遇到的问题', this.summary, 120)
      if (v === null) return
      this.summary = v.slice(0, 120)
      log('反馈', '已输入描述 ' + this.summary.length + ' 字');
    },

    async editContact() {
      var v = await this.askText('QQ 号或邮箱（方便回访）', this.contact, 60)
      if (v === null) return
      this.contact = v.slice(0, 60)
    },

    /* 用户群: 二维码在「关于」页, 这里直接跳过去 */
    openGroup() {
      try {
        $falcon.navTo('about', {})
      } catch (e) {
        log('反馈', '跳转关于页失败 ' + (e && e.message ? e.message : e))
      }
    },

    async editDetail() {
      var v = await this.askText('补充细节: 什么时候、哪个网络、点了什么', this.detail, 300)
      if (v === null) return
      this.detail = v.slice(0, 2000)
    },

    /* 提交: 必须先同意条款 */
    async doSubmit() {
      if (this.busy) return
      if (!this.agreed) {
        this.showTerms = true;
        this.resultBox = 'result result-warn';
        this.resultMsg = '请先阅读并勾选同意《用户条款》，才能提交';
        return
      }
      if (!this.summary || this.summary.length < 2) {
        this.resultBox = 'result result-warn';
        this.resultMsg = '请先点「问题描述」输入框，写一句问题描述';
        return
      }
      if (!this.detail || this.detail.length < 2) {
        this.resultBox = 'result result-warn';
        this.resultMsg = '请把「详细情况」填写完整：什么时候开始、哪个网络、点了什么';
        return
      }
      this.busy = true;
      this.resultMsg = '';
      this.resultId = 0;
      this.stage = '自检中…';
      var self = this;
      try {
        log('反馈', '开始提交 len=' + this.summary.length);
        /* 提交前会先跑一遍完整功能检测, 结果自动写进 wifi.log 并随反馈上传 */
        var r = await submitWithContext({
          summary: this.summary,
          description: this.detail,
          contact: this.contact
        }, {
          skipNet: true,
          onStage: function (s) { self.stage = s }
        });
        if (r && r.ok) {
          this.resultBox = 'result result-ok';
          this.resultMsg = r.duplicate ? '这个问题已有人反馈，已补充到原工单' : '提交成功，感谢反馈！';
          this.resultId = r.id || 0;
          log('反馈', '提交成功 id=' + this.resultId);
        } else {
          this.resultBox = 'result result-err';
          this.resultMsg = (r && r.message) ? r.message : '提交失败';
          log('反馈', '提交失败 ' + this.resultMsg);
        }
      } catch (e) {
        this.resultBox = 'result result-err';
        this.resultMsg = '没连上反馈服务：设备可能没联网，可用电脑或手机打开上方网址反馈';
        log('反馈', '提交异常 ' + (e && e.message ? e.message : e));
      } finally {
        this.busy = false;
        this.stage = '';
      }
    }
  },
  onShow() {
    /* 不做网络判断: 顶部固定显示官网入口, 设备信息异步读, 不影响页面先出来 */
    this.loadDevice()
  },
  onHide() {},
  onUnload() {}
}
</script>
<style>
.page { width: 100%; height: 100%; background-color: #0b0c0e; flex-direction: column; }
.bar {
  width: 100%; height: 44px; background-color: #14161a;
  flex-direction: row; align-items: center; justify-content: space-between;
  padding-left: 14px; padding-right: 12px; flex-wrap: wrap;
}
.bartitle { font-size: 20px; color: #f2f4f8; font-weight: bold; }
.baractions { flex-direction: row; align-items: center; flex-wrap: wrap; }

.btn-ghost {
  height: 30px; min-width: 58px; padding-left: 14px; padding-right: 14px;
  border-radius: 15px; background-color: #24272e; margin-left: 8px;
  align-items: center; justify-content: center;
}
.btn-primary {
  height: 30px; min-width: 96px; padding-left: 18px; padding-right: 18px;
  border-radius: 15px; background-color: #4c9aff; margin-left: 8px;
  align-items: center; justify-content: center;
}
.btn-disabled {
  height: 30px; min-width: 96px; padding-left: 18px; padding-right: 18px;
  border-radius: 15px; background-color: #3a3f47; margin-left: 8px;
  align-items: center; justify-content: center;
}
.btntext { font-size: 14px; color: #ffffff; }

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

.inputbox {
  width: 100%; height: 44px; background-color: #14161a; border-radius: 8px;
  padding-left: 10px; padding-right: 10px; align-items: center;
}
.inputbox-small {
  width: 100%; height: 38px; background-color: #14161a; border-radius: 8px;
  padding-left: 10px; padding-right: 10px; align-items: center;
}
.inputph { font-size: 14px; color: #6b7280; line-height: 20px; }
.inputtext { font-size: 15px; color: #ffffff; line-height: 20px; }

.collect {
  background-color: #14161a; border-radius: 8px;
  padding-left: 10px; padding-right: 10px; padding-top: 6px; padding-bottom: 6px;
}
.collectrow { flex-direction: row; align-items: flex-start; margin-bottom: 4px; }
.dotok { font-size: 14px; color: #35c46b; margin-right: 4px; line-height: 20px; }
.collecttext { font-size: 13px; color: #9aa4b2; flex: 1; line-height: 20px; }

/* 同意条款: 整行可点, 勾选框固定尺寸 */
.agreerow {
  flex-direction: row; align-items: center; flex-wrap: wrap;
  margin-top: 10px; margin-bottom: 4px;
  padding-left: 2px;
}
.agbox {
  width: 20px; height: 20px; border-radius: 4px;
  background-color: #1b1e24; border-width: 1px; border-color: #4a515b;
  align-items: center; justify-content: center; margin-right: 8px;
}
.agbox-on {
  width: 20px; height: 20px; border-radius: 4px;
  background-color: #4c9aff;
  align-items: center; justify-content: center; margin-right: 8px;
}
.agcheck { font-size: 14px; color: #ffffff; }
.agreetext { font-size: 14px; color: #c8ccd4; line-height: 20px; }

/* 加群选项行 */
.grouperow {
  flex-direction: row; align-items: center; flex-wrap: wrap;
  margin-top: 6px; margin-bottom: 2px; padding-left: 2px;
}
.grouptext { font-size: 13px; color: #9aa4b2; line-height: 20px; }

/* 网页反馈入口栏(固定显示, 不做网络判断) */
.webbar {
  border-radius: 8px; background-color: #14161a;
  padding-left: 10px; padding-right: 10px; padding-top: 8px; padding-bottom: 8px;
  margin-bottom: 6px;
}
.webbartext { font-size: 13px; color: #9aa4b2; line-height: 19px; }
.weblink { font-size: 13px; color: #6ec1ff; line-height: 19px; margin-top: 2px; }
.webbarnote { font-size: 12px; color: #808a96; line-height: 18px; margin-top: 4px; }

/* 联网状态条 */
.offline {
  border-radius: 8px; background-color: #2a2213;
  padding-left: 10px; padding-right: 10px; padding-top: 8px; padding-bottom: 8px;
  margin-bottom: 6px;
}
.offlinetitle { font-size: 14px; color: #ffb020; font-weight: bold; line-height: 20px; }
.offlinetext { font-size: 13px; color: #c8ccd4; line-height: 19px; }
.offlinelink { font-size: 13px; color: #6ec1ff; line-height: 19px; margin-top: 2px; margin-bottom: 2px; }
.online {
  border-radius: 8px; background-color: #10231a;
  padding-left: 10px; padding-right: 10px; padding-top: 6px; padding-bottom: 6px;
  margin-bottom: 6px;
}
.onlinetext { font-size: 13px; color: #9aa4b2; line-height: 19px; }
.agreelink { font-size: 14px; color: #6ec1ff; line-height: 20px; }

.result {
  border-radius: 8px; background-color: #14161a;
  padding-left: 10px; padding-right: 10px; padding-top: 8px; padding-bottom: 8px;
  margin-top: 8px;
}
.result-ok { background-color: #10231a; border-radius: 8px; padding-left: 10px; padding-right: 10px; padding-top: 8px; padding-bottom: 8px; margin-top: 8px; }
.result-err { background-color: #2a1518; border-radius: 8px; padding-left: 10px; padding-right: 10px; padding-top: 8px; padding-bottom: 8px; margin-top: 8px; }
.result-warn { background-color: #2a2213; border-radius: 8px; padding-left: 10px; padding-right: 10px; padding-top: 8px; padding-bottom: 8px; margin-top: 8px; }
.result-ok-box { border-radius: 8px; background-color: #10231a; padding-left: 10px; padding-right: 10px; padding-top: 8px; padding-bottom: 8px; margin-top: 8px; }
.resulttext { font-size: 14px; color: #d8d8d8; line-height: 20px; }

.foot {
  width: 100%; height: 48px; background-color: #14161a;
  flex-direction: row; align-items: center; justify-content: flex-end;
  padding-left: 14px; padding-right: 14px;
}

.mask {
  position: absolute; left: 0px; top: 0px; width: 100%; height: 100%;
  background-color: rgba(0, 0, 0, 0.9);
  align-items: center; justify-content: center;
}
.termscard {
  width: 540px; background-color: #14161a; border-radius: 10px;
  padding-left: 14px; padding-right: 14px; padding-top: 12px; padding-bottom: 10px;
  flex-direction: column;
}
.termstitle { font-size: 17px; color: #ffffff; font-weight: bold; margin-bottom: 6px; }
.termsscroll { height: 130px; }
.termstext { font-size: 13px; color: #c8ccd4; line-height: 19px; margin-bottom: 5px; }
.termsbtns { flex-direction: row; align-items: center; justify-content: flex-end; margin-top: 6px; }
</style>
