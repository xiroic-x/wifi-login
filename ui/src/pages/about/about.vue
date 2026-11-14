<template>
  <div class="page">
    <div class="bar">
      <text class="bartitle">关于</text>
      <div class="baractions">
        <div class="btn-ghost" @click="goBack"><text class="btntext">返回</text></div>
      </div>
    </div>

    <scroller class="body">
      <div class="hero">
        <div class="logo"><text class="logotext">Wi</text></div>
        <div class="herotext">
          <text class="appname">WiFi 网络认证</text>
          <text class="appdesc">检测 · 登录 · 设备管理，一个页面走完</text>
        </div>
        <div class="badge"><text class="badgetext">v{{ version }}</text></div>
      </div>

      <text class="section">能做什么</text>
      <text class="li">· 连通性检测：204 只当证据，必须非探测源复核才判「无需登入」</text>
      <text class="li">· 账号登录：内置 Panabit 与 H3C iMC 门户适配器，支持按网络记住密码</text>
      <text class="li">· 设备管理：Panabit 门户可查看在线设备并下线</text>
      <text class="li">· 功能检测：看清系统版本、固件能力与兼容性判定</text>

      <text class="section">支持的机型</text>
      <text class="li">· RK 包：X 系列（RK3562 / RK3566）</text>
      <text class="li">· CVI 包：S 系列 / X5 系列 / A 系列（32 位）</text>
      <text class="li">· 界面自适应：横条屏与竖屏全面屏都完整显示</text>

      <text class="section">应用信息</text>
      <div class="kv"><text class="k">appid</text><text class="v">{{ appid }}</text></div>
      <div class="kv"><text class="k">版本</text><text class="v">{{ version }}</text></div>
      <div class="kv"><text class="k">开源</text><text class="v">github.com/soarnext/wifi-login</text></div>
      <div class="kv"><text class="k">许可</text><text class="v">框架 GPLv3 · 适配器与平台层 MIT</text></div>
      <div class="kv"><text class="k">作者</text><text class="v">Xiro</text></div>

      <text class="tip">遇到问题请附机型、版本与「功能检测」页的自检结果提交 Issue。</text>
    </scroller>
  </div>
</template>

<script>
import { APP_VERSION, APP_ID } from '../../services/version.js'

export default {
  name: 'about',
  data() {
    return { version: APP_VERSION, appid: APP_ID }
  },
  methods: {
    onShow() {},
    onHide() {},
    onUnload() {},
    goBack() { this.$page.finish() },
  },
}
</script>

<style>
/* 设计语言: 背景 #0b0c0e / 面板 #14161a / 分隔 #24272e / 主色 #4c9aff
 * 文字 #f2f4f8 / 次要 #9aa4b2 / 弱 #6b7480 · 顶栏 44 · 圆角 8 · 全部百分比宽度 */
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
.btntext { font-size: 15px; color: #f2f4f8; }
.body { flex: 1; padding-left: 16px; padding-right: 16px; padding-top: 10px; }
.hero { flex-direction: row; align-items: center; margin-bottom: 10px; flex-wrap: wrap; }
.logo {
  width: 42px; height: 42px; border-radius: 10px; background-color: #4c9aff;
  align-items: center; justify-content: center; margin-right: 12px;
}
.logotext { font-size: 20px; color: #ffffff; font-weight: bold; }
.herotext { flex: 1; flex-direction: column; }
.appname { font-size: 20px; color: #f2f4f8; font-weight: bold; }
.appdesc { font-size: 14px; color: #9aa4b2; margin-top: 2px; }
.badge {
  padding-left: 10px; padding-right: 10px; height: 24px; border-radius: 12px;
  background-color: #1b2735; align-items: center; justify-content: center;
}
.badgetext { font-size: 13px; color: #4c9aff; }
.section { font-size: 15px; color: #4c9aff; font-weight: bold; margin-top: 10px; margin-bottom: 4px; }
.li { font-size: 14px; color: #d7dce4; margin-bottom: 3px; }
.kv { flex-direction: row; margin-bottom: 3px; flex-wrap: wrap; }
.k { width: 76px; font-size: 14px; color: #6b7480; }
.v { flex: 1; font-size: 14px; color: #d7dce4; }
.tip { font-size: 13px; color: #6b7480; margin-top: 12px; margin-bottom: 14px; }
</style>
