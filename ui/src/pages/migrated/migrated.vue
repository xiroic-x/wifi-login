<template>
  <div class="wrapper">
    <div class="headbar">
      <text class="title">{{ kind === 'migrate' ? '迁移已完成' : '更新完成' }}</text>
    </div>
    <div class="body">
      <text class="big">{{ headline }}</text>
      <text class="row" v-for="(r, i) in rows" :key="'r' + i">{{ r }}</text>
      <text class="hint">这些数据现在都在应用自己的数据目录里, 可在「设置 → 空间清理」中一次性清除。</text>
    </div>
    <div class="footbar">
      <div class="btn" @click="done"><text class="btn-text">知道了</text></div>
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
    return { kind: 'migrate', items: [], prev: '', rows: [] }
  },
  computed: {
    headline() {
      if (this.kind === 'migrate') return '旧版本的数据已迁移到本应用'
      return '已更新到 v' + APP_VERSION + (this.prev ? ' (原 v' + this.prev + ')' : '')
    },
  },
  methods: {
    onLoad(query) {
      var q = query || {}
      this.kind = q.kind === 'update' ? 'update' : 'migrate'
      this.prev = q.prev || ''
      var items = (q.items ? String(q.items) : '').split(',').filter(function (x) { return x })
      var rows = []
      for (var i = 0; i < items.length; i++) {
        rows.push('· ' + items[i] + ' 已并入应用数据目录')
      }
      rows.push('· 账号与密码保持原样, 不需要重新登录')
      this.rows = rows
    },
    onShow() {},
    onHide() {},
    onUnload() {},
    async done() {
      try {
        await writeState({ noticeShownAt: Date.now(), lastVersion: APP_VERSION })
      } catch (e) {}
      log('迁移', '提示已确认 kind=' + this.kind)
      this.$page.finish()
    },
  },
}
</script>

<style>
.wrapper { width: 100%; height: 100%; background-color: #000000; flex-direction: column; }
.headbar {
  width: 100%; height: 44px; background-color: #141414;
  flex-direction: row; align-items: center; padding-left: 16px;
}
.title { font-size: 24px; color: #ffffff; font-weight: bold; }
.body { flex: 1; padding-left: 16px; padding-right: 16px; padding-top: 10px; }
.big { font-size: 21px; color: #5bd45b; font-weight: bold; margin-bottom: 8px; }
.row { font-size: 15px; color: #e0e0e0; margin-bottom: 3px; }
.hint { font-size: 14px; color: #909090; margin-top: 10px; }
.footbar {
  width: 100%; height: 52px; flex-direction: row; align-items: center;
  justify-content: flex-end; padding-right: 16px;
}
.btn {
  height: 34px; padding-left: 18px; padding-right: 18px; border-radius: 17px;
  background-color: #2f6fed; align-items: center; justify-content: center;
}
.btn-text { font-size: 16px; color: #ffffff; }
</style>
