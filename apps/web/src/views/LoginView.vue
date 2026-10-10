<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const username = ref('')
const password = ref('')
const loading = ref(false)

async function submit(): Promise<void> {
  if (!username.value.trim() || !password.value) {
    ElMessage.warning('请输入用户名和密码')
    return
  }
  loading.value = true
  try {
    await auth.login(username.value.trim(), password.value)
    const redirect = route.query.redirect
    if (auth.user?.must_change_password) {
      void router.replace('/settings/profile')
    } else if (typeof redirect === 'string' && redirect.startsWith('/')) {
      void router.replace(redirect)
    } else {
      void router.replace('/dashboard')
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <h2 class="login-title">
        家庭费用管理
      </h2>
      <p
        class="muted"
        style="text-align: center; margin-top: 0"
      >
        记录每一家店铺的每一笔费用
      </p>
      <el-form
        label-position="top"
        @submit.prevent="submit"
      >
        <el-form-item label="用户名">
          <el-input
            v-model="username"
            placeholder="用户名"
            size="large"
            autocomplete="username"
          />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="password"
            type="password"
            placeholder="密码"
            size="large"
            show-password
            autocomplete="current-password"
          />
        </el-form-item>
        <el-button
          type="primary"
          size="large"
          class="full-width"
          :loading="loading"
          native-type="submit"
          style="margin-top: 4px"
        >
          登录
        </el-button>
      </el-form>
      <p
        class="muted"
        style="text-align: center; margin-bottom: 0"
      >
        <a href="/about">应用介绍</a> · <a href="/privacy">隐私政策</a>
      </p>
    </el-card>
  </div>
</template>

<style scoped>
.login-wrap {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.login-card {
  width: 100%;
  max-width: 360px;
}

.login-title {
  text-align: center;
  margin: 4px 0 8px;
}
</style>
