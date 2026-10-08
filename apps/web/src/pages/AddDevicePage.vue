<script setup lang="ts">
/**
 * 增加设备页：
 *   (a) 局域网 UDP 扫描发现：开始/停止扫描、列表勾选（已在设备列表中的排除）、确认添加
 *   (b) 手动输入：MAC 必须 12 位十六进制，名称默认 zM1_XXXX
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showSuccessToast, showToast } from 'vant';
import AppNavBar from '../components/AppNavBar.vue';
import { useAppStore } from '../stores/app';
import { useDeviceStore } from '../stores/devices';

const router = useRouter();
const app = useAppStore();
const device = useDeviceStore();

// region 局域网扫描
const selected = ref<string[]>([]);
const scanList = computed(() => app.scanDevices);
const knownMacs = computed(() => new Set(device.devices.map((d) => d.mac)));

onMounted(async () => {
  try {
    await app.refreshScan();
  } catch {
    /* 后端不可用时忽略 */
  }
});

async function toggleScan() {
  try {
    if (app.scanning) await app.stopScan();
    else await app.startScan();
  } catch (e) {
    showToast(String((e as Error).message));
  }
}

async function confirmScan() {
  const picked = scanList.value.filter(
    (d) => selected.value.includes(d.mac) && !knownMacs.value.has(d.mac),
  );
  if (!picked.length) {
    showToast('请先勾选要添加的设备');
    return;
  }
  let added = 0;
  for (const d of picked) {
    try {
      await device.add(d.name, d.mac, d.type);
      added++;
    } catch (e) {
      showToast(String((e as Error).message));
    }
  }
  try {
    await app.stopScan();
  } catch {
    /* ignore */
  }
  if (added > 0) {
    showSuccessToast('设备已添加');
    router.push('/');
  }
}
// endregion

// region 手动输入
const manualMac = ref('');
const manualName = ref('');

async function addManual() {
  const mac = manualMac.value.trim().toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(mac)) {
    showToast('MAC 格式错误,请输入 12 位十六进制 MAC 地址');
    return;
  }
  const name = manualName.value.trim() || `zM1_${mac.slice(-4).toUpperCase()}`;
  try {
    await device.add(name, mac);
    showSuccessToast('设备已添加');
    router.push('/');
  } catch (e) {
    showToast(String((e as Error).message));
  }
}
// endregion

function back() {
  router.back();
}
</script>

<template>
  <div class="flex min-h-full flex-col bg-gray-50">
    <AppNavBar title="添加设备" back @back="back" />

    <!-- (a) 局域网扫描 -->
    <van-cell-group inset class="mt-3" title="局域网扫描">
      <div class="flex items-center gap-3 px-4 py-3">
        <van-button
          size="small"
          :type="app.scanning ? 'danger' : 'primary'"
          :color="app.scanning ? undefined : '#3F51B5'"
          data-testid="scan-toggle"
          @click="toggleScan"
        >
          {{ app.scanning ? '停止扫描' : '开始扫描' }}
        </van-button>
        <span v-if="app.scanning" class="flex items-center gap-1 text-xs text-gray-500" data-testid="scan-status">
          <van-loading size="14" />正在通过 UDP 广播扫描附近设备....
        </span>
      </div>

      <van-checkbox-group v-model="selected">
        <div
          v-for="d in scanList"
          :key="d.mac"
          class="flex items-center gap-2 border-t border-gray-100 px-4 py-3"
          :data-testid="`scan-device-${d.mac}`"
        >
          <van-checkbox :name="d.mac" :disabled="knownMacs.has(d.mac)" />
          <div class="flex flex-1 flex-col">
            <span class="text-sm text-gray-800">{{ d.name }}</span>
            <span class="text-xs text-gray-400">{{ d.mac }} · {{ d.typeName }}</span>
          </div>
          <van-tag v-if="knownMacs.has(d.mac)" type="primary">已添加</van-tag>
        </div>
      </van-checkbox-group>
      <div v-if="!scanList.length" class="border-t border-gray-100 px-4 py-6 text-center text-sm text-gray-400">
        未发现设备,点击「开始扫描」
      </div>

      <div class="border-t border-gray-100 px-4 py-3">
        <van-button block type="primary" color="#3F51B5" data-testid="scan-confirm" @click="confirmScan">
          确认
        </van-button>
      </div>
    </van-cell-group>

    <!-- (b) 手动输入 -->
    <van-cell-group inset class="mt-3" title="手动输入">
      <van-field
        v-model="manualMac"
        label="MAC 地址"
        placeholder="12 位十六进制,如 aabbccddeeff"
        clearable
        data-testid="manual-mac"
      />
      <van-field
        v-model="manualName"
        label="名称"
        placeholder="留空默认 zM1_XXXX"
        clearable
        data-testid="manual-name"
      />
    </van-cell-group>
    <div class="px-4 pt-3 pb-6">
      <van-button block type="primary" color="#3F51B5" data-testid="manual-add" @click="addManual">
        添加
      </van-button>
    </div>
  </div>
</template>
