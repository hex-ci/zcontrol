import type { Store } from './db.ts'

/** 全局设置项 */
export interface AppSettings {
  mqtt_uri: string
  mqtt_user: string
  mqtt_clientid: string
  mqtt_password_set: boolean
  version_no_ask: string
}

const KEY_MQTT_URI = 'mqtt_uri'
const KEY_MQTT_USER = 'mqtt_user'
const KEY_MQTT_PASSWORD = 'mqtt_password'
const KEY_MQTT_CLIENTID = 'mqtt_clientid'
const KEY_VERSION_NO_ASK = 'version_no_ask'

export class SettingsStore {
  store: Store

  constructor(store: Store) {
    this.store = store
  }

  mqttUri(): string {
    return this.store.getSetting(KEY_MQTT_URI, '')
  }

  mqttUser(): string {
    return this.store.getSetting(KEY_MQTT_USER, '')
  }

  /** 明文密码只留在后端，永不回传前端 */
  mqttPassword(): string {
    return this.store.getSetting(KEY_MQTT_PASSWORD, '')
  }

  mqttClientId(): string {
    return this.store.getSetting(KEY_MQTT_CLIENTID, '')
  }

  versionNoAsk(): string {
    return this.store.getSetting(KEY_VERSION_NO_ASK, '')
  }

  set(partial: {
    mqtt_uri?: string
    mqtt_user?: string
    mqtt_password?: string
    mqtt_clientid?: string
    version_no_ask?: string
  }): void {
    if (partial.mqtt_uri !== undefined) this.store.setSetting(KEY_MQTT_URI, partial.mqtt_uri)
    if (partial.mqtt_user !== undefined) this.store.setSetting(KEY_MQTT_USER, partial.mqtt_user)
    if (partial.mqtt_password !== undefined) this.store.setSetting(KEY_MQTT_PASSWORD, partial.mqtt_password)
    if (partial.mqtt_clientid !== undefined) this.store.setSetting(KEY_MQTT_CLIENTID, partial.mqtt_clientid)
    if (partial.version_no_ask !== undefined) this.store.setSetting(KEY_VERSION_NO_ASK, partial.version_no_ask)
  }

  /** 脱敏后的设置（回传前端用） */
  masked(): AppSettings {
    return {
      mqtt_uri: this.mqttUri(),
      mqtt_user: this.mqttUser(),
      mqtt_clientid: this.mqttClientId(),
      mqtt_password_set: this.mqttPassword().length > 0,
      version_no_ask: this.versionNoAsk(),
    }
  }

  // ---- 单设备设置 ----

  /** 单设备设置：always_UDP（默认 false） */
  alwaysUdp(mac: string): boolean {
    return this.store.getDeviceSetting(mac, 'always_UDP', 'false') === 'true'
  }

  setAlwaysUdp(mac: string, value: boolean): void {
    this.store.setDeviceSetting(mac, 'always_UDP', value ? 'true' : 'false')
  }
}
