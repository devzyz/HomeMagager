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
    <SettingsTabs active="shops" />
    <DictionaryManager
      base="/shops"
      label="店铺"
      :items="dicts.shops"
      :loading="dicts.loading"
      @reload="dicts.reload()"
    />
  </div>
</template>
