/**
 * 与后端的接口契约（见 docs/API.md）。改动需同步 apps/server。
 */

export interface Zm1Task {
  hour: number
  minute: number
  brightness: number
  on: number
}

/** 设备回包的 MQTT 配置（云同步后设备回报的 setting 报文，密码不下发/不回传） */
export interface Zm1MqttSetting {
  mqtt_uri: string
  mqtt_port: number
  mqtt_user: string
}

export interface M1State {
  PM25?: number
  formaldehyde?: number
  temperature?: number
  humidity?: number
  brightness?: number
  time?: number
  version?: string
  interval?: number
  ssid?: string
  zone?: number
  ota_progress?: number
  /** 设备当前保存的 MQTT 服务器（只有收到过 setting 回包才有） */
  mqttSetting?: Zm1MqttSetting
  tasks?: (Zm1Task | null)[]
  lastTopic?: 'state' | 'sensor' | null
}

export interface DeviceDTO {
  mac: string
  name: string
  type: number
  typeName: string
  online: boolean
  ip: string | null
  order: number
  state: M1State
  updatedAt: number
}

export interface MqttStatus {
  connected: boolean
  uri: string
  error: string | null
}

export interface AppStatus {
  mqtt: MqttStatus
  udp: { listening: boolean, port: number }
  scan: { active: boolean }
  version: string
  versionName: string
  localIps: string[]
}

/** 局域网扫描状态：是否在扫描 + 已发现的设备 */
export interface ScanState {
  active: boolean
  devices: DeviceDTO[]
}

export interface AppSettings {
  mqtt_uri: string
  mqtt_user: string
  mqtt_clientid: string
  mqtt_password_set: boolean
  version_no_ask: string
}

export interface SentInfo {
  channel: 'mqtt' | 'udp'
  topic: string | null
  payload: string
}

export interface OtaCheckResult {
  hasUpdate: boolean
  current: string
  tag_name: string
  title: string
  message: string
  ota: string | null
}

export interface HaConfigResult {
  /** 下载用的文件名 */
  file_name: string
  /** 可直接粘贴进 configuration.yaml 的 YAML 文本 */
  yaml: string
}

export interface ExportPayload {
  device: { name: string, mac: string, type: number, type_name: string }[]
}

export interface ImportResult {
  total: number
  added: number
  dup: number
  invalid: number
}

export type WsEvent
  = | {
    type: 'hello'
    data: { status: AppStatus, devices: DeviceDTO[], settings: AppSettings, scan: ScanState }
  }
  | { type: 'status', data: AppStatus }
  | { type: 'devices', data: { devices: DeviceDTO[] } }
  | { type: 'scan', data: { devices: DeviceDTO[] } }
  | {
    type: 'data'
    data: { mac: string, source: 'mqtt' | 'udp', topic: string | null, payload: unknown, ts: number }
  }
  | {
    type: 'sent'
    data: { mac: string, source: 'mqtt' | 'udp', topic: string | null, payload: string, ts: number }
  }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // 注意：GET 或没有 body 的请求不能带 content-type: application/json，
  // 否则 Fastify 的 JSON 解析器会以「body 为空」返回 400。
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) }
  if (init?.body !== undefined) headers['content-type'] = 'application/json'
  const res = await fetch(`/api${path}`, { ...init, headers })
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    }
    catch {
      data = { error: text }
    }
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? res.statusText
    throw new Error(msg)
  }
  return data as T
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) })

export const api = {
  health: () => req<{ ok: boolean, version: string }>('/health'),
  status: () => req<AppStatus>('/status'),

  devices: () => req<{ devices: DeviceDTO[] }>('/devices'),
  addDevice: (name: string, mac: string, type = 4) =>
    req<{ device: DeviceDTO }>('/devices', { method: 'POST', ...json({ name, mac, type }) }),
  renameDevice: (mac: string, name: string) =>
    req<{ device: DeviceDTO }>(`/devices/${mac}`, { method: 'PATCH', ...json({ name }) }),
  removeDevice: (mac: string) => req<{ ok: boolean }>(`/devices/${mac}`, { method: 'DELETE' }),
  reorderDevices: (macs: string[]) =>
    req<{ devices: DeviceDTO[] }>('/devices/order', { method: 'PUT', ...json({ macs }) }),
  deviceState: (mac: string) => req<{ state: M1State }>(`/devices/${mac}/state`),
  deviceSettings: (mac: string) => req<{ always_UDP: boolean }>(`/devices/${mac}/settings`),
  saveDeviceSettings: (mac: string, body: { always_UDP?: boolean }) =>
    req<{ always_UDP: boolean }>(`/devices/${mac}/settings`, { method: 'PUT', ...json(body) }),
  cmd: (mac: string, cmd: Record<string, unknown>) =>
    req<{ sent: SentInfo }>(`/devices/${mac}/cmd`, { method: 'POST', ...json({ cmd }) }),

  settings: () => req<AppSettings>('/settings'),
  saveSettings: (body: Partial<AppSettings> & { mqtt_password?: string }) =>
    req<{ settings: AppSettings, mqtt: MqttStatus }>('/settings', { method: 'PUT', ...json(body) }),
  syncMqtt: (mac: string) =>
    req<{ sent: { channel: 'udp', payload: string } }>(`/settings/mqtt/sync/${mac}`, { method: 'POST' }),

  scanState: () => req<ScanState>('/discovery/scan'),
  scan: (action: 'start' | 'stop') =>
    req<ScanState>('/discovery/scan', { method: 'POST', ...json({ action }) }),

  exportDevices: () => req<ExportPayload>('/devices/export'),
  importDevices: (device: { name: string, mac: string, type: number }[]) =>
    req<ImportResult>('/devices/import', { method: 'POST', ...json({ device }) }),

  otaCheck: (mac: string) => req<OtaCheckResult>(`/devices/${mac}/ota/check`),
  haConfig: (mac: string) => req<HaConfigResult>(`/devices/${mac}/ha-config`),
}
