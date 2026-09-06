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
      <text class="appname">WiFi 网络认证</text>
      <text class="row">版本: {{ version }}</text>
      <text class="row">appid: {{ appid }}</text>
      <text class="section">功能</text>
      <text class="row">- WiFi 连通性测试 (国内探测源), 无需登入时提示</text>
      <text class="row">- Panabit Portal 账号密码登录, 记住密码</text>
      <text class="row">- 会话过期自动刷新 + 心跳保活</text>
      <text class="row">- 探测不到服务器时可手动输入 IP:端口</text>
      <text class="section">外部调用</text>
      <text class="row">$falcon.navTo('falcon://{{ appid }}/index', 参数)</text>
      <text class="row">- action=check 检测是否需要登入, 结果经 $falcon.trigger</text>
      <text class="row">  回调 (默认事件名 wifiCheckResult, 可用 callback 指定)</text>
      <text class="row">- action=login 登录 (server/username/password/remember/auto)</text>
      <text class="row">- action=log 打开日志页</text>
      <text class="section">日志</text>
      <text class="row">/userdisk/xiro/wifi.log (超过 512KB 自动轮转)</text>
    </scroller>
    <div class="statusbar">
      <text class="statusinfo">GitHub: bot-xiro/action (wifi 分支)</text>
    </div>
  </div>
</template>

<script>
import { APP_VERSION, APP_ID } from '../../services/version.js'

export default {
  name: 'about',
  data() {
    return {
      version: APP_VERSION,
      appid: APP_ID,
    }
  },
  methods: {
    onShow() {},
    onHide() {},
    onUnload() {},
    goBack() {
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
  height: 40px;
  background-color: #16324f;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding-left: 20px;
  padding-right: 16px;
}
.title {
  font-size: 24px;
  color: #e8f1fb;
  font-weight: bold;
}
.headbtns {
  flex-direction: row;
  align-items: center;
}
.hbtn {
  width: 90px;
  height: 28px;
  border-radius: 14px;
  background-color: #3f5f85;
  align-items: center;
  justify-content: center;
}
.hbtn-text {
  font-size: 16px;
  color: #ffffff;
}
.aboutscroll {
  width: 960px;
  height: 202px;
  padding-left: 20px;
  padding-right: 20px;
  padding-top: 8px;
}
.appname {
  font-size: 22px;
  color: #37c2a0;
  font-weight: bold;
  margin-bottom: 6px;
}
.section {
  font-size: 17px;
  color: #ffb648;
  font-weight: bold;
  margin-top: 8px;
  margin-bottom: 4px;
}
.row {
  font-size: 15px;
  color: #b8cde8;
  margin-bottom: 2px;
}
.statusbar {
  width: 960px;
  height: 24px;
  background-color: #16324f;
  justify-content: center;
  padding-left: 20px;
}
.statusinfo {
  font-size: 13px;
  color: #6f8cb0;
}
</style>
