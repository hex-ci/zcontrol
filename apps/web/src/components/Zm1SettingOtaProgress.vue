<script setup lang="ts">
/**
 * OTA 进度弹窗：
 * 「正在更新固件,请勿断开设备电源! ... 此窗口可直接取消,不影响更新」。
 * 进行中显示「正在获取最新固件版本,请稍后....\n进度:N%」。
 */
defineProps<{ show: boolean, progress: number }>()
const emit = defineEmits<{ 'update:show': [boolean] }>()
</script>

<template>
  <VanPopup
    :show="show"
    round
    :close-on-click-overlay="false"
    class="w-[82%] overflow-hidden"
    @update:show="emit('update:show', $event)"
  >
    <div class="whitespace-pre-line px-5 pt-6 pb-4 text-center text-sm leading-7 text-gray-700">
      {{ '正在获取最新固件版本,请稍后....\n' + '进度: ' + progress + '%' }}
    </div>
    <div class="border-t border-gray-100">
      <VanButton
        block
        plain
        type="primary"
        class="h-12! border-0!"
        @click="emit('update:show', false)"
      >
        取消
      </VanButton>
    </div>
  </VanPopup>
</template>
