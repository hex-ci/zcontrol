<script setup lang="ts">
/**
 * 主界面外壳：
 *   抽屉（DeviceDrawer.vue）
 *   ├─ 顶部工具栏（标题=当前设备名，菜单：设备文档 / 云同步 / 设备设置）
 *   ├─ 设备页签
 *   └─ 每个页签内是一个设备页面（DeviceM1Page.vue）
 *
 * 侧滑：抽屉按钮 + 边缘滑动打开。
 */
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showConfirmDialog, showDialog, showToast } from 'vant'
import AppNavBar from '../components/AppNavBar.vue'
import DeviceDrawer from '../components/DeviceDrawer.vue'
import DeviceM1Page from './DeviceM1Page.vue'
import { useAppStore } from '../stores/app'
import { useDeviceStore } from '../stores/devices'
import { useLogStore } from '../stores/log'
import { onMqttSyncAck } from '../composables/mqttSyncAck'

const app = useAppStore()
const device = useDeviceStore()
const log = useLogStore()
const router = useRouter()
const route = useRoute()

const drawer = ref(false)
const active = ref(0)

const devices = computed(() => device.devices)
const current = computed(() => devices.value[active.value] ?? null)
const title = computed(() => current.value?.name ?? 'zControl 智能控制')

watch(
  devices,
  (list) => {
    const idx = list.findIndex(d => d.mac === device.currentMac)
    if (idx >= 0 && idx !== active.value) active.value = idx
    if (idx < 0 && list.length) active.value = 0
  },
  { immediate: true },
)

watch(active, (i) => {
  const d = devices.value[i]
  if (d) device.currentMac = d.mac
})

/** 设备文档入口 */
function openDoc() {
  const docUri = 'https://github.com/hex-ci/zcontrol/blob/main/docs/PROTOCOL.md'
  window.open(docUri, '_blank')
}

/** 云同步：把本机 MQTT 配置下发给设备（UDP 广播）+ 等设备回包确认 */
const ACK_TIMEOUT_MS = 3000
const MAX_SYNC_TRIES = 3

/**
 * 等设备回报 MQTT 配置（回包确认）。
 * 广播/设备都可能漏包，所以发送后等一小会儿；超时返回 false，由调用方提示重发。
 */
function waitForMqttAck(mac: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const off = onMqttSyncAck((ack) => {
      if (settled || ack.mac !== mac) return
      settled = true
      off()
      window.clearTimeout(timer)
      resolve(true)
    })
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      off()
      resolve(false)
    }, timeoutMs)
  })
}

async function cloudSync() {
  const d = current.value
  if (!d) {
    // 对齐原版：设备列表为空时弹框提示，而不是静默返回
    await showDialog({
      title: '设备列表为空',
      message: '请先添加设备',
      confirmButtonText: '确定',
    })
    return
  }
  const uri = app.settings?.mqtt_uri ?? ''
  if (!uri) {
    await showConfirmDialog({
      title: '未设置 MQTT 服务器',
      message: '继续会发送空数据,将删除固件的 MQTT 服务器设置!继续?',
      confirmButtonText: '继续',
      cancelButtonText: '取消',
    })
  }

  try {
    for (let attempt = 1; attempt <= MAX_SYNC_TRIES; attempt++) {
      await app.syncMqtt(d.mac)
      showToast(
        attempt === 1
          ? `已发送 MQTT 配置到 "${d.name}"`
          : `已重发(${attempt})到 "${d.name}"`,
      )

      // 收到回包时 mqttSyncAck 会弹「已设置...mqtt服务器」，这里就不用再提示了
      if (await waitForMqttAck(d.mac, ACK_TIMEOUT_MS)) return

      if (attempt === MAX_SYNC_TRIES) {
        await showDialog({
          title: '未收到设备回包',
          message:
            `已向 "${d.name}" 下发 ${attempt} 次 MQTT 配置，但都没等到设备回包。\n`
            + '可能原因：广播丢包、设备正忙、或设备与本机不在同一网段。\n'
            + '可稍后在「设备设置 → 设备 MQTT 服务器」查看设备上的实际配置。',
          confirmButtonText: '知道了',
        })
        return
      }

      try {
        await showConfirmDialog({
          title: '未收到设备回包',
          message:
            `已向 "${d.name}" 下发 MQTT 配置，但 ${ACK_TIMEOUT_MS / 1000} 秒内没等到设备回包。\n`
            + '多半是广播丢包或设备没吃到这一包，点「重发」再试一次。',
          confirmButtonText: '重发',
          cancelButtonText: '取消',
        })
      }
      catch {
        return // 用户取消重发
      }
    }
  }
  catch (e) {
    showToast(String((e as Error).message))
  }
}

function goDeviceSettings() {
  if (!current.value) {
    showToast('设备列表为空')
    return
  }
  router.push(`/device/${current.value.mac}/settings`)
}

function onAdd() {
  drawer.value = false
  router.push('/add')
}

watch(
  () => route.fullPath,
  () => {
    if (route.name === 'main') drawer.value = false
  },
)
</script>

<template>
  <div class="flex min-h-full flex-col">
    <AppNavBar
      :title="title"
      menu
      doc
      sync
      edit
      @menu="drawer = true"
      @doc="openDoc"
      @sync="cloudSync"
      @edit="goDeviceSettings"
    />

    <VanTabs v-if="devices.length" v-model:active="active" sticky class="flex-1">
      <VanTab v-for="d in devices" :key="d.mac" :title="d.name">
        <DeviceM1Page :device="d" />
      </VanTab>
    </VanTabs>

    <VanEmpty v-else description="还没有设备，先去「增加设备」添加">
      <VanButton type="primary" size="small" class="w-32" @click="onAdd">增加设备</VanButton>
    </VanEmpty>

    <!-- 抽屉与蒙层：两者都常驻渲染，只用 opacity / transform 做动画。
         用 Vant Popup 时面板关闭态是 display:none，打开瞬间浏览器要重新布局绘制整棵子树，
         这段时间只有蒙层在动（CPU 慢时实测差 ~170ms），所以改成常驻绘制、纯 transform 平移 -->
    <div
      data-testid="drawer-overlay"
      class="fixed inset-0 z-[2000] bg-black/70 transition-opacity duration-300"
      :class="drawer ? 'opacity-100' : 'pointer-events-none opacity-0'"
      @click="drawer = false"
    ></div>
    <aside
      data-testid="drawer-panel"
      class="fixed inset-y-0 left-0 z-[2001] w-[78%] bg-white shadow-xl transition-transform duration-300"
      :class="drawer ? 'translate-x-0' : '-translate-x-full'"
      :aria-hidden="drawer ? 'false' : 'true'"
    >
      <DeviceDrawer
        :active-mac="current?.mac ?? ''"
        @pick="
          (mac: string) => {
            const i = devices.findIndex((d) => d.mac === mac);
            if (i >= 0) active = i;
            drawer = false;
          }
        "
        @add="onAdd"
        @settings="
          () => {
            drawer = false;
            router.push('/settings');
          }
        "
        @about="
          () => {
            drawer = false;
            router.push('/about');
          }
        "
        @sort="
          () => {
            drawer = false;
            router.push('/sort');
          }
        "
        @remove="
          async (mac: string) => {
            await device.remove(mac);
            log.clear(mac);
          }
        "
      />
    </aside>
  </div>
</template>
