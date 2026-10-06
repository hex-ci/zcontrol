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
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import AppNavBar from '../components/AppNavBar.vue';
import DeviceDrawer from '../components/DeviceDrawer.vue';
import DeviceM1Page from './DeviceM1Page.vue';
import { useAppStore } from '../stores/app';
import { useDeviceStore } from '../stores/devices';
import { useLogStore } from '../stores/log';

const app = useAppStore();
const device = useDeviceStore();
const log = useLogStore();
const router = useRouter();
const route = useRoute();

const drawer = ref(false);
const active = ref(0);

const devices = computed(() => device.devices);
const current = computed(() => devices.value[active.value] ?? null);
const title = computed(() => current.value?.name ?? 'zControl 智能控制');

watch(
  devices,
  (list) => {
    const idx = list.findIndex((d) => d.mac === device.currentMac);
    if (idx >= 0 && idx !== active.value) active.value = idx;
    if (idx < 0 && list.length) active.value = 0;
  },
  { immediate: true },
);

watch(active, (i) => {
  const d = devices.value[i];
  if (d) device.currentMac = d.mac;
});

/** 设备文档入口 */
function openDoc() {
  const docUri = 'https://github.com/hex-ci/zcontrol/blob/main/docs/PROTOCOL.md';
  window.open(docUri, '_blank');
}

/** 云同步：把本机 MQTT 配置下发给设备 */
async function cloudSync() {
  const d = current.value;
  if (!d) return;
  const uri = app.settings?.mqtt_uri ?? '';
  if (!uri) {
    await showConfirmDialog({
      title: '未设置MQTT服务器',
      message: '继续会发送空数据,将删除固件的MQTT服务器设置!继续?',
      confirmButtonText: '继续',
      cancelButtonText: '取消',
    });
  }
  try {
    await app.syncMqtt(d.mac);
    showToast('已发送MQTT配置');
  } catch (e) {
    showToast(String((e as Error).message));
  }
}

function goDeviceSettings() {
  if (!current.value) {
    showToast('设备列表为空');
    return;
  }
  router.push(`/device/${current.value.mac}/settings`);
}

function onAdd() {
  drawer.value = false;
  router.push('/add');
}

watch(
  () => route.fullPath,
  () => {
    if (route.name === 'main') drawer.value = false;
  },
);
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

    <van-tabs v-if="devices.length" v-model:active="active" sticky class="flex-1">
      <van-tab v-for="d in devices" :key="d.mac" :title="d.name">
        <DeviceM1Page :device="d" />
      </van-tab>
    </van-tabs>

    <van-empty v-else description="还没有设备，先去「增加设备」添加">
      <van-button type="primary" size="small" class="w-32" @click="onAdd">增加设备</van-button>
    </van-empty>

    <van-popup
      v-model:show="drawer"
      position="left"
      :style="{ width: '78%', height: '100%' }"
      class="p-0!"
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
    </van-popup>
  </div>
</template>
