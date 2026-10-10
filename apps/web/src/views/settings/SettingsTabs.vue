<script setup lang="ts">
import { useRouter } from 'vue-router'

defineProps<{ active: 'shops' | 'categories' | 'users' | 'backup' | 'profile' }>()

const router = useRouter()

const tabs: { name: 'shops' | 'categories' | 'users' | 'backup' | 'profile'; label: string; path: string }[] = [
  { name: 'shops', label: '店铺', path: '/settings/shops' },
  { name: 'categories', label: '类别', path: '/settings/categories' },
  { name: 'users', label: '成员', path: '/settings/users' },
  { name: 'backup', label: '备份', path: '/settings/backup' },
  { name: 'profile', label: '资料', path: '/settings/profile' },
]

function onChange(name: string | number | boolean | undefined | null): void {
  const tab = tabs.find((t) => t.name === name)
  if (tab) void router.push(tab.path)
}
</script>

<template>
  <el-tabs
    :model-value="active"
    style="margin-bottom: 12px"
    @tab-change="onChange"
  >
    <el-tab-pane
      v-for="t in tabs"
      :key="t.name"
      :label="t.label"
      :name="t.name"
    />
  </el-tabs>
</template>
