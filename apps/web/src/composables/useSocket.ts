import type { WsEvent } from '../api'
import { notifyMqttSyncAck } from './mqttSyncAck'
import { useAppStore } from '../stores/app'
import { useDeviceStore } from '../stores/devices'
import { useLogStore } from '../stores/log'

let socket: WebSocket | null = null
let started = false
let retryTimer: number | null = null

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

function dispatch(ev: WsEvent) {
  const app = useAppStore()
  const device = useDeviceStore()
  const log = useLogStore()

  switch (ev.type) {
    case 'hello': {
      app.setStatus(ev.data.status)
      app.settings = ev.data.settings
      device.applyDevices(ev.data.devices)
      app.setScanning(ev.data.scan.active)
      app.setScanDevices(ev.data.scan.devices)
      break
    }
    case 'status': {
      const prev = app.status?.mqtt.connected
      app.setStatus(ev.data)
      app.setScanning(ev.data.scan.active)
      if (prev !== ev.data.mqtt.connected) {
        if (ev.data.mqtt.connected) {
          for (const d of device.devices) log.push(d.mac, 'sys', '本工具已连接 MQTT 服务器')
        }
        else {
          const err = ev.data.mqtt.error ? `:${ev.data.mqtt.error}` : ''
          for (const d of device.devices) log.push(d.mac, 'sys', `本工具已断开 MQTT 服务器 ${err}`)
        }
      }
      break
    }
    case 'devices': {
      device.applyDevices(ev.data.devices)
      if (app.scanning) void app.refreshScan()
      break
    }
    case 'scan': {
      // 扫描结果实时推送：点「开始扫描」后无需刷新即可看到设备
      app.setScanDevices(ev.data.devices)
      break
    }
    case 'data': {
      const { mac, source, payload } = ev.data
      const text
        = typeof payload === 'string' ? payload : JSON.stringify(payload).replace(/\\/g, '')
      log.push(mac, 'recv', `接收 ${source}: ${text}`, ev.data.ts)
      // 设备回包确认：云同步下发的 MQTT 配置（原版在此弹 Toast 显示设备实际保存的值）
      if (typeof payload === 'object' && payload !== null) notifyMqttSyncAck(mac, payload)
      break
    }
    case 'sent': {
      log.push(ev.data.mac, 'send', `发送 ${ev.data.source}: ${ev.data.payload}`, ev.data.ts)
      break
    }
  }
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return
  }
  socket = new WebSocket(wsUrl())
  socket.onmessage = (e) => {
    try {
      dispatch(JSON.parse(e.data as string) as WsEvent)
    }
    catch {
      /* 忽略非契约消息 */
    }
  }
  socket.onclose = () => {
    // 断线 1 秒后重连
    if (retryTimer === null) {
      retryTimer = window.setTimeout(() => {
        retryTimer = null
        connect()
      }, 1000)
    }
  }
  socket.onerror = () => {
    socket?.close()
  }
}

/** 在 App.vue 里调用一次；重复调用无副作用 */
export function initSocket() {
  if (started) return
  started = true
  connect()
}
