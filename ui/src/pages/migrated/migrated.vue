<template>
  <div class="page">
    <div class="bar">
      <text class="bartitle">{{ isUpdate ? '更新完成' : '迁移已完成' }}</text>
    </div>

    <div class="body">
      <div class="okcard">
        <text class="oktitle">{{ headline }}</text>
        <text class="oksub">{{ subtitle }}</text>
      </div>

      <text class="section" v-if="rows.length">处理明细</text>
      <text class="li" v-for="(r, i) in rows" :key="'r' + i">{{ r }}</text>

      <text class="tip">数据现在都在应用自己的数据目录里，可在「设置 → 空间清理」中一次性清除；
        账号与密码保持原样，不需要重新登录。</text>
    </div>

    <div class="foot">
      <div class="btn-primary" @click="done"><text class="btntext">知道了</text></div>
    </div>
  </div>
</template>

<script>
import { APP_VERSION } from '../../services/version.js'
import { writeState } from '../../services/store.js'
import { log } from '../../services/logger.js'

export default {
  name: 'migrated',
  data() {
    return { kind: 'migrate', items: [], prev: '', rows: [], isUpdate: false }
  },
  computed: {
    headline() {
      if (this.isUpdate) return '已更新到 v' + APP_VERSION
      return '旧版本的数据已并入本应用'
    },
    subtitle() {
      if (this.isUpdate) return this.prev ? ('原版本 v' + this.prev) : '本次为首次运行'
      return '无需重新登录，账号与密码保持原样'
    },
  },
  methods: {
    onLoad(query) {
      var q = query || {}
      this.isUpdate = q.kind === 'update'
      this.prev = q.prev || ''
      var items = (q.items ? String(q.items) : '').split(',').filter(function (x) { return x })
      var rows = []
      for (var i = 0; i < items.length; i++) rows.push('· ' + items[i] + ' 已并入应用数据目录')
      this.rows = rows
    },
    onShow() {},
    onHide() {},
    onUnload() {},
    async done() {
      try {
        await writeState({ noticeShownAt: Date.now(), lastVersion: APP_VERSION })
      } catch (e) {}
      log('迁移', '提示已确认 kind=' + (this.isUpdate ? 'update' : 'migrate'))
      this.$page.finish()
    },
  },
}
</script>

<style>
.page { width: 100%; height: 100%; background-color: #0b0c0e; flex-direction: column; }
.bar {
  width: 100%; height: 44px; background-color: #14161a;
  flex-direction: row; align-items: center; padding-left: 16px;
}
.bartitle { font-size: 22px; color: #f2f4f8; font-weight: bold; }
.body { flex: 1; padding-left: 16px; padding-right: 16px; padding-top: 10px; }
.okcard {
  background-color: #10231a; border-radius: 8px; padding: 10px 12px;
  border-left-width: 3px; border-left-color: #35c46b; margin-bottom: 10px;
}
.oktitle { font-size: 18px; color: #57d98a; font-weight: bold; }
.oksub { font-size: 13px; color: #8fc3a4; margin-top: 3px; }
.section { font-size: 15px; color: #4c9aff; font-weight: bold; margin-top: 6px; margin-bottom: 4px; }
.li { font-size: 14px; color: #d7dce4; margin-bottom: 3px; }
.tip { font-size: 13px; color: #6b7480; margin-top: 10px; }
.foot {
  width: 100%; height: 52px; flex-direction: row; align-items: center;
  justify-content: flex-end; padding-right: 16px;
}
.btn {
  height: 32px; padding-left: 18px; padding-right: 18px; border-radius: 16px;
  align-items: center; justify-content: center;
}
.btn-primary { background-color: #4c9aff; }
.btntext { font-size: 15px; color: #ffffff; }
</style>
