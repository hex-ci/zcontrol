<script setup lang="ts">
/**
 * 底部日志区（默认隐藏，点「日志」按钮展开）：
 *   展开后高 66px + 可滚动 + 13px 等宽字体。
 * 日志格式：
 *   首行 `---- yyyy/MM/dd HH:mm:ss ----`（useLogStore 的 header），
 *   之后每行 `[HH:mm:ss.sss]内容`（stamp + text）。
 * 长按日志内容弹「清除log?」确认框；展开时右上角另有清除按钮。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { showConfirmDialog } from 'vant'
import { header, stamp, useLogStore } from '../stores/log'

const props = defineProps<{ mac: string }>()

const log = useLogStore()
const scroller = ref<HTMLElement | null>(null)

/** 日志栏默认隐藏，点击折叠条才展开 */
const show = ref(false)

const lines = computed(() => log.lines(props.mac))
const headerText = computed(() => header(log.headerAt[props.mac] ?? Date.now()))

async function scrollToBottom() {
  await nextTick()
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

// 展开时滚到底部；展开后有新日志也自动滚到底
watch([show, () => lines.value.length], () => {
  if (show.value) void scrollToBottom()
})

/** 长按/按钮 → 确认框「清除log?」 */
async function clearLog() {
  try {
    await showConfirmDialog({
      title: '清除log?',
      confirmButtonText: '确认',
      cancelButtonText: '取消',
    })
    log.clear(props.mac)
  }
  catch {
    // 点了取消
  }
}

// 长按（pointer 事件在移动端等价长按，桌面端等价按住）
let pressTimer: number | undefined
function pressStart() {
  pressStop()
  pressTimer = window.setTimeout(() => {
    pressTimer = undefined
    void clearLog()
  }, 600)
}
function pressStop() {
  if (pressTimer !== undefined) {
    window.clearTimeout(pressTimer)
    pressTimer = undefined
  }
}
onBeforeUnmount(pressStop)
</script>

<template>
  <div class="border-t border-black/10 bg-white">
    <!-- 折叠条：日志内容默认隐藏 -->
    <div class="flex items-center justify-between px-2 py-1">
      <button
        type="button"
        data-testid="m1-log-toggle"
        class="flex items-center gap-1 text-xs text-gray-500"
        @click="show = !show"
      >
        <VanIcon :name="show ? 'arrow-down' : 'arrow-up'" size="12" />
        日志
      </button>
      <VanIcon
        v-if="show"
        data-testid="m1-log-clear"
        name="delete-o"
        size="16"
        class="text-gray-400"
        @click="clearLog"
      />
    </div>

    <!-- 展开后的日志内容；长按可弹菜单清 log -->
    <div
      v-if="show"
      ref="scroller"
      data-testid="m1-log"
      class="h-[66px] overflow-y-auto px-2 pb-1 font-mono text-[13px] leading-[15px] text-gray-800"
      @pointerdown="pressStart"
      @pointerup="pressStop"
      @pointerleave="pressStop"
      @pointercancel="pressStop"
      @contextmenu.prevent
    >
      <div data-testid="m1-log-header" class="whitespace-pre-wrap break-all">{{ headerText }}</div>
      <div v-for="(l, i) in lines" :key="i" class="whitespace-pre-wrap break-all">{{ stamp(l.ts) }}{{ l.text }}</div>
    </div>
  </div>
</template>
