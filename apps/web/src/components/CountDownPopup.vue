<script setup lang="ts">
/**
 * 弹窗：设置倒计时时间
 *
 * 控件：「设置倒计时时间」标题 / 「注意:倒计时占用最后一组定时任务」提示
 *       / 时(0-23, %02d, 默认 1) / 分(0-59, %02d, 默认 0)
 *       / 亮度选择（显示值「关闭」,「1」..「4」，默认 0） / 「确认」按钮
 *
 * 固定占用最后一组定时任务 task_4；确认时以「当前时间 + 时/分偏移」算出最终时间。
 */
import { computed, ref, watch } from 'vue';

const props = defineProps<{ show: boolean }>();

const emit = defineEmits<{
  'update:show': [value: boolean];
  confirm: [payload: { hour: number; minute: number; brightness: number }];
}>();

const show = computed({
  get: () => props.show,
  set: (v: boolean) => emit('update:show', v),
});

const actionColumns = [
  { text: '关闭', value: 0 },
  { text: '1', value: 1 },
  { text: '2', value: 2 },
  { text: '3', value: 3 },
  { text: '4', value: 4 },
];

const time = ref<string[]>(['01', '00']);
const action = ref<number[]>([0]);

watch(show, (visible) => {
  if (!visible) return;
  time.value = ['01', '00'];
  action.value = [0];
});

function onConfirm() {
  const hours = Number(time.value[0] ?? 0);
  const minutes = Number(time.value[1] ?? 0);
  const brightness = Number(action.value[0] ?? 0);

  const target = new Date();
  target.setHours(target.getHours() + hours);
  target.setMinutes(target.getMinutes() + minutes);

  emit('confirm', {
    hour: target.getHours(),
    minute: target.getMinutes(),
    brightness,
  });
  show.value = false;
}
</script>

<template>
  <van-popup v-model:show="show" position="center" round class="w-[85vw] max-w-[340px]">
    <div class="px-4 pb-6 pt-5">
      <div class="text-center text-[22px] font-medium">设置倒计时时间</div>
      <div class="mt-1 text-center text-[12px] text-gray-500">
        注意:倒计时占用最后一组定时任务
      </div>

      <div class="mt-3 flex items-stretch justify-center gap-1">
        <van-time-picker
          v-model="time"
          :columns-type="['hour', 'minute']"
          :show-toolbar="false"
          :visible-option-num="5"
          :option-height="40"
          class="flex-1"
        />
        <van-picker
          v-model="action"
          :columns="actionColumns"
          :show-toolbar="false"
          :visible-option-num="5"
          :option-height="40"
          class="w-[72px]"
        />
      </div>

      <div class="pt-4">
        <van-button type="primary" color="#3F51B5" block @click="onConfirm">确认</van-button>
      </div>
    </div>
  </van-popup>
</template>
