<script setup lang="ts">
/**
 * zM1 设备主页面。
 *
 * 展示：
 *   PM2.5 / 甲醛 / 温度 / 湿度 / 亮度滑块 / 「亮度定时」入口 / 底部日志区
 *
 * 交互：
 *   - 拖动亮度滑块结束 → {"brightness":N}
 *   - 挂载（延迟 800ms）、MQTT 连接成功/断开、下拉刷新 → {"brightness":null}
 *   - 「亮度定时」点击 → 亮度定时页 /device/:mac/plug
 * 所有下发统一走 useDeviceStore().sendCmd（POST /api/devices/:mac/cmd），失败 showToast。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import type { DeviceDTO } from '../api'
import DeviceLogPanel from '../components/DeviceLogPanel.vue'
import M1DataCard from '../components/M1DataCard.vue'
import { useAppStore } from '../stores/app'
import { useDeviceStore } from '../stores/devices'

const props = defineProps<{ device: DeviceDTO }>()

const router = useRouter()
const app = useAppStore()
const deviceStore = useDeviceStore()

const refreshing = ref(false)
const mac = computed(() => props.device.mac)
/** 设备最新快照（后端合并 state/sensor 后的结果） */
const state = computed(() => deviceStore.stateOf(mac.value))

/** 在线状态：MQTT 未连接 → 未连接；否则按 availability 结果 在线/离线 */
const onlineText = computed(() => {
  if (!app.status?.mqtt.connected) return '未连接'
  return props.device.online ? '在线' : '离线'
})
const onlineType = computed(() =>
  onlineText.value === '在线' ? 'success' : onlineText.value === '离线' ? 'danger' : 'primary',
)

/** 统一下发入口，失败 toast 错误信息 */
async function send(cmd: Record<string, unknown>) {
  try {
    await deviceStore.sendCmd(mac.value, cmd)
  }
  catch (e) {
    showToast((e as Error).message || '发送失败')
  }
}

/** 查询亮度 */
function queryBrightness() {
  void send({ brightness: null })
}

/** 亮度滑块拖动结束，value 为进度 */
function onBrightnessEnd(value: number) {
  void send({ brightness: value })
}

/** 下拉刷新 → 查询亮度 */
function onRefresh() {
  queryBrightness()
  refreshing.value = false
}

/** 「亮度定时」入口 → /device/:mac/plug */
function goBrightnessTask() {
  router.push(`/device/${mac.value}/plug`)
}

let serviceTimer: number | undefined
onMounted(() => {
  // 挂载后延迟 800ms 查询一次
  serviceTimer = window.setTimeout(queryBrightness, 800)
})
onBeforeUnmount(() => {
  if (serviceTimer !== undefined) window.clearTimeout(serviceTimer)
})

// MQTT 连接状态变化即查询（首次快照不算变化）
watch(
  () => app.status?.mqtt.connected,
  (now, prev) => {
    if (prev === undefined || now === undefined) return
    queryBrightness()
  },
)
</script>

<template>
  <!-- 上部下拉刷新占满剩余高度，底部日志区固定高度 -->
  <div class="flex min-h-[calc(100dvh-90px)] flex-col">
    <VanPullRefresh v-model="refreshing" class="flex-1" @refresh="onRefresh">
      <div class="flex items-center justify-end px-4 pt-3">
        <VanTag :type="onlineType">{{ onlineText }}</VanTag>
      </div>

      <M1DataCard
        :state="state"
        @brightness-end="onBrightnessEnd"
        @brightness-task="goBrightnessTask"
      />
    </VanPullRefresh>

    <DeviceLogPanel class="mt-auto" :mac="mac" />
  </div>
</template>
