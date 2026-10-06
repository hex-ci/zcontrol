<script setup lang="ts">
/**
 * 通用输入弹窗（名称 / 上报频率 / 手动输入固件下载地址共用）。
 */
import { ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    show: boolean;
    title: string;
    message?: string;
    placeholder?: string;
    initial?: string;
    inputType?: 'text' | 'number' | 'tel';
    confirmText?: string;
    cancelText?: string;
  }>(),
  {
    message: '',
    placeholder: '',
    initial: '',
    inputType: 'text',
    confirmText: '确定',
    cancelText: '取消',
  },
);

const emit = defineEmits<{
  'update:show': [boolean];
  confirm: [string];
  cancel: [];
}>();

const draft = ref('');

watch(
  () => props.show,
  (s) => {
    if (s) draft.value = props.initial;
  },
);
</script>

<template>
  <van-dialog
    :show="show"
    :title="title"
    show-cancel-button
    :confirm-button-text="confirmText"
    :cancel-button-text="cancelText"
    @update:show="emit('update:show', $event)"
    @confirm="emit('confirm', draft)"
    @cancel="emit('cancel')"
  >
    <div v-if="message" class="px-4 pt-2 text-sm text-gray-500">{{ message }}</div>
    <van-field
      v-model="draft"
      :type="inputType"
      :placeholder="placeholder"
      :border="false"
      class="my-2"
    />
  </van-dialog>
</template>
