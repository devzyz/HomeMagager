import { ref } from 'vue'
import { defineStore } from 'pinia'
import { api, setCsrfToken } from '../api/client'
import type { AuthUser } from '../api/types'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const ready = ref(false)

  async function fetchMe(): Promise<void> {
    try {
      const r = await api.get<{ user: AuthUser; csrf_token: string }>('/auth/me')
      user.value = r.user
      setCsrfToken(r.csrf_token)
    } catch {
      user.value = null
      setCsrfToken('')
    } finally {
      ready.value = true
    }
  }

  async function login(username: string, password: string): Promise<void> {
    const r = await api.post<{ user: AuthUser; csrf_token: string }>('/auth/login', { username, password })
    user.value = r.user
    setCsrfToken(r.csrf_token)
  }

  async function logout(): Promise<void> {
    try {
      await api.post('/auth/logout')
    } finally {
      reset()
    }
  }

  function reset(): void {
    user.value = null
    setCsrfToken('')
  }

  return { user, ready, fetchMe, login, logout, reset }
})
