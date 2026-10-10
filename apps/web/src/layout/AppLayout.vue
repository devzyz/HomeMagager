<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Odometer, List, Money, DataAnalysis, Setting } from '@element-plus/icons-vue'
import GlobalShopFilter from '../components/GlobalShopFilter.vue'

const route = useRoute()

const nav = [
  { to: '/dashboard', label: '首页', icon: Odometer },
  { to: '/expenses', label: '费用', icon: List },
  { to: '/payroll', label: '工资', icon: Money },
  { to: '/reports', label: '报表', icon: DataAnalysis },
  { to: '/settings/profile', label: '设置', icon: Setting, match: '/settings' },
]

const isNavActive = (item: (typeof nav)[number]): boolean => {
  const target = 'match' in item && item.match ? item.match : item.to
  return route.path === target || route.path.startsWith(`${target}/`)
}

const pageTitle = computed(() => (route.meta.title as string | undefined) ?? '家庭费用管理')
const showShopFilter = computed(() => route.meta.shopFilter === true)
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <span class="app-title">{{ pageTitle }}</span>
      <GlobalShopFilter v-if="showShopFilter" />
    </header>
    <main class="app-main">
      <router-view />
    </main>
    <nav class="app-nav">
      <router-link
        v-for="item in nav"
        :key="item.to"
        :to="item.to"
        class="nav-item"
        :class="{ active: isNavActive(item) }"
      >
        <el-icon><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </router-link>
    </nav>
  </div>
</template>
