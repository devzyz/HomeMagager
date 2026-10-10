<script setup lang="ts">
import { onMounted } from 'vue'
import { useDictStore } from '../../stores/dicts'
import DictionaryManager from '../../components/DictionaryManager.vue'
import SettingsTabs from './SettingsTabs.vue'

const dicts = useDictStore()

onMounted(() => {
  void dicts.reload()
})
</script>

<template>
  <div>
    <SettingsTabs active="categories" />
    <DictionaryManager
      base="/categories"
      label="类别"
      :items="dicts.categories"
      :loading="dicts.loading"
      @reload="dicts.reload()"
    />
  </div>
</template>
