<script setup lang="ts">
/**
 * zM1 设备设置页。
 * preference key 顺序：name / mac / always_UDP / ssid / zone /
 * interval / fw_version / time_calibration / restart / regetdata。
 * 长按「当前版本」的下一项（time_calibration）→ 弹出固件地址输入框。
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showConfirmDialog, showDialog, showToast } from 'vant';
import AppNavBar from '../components/AppNavBar.vue';
import Zm1SettingZonePicker, {
  ZONE_TEXTS,
  ZONE_VALUES,
} from '../components/Zm1SettingZonePicker.vue';
import Zm1SettingTextDialog from '../components/Zm1SettingTextDialog.vue';
import Zm1SettingOtaProgress from '../components/Zm1SettingOtaProgress.vue';
import Zm1HaConfigDialog from '../components/Zm1HaConfigDialog.vue';
import { copyText } from '../composables/clipboard';
import { api } from '../api';
import { useAppStore } from '../stores/app';
import { useDeviceStore } from '../stores/devices';

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const store = useDeviceStore();

const mac = computed(() => String(route.params.mac ?? ''));
const device = computed(() => store.byMac(mac.value));
const state = computed(() => device.value?.state ?? {});

const deviceName = computed(() => device.value?.name ?? '');
const ssid = computed(() => state.value.ssid ?? '');
/** 设备当前保存的 MQTT 服务器：只有收到过云同步回包（setting 报文）才有值 */
const mqttSetting = computed(() => state.value.mqttSetting ?? null);
const mqttSettingText = computed(() => {
  const s = mqttSetting.value;
  return s ? `${s.mqtt_uri}:${s.mqtt_port}` : '';
});
const mqttSettingUser = computed(() => {
  const s = mqttSetting.value;
  if (!s) return '未获取到设备保存的配置,可回主页点右上角云图标下发';
  return s.mqtt_user ? `用户:${s.mqtt_user}` : '未设置用户名';
});
const version = computed(() => state.value.version ?? '');
const intervalText = computed(() =>
  state.value.interval == null ? '' : String(state.value.interval),
);
const zoneText = computed(() => {
  const z = state.value.zone;
  if (z == null) return '';
  const i = ZONE_VALUES.indexOf(z);
  return i >= 0 ? ZONE_TEXTS[i] : '';
});

//region 进页面自动请求设备数据（对齐原版：设置页一打开就请求 version/interval/ssid/zone）
const loading = ref(false);
let loadTimer: number | null = null;

/** 四个字段是否还有没取到的（都有值时不必显示加载中） */
const DATA_FIELDS = ['version', 'interval', 'ssid', 'zone'] as const;
type DataField = (typeof DATA_FIELDS)[number];

const missingFields = (): DataField[] => DATA_FIELDS.filter((f) => state.value[f] == null);

/** 本次查询在等哪些字段（避免被无关的状态更新提前结束加载态） */
let pendingFields: DataField[] = [];

function clearLoadTimer(): void {
  if (loadTimer !== null) {
    window.clearTimeout(loadTimer);
    loadTimer = null;
  }
}

/**
 * 请求设备当前数据：四个字段全为 null 表示「只查询、不改值」，设备会回报当前值。
 * 缺数据的字段先显示加载中；等到这些字段回来、或超时（提示手动重试）后结束。
 */
async function queryDeviceData(): Promise<void> {
  clearLoadTimer();
  pendingFields = missingFields();
  loading.value = pendingFields.length > 0;
  if (loading.value) {
    loadTimer = window.setTimeout(() => {
      loadTimer = null;
      loading.value = false;
      showToast('未获取到设备数据,请点「重新获取数据」重试');
    }, 6000);
  }
  try {
    await store.sendCmd(mac.value, { version: null, interval: null, ssid: null, zone: null });
  } catch {
    /* 下发失败由 sendCmd 内部提示 */
  }
}

/** 等待中的字段都到齐 → 结束加载态 */
watch(
  () => [state.value.version, state.value.interval, state.value.ssid, state.value.zone],
  () => {
    if (!loading.value) return;
    if (pendingFields.every((f) => state.value[f] != null)) {
      clearLoadTimer();
      loading.value = false;
    }
  },
);

// MqttConnected / MqttDisconnected 时重新查询（与原版一致）
watch(
  () => app.status?.mqtt.connected,
  (now, before) => {
    if (before === undefined || now === before) return;
    void queryDeviceData();
  },
);

/** 值还没取到时显示「加载中」，避免空白的单元格看起来像坏了 */
function valueOrLoading(v: string): string {
  return loading.value && !v ? '加载中' : v;
}
//endregion

//region 总是通过UDP发送数据（GET/PUT /api/devices/:mac/settings）
const alwaysUdp = ref(false);

onMounted(async () => {
  if (!store.loaded) {
    try {
      await store.load();
    } catch {
      /* 由 App.vue 兜底 */
    }
  }
  try {
    const r = await store.deviceSettings(mac.value);
    alwaysUdp.value = !!r.always_UDP;
  } catch {
    /* 忽略读取失败，保持默认 false */
  }
  void queryDeviceData();
});

async function onUdpChange(v: boolean): Promise<void> {
  const prev = alwaysUdp.value;
  alwaysUdp.value = v;
  try {
    await store.saveDeviceSettings(mac.value, { always_UDP: v });
  } catch {
    alwaysUdp.value = prev;
    showToast('保存失败');
  }
}
//endregion

//region 名称（EditTextPreference dialogTitle=设备名称）
const nameShow = ref(false);

async function onNameConfirm(v: string): Promise<void> {
  const name = v.trim();
  if (!name) return;
  await store.sendCmd(mac.value, { setting: { name } });
  const d = device.value;
  if (d) d.name = name;
}
//endregion

//region MAC地址(点击复制)
async function copyMac(): Promise<void> {
  showToast((await copyText(mac.value)) ? '已复制mac地址' : '复制mac地址失败');
}
//endregion

//region 时区（ListPreference entries=@array/zone）
const zoneShow = ref(false);
/** 发出 {time:-1} 后等待设备回校时结果，避免页面加载时的历史 time 触发提示 */
let pendingTime = false;

async function onZoneConfirm(zone: number): Promise<void> {
  await store.sendCmd(mac.value, { zone });
  await store.sendCmd(mac.value, { time: -1 });
  pendingTime = true;
  showToast('已发送时区/校时请求,请等待校时结果返回');
}
//endregion

//region 上报频率(秒)（范围 1-255）
const intervalShow = ref(false);

async function onIntervalConfirm(v: string): Promise<void> {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 255) {
    showToast('输入有误!范围1-255');
    return;
  }
  await store.sendCmd(mac.value, { interval: n });
}
//endregion

//region 重新获取数据
async function regetData(): Promise<void> {
  await queryDeviceData();
}
//endregion

//region Home Assistant 配置（纯文本生成，不发任何报文）
const haShow = ref(false);
const haYaml = ref('');
const haFileName = ref('');

async function onHaConfig(): Promise<void> {
  try {
    const r = await api.haConfig(mac.value);
    haYaml.value = r.yaml;
    haFileName.value = r.file_name;
    haShow.value = true;
  } catch (e) {
    showToast(String((e as Error).message));
  }
}
//endregion

//region 版本 / OTA（未获取到版本先弹提示）
function isGetVersion(): boolean {
  if (!version.value) {
    void showDialog({
      title: '未获取到当前设备版本',
      message: '请点击重新获取数据.获取到当前设备版本后重试.',
      confirmButtonText: '确定',
    }).then(() => {
      void regetData();
      showToast('请求版本数据...');
    });
    return false;
  }
  return true;
}

async function onVersionClick(): Promise<void> {
  if (!isGetVersion()) return;
  try {
    const r = await api.otaCheck(mac.value);
    if (!r.hasUpdate) {
      showToast('已是最新版本');
      return;
    }
    try {
      await showConfirmDialog({
        title: `获取到最新版本:${r.tag_name}`,
        message: `${r.title}\n${r.message}`,
        confirmButtonText: '更新',
        cancelButtonText: '取消',
        messageAlign: 'left',
      });
      await store.sendCmd(mac.value, { setting: { ota: r.ota } });
      otaFlag = true;
    } catch {
      /* 用户取消 */
    }
  } catch {
    showToast('获取最新版本信息失败');
  }
}
//endregion

//region 手动校时 + 长按 debugFWUpdate
let pendingTimeCalibration = false;

async function manualCalibrate(): Promise<void> {
  if (!isGetVersion()) return;
  try {
    await showConfirmDialog({
      title: '手动校时?',
      message: '注意:校时后,必须等待一分钟才能校时成功,所以请不要快速连续进行手动校时',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    });
    await store.sendCmd(mac.value, { time: -1 });
    pendingTime = true;
    pendingTimeCalibration = true;
  } catch {
    /* 用户取消 */
  }
}

//region 长按（当前版本下一项 → 手动校时）
const fwShow = ref(false);
let pressTimer: number | null = null;
let longFired = false;

function clearPress(): void {
  if (pressTimer !== null) {
    window.clearTimeout(pressTimer);
    pressTimer = null;
  }
}

function startPress(): void {
  clearPress();
  longFired = false;
  pressTimer = window.setTimeout(() => {
    pressTimer = null;
    longFired = true;
    debugFWUpdate();
  }, 600);
}

function onCalibrationClick(): void {
  if (longFired) {
    longFired = false;
    return;
  }
  void manualCalibrate();
}

function debugFWUpdate(): void {
  if (!isGetVersion()) return;
  fwShow.value = true;
}

async function onFirmwareConfirm(uri: string): Promise<void> {
  const u = uri.trim();
  if (u.length < 1) return;
  if (u.startsWith('http')) {
    await store.sendCmd(mac.value, { setting: { ota: u } });
    otaFlag = true;
  } else {
    showToast('地址不合法');
  }
}
//endregion
//endregion

//region 重启设备
async function onRestart(): Promise<void> {
  try {
    await showConfirmDialog({
      title: '重启设备?',
      message: '如果设备死机此处重启可能无效,依然需要手动拔插插头才能重启设备',
      confirmButtonText: '确定',
      cancelButtonText: '取消',
    });
    await store.sendCmd(mac.value, { cmd: 'restart' });
  } catch {
    /* 用户取消 */
  }
}
//endregion

//region OTA 进度回显
const otaProgress = ref(0);
const otaShow = ref(false);
/** 是否处于 OTA 流程 */
let otaFlag = false;

watch(
  () => state.value.ota_progress,
  (p) => {
    if (p == null) return;
    if (p >= 0 && p < 100) {
      otaFlag = true;
      otaProgress.value = p;
      otaShow.value = true;
      return;
    }
    if (!otaFlag) return;
    otaFlag = false;
    otaShow.value = false;
    void showDialog({
      title: '',
      message: p === -1 ? '固件更新失败!请重试' : '固件更新成功!',
      confirmButtonText: '确定',
    });
  },
);
//endregion

//region 校时结果（time < 1586000000 视为失败，否则按 GMT+0 显示）
function formatGmt0(sec: number): string {
  const d = new Date(sec * 1000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    ` ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  );
}

watch(
  () => state.value.time,
  (t, old) => {
    if (t == null || t === old || !pendingTime) return;
    pendingTime = false;
    pendingTimeCalibration = false;
    if (Number(t) < 1586000000) {
      showToast('校时失败,请重试');
      return;
    }
    showToast({ message: `校时结果:${formatGmt0(Number(t))}`, duration: 5000 });
  },
);
//endregion

function goBack(): void {
  if (window.history.length > 1) router.back();
  else router.push('/');
}
</script>

<template>
  <div class="flex min-h-full flex-col">
    <AppNavBar title="设备设置" back @back="goBack" />

    <div class="flex-1 py-3">
      <van-cell-group inset title="设备">
        <!-- 名称 -->
        <van-cell
          title="名称"
          :value="deviceName"
          is-link
          @click="nameShow = true"
        />

        <!-- MAC地址(点击复制) -->
        <van-cell title="MAC地址(点击复制)" :value="mac" @click="copyMac" />

        <!-- 总是通过UDP发送数据 -->
        <van-cell title="总是通过UDP发送数据" label="即使连接MQTT服务器,也使用UDP发送数据">
          <template #right-icon>
            <van-switch :model-value="alwaysUdp" size="20" @update:model-value="onUdpChange" />
          </template>
        </van-cell>

        <!-- 连接的热点 -->
        <van-cell title="连接的热点" :value="valueOrLoading(ssid)" />

        <!-- 设备当前保存的 MQTT 服务器（云同步后由设备回包确认） -->
        <van-cell
          title="设备MQTT服务器"
          :label="mqttSettingUser"
          :value="mqttSettingText"
          data-testid="device-mqtt-setting"
        />

        <!-- 时区 -->
        <van-cell title="时区" :value="valueOrLoading(zoneText)" is-link @click="zoneShow = true" />

        <!-- 上报频率(秒) -->
        <van-cell
          title="上报频率(秒)"
          :value="valueOrLoading(intervalText)"
          is-link
          @click="intervalShow = true"
        />

        <!-- 当前版本(点击检查新版本) -->
        <van-cell
          title="当前版本(点击检查新版本)"
          :value="valueOrLoading(version)"
          is-link
          @click="onVersionClick"
        />

        <!-- 手动校时（长按进入固件地址输入） -->
        <van-cell
          title="手动校时"
          label="自动校时异常时使用"
          @click="onCalibrationClick"
          @mousedown="startPress"
          @mouseup="clearPress"
          @mouseleave="clearPress"
          @touchstart.passive="startPress"
          @touchend="clearPress"
          @touchmove.passive="clearPress"
          @touchcancel="clearPress"
        />

        <!-- 重启设备 -->
        <van-cell title="重启设备" is-link @click="onRestart" />

        <!-- 重新获取数据 -->
        <van-cell
          title="重新获取数据"
          label="获取版本/激活状态失败时点此重试"
          is-link
          @click="regetData"
        />
      </van-cell-group>

      <!-- Home Assistant：生成本机可粘贴的 MQTT 配置（只输出文本） -->
      <van-cell-group inset title="Home Assistant" class="mt-3">
        <van-cell
          title="生成 MQTT 配置"
          label="输出 YAML(4 个传感器 + 屏幕亮度)，粘贴进 configuration.yaml"
          is-link
          data-testid="ha-config-entry"
          @click="onHaConfig"
        />
      </van-cell-group>
    </div>

    <!-- 时区选择器 -->
    <Zm1SettingZonePicker
      v-model:show="zoneShow"
      :model-value="state.zone ?? null"
      @confirm="onZoneConfirm"
    />

    <!-- 名称 -->
    <Zm1SettingTextDialog
      v-model:show="nameShow"
      title="设备名称"
      :initial="deviceName"
      placeholder="请输入设备名称"
      confirm-text="保存"
      cancel-text="取消"
      @confirm="onNameConfirm"
    />

    <!-- 上报频率 -->
    <Zm1SettingTextDialog
      v-model:show="intervalShow"
      title="上报频率"
      message="单位:秒, 范围1-255"
      :initial="intervalText"
      input-type="number"
      confirm-text="保存"
      cancel-text="取消"
      @confirm="onIntervalConfirm"
    />

    <!-- 手动输入固件下载地址（长按触发） -->
    <Zm1SettingTextDialog
      v-model:show="fwShow"
      title="请输入固件下载地址"
      message="警告:输入错误的地址可能导致固件损坏!"
      placeholder="https://...../ota.bin"
      confirm-text="确定"
      cancel-text="取消"
      @confirm="onFirmwareConfirm"
    />

    <!-- OTA 进度 -->
    <Zm1SettingOtaProgress v-model:show="otaShow" :progress="otaProgress" />

    <!-- Home Assistant 配置（YAML 文本） -->
    <Zm1HaConfigDialog
      v-model:show="haShow"
      :yaml="haYaml"
      :file-name="haFileName"
    />
  </div>
</template>
