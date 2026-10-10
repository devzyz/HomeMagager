<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../api/client'
import { formatCents } from '../utils/format'
import { expenseFiltersFromQuery } from '../utils/expenseFilters'

interface PrintItem {
  id: string
  paid_date: string
  shop_name: string
  category_name: string
  amount_cents: number
  bill_month: string
  remark: string | null
}

interface PrintData {
  filter_description: string
  stat_basis: string
  total_count: number
  total_amount_cents: number
  items: PrintItem[]
}

const route = useRoute()
const data = ref<PrintData | null>(null)
const loading = ref(false)

onMounted(async () => {
  loading.value = true
  try {
    data.value = await api.get<PrintData>('/reports/print-data', expenseFiltersFromQuery(route.query))
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载失败')
  } finally {
    loading.value = false
  }
})

function doPrint(): void {
  window.print()
}

function goBack(): void {
  window.history.back()
}
</script>

<template>
  <div
    v-loading="loading"
    class="print-wrap"
  >
    <div class="print-toolbar no-print">
      <el-button
        type="primary"
        @click="doPrint"
      >
        打印 / 保存 PDF
      </el-button>
      <el-button @click="goBack">
        返回
      </el-button>
    </div>

    <div
      v-if="data"
      class="print-page"
    >
      <h2 class="print-title">
        费用报表
      </h2>
      <p class="print-meta">
        筛选：{{ data.filter_description }}
      </p>
      <p class="print-meta">
        统计口径：{{ data.stat_basis }} · 共 {{ data.total_count }} 笔 · 合计 {{ formatCents(data.total_amount_cents) }}
      </p>
      <table class="print-table">
        <thead>
          <tr>
            <th>缴费日期</th>
            <th>店铺</th>
            <th>类别</th>
            <th class="num">
              金额（元）
            </th>
            <th>账单月份</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="e in data.items"
            :key="e.id"
          >
            <td>{{ e.paid_date }}</td>
            <td>{{ e.shop_name }}</td>
            <td>{{ e.category_name }}</td>
            <td class="num">
              {{ (e.amount_cents / 100).toFixed(2) }}
            </td>
            <td>{{ e.bill_month }}</td>
            <td>{{ e.remark || '' }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3">
              合计（{{ data.total_count }} 笔）
            </td>
            <td class="num">
              {{ (data.total_amount_cents / 100).toFixed(2) }}
            </td>
            <td colspan="2" />
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped>
.print-toolbar {
  max-width: 900px;
  margin: 0 auto 12px;
  padding: 0 12px;
}

.print-page {
  max-width: 900px;
  margin: 0 auto;
  padding: 24px;
  background: #fff;
}

.print-title {
  text-align: center;
  margin: 0 0 8px;
}

.print-meta {
  font-size: 12px;
  color: #606266;
  margin: 0 0 4px;
}

.print-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  margin-top: 10px;
}

.print-table th,
.print-table td {
  border: 1px solid #303133;
  padding: 4px 6px;
  text-align: left;
  word-break: break-all;
}

.print-table th {
  background: #f2f3f5;
}

.print-table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.print-table tfoot td {
  font-weight: 700;
}

@media print {
  .no-print {
    display: none !important;
  }

  .print-wrap {
    background: #fff;
  }

  .print-page {
    max-width: none;
    padding: 0;
  }

  thead {
    display: table-header-group;
  }

  tr {
    page-break-inside: avoid;
  }

  @page {
    size: A4;
    margin: 15mm;
  }
}
</style>
