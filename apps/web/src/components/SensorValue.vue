<script setup lang="ts">
/**
 * 单个数值区：设备数据的数值展示。
 *   PM2.5 / 甲醛 的主值为 40px 级
 *   温度 / 湿度 的次值为 25px 级，带前置图标
 * 不写自定义 CSS：字号用 Tailwind 任意值类，图标用 Vant Icon。
 */
defineProps<{
  /** 固定文案 */
  label: string
  /** 已格式化好的数值文本 */
  value: string
  /** 固定单位文案（ug/m³ / mg/m³） */
  unit?: string
  /** 前置图标（Vant icon name） */
  icon?: string
  /** lg = 40px 主值，md = 25px 次值 */
  size?: 'lg' | 'md'
  /** 测试锚点 */
  testid?: string
}>()
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex items-center gap-1 text-[13px] text-white/70">
      <VanIcon v-if="icon" :name="icon" size="14" />
      <span>{{ label }}</span>
    </div>
    <div class="flex items-baseline gap-1">
      <span
        class="leading-none font-medium text-white"
        :class="size === 'md' ? 'text-[25px]' : 'text-[40px]'"
        :data-testid="testid"
      >{{ value }}</span>
      <span v-if="unit" class="text-xs text-white/70">{{ unit }}</span>
    </div>
  </div>
</template>
