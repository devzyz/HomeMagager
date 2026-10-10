<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../../api/client'
import { formatBytes } from '../../utils/format'
import SettingsTabs from './SettingsTabs.vue'

interface RunRow {
  id: string
  provider: string
  trigger_type: string
  status: string
  started_at: string
  finished_at: string | null
  file_name: string | null
  size_bytes: number | null
  error_message: string | null
}

interface BackupStatus {
  running: boolean
  current_run_id: string | null
  local: {
    interval_days: number
    keep: number
    last_success_at: string | null
    last_file_name: string | null
    last_size_bytes: number | null
  }
  cloud: { enabled: boolean; reason: string; keep: number; schedule: string; last_success_at: string | null; next_due_at: string | null; cooldown_until: string | null }
  next_due_at: string | null
  cooldown_until: string | null
  last_run: RunRow | null
}

const status = ref<BackupStatus | null>(null)
const runs = ref<RunRow[]>([])
const loading = ref(false)
const triggering = ref(false)
let pollTimer: number | null = null

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '--'
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

async function load(): Promise<void> {
  loading.value = true
  try {
    status.value = await api.get<BackupStatus>('/backup/status')
    const r = await api.get<{ items: RunRow[] }>('/backup/runs', { page_size: '10' })
    runs.value = r.items
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()
  pollTimer = window.setInterval(() => {
    if (status.value?.running) void load()
  }, 2000)
})
onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer)
})

async function triggerBackup(provider: 'local' | 'googledrive' = 'local'): Promise<void> {
  triggering.value = true
  try {
    await api.post('/backup/runs', { provider })
    ElMessage.success('备份任务已开始')
    await load()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '触发失败')
  } finally {
    triggering.value = false
  }
}

const statusTag = (s: string): 'success' | 'danger' | 'primary' | 'info' =>
  s === 'success' ? 'success' : s === 'failed' ? 'danger' : s === 'running' ? 'primary' : 'info'
</script>

<template>
  <div>
    <SettingsTabs active="backup" />

    <el-card
      shadow="never"
      style="margin-bottom: 12px"
    >
      <template #header>
        本地备份
      </template>
      <div class="row-line">
        <span class="muted">最近成功</span>
        <span>{{ fmtTime(status?.local.last_success_at) }}</span>
      </div>
      <div
        v-if="status?.local.last_file_name"
        class="row-line"
      >
        <span class="muted">备份文件</span>
        <span style="max-width: 60%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
          {{ status.local.last_file_name }}（{{ formatBytes(status.local.last_size_bytes ?? 0) }}）
        </span>
      </div>
      <div class="row-line">
        <span class="muted">下次自动备份</span>
        <span>{{ status?.local.last_success_at ? fmtTime(status.next_due_at ?? null) : '从未成功，到期检查后即会执行' }}</span>
      </div>
      <div
        v-if="status?.cooldown_until"
        class="row-line"
      >
        <span class="muted">失败冷却中</span>
        <span>至 {{ fmtTime(status.cooldown_until) }}</span>
      </div>
      <div
        v-if="status?.running"
        class="row-line"
      >
        <span class="muted">当前任务</span>
        <span>备份进行中…（完成后自动刷新）</span>
      </div>
      <el-button
        type="primary"
        :loading="triggering || status?.running"
        style="margin-top: 8px"
        @click="triggerBackup('local')"
      >
        立即本地备份
      </el-button>
      <p
        class="muted"
        style="margin-bottom: 0"
      >
        每 {{ status?.local.interval_days ?? 7 }} 天自动备份数据库与凭证附件，保留最近 {{ status?.local.keep ?? 2 }} 组。
        本地副本保存在服务器；云端备份状态见下方。
      </p>
    </el-card>

    <el-card
      shadow="never"
      style="margin-bottom: 12px"
    >
      <template #header>
        云端备份（Google Drive）
      </template>
      <el-alert
        :type="status?.cloud.enabled ? 'success' : 'info'"
        :closable="false"
        :title="status?.cloud.enabled ? 'Google Drive 已配置' : 'Google Drive 待授权'"
        :description="status?.cloud.reason"
      />
      <div class="row-line">
        <span class="muted">最近云端成功</span><span>{{ fmtTime(status?.cloud.last_success_at) }}</span>
      </div>
      <div
        v-if="status?.cloud.enabled"
        class="row-line"
      >
        <span class="muted">下次云端备份</span><span>{{ fmtTime(status.cloud.next_due_at) }}</span>
      </div>
      <div
        v-if="status?.cloud.cooldown_until"
        class="row-line"
      >
        <span class="muted">云端失败冷却</span><span>至 {{ fmtTime(status.cloud.cooldown_until) }}</span>
      </div>
      <el-button
        type="primary"
        :disabled="!status?.cloud.enabled"
        :loading="triggering || status?.running"
        style="margin-top: 12px"
        @click="triggerBackup('googledrive')"
      >
        立即云端备份
      </el-button>
      <p
        class="muted"
        style="margin-bottom: 0"
      >
        {{ status?.cloud.schedule ?? '每周日北京时间 03:00' }}，保存数据库、凭证附件和校验清单。新组上传并校验成功后，永久清理超过最近 {{ status?.cloud.keep ?? 5 }} 组的本应用云备份。
      </p>
    </el-card>

    <el-card shadow="never">
      <template #header>
        备份历史（最近 10 次）
      </template>
      <el-empty
        v-if="runs.length === 0"
        description="还没有备份记录"
      />
      <div
        v-for="r in runs"
        :key="r.id"
        class="row-line"
        style="border-bottom: 1px solid #f0f2f5"
      >
        <div style="min-width: 0">
          <div style="display: flex; gap: 6px; align-items: center">
            <el-tag
              size="small"
              :type="statusTag(r.status)"
            >
              {{ r.status }}
            </el-tag>
            <el-tag
              size="small"
              type="info"
              effect="plain"
            >
              {{ r.provider === 'googledrive' ? 'Google Drive' : r.provider === 'local' ? '本地' : '阿里云盘' }} · {{ r.trigger_type === 'manual' ? '手动' : '自动' }}
            </el-tag>
            <span
              v-if="r.file_name"
              class="muted"
              style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
            >
              {{ r.file_name }}{{ r.size_bytes ? `（${formatBytes(r.size_bytes)}）` : '' }}
            </span>
          </div>
          <div
            v-if="r.error_message"
            class="muted"
            style="color: #f56c6c"
          >
            {{ r.error_message }}
          </div>
        </div>
        <span
          class="muted"
          style="flex: none"
        >{{ fmtTime(r.started_at) }}</span>
      </div>
    </el-card>
  </div>
</template>
