<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../../api/client'
import type { PayrollCalendar, PayrollDay } from '../../api/types'
import { formatCents } from '../../utils/format'

const route = useRoute()
const data = ref<PayrollCalendar | null>(null)
const month = ref('')
const loading = ref(false)
const error = ref('')
let requestId = 0
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const dailyMoney = new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', minimumFractionDigits: 0, maximumFractionDigits: 2, useGrouping: false })
const dayMap = computed(() => new Map(data.value?.days.map((day) => [day.work_date, day])))
const cells = computed(() => {
  if (!data.value) return []
  const [year, m] = data.value.month.split('-').map(Number) as [number, number]
  const offset = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7
  const count = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1
    return day < 1 || day > count ? null : `${data.value!.month}-${String(day).padStart(2, '0')}`
  })
})

async function reload(): Promise<void> {
  const token = ++requestId
  loading.value = true
  error.value = ''
  data.value = null
  try {
    const result = await api.get<PayrollCalendar>(`/payroll/members/${route.params.id}/calendar`, { month: month.value || undefined })
    if (token !== requestId) return
    data.value = result
    month.value = result.month
  } catch (err) {
    if (token === requestId) error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    if (token === requestId) loading.value = false
  }
}
watch(() => route.params.id, () => { month.value = ''; dialog.value = false; void reload() }, { immediate: false })

function moveMonth(step: number): void {
  const [year, m] = month.value.split('-').map(Number) as [number, number]
  const date = new Date(Date.UTC(year, m - 1 + step, 1))
  month.value = date.toISOString().slice(0, 7)
  void reload()
}
function state(date: string): string {
  if (date > (data.value?.today ?? '')) return 'future'
  return dayMap.value.get(date)?.status ?? 'unrecorded'
}
function dayLabel(date: string): string {
  const record = dayMap.value.get(date)
  const future = state(date) === 'future'
  if (!record) return future ? '未到' : '未记录'
  return `${future ? '预记 · ' : ''}${record.status === 'leave' ? '请假' : `${record.hours_hundredths / 100} 小时`}`
}

const dialog = ref(false)
const selected = ref('')
const existing = ref(false)
const busy = ref(false)
const form = ref({ status: 'worked' as PayrollDay['status'], hours: 8 as number | undefined, rate: undefined as number | undefined })
const preview = computed(() => form.value.status === 'leave' ? 0 : Math.round(Math.round((form.value.rate ?? 0) * 100) * Math.round((form.value.hours ?? 0) * 100) / 100))
function edit(date: string): void {
  if (!data.value || loading.value) return
  const record = dayMap.value.get(date)
  selected.value = date
  existing.value = Boolean(record)
  form.value = { status: record?.status ?? 'worked', hours: record?.status === 'worked' ? record.hours_hundredths / 100 : 8, rate: (record?.hourly_rate_cents ?? data.value.member.hourly_rate_cents) / 100 }
  dialog.value = true
}

async function save(clear = false): Promise<void> {
  if (busy.value) return
  const { status, hours, rate } = form.value
  if (!clear && (!rate || rate < 0.01 || rate > 9999.99 || (status === 'worked' && (!hours || hours < 0.01 || hours > 24)))) {
    ElMessage.warning('请填写有效时薪和上班时长（0.01~24 小时）')
    return
  }
  busy.value = true
  try {
    const path = `/payroll/members/${route.params.id}/days/${selected.value}`
    if (clear) await api.delete(path)
    else await api.patch(path, { status, hours_hundredths: status === 'leave' ? 0 : Math.round(hours! * 100), hourly_rate_cents: Math.round(rate! * 100) })
    dialog.value = false
    ElMessage.success(clear ? '已恢复为未记录' : '当天记录已保存')
    await reload()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    busy.value = false
  }
}
void reload()
</script>

<template>
  <section
    v-loading="loading"
    class="payroll-calendar"
  >
    <router-link
      to="/payroll"
      class="back-link"
    >
      ‹ 返回人员列表
    </router-link>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
      show-icon
    />
    <el-button
      v-if="error"
      @click="reload"
    >
      重新加载
    </el-button>
    <template v-if="data">
      <div class="person-heading">
        <h1>{{ data.member.name }}</h1>
        <span class="muted">默认时薪 {{ formatCents(data.member.hourly_rate_cents) }}</span>
      </div>
      <div class="summary">
        <div><span>本月工资</span><strong>{{ formatCents(data.summary.amount_cents) }}</strong></div>
        <div><span>上班时长</span><strong>{{ data.summary.hours_hundredths / 100 }} <small>小时</small></strong></div>
        <div><span>出勤 / 请假</span><strong>{{ data.summary.worked_days }} / {{ data.summary.leave_days }} <small>天</small></strong></div>
      </div>
      <div class="calendar-panel">
        <div class="month-controls">
          <el-button
            aria-label="上个月"
            :disabled="loading || month <= '2000-01'"
            @click="moveMonth(-1)"
          >
            ‹
          </el-button>
          <h2>{{ data.month.replace('-', ' 年 ') }} 月</h2>
          <el-button
            aria-label="下个月"
            :disabled="loading || month >= '2100-12'"
            @click="moveMonth(1)"
          >
            ›
          </el-button>
          <el-button
            class="this-month"
            :disabled="loading || month === data.today.slice(0, 7)"
            @click="month = ''; reload()"
          >
            本月
          </el-button>
        </div>
        <div class="legend">
          <span class="worked">上班</span><span class="leave">请假</span><span class="future">未来日期</span><span class="unrecorded">未记录</span>
        </div>
        <div
          class="calendar-grid"
          aria-label="每日工资月历"
        >
          <div
            v-for="day in weekdays"
            :key="day"
            class="weekday"
          >
            周{{ day }}
          </div>
          <template
            v-for="(date, index) in cells"
            :key="date ?? `blank-${index}`"
          >
            <button
              v-if="date"
              type="button"
              class="day-cell"
              :class="[state(date), { today: date === data.today }]"
              :data-date="date"
              :aria-label="`${date} ${dayLabel(date)}${dayMap.get(date)?.status === 'worked' ? ' ' + formatCents(dayMap.get(date)!.amount_cents) : ''}，编辑当天工时`"
              @click="edit(date)"
            >
              <span class="day-number">{{ Number(date.slice(-2)) }}<small v-if="date === data.today">今</small></span>
              <strong
                v-if="dayMap.get(date)?.status === 'worked'"
                class="day-amount"
              >{{ dailyMoney.format(dayMap.get(date)!.amount_cents / 100) }}</strong>
              <span class="day-status">{{ dayLabel(date) }}</span>
            </button>
            <div
              v-else
              class="blank-cell"
              aria-hidden="true"
            />
          </template>
        </div>
        <p class="calendar-note">
          点击日期编辑工时。未来日期可预填，保持白色，且不计入当前汇总；请假工资为 0。汇总截至 {{ data.today }}。
        </p>
      </div>
    </template>

    <el-dialog
      v-model="dialog"
      :title="`${selected} · 工时记录`"
      width="92%"
      style="max-width: 440px"
      :close-on-click-modal="!busy"
      :close-on-press-escape="!busy"
      :show-close="!busy"
    >
      <el-form
        label-position="top"
        @submit.prevent="save()"
      >
        <el-form-item label="当天状态">
          <el-radio-group
            v-model="form.status"
            :disabled="busy"
          >
            <el-radio-button value="worked">
              上班
            </el-radio-button>
            <el-radio-button value="leave">
              请假
            </el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item
          v-if="form.status === 'worked'"
          label="上班时长（小时）"
          for="day-hours"
        >
          <el-input-number
            id="day-hours"
            v-model="form.hours"
            :min="0.01"
            :max="24"
            :precision="2"
            :step="0.5"
            :disabled="busy"
          />
        </el-form-item>
        <el-form-item
          v-if="form.status === 'worked'"
          label="当天时薪（元 / 小时）"
          for="day-rate"
        >
          <el-input-number
            id="day-rate"
            v-model="form.rate"
            :min="0.01"
            :max="9999.99"
            :precision="2"
            :disabled="busy"
          />
        </el-form-item>
        <p class="preview">
          当天工资 <strong>{{ formatCents(preview) }}</strong>
        </p>
        <p
          v-if="selected > (data?.today ?? '')"
          class="muted"
        >
          这是未来日期，保存后作为预记，暂不计入工资汇总。
        </p>
      </el-form>
      <template #footer>
        <div class="dialog-actions">
          <el-button
            v-if="existing"
            type="danger"
            text
            :disabled="busy"
            @click="save(true)"
          >
            清除记录
          </el-button>
          <span class="action-spacer" />
          <el-button
            :disabled="busy"
            @click="dialog = false"
          >
            取消
          </el-button>
          <el-button
            type="primary"
            :loading="busy"
            @click="save()"
          >
            保存
          </el-button>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.back-link { display: inline-block; color: #337ecc; text-decoration: none; padding: 8px 0; margin-bottom: 8px; }
.person-heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 16px; margin-bottom: 16px; }
h1 { font-size: 22px; margin: 0; overflow-wrap: anywhere; }
.summary { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 12px; margin-bottom: 16px; }
.summary > div { display: flex; flex-direction: column; gap: 10px; padding: 16px; background: #fff; border: 1px solid #e4e7ed; border-radius: 10px; min-width: 0; }
.summary span { font-size: 13px; color: #606266; }
.summary strong { font-size: 22px; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.summary small { font-size: 12px; font-weight: 400; }
.calendar-panel { padding: 16px; background: white; border: 1px solid #e4e7ed; border-radius: 10px; }
.month-controls { display: flex; align-items: center; gap: 12px; }
.month-controls h2 { margin: 0; font-size: 18px; }
.month-controls .el-button { margin-left: 0; min-width: 36px; min-height: 36px; }
.this-month { margin-left: auto !important; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; margin: 18px 0; font-size: 12px; color: #606266; }
.legend span { display: flex; align-items: center; gap: 5px; background: transparent; }
.legend span::before { content: ''; width: 10px; height: 10px; border: 1px solid #dcdfe6; border-radius: 3px; }
.legend .worked::before { background: #d7f1df; border-color: #92cea7; }
.legend .leave::before { background: #fde3e3; border-color: #efa5a5; }
.legend .unrecorded::before { background: #f1f3f5; }
.calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.weekday { text-align: center; padding: 6px 0 10px; color: #606266; font-size: 13px; }
.day-cell { display: flex; flex-direction: column; gap: 10px; align-items: stretch; min-height: 104px; padding: 10px; border: 1px solid #e4e7ed; border-radius: 7px; font: inherit; text-align: left; cursor: pointer; min-width: 0; }
.day-cell:hover { border-color: #409eff; }
.day-cell:focus-visible { outline: 2px solid #409eff; outline-offset: 1px; }
.worked { background: #eaf7ee; color: #24653a; border-color: #b5ddc1; }
.leave { background: #fff0f0; color: #ae3434; border-color: #f1bebe; }
.future { background: #fff; color: #606266; }
.unrecorded { background: #f5f7fa; color: #606266; }
.today { box-shadow: inset 0 0 0 1px #409eff; }
.day-number { display: flex; align-items: center; justify-content: space-between; font-weight: 600; }
.day-number small { color: #337ecc; font-size: 11px; }
.day-amount { font-size: 15px; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.day-status { font-size: 12px; margin-top: auto; }
.calendar-note { color: #606266; font-size: 12px; line-height: 1.7; margin: 16px 0 0; }
.preview { display: flex; justify-content: space-between; padding: 14px; background: #f5f7fa; border-radius: 8px; }
.dialog-actions { display: flex; align-items: center; }
.action-spacer { flex: 1; }
@media (max-width: 600px) {
  .summary { gap: 6px; }
  .summary > div { padding: 12px 8px; }
  .summary strong { font-size: 17px; }
  .calendar-panel { padding: 10px 6px; }
  .month-controls { gap: 8px; }
  .month-controls h2 { font-size: 16px; }
  .calendar-grid { gap: 3px; }
  .day-cell { padding: 7px 3px; min-height: 90px; gap: 6px; }
  .day-number { font-size: 13px; }
  .day-amount { font-size: 10px; letter-spacing: -0.3px; }
  .day-status { font-size: 10px; }
  .legend { gap: 9px; }
}
</style>
