<template>
  <div class="wrapper">
    <div class="headbar">
      <text class="title">关于</text>
      <div class="headbtns">
        <div class="hbtn" @click="goBack">
          <text class="hbtn-text">返回</text>
        </div>
      </div>
    </div>
    <scroller class="aboutscroll">
      <div class="titlerow">
        <text class="appname">WiFi 网络认证</text>
        <div class="verbadge"><text class="verbadge-text">v{{ version }}</text></div>
      </div>
      <text class="row">appid: {{ appid }}</text>

      <text class="section">简介</text>
      <text class="row">· WiFi 认证上网框架 + 模块化认证适配器（自动识别认证页类型）</text>
      <text class="row">· 连通性测试 / 账号密码登录 / 在线设备管理</text>
      <text class="row">· 内置 Panabit 与 H3C iMC 适配器，更多认证系统见 ADAPTER.md</text>

      <text class="section">开源</text>
      <text class="row coderow" @click="openRepo">https://github.com/xiroic-x/wifi-login</text>
      <text class="row">· 许可：框架 GPLv3 / 适配器与平台层 MIT（分层许可）</text>

      <text class="section">用户群</text>
      <div class="qqrow" @click="showQr = true">
        <div class="qqbadge"><text class="qqbadge-text">QQ</text></div>
        <div class="qqtexts">
          <text class="qqnum">QQ 群：1132515689</text>
          <text class="qqhint">点此查看二维码，用手机 QQ 扫码加入</text>
        </div>
        <div class="qraction"><text class="qraction-text">二维码</text></div>
      </div>

      <text class="section">作者</text>
      <text class="row">· Xiro · 来自 vibe coding 制作</text>

      <text class="section">设备兼容性</text>
      <text class="row">· 已实测机型见 README 的「支持机型与产物」</text>
      <text class="row">· 遇到问题请附机型、SKU 与「功能检测」页的自检结果提 Issue</text>
    </scroller>

    <div class="statusbar">
      <text class="statusinfo">github.com/xiroic-x/wifi-login  |  QQ 群 1132515689</text>
    </div>

    <!-- 二维码弹层：点击遮罩关闭 -->
    <div class="qrmask" v-if="showQr" @click="showQr = false">
      <div class="qrcard" @click="noop">
        <text class="qrtitle">扫码加入 WiFi-login 用户群</text>
        <image class="qrimg" :src="qrImage"></image>
        <text class="qrnum">QQ 群号：1132515689</text>
        <text class="qrtip">用手机 QQ「扫一扫」识别上方二维码</text>
        <div class="qrdone" @click="showQr = false">
          <text class="qrdone-text">关闭</text>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { APP_VERSION, APP_ID } from '../../services/version.js'
import { QQ_QR_IMAGE } from '../../services/qq-qr.js'

const REPO_URL = 'https://github.com/xiroic-x/wifi-login'
const QQ_GROUP = '1132515689'
const QQ_JOIN_URL = 'https://qm.qq.com/q/84cy1FHwX0'

export default {
  name: 'about',
  data() {
    return {
      version: APP_VERSION,
      appid: APP_ID,
      showQr: false,
      qrImage: QQ_QR_IMAGE,
      repoUrl: REPO_URL,
      qqGroup: QQ_GROUP,
    }
  },
  methods: {
    onShow() {},
    onHide() {},
    onUnload() {},
    noop() {},
    goBack() { this.$page.finish() },
    /* 打开仓库：优先用系统浏览器能力，没有就退化为复制/提示 */
    openRepo() {
      try {
        if (typeof $falcon !== 'undefined' && $falcon.jsapi && $falcon.jsapi.system && $falcon.jsapi.system.openUrl) {
          $falcon.jsapi.system.openUrl({ url: REPO_URL })
          return
        }
      } catch (e) {}
      this.showQr = true
    },
  },
}
</script>

<style>
.wrapper {
  width: 960px;
  height: 266px;
  background-color: #000000;
  flex-direction: column;
}
.headbar {
  width: 960px;
  height: 44px;
  background-color: #141414;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding-left: 20px;
  padding-right: 16px;
}
.title {
  font-size: 26px;
  color: #ffffff;
  font-weight: bold;
}
.headbtns { flex-direction: row; align-items: center; }
.hbtn {
  width: 90px;
  height: 32px;
  border-radius: 16px;
  background-color: #333333;
  align-items: center;
  justify-content: center;
}
.hbtn-text { font-size: 17px; color: #ffffff; }
.aboutscroll {
  width: 960px;
  height: 198px;
  padding-left: 20px;
  padding-right: 20px;
  padding-top: 8px;
}
.titlerow { flex-direction: row; align-items: center; }
.appname { font-size: 24px; color: #ffffff; font-weight: bold; }
.verbadge {
  margin-left: 10px;
  padding-left: 8px;
  padding-right: 8px;
  height: 24px;
  border-radius: 12px;
  background-color: #1f3a5f;
  align-items: center;
  justify-content: center;
}
.verbadge-text { font-size: 15px; color: #6ec1ff; }
.section {
  font-size: 18px;
  color: #6ec1ff;
  font-weight: bold;
  margin-top: 10px;
  margin-bottom: 4px;
}
.row { font-size: 16px; color: #d8d8d8; margin-bottom: 3px; }
.coderow { color: #6ec1ff; }
.qqrow {
  flex-direction: row;
  align-items: center;
  background-color: #14161a;
  border-radius: 8px;
  padding-left: 10px;
  padding-right: 10px;
  padding-top: 8px;
  padding-bottom: 8px;
  margin-top: 4px;
}
.qqbadge {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background-color: #12b7f5;
  align-items: center;
  justify-content: center;
}
.qqbadge-text { font-size: 15px; color: #ffffff; font-weight: bold; }
.qqtexts { flex: 1; flex-direction: column; margin-left: 10px; }
.qqnum { font-size: 17px; color: #ffffff; }
.qqhint { font-size: 14px; color: #9aa4b2; }
.qraction {
  padding-left: 12px;
  padding-right: 12px;
  height: 28px;
  border-radius: 14px;
  background-color: #1f3a5f;
  align-items: center;
  justify-content: center;
}
.qraction-text { font-size: 14px; color: #6ec1ff; }
.statusbar {
  width: 960px;
  height: 24px;
  background-color: #141414;
  align-items: center;
  padding-left: 20px;
}
.statusinfo { font-size: 13px; color: #808080; }
.qrmask {
  position: absolute;
  left: 0px;
  top: 0px;
  width: 960px;
  height: 266px;
  background-color: rgba(0, 0, 0, 0.82);
  align-items: center;
  justify-content: center;
}
.qrcard {
  width: 236px;
  background-color: #14161a;
  border-radius: 10px;
  padding-top: 8px;
  padding-bottom: 8px;
  padding-left: 12px;
  padding-right: 12px;
  flex-direction: column;
  align-items: center;
}
.qrtitle { font-size: 15px; color: #ffffff; font-weight: bold; margin-bottom: 4px; }
.qrimg { width: 108px; height: 108px; border-radius: 6px; }
.qrnum { font-size: 15px; color: #6ec1ff; margin-top: 4px; }
.qrtip { font-size: 12px; color: #9aa4b2; margin-top: 1px; }
.qrdone {
  margin-top: 6px;
  width: 96px;
  height: 26px;
  border-radius: 15px;
  background-color: #2f6fed;
  align-items: center;
  justify-content: center;
}
.qrdone-text { font-size: 15px; color: #ffffff; }
</style>
