<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import { useDictStore } from '../stores/dicts'
import { formatCents, currentMonthStr } from '../utils/format'
import { ensureCharts, echarts } from '../utils/charts'

interface DashboardData {
  month: string
  month_total_cents: number
  month_count: number
  year_total_cents: number
  prev_month: string
  prev_month_total_cents: number
  month_over_prev: number | null
  trend: { month: string; total_cents: number }[]
  categories: { category_id: string; name: string; total_cents: number }[]
  shops: { shop_id: string; name: string; total_cents: number }[] | null
  month_is_current: boolean
}

const route = useRoute()
const router = useRouter()
const dicts = useDictStore()

const data = ref<DashboardData | null>(null)
const loading = ref(false)

const month = computed<string>(() => {
  const m = route.query.month
  return typeof m === 'string' && /^\d{4}-\d{2}$/.test(m) ? m : currentMonthStr()
})
const shopId = computed(() => (typeof route.query.shop === 'string' && route.query.shop ? route.query.shop : undefined))

async function load(): Promise<void> {
  loading.value = true
  try {
    data.value = await api.get<DashboardData>('/dashboard', { month: month.value, shop_id: shopId.value })
    await nextTick()
    renderCharts()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await dicts.ensure()
  await load()
})
watch(month, load)
watch(shopId, load)

function onMonthChange(v: string | null): void {
  const query = { ...route.query }
  if (v && v !== currentMonthStr()) query.month = v
  else delete query.month
  const clean: Record<string, string> = {}
  for (const [k, val] of Object.entries(query)) if (val) clean[k] = String(val)
  void router.replace({ query: clean })
}

const changeText = computed<string>(() => {
  if (!data.value || data.value.month_over_prev === null) return '--'
  const pct = data.value.month_over_prev * 100
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
})

const trendEl = ref<HTMLDivElement | null>(null)
const pieEl = ref<HTMLDivElement | null>(null)
const shopEl = ref<HTMLDivElement | null>(null)
let trendChart: echarts.ECharts | null = null
let pieChart: echarts.ECharts | null = null
let shopChart: echarts.ECharts | null = null

function chartForElement(chart: echarts.ECharts | null, element: HTMLDivElement | null): echarts.ECharts | null {
  if (chart && chart.getDom() !== element) {
    chart.dispose()
    chart = null
  }
  return element ? chart ?? echarts.init(element) : null
}

function renderCharts(): void {
  if (!data.value) return
  ensureCharts()
  trendChart = chartForElement(trendChart, trendEl.value)
  pieChart = chartForElement(pieChart, pieEl.value)
  shopChart = chartForElement(shopChart, shopEl.value)

  if (trendEl.value) {
    trendChart = trendChart ?? echarts.init(trendEl.value)
    trendChart.setOption({
      grid: { left: 8, right: 8, top: 24, bottom: 20, containLabel: true },
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v: unknown) => formatCents(Number(v)),
      },
      xAxis: { type: 'category', data: data.value.trend.map((t) => t.month.slice(2)) },
      yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${(v / 100).toFixed(0)}元` } },
      series: [{ type: 'bar', data: data.value.trend.map((t) => t.total_cents), itemStyle: { color: '#409eff' } }],
    })
  }

  const cats = data.value.categories
  if (pieEl.value) {
    if (cats.length === 0) {
      pieChart?.clear()
    } else {
      pieChart = pieChart ?? echarts.init(pieEl.value)
      pieChart.setOption({
        tooltip: { trigger: 'item', valueFormatter: (v: unknown) => formatCents(Number(v)) },
        series: [
          {
            type: 'pie',
            radius: ['35%', '65%'],
            data: cats.map((c) => ({ name: c.name, value: c.total_cents })),
            label: { formatter: '{b}\n{d}%' },
          },
        ],
      })
    }
  }

  const shops = data.value.shops
  if (shopEl.value) {
    if (!shops || shops.length === 0) {
      shopChart?.clear()
    } else {
      shopChart = shopChart ?? echarts.init(shopEl.value)
      shopChart.setOption({
        grid: { left: 8, right: 8, top: 24, bottom: 20, containLabel: true },
        tooltip: { trigger: 'axis', valueFormatter: (v: unknown) => formatCents(Number(v)) },
        xAxis: { type: 'category', data: shops.map((s) => s.name) },
        yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `${(v / 100).toFixed(0)}元` } },
        series: [{ type: 'bar', data: shops.map((s) => s.total_cents), itemStyle: { color: '#67c23a' } }],
      })
    }
  }
}

function onResize(): void {
  trendChart?.resize()
  pieChart?.resize()
  shopChart?.resize()
}
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  trendChart?.dispose()
  pieChart?.dispose()
  shopChart?.dispose()
})
</script>

<template>
  <div v-loading="loading">
    <div class="dash-toolbar">
      <el-date-picker
        :model-value="month"
        type="month"
        value-format="YYYY-MM"
        style="width: 150px"
        @update:model-value="onMonthChange"
      />
    </div>

    <template v-if="data">
      <div class="stat-grid">
        <el-card
          shadow="never"
          class="stat-card"
        >
          <div class="muted">
            本月合计（{{ data.month_count }} 笔）
          </div>
          <div class="money stat-value">
            {{ formatCents(data.month_total_cents) }}
          </div>
          <div class="muted">
            上月（{{ data.prev_month }}）{{ formatCents(data.prev_month_total_cents) }} · 环比 <b>{{ changeText }}</b>
          </div>
        </el-card>
        <el-card
          shadow="never"
          class="stat-card"
        >
          <div class="muted">
            {{ data.month.slice(0, 4) }} 全年合计（1—12 月）
          </div>
          <div class="money stat-value">
            {{ formatCents(data.year_total_cents) }}
          </div>
        </el-card>
      </div>
      <p
        v-if="data.month_is_current"
        class="muted"
        style="margin-top: 0"
      >
        注：本月尚未结束，数据会随录入继续变化。
      </p>

      <el-card
        shadow="never"
        style="margin-bottom: 12px"
      >
        <template #header>
          近 12 个月趋势（按账单月份）
        </template>
        <div
          ref="trendEl"
          style="height: 240px"
        />
      </el-card>

      <div class="dash-grid">
        <el-card shadow="never">
          <template #header>
            {{ data.month }} 类别占比
          </template>
          <div
            v-if="data.categories.length === 0"
            class="muted"
            style="text-align: center; padding: 40px 0"
          >
            该月暂无数据
          </div>
          <div
            v-else
            ref="pieEl"
            style="height: 240px"
          />
        </el-card>
        <el-card
          v-if="data.shops"
          shadow="never"
        >
          <template #header>
            {{ data.month }} 店铺对比
          </template>
          <div
            v-if="data.shops.length === 0"
            class="muted"
            style="text-align: center; padding: 40px 0"
          >
            该月暂无数据
          </div>
          <div
            v-else
            ref="shopEl"
            style="height: 240px"
          />
        </el-card>
      </div>
    </template>
  </div>
</template>

<style scoped>
.dash-toolbar {
  margin-bottom: 12px;
}

.stat-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  margin-bottom: 12px;
}

@media (min-width: 720px) {
  .stat-grid {
    grid-template-columns: 1fr 1fr;
  }
}

.stat-value {
  font-size: 24px;
  margin: 4px 0;
}

.dash-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
}

@media (min-width: 720px) {
  .dash-grid {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
