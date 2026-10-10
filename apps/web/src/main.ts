import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { setUnauthorizedHandler } from './api/client'
import { useAuthStore } from './stores/auth'
// Programmatic dialogs need their complete styles before any route opens them.
import 'element-plus/es/components/message-box/style/css'
import './styles.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// 401 统一处理：清空本地登录态并跳转登录页（登录接口自身除外）
setUnauthorizedHandler(() => {
  useAuthStore().reset()
  const current = router.currentRoute.value
  if (current.path !== '/login') {
    router.push({ path: '/login', query: { redirect: current.fullPath } })
  }
})

app.mount('#app')
