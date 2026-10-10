<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../../api/client'
import { useAuthStore } from '../../stores/auth'
import SettingsTabs from './SettingsTabs.vue'

const auth = useAuthStore()
const router = useRouter()

const displayName = ref(auth.user?.display_name ?? '')
const savingName = ref(false)

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const changingPwd = ref(false)

async function saveDisplayName(): Promise<void> {
  const name = displayName.value.trim()
  if (!name) {
    ElMessage.warning('显示名不能为空')
    return
  }
  savingName.value = true
  try {
    await api.patch(`/users/${auth.user?.id}/display-name`, { display_name: name })
    ElMessage.success('显示名已更新')
    await auth.fetchMe()
    displayName.value = auth.user?.display_name ?? name
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    savingName.value = false
  }
}

async function changePassword(): Promise<void> {
  if (!oldPassword.value || !newPassword.value) {
    ElMessage.warning('请填写旧密码和新密码')
    return
  }
  if (newPassword.value !== confirmPassword.value) {
    ElMessage.warning('两次输入的新密码不一致')
    return
  }
  changingPwd.value = true
  try {
    await api.post('/auth/change-password', {
      old_password: oldPassword.value,
      new_password: newPassword.value,
    })
    ElMessage.success('密码已修改，请使用新密码重新登录')
    auth.reset()
    void router.replace('/login')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '修改失败')
  } finally {
    changingPwd.value = false
  }
}

async function logout(): Promise<void> {
  await auth.logout()
  void router.replace('/login')
}
</script>

<template>
  <div>
    <SettingsTabs active="profile" />

    <el-alert
      v-if="auth.user?.must_change_password"
      type="warning"
      :closable="false"
      title="首次登录或密码已被重置，请先修改密码后再使用其他功能"
      style="margin-bottom: 12px"
    />

    <el-card
      shadow="never"
      style="margin-bottom: 12px"
    >
      <template #header>
        账号信息
      </template>
      <div class="row-line">
        <span class="muted">用户名</span><span>{{ auth.user?.username }}</span>
      </div>
      <div class="row-line">
        <span class="muted">显示名</span>
        <div style="display: flex; gap: 8px">
          <el-input
            v-model="displayName"
            maxlength="50"
            style="width: 160px"
          />
          <el-button
            type="primary"
            :loading="savingName"
            @click="saveDisplayName"
          >
            保存
          </el-button>
        </div>
      </div>
    </el-card>

    <el-card
      shadow="never"
      style="margin-bottom: 12px"
    >
      <template #header>
        修改密码
      </template>
      <el-form
        label-position="top"
        style="max-width: 420px"
      >
        <el-form-item label="当前密码">
          <el-input
            v-model="oldPassword"
            type="password"
            show-password
          />
        </el-form-item>
        <el-form-item label="新密码（12~128 字符）">
          <el-input
            v-model="newPassword"
            type="password"
            show-password
          />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input
            v-model="confirmPassword"
            type="password"
            show-password
            @keyup.enter="changePassword"
          />
        </el-form-item>
        <el-button
          type="primary"
          :loading="changingPwd"
          @click="changePassword"
        >
          修改密码
        </el-button>
      </el-form>
    </el-card>

    <el-button @click="logout">
      退出登录
    </el-button>
  </div>
</template>
