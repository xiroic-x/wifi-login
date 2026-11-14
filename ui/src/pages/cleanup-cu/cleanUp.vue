<template>
  <div class="page">
    <div class="bar">
      <text class="bartitle">数据清理</text>
      <div class="baractions">
        <div class="btn-ghost" @click="goBack"><text class="btntext">返回</text></div>
      </div>
    </div>

    <div class="body">
      <div class="warncard">
        <text class="warntitle">将清除本应用保存的全部账号</text>
        <text class="warnsub">此操作不可撤销，清除后需要重新登录 WiFi</text>
      </div>

      <text class="section">会被清除的内容</text>
      <text class="li">· 当前网络与其他网络记住的用户名、密码</text>
      <text class="li">· 各网络的认证服务器地址与所选认证类型</text>
      <text class="li">· 最近一次的检测结果缓存</text>

      <text class="section">不会被清除的内容</text>
      <text class="li">· 应用本身与本页设置</text>
      <text class="li">· 系统里其他应用的数据</text>

      <div class="result" v-if="result"><text class="resulttext">{{ result }}</text></div>
    </div>

    <div class="foot">
      <div class="btn-ghost" @click="goBack"><text class="btntext">取消</text></div>
      <div class="btn-danger" @click="doClear">
        <text class="btntext">{{ result ? '完成' : (busy ? '清除中…' : '确认清除全部账号') }}</text>
      </div>
    </div>
  </div>
</template>

<script>
import { clearAllAccounts } from '../../services/store.js'
import { log } from '../../services/logger.js'

export default {
  name: 'cleanUp',
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
        this.result = n > 0 ? ('已清除 ' + n + ' 个网络的账号') : '已清除（此前没有保存的账号）'
      } catch (e) {
        log('清理', 'clearAllAccounts 异常 ' + (e && e.message ? e.message : e))
        this.result = '清除失败：' + (e && e.message ? e.message : e)
      }
      this.busy = false
    },
  },
}
</script>

<style>
/* 与其它页面同一套设计语言; 宽度全部百分比, 横屏竖屏通用 */
.page { width: 100%; height: 100%; background-color: #0b0c0e; flex-direction: column; }
.bar {
  width: 100%; height: 44px; background-color: #14161a;
  flex-direction: row; align-items: center; justify-content: space-between;
  padding-left: 16px; padding-right: 12px; flex-wrap: wrap;
}
.bartitle { font-size: 22px; color: #f2f4f8; font-weight: bold; }
.baractions { flex-direction: row; align-items: center; flex-wrap: wrap; }
.body { flex: 1; padding-left: 16px; padding-right: 16px; padding-top: 10px; }
.warncard {
  background-color: #2a1518; border-radius: 8px; padding: 10px 12px;
  border-left-width: 3px; border-left-color: #e5484d; margin-bottom: 10px;
}
.warntitle { font-size: 17px; color: #ff6b70; font-weight: bold; }
.warnsub { font-size: 13px; color: #c99a9c; margin-top: 3px; }
.section { font-size: 15px; color: #4c9aff; font-weight: bold; margin-top: 8px; margin-bottom: 4px; }
.li { font-size: 14px; color: #d7dce4; margin-bottom: 3px; }
.result { margin-top: 10px; }
.resulttext { font-size: 15px; color: #35c46b; }
.foot {
  width: 100%; height: 52px; flex-direction: row; align-items: center;
  justify-content: flex-end; padding-right: 16px; flex-wrap: wrap;
}
.btn {
  height: 32px; padding-left: 16px; padding-right: 16px; border-radius: 16px;
  align-items: center; justify-content: center; margin-left: 10px;
}
.btn-ghost { background-color: #24272e; }
.btn-danger { background-color: #b3261e; }
.btntext { font-size: 15px; color: #f2f4f8; }
</style>
