<script setup lang="ts">
/**
 * 应用设置页：
 *   MQTT地址(mqtt_uri，只填地址时自动补 :1883，格式非法 Toast) / 用户名 / 密码(脱敏) / ClientID
 *   + 设备导入导出（剪贴板/文件）
 *   + 显示 MQTT 连接状态与 UDP 监听状态（useAppStore().status）
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { showDialog, showToast } from 'vant';
import AppNavBar from '../components/AppNavBar.vue';
import type { AppSettings } from '../api';
import { useAppStore } from '../stores/app';
import { useDeviceStore } from '../stores/devices';

const router = useRouter();
const app = useAppStore();
const device = useDeviceStore();

const mqttUri = ref('');
const mqttUser = ref('');
const mqttPassword = ref('');
const mqttClientId = ref('');
const mqttPasswordSet = ref(false);
const touched = ref(false);
const saving = ref(false);

const mqtt = computed(() => app.status?.mqtt ?? null);
const udp = computed(() => app.status?.udp ?? null);
const mqttState = computed(() =>
  app.status ? (app.status.mqtt.connected ? '已连接' : '未连接') : '未知',
);
const udpState = computed(() =>
  app.status
    ? app.status.udp.listening
      ? `监听中(端口 ${app.status.udp.port})`
      : '未监听'
    : '未知',
);

function fill() {
  const s = app.settings;
  if (!s || touched.value) return;
  mqttUri.value = s.mqtt_uri ?? '';
  mqttUser.value = s.mqtt_user ?? '';
  mqttClientId.value = s.mqtt_clientid ?? '';
  mqttPasswordSet.value = !!s.mqtt_password_set;
}

onMounted(async () => {
  if (!app.settings) {
    try {
      await app.loadSettings();
    } catch {
      /* 后端不可用时忽略 */
    }
  }
  fill();
});

watch(() => app.settings, fill);

/** mqtt_uri 校验：地址合法才保存；非法弹 Toast */
function normalizeMqttUri(raw: string): { ok: boolean; value: string } {
  const str = raw.trim();
  if (str.length === 0) return { ok: true, value: '' };
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/;
  const dottedHost = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
  const parts = str.split(':');
  if (parts.length === 1) {
    // 只填地址：必须像 IP 或域名，自动补 :1883
    if (ipv4.test(str) || dottedHost.test(str)) return { ok: true, value: `${str}:1883` };
    return { ok: false, value: str };
  }
  if (parts.length === 2) {
    const [host, portStr] = parts;
    const port = Number(portStr);
    if (/^[A-Za-z0-9._-]+$/.test(host) && Number.isInteger(port) && port > 0 && port <= 65535)
      return { ok: true, value: str };
  }
  return { ok: false, value: str };
}

async function save() {
  const r = normalizeMqttUri(mqttUri.value);
  if (!r.ok) {
    showToast('保存失败!格式错误.\n格式:地址:端口\n如192.168.1.1:1883');
    return;
  }
  const clientChanged = mqttClientId.value.trim() !== (app.settings?.mqtt_clientid ?? '');
  const body: Partial<AppSettings> & { mqtt_password?: string } = {
    mqtt_uri: r.value,
    mqtt_user: mqttUser.value,
    mqtt_clientid: mqttClientId.value,
  };
  if (mqttPassword.value.length > 0) body.mqtt_password = mqttPassword.value;

  saving.value = true;
  try {
    await app.saveSettings(body);
    mqttUri.value = r.value;
    mqttPassword.value = '';
    if (clientChanged) {
      showToast('注意:同个MQTT服务器内,ClientID必须唯一,否则将导致设备掉线');
    } else {
      showToast('已保存');
    }
  } catch (e) {
    showToast(String((e as Error).message));
  } finally {
    saving.value = false;
  }
}

// region 设备导出 / 导入
const exportText = ref('');
const importText = ref('');
const importing = ref(false);

async function doExport() {
  try {
    const r = await device.exportDevices();
    exportText.value = JSON.stringify(r, null, 2);
    let copied = false;
    try {
      await navigator.clipboard.writeText(exportText.value);
      copied = true;
    } catch {
      /* 无剪贴板权限时忽略，仍可在下方文本框复制 */
    }
    showToast(copied ? '已经导出到剪贴板中!' : '导出完成,可在下方复制');
  } catch (e) {
    showToast(`设置剪贴板错误,请确认剪贴板权限! ${String((e as Error).message)}`);
  }
}

function downloadExport() {
  if (!exportText.value) return;
  const blob = new Blob([exportText.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'devices.json';
  a.click();
  URL.revokeObjectURL(url);
}

function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    importText.value = String(reader.result ?? '');
  };
  reader.readAsText(file);
}

/** 设备导入的提示文案 */
async function doImport() {
  let parsed: unknown;
  try {
    parsed = JSON.parse(importText.value);
  } catch {
    showDialog({ title: '导入失败', message: 'json格数错误!请确认导入内容格式正确!' });
    return;
  }
  const arr = (parsed as { device?: unknown })?.device;
  if (!Array.isArray(arr)) {
    showDialog({ title: '导入失败', message: 'json格数错误!请确认导入内容格式正确!' });
    return;
  }
  const list: { name: string; mac: string; type: number }[] = [];
  for (const it of arr as { name?: unknown; mac?: unknown; type?: unknown }[]) {
    const name = it?.name;
    const mac = it?.mac;
    const type = it?.type;
    if (typeof name !== 'string' || typeof mac !== 'string' || typeof type !== 'number') continue;
    if (!/^[0-9a-fA-F]{12}$/.test(mac)) continue;
    list.push({ name, mac: mac.toLowerCase(), type });
  }
  if (!list.length) {
    showDialog({ title: '导入失败', message: '未检测到有效设备!' });
    return;
  }
  importing.value = true;
  try {
    const r = await device.importDevices(list);
    if (r.total === 0) {
      showDialog({ title: '导入失败', message: '未检测到有效设备!' });
    } else if (r.added === 0) {
      showDialog({ title: '导入设备重复!', message: `导入设备${r.total}个,无新设备!` });
    } else {
      showDialog({
        title: '导入设备成功!',
        message: `导入设备${r.total}个,重复设备${r.dup}个\n实际导入设备${r.added}个`,
      });
    }
    importText.value = '';
  } catch (e) {
    showDialog({ title: '导入失败', message: String((e as Error).message) });
  } finally {
    importing.value = false;
  }
}
// endregion

function back() {
  router.back();
}
</script>

<template>
  <div class="flex min-h-full flex-col bg-gray-50">
    <AppNavBar title="设置" back @back="back" />

    <!-- 连接状态 -->
    <van-cell-group inset class="mt-3" title="连接状态">
      <van-cell title="MQTT连接" :value="mqttState" :label="mqtt?.uri || '未设置服务器'" data-testid="mqtt-state" />
      <van-cell title="UDP监听" :value="udpState" data-testid="udp-state" />
    </van-cell-group>

    <!-- MQTT服务器设置（res/xml/setting.xml） -->
    <van-cell-group inset class="mt-3" title="MQTT服务器设置">
      <van-field
        v-model="mqttUri"
        label="MQTT地址"
        placeholder="192.168.1.1:1883"
        clearable
        @update:model-value="touched = true"
      />
      <van-field
        v-model="mqttUser"
        label="MQTT登录用户名"
        placeholder="用户名"
        clearable
        @update:model-value="touched = true"
      />
      <van-field
        v-model="mqttPassword"
        type="password"
        label="MQTT登录密码"
        :placeholder="mqttPasswordSet ? '已设置(留空表示不修改)' : '未设置'"
        clearable
        @update:model-value="touched = true"
      />
      <van-field
        v-model="mqttClientId"
        label="MQTT Client ID"
        placeholder="不填时随机生成"
        clearable
        @update:model-value="touched = true"
      />
    </van-cell-group>
    <p class="px-5 pt-1 text-xs text-gray-400">
      MQTT服务器地址,格式必须为 地址:端口<br />如192.168.1.1:1883
    </p>
    <div class="px-4 pt-3">
      <van-button
        type="primary"
        block
        :loading="saving"
        data-testid="save-mqtt"
        color="#3F51B5"
        @click="save"
      >
        保存
      </van-button>
    </div>

    <!-- 导入导出设备 -->
    <van-cell-group inset class="mt-4" title="导入导出设备">
      <van-cell title="导出设备" value="导出设备到剪贴板" is-link @click="doExport" />
      <van-cell title="导入设备" value="从剪贴板导入设备" is-link @click="doImport" />
    </van-cell-group>

    <div class="mt-3 px-4">
      <van-field
        v-model="exportText"
        rows="3"
        autosize
        type="textarea"
        label="导出结果"
        placeholder="点击上方「导出设备」后,JSON 显示在此"
      />
      <div class="mt-2 flex gap-2">
        <van-button size="small" data-testid="export-copy" @click="doExport">复制到剪贴板</van-button>
        <van-button size="small" data-testid="export-download" @click="downloadExport">
          下载 JSON
        </van-button>
      </div>
    </div>

    <div class="mt-4 px-4 pb-6">
      <van-field
        v-model="importText"
        rows="3"
        autosize
        type="textarea"
        label="导入内容"
        placeholder="粘贴导出的 JSON"
        data-testid="import-text"
      />
      <div class="mt-2 flex items-center gap-2">
        <van-button size="small" type="primary" :loading="importing" data-testid="import-run" @click="doImport">
          导入
        </van-button>
        <input
          type="file"
          accept=".json,application/json"
          class="text-xs"
          data-testid="import-file"
          @change="onFile"
        />
      </div>
    </div>
  </div>
</template>
