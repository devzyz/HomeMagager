<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDictStore } from '../stores/dicts'

const route = useRoute()
const router = useRouter()
const dicts = useDictStore()

onMounted(() => {
  void dicts.ensure()
})

const current = computed<string>(() => (route.query.shop as string) || 'all')

function onChange(value: string | number | boolean | undefined | null): void {
  const v = String(value)
  const query = { ...route.query }
  if (v === 'all') delete query.shop
  else query.shop = v
  void router.replace({ query })
}
</script>

<template>
  <el-select
    :model-value="current"
    size="small"
    style="width: 150px"
    @change="onChange"
  >
    <el-option
      label="全部店铺"
      value="all"
    />
    <el-option
      v-for="s in dicts.shops"
      :key="s.id"
      :label="s.is_active ? s.name : `${s.name}（停用）`"
      :value="s.id"
    />
  </el-select>
</template>
