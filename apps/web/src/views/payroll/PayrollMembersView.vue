<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../../api/client'
import type { PayrollMember } from '../../api/types'
import { formatCents } from '../../utils/format'

const members = ref<PayrollMember[]>([])
const loading = ref(true)
const error = ref('')
const dialog = ref(false)
const editing = ref<string | null>(null)
const form = ref({ name: '', rate: 0 as number | undefined })
const busy = ref(false)

async function reload(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    members.value = (await api.get<{ items: PayrollMember[] }>('/payroll/members')).items
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}
onMounted(reload)

function open(member?: PayrollMember): void {
  editing.value = member?.id ?? null
  form.value = { name: member?.name ?? '', rate: member ? member.hourly_rate_cents / 100 : undefined }
  dialog.value = true
}

async function save(): Promise<void> {
  if (busy.value) return
  const rate = form.value.rate
  if (!form.value.name.trim() || !rate || rate < 0.01 || rate > 9999.99) {
    ElMessage.warning('请填写姓名及有效时薪（0.01~9999.99 元）')
    return
  }
  busy.value = true
  try {
    const body = { name: form.value.name.trim(), hourly_rate_cents: Math.round(rate * 100) }
    if (editing.value) await api.patch(`/payroll/members/${editing.value}`, body)
    else await api.post('/payroll/members', body)
    dialog.value = false
    ElMessage.success(editing.value ? '成员资料已更新' : '成员已新增')
    await reload()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section v-loading="loading">
    <div class="row-line">
      <h1
        class="page-title"
        style="margin: 0"
      >
        工资成员
      </h1>
      <el-button
        type="primary"
        @click="open()"
      >
        新增成员
      </el-button>
    </div>
    <p class="muted">
      选择成员，记录每天的工时与工资。工资成员无需登录账号。
    </p>
    <el-alert
      v-if="error"
      :title="error"
      type="error"
      :closable="false"
      show-icon
    />
    <el-button
      v-if="error"
      style="margin-top: 12px"
      @click="reload"
    >
      重新加载
    </el-button>
    <el-empty
      v-else-if="!loading && !members.length"
      description="暂无工资成员，先添加一位成员吧"
    />
    <div
      v-else
      class="card-list"
    >
      <article
        v-for="member in members"
        :key="member.id"
        class="member-card"
      >
        <router-link
          :to="`/payroll/${member.id}`"
          class="member-link"
        >
          <span
            class="avatar"
            aria-hidden="true"
          >{{ [...member.name][0] }}</span>
          <span class="member-info">
            <strong>{{ member.name }}</strong>
            <span class="muted">时薪 {{ formatCents(member.hourly_rate_cents) }} · 查看工资月历</span>
          </span>
          <span aria-hidden="true">›</span>
        </router-link>
        <el-button
          text
          type="primary"
          :aria-label="`编辑${member.name}资料`"
          @click="open(member)"
        >
          编辑
        </el-button>
      </article>
    </div>
    <el-dialog
      v-model="dialog"
      :title="editing ? '编辑工资成员' : '新增工资成员'"
      width="92%"
      style="max-width: 420px"
      :close-on-click-modal="!busy"
      :close-on-press-escape="!busy"
      :show-close="!busy"
    >
      <el-form
        label-position="top"
        @submit.prevent="save"
      >
        <el-form-item
          label="姓名"
          for="payroll-name"
        >
          <el-input
            id="payroll-name"
            v-model="form.name"
            maxlength="50"
            :disabled="busy"
          />
        </el-form-item>
        <el-form-item
          label="时薪（元 / 小时）"
          for="payroll-rate"
        >
          <el-input-number
            id="payroll-rate"
            v-model="form.rate"
            :min="0.01"
            :max="9999.99"
            :precision="2"
            :step="1"
            :disabled="busy"
          />
        </el-form-item>
        <p class="muted">
          每天工资 = 当天时薪 × 上班时长，四舍五入到分。修改成员时薪仅用于新记录，已有记录保留原时薪。
        </p>
      </el-form>
      <template #footer>
        <el-button
          :disabled="busy"
          @click="dialog = false"
        >
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="busy"
          @click="save"
        >
          保存成员
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.member-card { display: flex; align-items: center; background: white; border: 1px solid #e4e7ed; border-radius: 10px; padding: 4px 12px; }
.member-link { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; padding: 14px 0; text-decoration: none; color: inherit; }
.member-link:focus-visible { outline: 2px solid #409eff; outline-offset: 2px; }
.avatar { display: grid; place-items: center; flex: 0 0 40px; height: 40px; border-radius: 12px; background: #ecf5ff; color: #337ecc; font-weight: 600; }
.member-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; overflow-wrap: anywhere; }
</style>
