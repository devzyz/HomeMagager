<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../../api/client'
import { useAuthStore } from '../../stores/auth'
import type { AuthUser } from '../../api/types'
import SettingsTabs from './SettingsTabs.vue'

const auth = useAuthStore()
const users = ref<AuthUser[]>([])
const loading = ref(false)

const creating = ref(false)
const createForm = ref({ username: '', display_name: '', password: '', operator_password: '' })
const resetting = ref<AuthUser | null>(null)
const resetForm = ref({ new_password: '', operator_password: '' })
const busy = ref(false)

async function reload(): Promise<void> {
  loading.value = true
  try {
    const r = await api.get<{ items: AuthUser[] }>('/users')
    users.value = r.items
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(reload)

async function createUser(): Promise<void> {
  const f = createForm.value
  if (!f.username || !f.display_name.trim() || !f.password || !f.operator_password) {
    ElMessage.warning('请填写全部字段')
    return
  }
  busy.value = true
  try {
    await api.post('/users', f)
    ElMessage.success('成员已创建，对方首次登录需修改密码')
    creating.value = false
    createForm.value = { username: '', display_name: '', password: '', operator_password: '' }
    await reload()
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '创建失败')
  } finally {
    busy.value = false
  }
}

async function toggleActive(user: AuthUser): Promise<void> {
  if (user.id === auth.user?.id) {
    ElMessage.warning('不能停用当前登录的账号')
    return
  }
  if (!user.is_active) {
    await withOperatorPassword(`启用 ${user.display_name}`, async (pwd) => {
      await api.patch(`/users/${user.id}/active`, { is_active: true, operator_password: pwd })
      ElMessage.success('已启用')
      await reload()
    })
    return
  }
  try {
    await ElMessageBox.confirm(
      `停用后 ${user.display_name} 将无法登录，其现有登录立即失效。`,
      '停用成员',
      { confirmButtonText: '继续', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  await withOperatorPassword(`停用 ${user.display_name}`, async (pwd) => {
    await api.patch(`/users/${user.id}/active`, { is_active: false, operator_password: pwd })
    ElMessage.success('已停用')
    await reload()
  })
}

/** 操作者密码确认框：所有敏感成员操作共用 */
async function withOperatorPassword(title: string, action: (pwd: string) => Promise<void>): Promise<void> {
  try {
    const { value } = await ElMessageBox.prompt('请输入你的登录密码以确认操作', title, {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      inputType: 'password',
      inputValidator: (v: string) => (v ? true : '请输入密码'),
    })
    busy.value = true
    await action(value)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!/cancel|close/i.test(msg)) ElMessage.error(msg)
  } finally {
    busy.value = false
  }
}

async function resetPassword(): Promise<void> {
  if (!resetting.value) return
  const f = resetForm.value
  if (!f.new_password || !f.operator_password) {
    ElMessage.warning('请填写全部字段')
    return
  }
  busy.value = true
  try {
    await api.post(`/users/${resetting.value.id}/reset-password`, f)
    ElMessage.success('密码已重置，对方需重新登录并修改密码')
    resetting.value = null
    resetForm.value = { new_password: '', operator_password: '' }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '重置失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div>
    <SettingsTabs active="users" />
    <el-button
      type="primary"
      style="margin-bottom: 12px"
      @click="creating = true"
    >
      新增成员
    </el-button>

    <el-empty
      v-if="!loading && users.length === 0"
      description="暂无成员"
    />
    <el-card
      v-else
      shadow="never"
      style="overflow: hidden"
    >
      <div
        v-for="u in users"
        :key="u.id"
        class="row-line"
        style="border-bottom: 1px solid #f0f2f5"
      >
        <div style="min-width: 0">
          <div style="display: flex; align-items: center; gap: 6px">
            <span style="font-weight: 600">{{ u.display_name }}</span>
            <el-tag
              size="small"
              type="info"
            >
              {{ u.username }}
            </el-tag>
            <el-tag
              v-if="!u.is_active"
              size="small"
              type="danger"
            >
              停用
            </el-tag>
            <el-tag
              v-if="u.id === auth.user?.id"
              size="small"
            >
              我
            </el-tag>
          </div>
          <div
            v-if="u.must_change_password"
            class="muted"
          >
            待修改初始密码
          </div>
        </div>
        <div>
          <el-button
            size="small"
            text
            type="primary"
            :disabled="u.id === auth.user?.id"
            @click="resetting = u"
          >
            重置密码
          </el-button>
          <el-button
            size="small"
            text
            :type="u.is_active ? 'danger' : 'success'"
            :disabled="u.id === auth.user?.id"
            @click="toggleActive(u)"
          >
            {{ u.is_active ? '停用' : '启用' }}
          </el-button>
        </div>
      </div>
    </el-card>

    <el-dialog
      v-model="creating"
      title="新增成员"
      width="92%"
      style="max-width: 420px"
    >
      <el-form label-position="top">
        <el-form-item label="用户名（3~32 位小写字母/数字/_/-）">
          <el-input
            v-model="createForm.username"
            maxlength="32"
          />
        </el-form-item>
        <el-form-item label="显示名">
          <el-input
            v-model="createForm.display_name"
            maxlength="50"
          />
        </el-form-item>
        <el-form-item label="初始密码（12~128 字符）">
          <el-input
            v-model="createForm.password"
            type="password"
            show-password
          />
        </el-form-item>
        <el-form-item label="你的登录密码（确认操作）">
          <el-input
            v-model="createForm.operator_password"
            type="password"
            show-password
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="creating = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="busy"
          @click="createUser"
        >
          创建
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      :model-value="resetting !== null"
      title="重置密码"
      width="92%"
      style="max-width: 420px"
      @update:model-value="resetting = null"
    >
      <p
        class="muted"
        style="margin-top: 0"
      >
        为 {{ resetting?.display_name }} 设置新密码（12~128 字符），重置后其所有登录立即失效。
      </p>
      <el-form label-position="top">
        <el-form-item label="新密码">
          <el-input
            v-model="resetForm.new_password"
            type="password"
            show-password
          />
        </el-form-item>
        <el-form-item label="你的登录密码（确认操作）">
          <el-input
            v-model="resetForm.operator_password"
            type="password"
            show-password
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="resetting = null">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="busy"
          @click="resetPassword"
        >
          重置
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
