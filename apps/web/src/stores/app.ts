import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, type AppSettings, type AppStatus, type DeviceDTO, type MqttStatus } from '../api';

export const useAppStore = defineStore('app', () => {
  const status = ref<AppStatus | null>(null);
  const settings = ref<AppSettings | null>(null);
  const scanDevices = ref<DeviceDTO[]>([]);
  const scanning = ref(false);

  function setStatus(s: AppStatus) {
    status.value = s;
  }

  async function loadStatus() {
    status.value = await api.status();
    return status.value;
  }

  async function loadSettings() {
    settings.value = await api.settings();
    return settings.value;
  }

  async function saveSettings(
    body: Partial<AppSettings> & { mqtt_password?: string },
  ): Promise<MqttStatus> {
    const r = await api.saveSettings(body);
    settings.value = r.settings;
    if (status.value) status.value = { ...status.value, mqtt: r.mqtt };
    return r.mqtt;
  }

  async function refreshScan() {
    const r = await api.scanState();
    scanning.value = r.active;
    scanDevices.value = r.devices;
  }

  async function startScan() {
    const r = await api.scan('start');
    scanning.value = r.active;
    scanDevices.value = r.devices;
  }

  async function stopScan() {
    const r = await api.scan('stop');
    scanning.value = r.active;
    scanDevices.value = r.devices;
  }

  async function syncMqtt(mac: string) {
    return api.syncMqtt(mac);
  }

  function setScanDevices(list: DeviceDTO[]) {
    scanDevices.value = list;
  }

  function setScanning(v: boolean) {
    scanning.value = v;
  }

  return {
    status,
    settings,
    scanDevices,
    scanning,
    setStatus,
    loadStatus,
    loadSettings,
    saveSettings,
    refreshScan,
    startScan,
    stopScan,
    syncMqtt,
    setScanDevices,
    setScanning,
  };
});
