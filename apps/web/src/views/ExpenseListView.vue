<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Plus, RefreshRight } from '@element-plus/icons-vue'
import { api } from '../api/client'
import { useDictStore } from '../stores/dicts'
import { formatCents } from '../utils/format'
import { expenseFiltersFromQuery } from '../utils/expenseFilters'

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
const dicts = useDictStore()

const items = ref<ExpenseItem[]>([])
const total = ref(0)
const totalAmountCents = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const loadError = ref(false)

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
  delete next.page
  void router.replace({ query: next })
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = false
  try {
    const r = await api.get<{
      items: ExpenseItem[]
      total: number
      page: number
      total_amount_cents: number
    }>('/expenses', {
      ...expenseFiltersFromQuery(route.query),
      page: q('page') || '1',
      page_size: String(pageSize),
    })
    items.value = r.items
    total.value = r.total
    totalAmountCents.value = r.total_amount_cents
    page.value = r.page
  } catch (err) {
    loadError.value = true
    ElMessage.error(err instanceof Error ? err.message : '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await dicts.ensure()
  await load()
})

watch(
  () => route.query,
  (next, prev) => {
    if (route.path !== '/expenses') return
    if (JSON.stringify(next) !== JSON.stringify(prev)) {
      keyword.value = q('kw')
      void load()
    }
  },
)

function onPageChange(p: number): void {
  void router.replace({ query: { ...route.query, page: String(p) } })
}

function searchKeyword(): void {
  setQuery({ kw: keyword.value || undefined })
}

function clearFilters(): void {
  keyword.value = ''
  void router.replace({ query: {} })
}

function goDetail(id: string): void {
  void router.push(`/expenses/${id}`)
}

function goNew(): void {
  void router.push({ path: '/expenses/new', query: shopId.value ? { shop: shopId.value } : {} })
}

const hasFilters = computed(
  () => shopId.value || categoryId.value || billRange.value || paidRange.value || keyword.value,
)
</script>

<template>
  <div>
    <div class="filter-bar">
      <el-select
        :model-value="shopId || 'all'"
        size="small"
        style="width: 120px"
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
        style="width: 260px"
        range-separator="-"
        start-placeholder="缴费日起"
        end-placeholder="缴费日止"
        value-format="YYYY-MM-DD"
        @update:model-value="(v: [string, string] | null) => setQuery({ pd_from: v?.[0], pd_to: v?.[1] })"
      />
      <div style="display: flex; gap: 6px; flex: 1; min-width: 200px; max-width: 320px">
        <el-input
          v-model="keyword"
          size="small"
          placeholder="搜索备注关键字"
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

    <div class="summary-line">
      <span>共 {{ total }} 笔 · 合计 <b class="money">{{ formatCents(totalAmountCents) }}</b></span>
      <el-button
        v-if="hasFilters"
        size="small"
        text
        type="primary"
        @click="clearFilters"
      >
        清除筛选
      </el-button>
    </div>

    <div
      v-if="loadError"
      style="text-align: center; padding: 24px"
    >
      <el-button
        type="primary"
        :icon="RefreshRight"
        @click="load"
      >
        重试
      </el-button>
    </div>
    <el-empty
      v-else-if="!loading && total === 0"
      :description="hasFilters ? '当前筛选下没有费用记录' : '还没有费用记录，点右下角 + 新增'"
    >
      <el-button
        v-if="hasFilters"
        @click="clearFilters"
      >
        清除筛选
      </el-button>
    </el-empty>

    <div
      v-loading="loading"
      class="card-list"
    >
      <div
        v-for="e in items"
        :key="e.id"
        class="expense-card"
        @click="goDetail(e.id)"
      >
        <div class="row-line">
          <div style="display: flex; align-items: center; gap: 6px; min-width: 0">
            <span class="shop-name">{{ e.shop_name }}</span>
            <el-tag
              size="small"
              effect="plain"
            >
              {{ e.category_name }}
            </el-tag>
          </div>
          <span class="money amount">{{ formatCents(e.amount_cents) }}</span>
        </div>
        <div class="card-meta">
          <span>缴费 {{ e.paid_date }}</span>
          <span>账单 {{ e.bill_month }}</span>
          <span v-if="e.attachment_count > 0">📎 {{ e.attachment_count }}</span>
        </div>
        <div
          v-if="e.remark"
          class="card-remark"
        >
          {{ e.remark }}
        </div>
      </div>
    </div>

    <div
      v-if="total > pageSize"
      class="pager"
    >
      <el-pagination
        background
        layout="prev, pager, next"
        :total="total"
        :page-size="pageSize"
        :current-page="page"
        @current-change="onPageChange"
      />
    </div>

    <el-button
      class="fab"
      type="primary"
      :icon="Plus"
      circle
      size="large"
      @click="goNew"
    />
  </div>
</template>

<style scoped>
.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.summary-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-size: 13px;
  color: #606266;
}

.expense-card {
  background: #fff;
  border-radius: 8px;
  border: 1px solid #ebeef5;
  padding: 12px;
  cursor: pointer;
}

.expense-card:active {
  background: #f5f7fa;
}

.shop-name {
  font-weight: 600;
}

.amount {
  font-size: 16px;
}

.card-meta {
  display: flex;
  gap: 12px;
  color: #909399;
  font-size: 12px;
  margin-top: 6px;
}

.card-remark {
  color: #909399;
  font-size: 12px;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pager {
  display: flex;
  justify-content: center;
  margin-top: 14px;
}

.fab {
  position: fixed;
  right: 18px;
  bottom: calc(var(--nav-height) + env(safe-area-inset-bottom, 0px) + 18px);
  width: 52px;
  height: 52px;
  z-index: 15;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.18);
}
</style>
