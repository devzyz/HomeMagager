<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Printer, Download } from '@element-plus/icons-vue'
import { api, assertApiResponse } from '../api/client'
import { useDictStore } from '../stores/dicts'
import { formatCents } from '../utils/format'
import { expenseFiltersFromQuery } from '../utils/expenseFilters'

interface ReportData {
  filter_description: string
  stat_basis: string
  total_count: number
  total_amount_cents: number
  categories: { category_id: string; name: string; count: number; total_cents: number }[]
}

const route = useRoute()
const router = useRouter()
const dicts = useDictStore()

const data = ref<ReportData | null>(null)
const loading = ref(false)
const exporting = ref(false)

function q(key: string): string {
  const v = route.query[key]
  return typeof v === 'string' ? v : ''
}


const shopId = computed(() => q('shop'))
const categoryId = computed(() => q('category'))
const billRange = computed<[string, string] | null>(() => {
  const from = q('bm_from')
  const to = q('bm_to')
  return from || to ? [from || to, to || from] : null
})
const paidRange = computed<[string, string] | null>(() => {
  const from = q('pd_from')
  const to = q('pd_to')
  return from || to ? [from || to, to || from] : null
})
const keyword = ref(q('kw'))

function setQuery(patch: Record<string, string | undefined>): void {
  const next = { ...route.query }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === '') delete next[k]
    else next[k] = v
  }
  void router.replace({ query: next })
}

const filterParams = computed(() => expenseFiltersFromQuery(route.query))

async function load(): Promise<void> {
  loading.value = true
  try {
    data.value = await api.get<ReportData>('/reports', filterParams.value)
  } catch (err) {
    data.value = null
    ElMessage.error(err instanceof Error ? err.message : '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await dicts.ensure()
  await load()
})
watch(() => route.query, () => {
  if (route.path === '/reports') {
    keyword.value = q('kw')
    void load()
  }
})

function searchKeyword(): void {
  setQuery({ kw: keyword.value || undefined })
}

function goPrint(): void {
  void router.push({ path: '/reports/print', query: route.query })
}

/** 通过 fetch 下载，以便统一携带 Cookie 并处理业务错误（如超限） */
async function exportExcel(): Promise<void> {
  exporting.value = true
  try {
    const res = await fetch('/api/reports/excel?' + new URLSearchParams(filterParams.value), {
      credentials: 'same-origin',
    })
    assertApiResponse(res)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null
      throw new Error(body?.message ?? `导出失败（${res.status}）`)
    }
    const blob = await res.blob()
    const disposition = res.headers.get('content-disposition') ?? ''
    const match = /filename\*=UTF-8''([^;]+)/.exec(disposition)
    const filename = match?.[1] ? decodeURIComponent(match[1]) : '费用报表.xlsx'
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success('已开始下载')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '导出失败')
  } finally {
    exporting.value = false
  }
}
</script>

<template>
  <div v-loading="loading">
    <div class="filter-bar">
      <el-select
        :model-value="shopId || 'all'"
        size="small"
        style="width: 130px"
        @change="(v: string) => setQuery({ shop: v === 'all' ? undefined : v })"
      >
        <el-option
          label="全部店铺"
          value="all"
        />
        <el-option
          v-for="s in dicts.shops"
          :key="s.id"
          :label="s.is_active ? s.name : `${s.name}（停用）`"
          :value="s.id"
        />
      </el-select>
      <el-select
        :model-value="categoryId || 'all'"
        size="small"
        style="width: 120px"
        @change="(v: string) => setQuery({ category: v === 'all' ? undefined : v })"
      >
        <el-option
          label="全部类别"
          value="all"
        />
        <el-option
          v-for="c in dicts.categories"
          :key="c.id"
          :label="c.is_active ? c.name : `${c.name}（停用）`"
          :value="c.id"
        />
      </el-select>
      <el-date-picker
        :model-value="billRange"
        type="monthrange"
        size="small"
        style="width: 240px"
        range-separator="-"
        start-placeholder="账单月起"
        end-placeholder="账单月止"
        value-format="YYYY-MM"
        @update:model-value="(v: [string, string] | null) => setQuery({ bm_from: v?.[0], bm_to: v?.[1] })"
      />
      <el-date-picker
        :model-value="paidRange"
        type="daterange"
        size="small"
        style="width: 250px"
        range-separator="-"
        start-placeholder="缴费日起"
        end-placeholder="缴费日止"
        value-format="YYYY-MM-DD"
        @update:model-value="(v: [string, string] | null) => setQuery({ pd_from: v?.[0], pd_to: v?.[1] })"
      />
      <div style="display: flex; gap: 6px; flex: 1; min-width: 180px; max-width: 300px">
        <el-input
          v-model="keyword"
          size="small"
          placeholder="备注关键字"
          clearable
          @keyup.enter="searchKeyword"
          @clear="searchKeyword"
        />
        <el-button
          size="small"
          @click="searchKeyword"
        >
          搜索
        </el-button>
      </div>
    </div>

    <el-card
      v-if="data"
      shadow="never"
      style="margin-bottom: 12px"
    >
      <div class="report-total">
        <div>
          <div class="muted">
            总笔数
          </div>
          <div
            class="money"
            style="font-size: 24px"
          >
            {{ data.total_count }}
          </div>
        </div>
        <div>
          <div class="muted">
            总金额
          </div>
          <div
            class="money"
            style="font-size: 24px"
          >
            {{ formatCents(data.total_amount_cents) }}
          </div>
        </div>
      </div>
      <p
        class="muted"
        style="margin: 0 0 4px"
      >
        筛选：{{ data.filter_description }}
      </p>
      <p
        class="muted"
        style="margin: 0"
      >
        统计口径：{{ data.stat_basis }}；导出与打印使用相同筛选。
      </p>
      <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap">
        <el-button
          type="primary"
          :icon="Download"
          :loading="exporting"
          @click="exportExcel"
        >
          导出 Excel
        </el-button>
        <el-button
          :icon="Printer"
          @click="goPrint"
        >
          打印 / 存 PDF
        </el-button>
      </div>
    </el-card>

    <el-card shadow="never">
      <template #header>
        分类汇总
      </template>
      <el-empty
        v-if="data && data.categories.length === 0"
        description="当前筛选下没有数据"
      />
      <el-table
        v-else-if="data"
        :data="data.categories"
        size="small"
      >
        <el-table-column
          prop="name"
          label="类别"
          min-width="100"
        />
        <el-table-column
          prop="count"
          label="笔数"
          width="80"
        />
        <el-table-column
          label="金额"
          width="130"
        >
          <template #default="{ row }">
            {{ formatCents(row.total_cents) }}
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.report-total {
  display: flex;
  justify-content: space-around;
  margin-bottom: 12px;
}
</style>
