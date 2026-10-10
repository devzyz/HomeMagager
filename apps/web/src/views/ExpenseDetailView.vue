<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Back, Delete, Document, EditPen, UploadFilled } from '@element-plus/icons-vue'
import { api, uploadFile } from '../api/client'
import { formatCents, formatBytes } from '../utils/format'

interface AttachmentItem {
  id: string
  original_name: string
  mime_type: string
  size_bytes: number
  created_at: string
}

interface ExpenseItem {
  id: string
  shop_id: string
  shop_name?: string
  category_id: string
  category_name?: string
  amount_cents: number
  bill_month: string
  paid_date: string
  remark: string | null
  version: number
  attachment_count: number
}

const route = useRoute()
const router = useRouter()

const expenseId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))
const item = ref<ExpenseItem | null>(null)
const attachments = ref<AttachmentItem[]>([])
const loading = ref(false)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

async function load(): Promise<void> {
  loading.value = true
  try {
    const r = await api.get<{ item: ExpenseItem }>(`/expenses/${expenseId.value}`)
    item.value = r.item
    const a = await api.get<{ items: AttachmentItem[] }>(`/expenses/${expenseId.value}/attachments`)
    attachments.value = a.items
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(load)

const fileUrl = (a: AttachmentItem): string => `/api/attachments/${a.id}/file`
const isImage = (a: AttachmentItem): boolean => a.mime_type.startsWith('image/')

function pickFiles(): void {
  fileInput.value?.click()
}

async function onFilesChosen(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length === 0 || uploading.value) return
  uploading.value = true
  let failed = 0
  try {
    for (const f of files) {
      try {
        await uploadFile(`/expenses/${expenseId.value}/attachments`, f)
      } catch (err) {
        failed++
        ElMessage.error(`${f.name}：${err instanceof Error ? err.message : '上传失败'}`)
      }
    }
    if (failed > 0) {
      ElMessage.warning(`部分附件上传失败（${failed} 个），费用已保存，可重试失败的部分`)
    } else {
      ElMessage.success('附件已上传')
    }
    await load()
  } finally {
    uploading.value = false
  }
}

async function deleteAttachment(a: AttachmentItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除附件“${a.original_name}”？`, '删除附件', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await api.delete(`/attachments/${a.id}`)
    ElMessage.success('附件已删除')
    await load()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败')
  }
}

async function deleteExpense(): Promise<void> {
  if (!item.value) return
  try {
    await ElMessageBox.confirm(
      `删除费用：${item.value.shop_name} ${formatCents(item.value.amount_cents)}（含 ${attachments.value.length} 个附件）？删除后不可恢复。`,
      '删除费用',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await api.delete(`/expenses/${expenseId.value}`)
    ElMessage.success('费用已删除')
    void router.replace('/expenses')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败')
  }
}

function goBack(): void {
  void router.back()
}
</script>

<template>
  <div v-loading="loading">
    <div style="display: flex; gap: 8px; margin-bottom: 12px">
      <el-button
        :icon="Back"
        circle
        @click="goBack"
      />
      <el-button
        type="primary"
        :icon="EditPen"
        @click="router.push(`/expenses/${expenseId}/edit`)"
      >
        编辑
      </el-button>
      <el-button
        type="danger"
        plain
        :icon="Delete"
        @click="deleteExpense"
      >
        删除
      </el-button>
    </div>

    <el-card
      v-if="item"
      shadow="never"
      style="margin-bottom: 12px"
    >
      <div class="amount-line">
        <span class="muted">金额</span>
        <span
          class="money"
          style="font-size: 26px"
        >{{ formatCents(item.amount_cents) }}</span>
      </div>
      <div class="row-line">
        <span class="muted">店铺</span><span>{{ item.shop_name }}</span>
      </div>
      <div class="row-line">
        <span class="muted">类别</span><span>{{ item.category_name }}</span>
      </div>
      <div class="row-line">
        <span class="muted">账单月份</span><span>{{ item.bill_month }}</span>
      </div>
      <div class="row-line">
        <span class="muted">缴费日期</span><span>{{ item.paid_date }}</span>
      </div>
      <div
        class="row-line"
        style="align-items: flex-start"
      >
        <span class="muted">备注</span><span style="text-align: right; max-width: 70%; white-space: pre-wrap">{{ item.remark || '—' }}</span>
      </div>
    </el-card>

    <el-card shadow="never">
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span>凭证附件（{{ attachments.length }}/5）</span>
          <el-button
            type="primary"
            size="small"
            :icon="UploadFilled"
            :loading="uploading"
            @click="pickFiles"
          >
            上传附件
          </el-button>
        </div>
      </template>
      <input
        ref="fileInput"
        type="file"
        accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
        multiple
        style="display: none"
        @change="onFilesChosen"
      >
      <el-empty
        v-if="attachments.length === 0"
        description="暂无附件，可上传小票/单据照片（JPEG/PNG/WEBP/PDF，单个不超过 10 MiB）"
      />
      <div
        v-for="a in attachments"
        :key="a.id"
        class="row-line"
        style="border-bottom: 1px solid #f0f2f5"
      >
        <div style="display: flex; align-items: center; gap: 10px; min-width: 0">
          <el-image
            v-if="isImage(a)"
            :src="fileUrl(a)"
            :preview-src-list="[fileUrl(a)]"
            :initial-index="0"
            fit="cover"
            style="width: 44px; height: 44px; border-radius: 6px; flex: none"
            preview-teleported
            hide-on-click-modal
          />
          <el-icon
            v-else
            style="font-size: 28px; color: #909399"
          >
            <Document />
          </el-icon>
          <div style="min-width: 0">
            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
              {{ a.original_name }}
            </div>
            <div class="muted">
              {{ formatBytes(a.size_bytes) }}
            </div>
          </div>
        </div>
        <div style="display: flex; gap: 4px">
          <a
            :href="fileUrl(a) + '?download=1'"
            style="text-decoration: none"
          >
            <el-button
              size="small"
              text
              type="primary"
            >下载</el-button>
          </a>
          <el-button
            size="small"
            text
            type="danger"
            @click="deleteAttachment(a)"
          >
            删除
          </el-button>
        </div>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.amount-line {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 10px;
}
</style>
