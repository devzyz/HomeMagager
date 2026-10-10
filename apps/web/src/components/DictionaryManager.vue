<script setup lang="ts">
import { ref } from 'vue'
import { ArrowUp, ArrowDown } from '@element-plus/icons-vue'
import { api } from '../api/client'
import type { DictItem } from '../api/types'

const props = defineProps<{
  base: '/shops' | '/categories'
  label: string
  items: DictItem[]
  loading: boolean
}>()

const emit = defineEmits<{ (e: 'reload'): void }>()

const adding = ref(false)
const addName = ref('')
const busy = ref(false)
const renameTarget = ref<DictItem | null>(null)
const renameName = ref('')

async function addItem(): Promise<void> {
  const name = addName.value.trim()
  if (!name) {
    ElMessage.warning(`请输入${props.label}名称`)
    return
  }
  busy.value = true
  try {
    await api.post(props.base, { name })
    ElMessage.success(`已添加${props.label}`)
    adding.value = false
    addName.value = ''
    emit('reload')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '添加失败')
  } finally {
    busy.value = false
  }
}

async function openRename(item: DictItem): Promise<void> {
  renameTarget.value = item
  renameName.value = item.name
}

async function rename(): Promise<void> {
  if (!renameTarget.value) return
  const name = renameName.value.trim()
  if (!name) {
    ElMessage.warning(`请输入${props.label}名称`)
    return
  }
  busy.value = true
  try {
    await api.patch(`${props.base}/${renameTarget.value.id}`, { name })
    ElMessage.success('已改名')
    renameTarget.value = null
    emit('reload')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '改名失败')
  } finally {
    busy.value = false
  }
}

async function toggleActive(item: DictItem): Promise<void> {
  if (!item.is_active) {
    busy.value = true
    try {
      await api.patch(`${props.base}/${item.id}/active`, { is_active: true })
      ElMessage.success('已启用')
      emit('reload')
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : '操作失败')
    } finally {
      busy.value = false
    }
    return
  }
  try {
    await ElMessageBox.confirm(
      `停用后新增费用时不能再选择“${item.name}”，历史记录不受影响。`,
      `停用${props.label}`,
      { confirmButtonText: '停用', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  busy.value = true
  try {
    await api.patch(`${props.base}/${item.id}/active`, { is_active: false })
    ElMessage.success('已停用')
    emit('reload')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '操作失败')
  } finally {
    busy.value = false
  }
}

async function move(item: DictItem, dir: -1 | 1): Promise<void> {
  const ids = props.items.map((i) => i.id)
  const idx = ids.indexOf(item.id)
  const target = idx + dir
  if (idx < 0 || target < 0 || target >= ids.length) return
  const a = ids[idx]
  const b = ids[target]
  if (a === undefined || b === undefined) return
  ids[idx] = b
  ids[target] = a
  try {
    await api.patch(`${props.base}/sort`, { ids })
    emit('reload')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '排序失败')
  }
}
</script>

<template>
  <div>
    <el-button
      type="primary"
      style="margin-bottom: 12px"
      @click="adding = true"
    >
      新增{{ label }}
    </el-button>

    <el-empty
      v-if="!loading && items.length === 0"
      description="暂无数据"
    />
    <el-card
      v-else
      shadow="never"
      style="overflow: hidden"
    >
      <div
        v-for="(item, i) in items"
        :key="item.id"
        class="row-line"
        style="border-bottom: 1px solid #f0f2f5"
      >
        <div style="display: flex; align-items: center; gap: 6px; min-width: 0">
          <el-button-group size="small">
            <el-button
              :icon="ArrowUp"
              :disabled="i === 0 || busy"
              @click="move(item, -1)"
            />
            <el-button
              :icon="ArrowDown"
              :disabled="i === items.length - 1 || busy"
              @click="move(item, 1)"
            />
          </el-button-group>
          <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ item.name }}</span>
          <el-tag
            v-if="!item.is_active"
            size="small"
            type="info"
          >
            停用
          </el-tag>
        </div>
        <div>
          <el-button
            size="small"
            text
            type="primary"
            @click="openRename(item)"
          >
            改名
          </el-button>
          <el-button
            size="small"
            text
            :type="item.is_active ? 'danger' : 'success'"
            @click="toggleActive(item)"
          >
            {{ item.is_active ? '停用' : '启用' }}
          </el-button>
        </div>
      </div>
    </el-card>
    <p
      v-if="items.some((i) => !i.is_active)"
      class="muted"
      style="margin-top: 8px"
    >
      停用项保留在历史记录中；新增费用时不再出现。
    </p>

    <el-dialog
      v-model="adding"
      :title="`新增${label}`"
      width="92%"
      style="max-width: 420px"
    >
      <el-input
        v-model="addName"
        :placeholder="`${label}名称（1~50 字）`"
        maxlength="50"
        @keyup.enter="addItem"
      />
      <template #footer>
        <el-button @click="adding = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="busy"
          @click="addItem"
        >
          保存
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      :model-value="renameTarget !== null"
      :title="`改名${label}`"
      width="92%"
      style="max-width: 420px"
      @update:model-value="renameTarget = null"
    >
      <el-input
        v-model="renameName"
        maxlength="50"
        @keyup.enter="rename"
      />
      <template #footer>
        <el-button @click="renameTarget = null">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="busy"
          @click="rename"
        >
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
