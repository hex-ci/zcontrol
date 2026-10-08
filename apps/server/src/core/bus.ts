import { EventEmitter } from 'node:events'

/**
 * 后端内部事件总线；WS 层订阅这里的事件推给前端。
 * 事件名与载荷见各 emit 处。
 */
export const bus = new EventEmitter()
bus.setMaxListeners(200)

export const EV = {
  /** MQTT 连接状态变化：{connected, uri, error} */
  MQTT_STATUS: 'mqtt.status',
  /** 收到 MQTT 报文：{topic, payload: string} */
  MQTT_MESSAGE: 'mqtt.message',
  /** UDP 监听状态变化：{listening, port} */
  UDP_STATUS: 'udp.status',
  /** 收到 UDP 报文：{ip, port, payload: string} */
  UDP_MESSAGE: 'udp.message',
  /** 设备上报（已解析）：{mac, source, topic, payload, ts} */
  DATA: 'device.data',
  /** 后端已下发报文：{mac, source, topic, payload, ts} */
  SENT: 'device.sent',
  /** 设备列表/状态变化：{devices} */
  DEVICES: 'devices.changed',
  /** 扫描状态变化：{active} */
  SCAN: 'scan.changed',
  /** 扫描发现的设备：{devices} */
  SCAN_FOUND: 'scan.found',
  /** 扫描响应（原始上报）：{name, mac, type, ip} */
  REPORT: 'device.report',
} as const

export type BusEventName = (typeof EV)[keyof typeof EV]
