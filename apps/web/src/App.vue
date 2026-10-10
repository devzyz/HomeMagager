<script setup lang="ts">
import { ref } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { setConnectionHandler } from './api/client'

const connectionMessage = ref('')
setConnectionHandler((message) => { connectionMessage.value = message })
function reopen(): void { window.location.reload() }
</script>

<template>
  <div
    v-if="connectionMessage"
    class="connection-notice"
    role="alert"
  >
    <span>{{ connectionMessage }}</span>
    <button
      type="button"
      @click="reopen"
    >
      重新打开
    </button>
    <button
      type="button"
      @click="connectionMessage = ''"
    >
      稍后处理
    </button>
  </div>
  <el-config-provider :locale="zhCn">
    <router-view />
  </el-config-provider>
</template>

<style scoped>
.connection-notice {
  position: sticky;
  top: 0;
  z-index: 100;
  background: #fff3cd;
  padding: 12px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.connection-notice button { min-height: 44px; cursor: pointer; }
</style>
