<script lang="ts">
/**
 * 时区数组（UTC 偏移文案与取值一一对应）。
 */
export const ZONE_TEXTS: string[] = [
  'UTC-12:00',
  'UTC-11:00',
  'UTC-10:00',
  'UTC-09:00',
  'UTC-08:00',
  'UTC-07:00',
  'UTC-06:00',
  'UTC-05:00',
  'UTC-04:30',
  'UTC-04:00',
  'UTC-03:30',
  'UTC-03:00',
  'UTC-02:00',
  'UTC-01:00',
  'UTC',
  'UTC+01:00',
  'UTC+02:00',
  'UTC+03:00',
  'UTC+03:30',
  'UTC+04:00',
  'UTC+04:30',
  'UTC+05:00',
  'UTC+05:30',
  'UTC+05:45',
  'UTC+06:00',
  'UTC+06:30',
  'UTC+07:00',
  'UTC+08:00',
  'UTC+09:00',
  'UTC+09:30',
  'UTC+10:00',
  'UTC+11:00',
  'UTC+12:00',
]

export const ZONE_VALUES: number[] = [
  -720, -660, -600, -540, -480, -420, -360, -300, -270, -240, -210, -180, -120, -60, 0, 60, 120,
  180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 540, 570, 600, 660, 720,
]
</script>

<script setup lang="ts">
/**
 * 时区选择器。
 * 选中后由父级负责下发 {"zone":值} 与 {"time":-1}。
 */
import { ref, watch } from 'vue'

const props = defineProps<{ show: boolean, modelValue?: number | null }>()
const emit = defineEmits<{ 'update:show': [boolean], 'confirm': [number] }>()

const columns = ZONE_TEXTS.map((text, i) => ({ text, value: ZONE_VALUES[i] }))

const picker = ref<Array<string | number>>([])

watch(
  () => props.show,
  (s) => {
    if (s) picker.value = [props.modelValue ?? 0]
  },
)

function onConfirm(payload: { selectedValues: Array<string | number> }): void {
  emit('confirm', Number(payload.selectedValues[0]))
  emit('update:show', false)
}
</script>

<template>
  <VanPopup
    :show="show"
    position="bottom"
    round
    @update:show="emit('update:show', $event)"
  >
    <VanPicker
      v-model="picker"
      :columns="columns"
      title="时区"
      @confirm="onConfirm"
      @cancel="emit('update:show', false)"
    />
  </VanPopup>
</template>
