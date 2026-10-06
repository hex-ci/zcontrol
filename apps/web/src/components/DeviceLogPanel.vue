<script setup lang="ts">
/**
 * 底部日志区：高 66px + 可滚动 + 13px 等宽字体。
 * 日志格式：
 *   首行 `---- yyyy/MM/dd HH:mm:ss ----`（useLogStore 的 header），
 *   之后每行 `[HH:mm:ss.sss]内容`（stamp + text）。
 * 长按弹「清除log?」确认框（确认/取消），确认调 log.clear(mac)；
 * 右上角另给一个清除按钮（Vant 图标），方便移动端操作。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { showConfirmDialog } from 'vant';
import { header, stamp, useLogStore } from '../stores/log';

const props = defineProps<{ mac: string }>();

const log = useLogStore();
const scroller = ref<HTMLElement | null>(null);

const lines = computed(() => log.lines(props.mac));
const headerText = computed(() => header(log.headerAt[props.mac] ?? Date.now()));

async function scrollToBottom() {
  await nextTick();
  const el = scroller.value;
  if (el) el.scrollTop = el.scrollHeight;
}

// 有新日志时自动滚到底部
watch(() => lines.value.length, scrollToBottom);

/** 长按/按钮 → 确认框「清除log?」 */
async function clearLog() {
  try {
    await showConfirmDialog({
      title: '清除log?',
      confirmButtonText: '确认',
      cancelButtonText: '取消',
    });
    log.clear(props.mac);
  } catch {
    // 点了取消
  }
}

// 长按（pointer 事件在移动端等价长按，桌面端等价按住）
let pressTimer: number | undefined;
function pressStart() {
  pressStop();
  pressTimer = window.setTimeout(() => {
    pressTimer = undefined;
    void clearLog();
  }, 600);
}
function pressStop() {
  if (pressTimer !== undefined) {
    window.clearTimeout(pressTimer);
    pressTimer = undefined;
  }
}
onBeforeUnmount(pressStop);
</script>

<template>
  <!-- 高 66px 的可滚动日志区；
       长按可弹菜单清 log，另给一个清除按钮（Vant 图标） -->
  <div class="flex items-start border-t border-black/10 bg-white">
    <div
      ref="scroller"
      data-testid="m1-log"
      class="h-[66px] flex-1 overflow-y-auto px-2 py-1 font-mono text-[13px] leading-[15px] text-gray-800"
      @pointerdown="pressStart"
      @pointerup="pressStop"
      @pointerleave="pressStop"
      @pointercancel="pressStop"
      @contextmenu.prevent
    >
      <div data-testid="m1-log-header" class="whitespace-pre-wrap break-all">{{ headerText }}</div>
      <div v-for="(l, i) in lines" :key="i" class="whitespace-pre-wrap break-all">{{ stamp(l.ts) }}{{ l.text }}</div>
    </div>
    <van-icon
      data-testid="m1-log-clear"
      name="delete-o"
      size="16"
      class="m-1 shrink-0 text-gray-400"
      @click="clearLog"
    />
  </div>
</template>
