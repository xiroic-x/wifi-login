<template>
  <div class="wrapper">
    <div class="headbar">
      <text class="title">数据清理</text>
      <div class="headbtns">
        <div class="hbtn" @click="goBack"><text class="hbtn-text">返回</text></div>
      </div>
    </div>
    <div class="body">
      <text class="warn">将清除本应用保存的【全部账号】</text>
      <text class="row">· 包括当前网络与其它网络记住的用户名、密码</text>
      <text class="row">· 包括各网络的级联槽位(按网络名保存的那一份)</text>
      <text class="row">· 认证服务器地址与检测结果会一并清空</text>
      <text class="row">· 此操作不可撤销, 清除后需重新登录 WiFi</text>
      <text class="result" v-if="result">{{ result }}</text>
    </div>
    <div class="footbar">
      <div class="btn ghost" @click="goBack"><text class="btn-text">取消</text></div>
      <div class="btn danger" @click="doClear">
        <text class="btn-text">{{ result ? '完成' : (busy ? '清除中…' : '确认清除全部账号') }}</text>
      </div>
    </div>
  </div>
</template>

<script>
import { clearAllAccounts } from '../../services/store.js'
import { log } from '../../services/logger.js'

export default {
  name: 'cleanup',
  data() {
    return { busy: false, result: '' }
  },
  methods: {
    onShow() {},
    onHide() {},
    onUnload() {},
    goBack() { this.$page.finish() },
    async doClear() {
      if (this.result) { this.goBack(); return }
      if (this.busy) return
      this.busy = true
      try {
        var r = await clearAllAccounts()
        var n = (r && r.cleared) || 0
        log('清理', 'clearAllAccounts ok=' + (r && r.ok) + ' cleared=' + n)
        this.result = n > 0 ? ('已清除 ' + n + ' 个网络的账号') : '已清除(此前没有保存的账号)'
      } catch (e) {
        log('清理', 'clearAllAccounts 异常 ' + (e && e.message ? e.message : e))
        this.result = '清除失败: ' + (e && e.message ? e.message : e)
      }
      this.busy = false
    },
  },
}
</script>

<style>
.wrapper { width: 100%; height: 100%; background-color: #000000; flex-direction: column; }
.headbar {
  width: 100%; height: 44px; background-color: #141414;
  flex-direction: row; align-items: center; justify-content: space-between;
  padding-left: 16px; padding-right: 12px;
}
.title { font-size: 24px; color: #ffffff; font-weight: bold; }
.headbtns { flex-direction: row; align-items: center; }
.hbtn {
  height: 32px; padding-left: 14px; padding-right: 14px; border-radius: 16px;
  background-color: #333333; align-items: center; justify-content: center;
}
.hbtn-text { font-size: 16px; color: #ffffff; }
.body { flex: 1; padding-left: 16px; padding-right: 16px; padding-top: 8px; }
.warn { font-size: 20px; color: #ff6b6b; font-weight: bold; margin-bottom: 8px; }
.row { font-size: 15px; color: #e0e0e0; margin-bottom: 3px; }
.result { font-size: 16px; color: #5bd45b; margin-top: 10px; }
.footbar {
  width: 100%; height: 52px; flex-direction: row; align-items: center;
  justify-content: flex-end; padding-right: 16px;
}
.btn {
  height: 34px; padding-left: 16px; padding-right: 16px; border-radius: 17px;
  align-items: center; justify-content: center; margin-left: 10px;
}
.btn.ghost { background-color: #333333; }
.btn.danger { background-color: #b3261e; }
.btn-text { font-size: 16px; color: #ffffff; }
</style>
