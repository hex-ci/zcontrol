<script setup lang="ts">
/**
 * zM1 数据卡片：深色底（#3f3f3f，白字）展示全部传感器数据。
 *   PM2.5（40px 主值 + ug/m³）/ 甲醛（40px 主值 + mg/m³）
 *   温度 / 湿度（25px 次值）
 *   亮度滑块（0..4）
 *   「亮度定时」入口（带 chevron）
 */
import { computed, ref, watch } from 'vue'
import type { M1State } from '../api'
import SensorValue from './SensorValue.vue'

const props = defineProps<{ state: M1State }>()
const emit = defineEmits<{ brightnessEnd: [number], brightnessTask: [] }>()

/** 亮度 0..4，未收到数据前保持初始进度 0 */
const brightness = ref(0)
watch(
  () => props.state.brightness,
  (v) => {
    if (typeof v === 'number' && v >= 0 && v <= 4) brightness.value = v
  },
  { immediate: true },
)

/**
 * 数值格式化：主值保留一位小数（int t = value * 10，再按 t/10 与 t%10 拼接）：
 * 未收到数据时调用方给 undefined → 占位 "--.-"。
 */
function decimal(value: number | undefined, suffix: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return `--.-${suffix}`
  const t = Math.trunc(value * 10) // 取整到 0.1
  return `${Math.trunc(t / 10)}.${t % 10}${suffix}`
}

/** PM25：直接字符串化，占位 "---" */
const pm25 = computed(() =>
  typeof props.state.PM25 === 'number' ? String(props.state.PM25) : '---',
)
/** 甲醛：直接字符串化，占位 "-.--" */
const formaldehyde = computed(() =>
  typeof props.state.formaldehyde === 'number' ? String(props.state.formaldehyde) : '-.--',
)
const temperature = computed(() => decimal(props.state.temperature, '℃'))
const humidity = computed(() => decimal(props.state.humidity, '%'))

/** 拖动结束下发亮度（Vant Slider 在交互结束时 emit change） */
function onBrightnessChange(value: number | number[]) {
  if (typeof value === 'number') emit('brightnessEnd', value)
}
</script>

<template>
  <div class="mx-4 mt-3 rounded-md bg-[#3f3f3f] px-4 pt-4 pb-5 text-white shadow">
    <div class="grid grid-cols-2 gap-x-2 gap-y-4">
      <SensorValue label="PM2.5" testid="m1-pm25" :value="pm25" unit="ug/m³" />
      <SensorValue label="甲醛" testid="m1-formaldehyde" :value="formaldehyde" unit="mg/m³" />
      <SensorValue
        label="温度"
        testid="m1-temperature"
        icon="fire-o"
        size="md"
        :value="temperature"
      />
      <SensorValue
        label="湿度"
        testid="m1-humidity"
        icon="flower-o"
        size="md"
        :value="humidity"
      />
    </div>

    <!-- 亮度滑块：范围 0..4，初始 0。
         旋钮直径 20px，值为 0 时会超出轨道左端 10px，所以滑块两侧留出边距，避免压到「亮度」二字 -->
    <div class="mt-5 flex items-center gap-2">
      <span class="shrink-0 text-[13px]">亮度</span>
      <VanSlider
        v-model="brightness"
        class="mx-3.5 flex-1"
        :min="0"
        :max="4"
        :step="1"
        @change="onBrightnessChange"
      />
    </div>

    <!-- 「亮度定时」入口：点击进入亮度定时页 -->
    <div
      data-testid="m1-brightness-task"
      class="mt-4 flex cursor-pointer items-center gap-1 text-[18px] text-white"
      @click="emit('brightnessTask')"
    >
      <span>亮度定时</span>
      <VanIcon name="arrow" size="16" />
    </div>
  </div>
</template>
