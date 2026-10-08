<script setup lang="ts">
/**
 * 弹窗：设置定时任务
 *
 * 控件：「设置定时任务」标题 / 时(0-23, %02d) / 分(0-59, %02d)
 *       / 亮度选择（显示值「关闭」,「1」,「2」,「3」,「4」→ brightness 0-4）
 *       / 「重复:每天」（M1 不使用 repeat 字段，仅静态文案，不入报文）
 *       / 「确认」按钮
 *
 * 确认后由父组件下发：{"task_{index}":{"hour":h,"minute":m,"brightness":action,"on":1}}
 */
import { computed, ref, watch } from 'vue'
import type { Zm1Task } from '../api'

const props = defineProps<{
  /** 是否显示 */
  show: boolean
  /** 当前行任务；未获取到为 null（用 TaskItem 初值兜底） */
  task: Zm1Task | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  'confirm': [payload: { hour: number, minute: number, brightness: number }]
}>()

const show = computed({
  get: () => props.show,
  set: (v: boolean) => emit('update:show', v),
})

/** 动作选项 {"关闭", "1", "2", "3", "4"}，取值 0-4 */
const actionColumns = [
  { text: '关闭', value: 0 },
  { text: '1', value: 1 },
  { text: '2', value: 2 },
  { text: '3', value: 3 },
  { text: '4', value: 4 },
]

const pad = (n: number) => String(n).padStart(2, '0')

const time = ref<string[]>(['00', '00'])
const action = ref<number[]>([4])

watch(
  show,
  (visible) => {
    if (!visible) return
    // 初值：hour=0 / minute=0 / action=4
    time.value = [pad(props.task?.hour ?? 0), pad(props.task?.minute ?? 0)]
    action.value = [props.task?.brightness ?? 4]
  },
  { immediate: true },
)

function onConfirm() {
  emit('confirm', {
    hour: Number(time.value[0] ?? 0),
    minute: Number(time.value[1] ?? 0),
    brightness: Number(action.value[0] ?? 0),
  })
  show.value = false
}
</script>

<template>
  <VanPopup v-model:show="show" position="center" round class="w-[85vw] max-w-[340px]">
    <div class="px-4 pb-6 pt-5">
      <div class="mb-2 text-center text-[22px] font-medium">设置定时任务</div>

      <div class="flex items-stretch justify-center gap-1">
        <VanTimePicker
          v-model="time"
          :columns-type="['hour', 'minute']"
          :show-toolbar="false"
          :visible-option-num="5"
          :option-height="40"
          class="flex-1"
        />
        <VanPicker
          v-model="action"
          :columns="actionColumns"
          :show-toolbar="false"
          :visible-option-num="5"
          :option-height="40"
          class="w-[72px]"
        />
      </div>

      <div class="py-3 text-center text-[14px] text-gray-500">重复:每天</div>

      <VanButton type="primary" color="#3F51B5" block @click="onConfirm">确认</VanButton>
    </div>
  </VanPopup>
</template>
