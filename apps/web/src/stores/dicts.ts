import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { api } from '../api/client'
import type { DictItem } from '../api/types'

/** 店铺/类别字典的全局缓存；费用录入、筛选、报表都会用到 */
export const useDictStore = defineStore('dicts', () => {
  const shops = ref<DictItem[]>([])
  const categories = ref<DictItem[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  let loadPromise: Promise<void> | null = null

  async function reload(): Promise<void> {
    loading.value = true
    try {
      const [sh, ca] = await Promise.all([
        api.get<{ items: DictItem[] }>('/shops'),
        api.get<{ items: DictItem[] }>('/categories'),
      ])
      shops.value = sh.items
      categories.value = ca.items
      loaded.value = true
    } finally {
      loading.value = false
      loadPromise = null
    }
  }

  async function ensure(): Promise<void> {
    if (loaded.value) return
    if (!loadPromise) loadPromise = reload()
    await loadPromise
  }

  const activeShops = computed(() => shops.value.filter((s) => s.is_active))
  const activeCategories = computed(() => categories.value.filter((c) => c.is_active))

  function shopName(id: string): string {
    return shops.value.find((s) => s.id === id)?.name ?? '未知店铺'
  }
  function categoryName(id: string): string {
    return categories.value.find((c) => c.id === id)?.name ?? '未知类别'
  }

  return { shops, categories, activeShops, activeCategories, loaded, loading, ensure, reload, shopName, categoryName }
})
