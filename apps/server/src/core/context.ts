import type { Store } from '../store/db.ts'
import type { SettingsStore } from '../store/settings.ts'
import type { Registry } from '../device/registry.ts'
import type { MqttService } from '../transport/mqtt.ts'
import type { UdpService } from '../transport/udp.ts'
import type { DiscoveryService } from '../transport/discovery.ts'
import type { Dispatcher } from './dispatcher.ts'

export interface AppCtx {
  store: Store
  settings: SettingsStore
  registry: Registry
  mqtt: MqttService
  udp: UdpService
  discovery: DiscoveryService
  dispatcher: Dispatcher
  /** 是否允许真正发起 MQTT 连接（测试时为 false） */
  allowConnect: boolean
}

export interface AppStatus {
  mqtt: { connected: boolean, uri: string, error: string | null }
  udp: { listening: boolean, port: number }
  scan: { active: boolean }
  version: string
  versionName: string
  localIps: string[]
}
