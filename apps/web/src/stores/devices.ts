import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, type DeviceDTO, type M1State, type SentInfo } from '../api'

/** zM1 设备类型编号（源码 Device.TYPE_M1）：只支持这一种 */
export const TYPE_M1 = 4

export const useDeviceStore = defineStore('devices', () => {
  const devices = ref<DeviceDTO[]>([])
  const currentMac = ref('')
  const loaded = ref(false)

  const current = computed<DeviceDTO | null>(
    () => devices.value.find(d => d.mac === currentMac.value) ?? null,
  )

  function byMac(mac: string): DeviceDTO | null {
    return devices.value.find(d => d.mac === mac) ?? null
  }

  function stateOf(mac: string): M1State {
    return byMac(mac)?.state ?? {}
  }

  function applyDevices(list: DeviceDTO[]) {
    devices.value = list
    if (!list.some(d => d.mac === currentMac.value)) {
      currentMac.value = list[0]?.mac ?? ''
    }
    loaded.value = true
  }

  async function load() {
    const r = await api.devices()
    applyDevices(r.devices)
    return r.devices
  }

  async function add(name: string, mac: string, type = TYPE_M1) {
    const r = await api.addDevice(name, mac.toLowerCase(), type)
    await load()
    return r.device
  }

  async function remove(mac: string) {
    await api.removeDevice(mac)
    await load()
  }

  async function rename(mac: string, name: string) {
    const r = await api.renameDevice(mac, name)
    await load()
    return r.device
  }

  async function reorder(macs: string[]) {
    const r = await api.reorderDevices(macs)
    applyDevices(r.devices)
    return r.devices
  }

  async function sendCmd(mac: string, cmd: Record<string, unknown>): Promise<SentInfo> {
    const r = await api.cmd(mac, cmd)
    return r.sent
  }

  async function deviceSettings(mac: string) {
    return api.deviceSettings(mac)
  }

  async function saveDeviceSettings(mac: string, body: { always_UDP?: boolean }) {
    return api.saveDeviceSettings(mac, body)
  }

  async function exportDevices() {
    return api.exportDevices()
  }

  async function importDevices(list: { name: string, mac: string, type: number }[]) {
    const r = await api.importDevices(list)
    await load()
    return r
  }

  return {
    devices,
    currentMac,
    loaded,
    current,
    byMac,
    stateOf,
    applyDevices,
    load,
    add,
    remove,
    rename,
    reorder,
    sendCmd,
    deviceSettings,
    saveDeviceSettings,
    exportDevices,
    importDevices,
  }
})
