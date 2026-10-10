<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api/client'
import { useDictStore } from '../stores/dicts'
import { currentMonthStr, todayStr, parseAmountToCentsOrNull } from '../utils/format'
import type { DictItem } from '../api/types'
import { useAuthStore } from '../stores/auth'

interface ExpenseItem {
  id: string
  shop_id: string
  category_id: string
  amount_cents: number
  bill_month: string
  paid_date: string
  remark: string | null
  version: number
}

const route = useRoute()
const router = useRouter()
const dicts = useDictStore()

const editId = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))
const isEdit = computed(() => editId.value !== '')

const form = ref({
  shop_id: '',
  category_id: '',
  amount: '',
  bill_month: currentMonthStr(),
  paid_date: todayStr(),
  remark: '',
})
const version = ref(1)
let clientUuid = crypto.randomUUID()
const draftKey = `expense-draft:${useAuthStore().user?.id}:${route.path}`
let draftReady = false
let saved = false
watch(form, () => {
  if (!draftReady || saved) return
  try {
    sessionStorage.setItem(draftKey, JSON.stringify({ form: form.value, version: version.value, clientUuid, at: Date.now() }))
  } catch { /* Storage may be disabled; keep the form usable. */ }
}, { deep: true, flush: 'sync' })
const saving = ref(false)
const loading = ref(false)
const shopOptions = ref<DictItem[]>([])
const categoryOptions = ref<DictItem[]>([])

function buildOptions(): void {
  // 编辑态显示全部（含停用项，带标记，仅原值可选保留）；新增只能选启用项
  if (isEdit.value) {
    shopOptions.value = dicts.shops
    categoryOptions.value = dicts.categories
  } else {
    shopOptions.value = [...dicts.activeShops]
    categoryOptions.value = [...dicts.activeCategories]
  }
}

onMounted(async () => {
  loading.value = true
  try {
    await dicts.reload()
    if (isEdit.value) {
      const r = await api.get<{ item: ExpenseItem }>(`/expenses/${editId.value}`)
      const item = r.item
      form.value = {
        shop_id: item.shop_id,
        category_id: item.category_id,
        amount: (item.amount_cents / 100).toFixed(2),
        bill_month: item.bill_month,
        paid_date: item.paid_date,
        remark: item.remark ?? '',
      }
      version.value = item.version
    } else {
      const presetShop = route.query.shop
      if (typeof presetShop === 'string' && dicts.activeShops.some((s) => s.id === presetShop)) {
        form.value.shop_id = presetShop
      }
    }
    buildOptions()
    try {
      const raw = sessionStorage.getItem(draftKey)
      if (raw) {
        const draft = JSON.parse(raw)
        if (Date.now() - draft.at < 86400000 && draft.form && typeof draft.clientUuid === 'string'
          && Object.keys(form.value).every((key) => typeof draft.form[key] === 'string')
          && Number.isInteger(draft.version)) {
          form.value = draft.form
          version.value = draft.version
          clientUuid = draft.clientUuid
          ElMessage.info('已恢复当前标签页内尚未提交的费用草稿')
        }
      }
    } catch { /* Ignore invalid or unavailable tab storage. */ }
    draftReady = true
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载失败')
  } finally {
    loading.value = false
  }
})

const amountError = computed<string>(() => {
  if (!form.value.amount.trim()) return ''
  return parseAmountToCentsOrNull(form.value.amount) === null ? '金额需为最多两位小数的正数，最大 9999999.99' : ''
})

const canSubmit = computed(
  () => form.value.shop_id && form.value.category_id && parseAmountToCentsOrNull(form.value.amount) !== null && form.value.bill_month && form.value.paid_date,
)

async function submit(): Promise<void> {
  if (!canSubmit.value || saving.value) return
  const payload = {
    shop_id: form.value.shop_id,
    category_id: form.value.category_id,
    amount: form.value.amount.trim(),
    bill_month: form.value.bill_month,
    paid_date: form.value.paid_date,
    remark: form.value.remark.trim() || undefined,
  }
  saving.value = true
  try {
    if (isEdit.value) {
      const r = await api.patch<{ item: { id: string } }>(`/expenses/${editId.value}`, {
        ...payload,
        version: version.value,
      })
      clearDraft()
      ElMessage.success('已保存')
      void router.replace(`/expenses/${r.item.id}`)
    } else {
      // 一次操作生成 UUID；网络重试复用同 ID，由服务端去重
      const r = await api.post<{ item: { id: string } }>('/expenses', { ...payload, id: clientUuid })
      clearDraft()
      ElMessage.success('费用已保存，可在详情页上传凭证附件')
      void router.replace(`/expenses/${r.item.id}`)
    }
  } catch (err) {
    const code = (err as { code?: string }).code
    if (code === 'VERSION_CONFLICT') {
      try {
        await ElMessageBox.confirm('记录已被他人修改，是否刷新后重新编辑？', '版本冲突', {
          confirmButtonText: '刷新',
          cancelButtonText: '留在当前页',
          type: 'warning',
        })
        await reloadEdit()
      } catch {
        // 留在当前页
      }
    } else {
      ElMessage.error(err instanceof Error ? err.message : '保存失败')
    }
  } finally {
    saving.value = false
  }
}

function clearDraft(): void {
  saved = true
  try { sessionStorage.removeItem(draftKey) } catch { /* Storage may be disabled. */ }
}

async function reloadEdit(): Promise<void> {
  loading.value = true
  try {
    const r = await api.get<{ item: ExpenseItem }>(`/expenses/${editId.value}`)
    const item = r.item
    version.value = item.version
    form.value = {
      shop_id: item.shop_id,
      category_id: item.category_id,
      amount: (item.amount_cents / 100).toFixed(2),
      bill_month: item.bill_month,
      paid_date: item.paid_date,
      remark: item.remark ?? '',
    }
    buildOptions()
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-loading="loading">
    <el-card
      shadow="never"
      style="max-width: 560px"
    >
      <el-form label-position="top">
        <el-form-item
          label="店铺"
          required
        >
          <el-select
            v-model="form.shop_id"
            placeholder="请选择店铺"
            style="width: 100%"
          >
            <el-option
              v-for="s in shopOptions"
              :key="s.id"
              :label="s.is_active ? s.name : `${s.name}（停用）`"
              :value="s.id"
              :disabled="!s.is_active && s.id !== form.shop_id"
            />
          </el-select>
        </el-form-item>
        <el-form-item
          label="类别"
          required
        >
          <el-select
            v-model="form.category_id"
            placeholder="请选择类别"
            style="width: 100%"
          >
            <el-option
              v-for="c in categoryOptions"
              :key="c.id"
              :label="c.is_active ? c.name : `${c.name}（停用）`"
              :value="c.id"
              :disabled="!c.is_active && c.id !== form.category_id"
            />
          </el-select>
        </el-form-item>
        <el-form-item
          label="金额（元）"
          required
          :error="amountError"
        >
          <el-input
            v-model="form.amount"
            inputmode="decimal"
            placeholder="0.00"
            size="large"
            style="font-variant-numeric: tabular-nums"
          />
        </el-form-item>
        <el-form-item
          label="账单月份（费用归属月份）"
          required
        >
          <el-date-picker
            v-model="form.bill_month"
            type="month"
            value-format="YYYY-MM"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item
          label="缴费日期（不能晚于今天）"
          required
        >
          <el-date-picker
            v-model="form.paid_date"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="备注（选填，最多 1000 字）">
          <el-input
            v-model="form.remark"
            type="textarea"
            :rows="3"
            maxlength="1000"
            show-word-limit
          />
        </el-form-item>
        <el-button
          type="primary"
          size="large"
          class="full-width"
          :loading="saving"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ isEdit ? '保存修改' : '保存费用' }}
        </el-button>
        <p
          class="muted"
          style="margin-bottom: 0"
        >
          {{ isEdit ? '保存期间请勿重复点击；若他人已修改会提示刷新。' : '保存后可在详情页上传凭证（JPEG/PNG/WEBP/PDF，单个不超过 10 MiB）。' }}
        </p>
      </el-form>
    </el-card>
  </div>
</template>
