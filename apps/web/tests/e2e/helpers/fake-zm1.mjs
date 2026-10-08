#!/usr/bin/env node
/**
 * 假 zM1 设备 —— 仅供自动化测试使用（全栈 e2e 用例会自己拉起它），不是产品代码。
 * 行为对齐固件文档与 zM1 协议约定：
 *  - MQTT 模式：订阅 device/zm1/<mac>/set，回 device/zm1/<mac>/state 与 /sensor，
 *    启动时发 retained 的 availability=1；
 *  - UDP 模式：监听 10182 广播，响应 {"cmd":"device report"} 等报文，从 10181 回发；
 *  - 支持字段：name/mac/PM25/formaldehyde/temperature/humidity/brightness/interval/zone/time/version/ssid/ota_progress/task_0..4/setting{name,ota}
 *
 * 用法：
 *   node apps/web/tests/e2e/helpers/fake-zm1.mjs --mac aabbccddeeff --name ZM1_TEST --broker 127.0.0.1:1883
 *   node apps/web/tests/e2e/helpers/fake-zm1.mjs --mac aabbccddeeff --udp
 */
import dgram from 'node:dgram'
import process from 'node:process'
import mqtt from 'mqtt'

const args = process.argv.slice(2)
function arg(name, def = '') {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const mac = arg('mac', 'aabbccddeeff').toLowerCase()
const name = arg('name', `zM1_${mac.slice(-4)}`)
const broker = arg('broker', '127.0.0.1:1883')
const useUdp = args.includes('--udp')
const PHONE_PORT = 10181
const DEVICE_PORT = 10182

const state = {
  name,
  mac,
  PM25: 35,
  formaldehyde: 0.02,
  temperature: 23.8,
  humidity: 64.0,
  brightness: 2,
  interval: 5,
  zone: 480,
  version: 'v0.0.4',
  ssid: 'zcontrol-test',
  time: -1,
  ota_progress: 100,
  tasks: [
    { hour: 7, minute: 30, brightness: 3, on: 1 },
    { hour: 0, minute: 0, brightness: 4, on: 0 },
    { hour: 0, minute: 0, brightness: 4, on: 0 },
    { hour: 0, minute: 0, brightness: 4, on: 0 },
    { hour: 0, minute: 0, brightness: 4, on: 0 },
  ],
}

function log(...a) {
  console.log(`[fake-zm1 ${mac}]`, ...a)
}

/** 处理一条来自后端的 JSON 报文，返回要回复的报文（可能为空） */
function handle(payload) {
  let msg
  try {
    msg = JSON.parse(payload)
  }
  catch {
    return null
  }
  if (!msg || typeof msg !== 'object') return null

  // 设备发现（局域网扫描）
  if (msg.cmd === 'device report') {
    return JSON.stringify({ name: state.name, mac: state.mac, type: 4 })
  }

  if (msg.mac && String(msg.mac).toLowerCase() !== state.mac) return null

  const reply = { name: state.name, mac: state.mac }

  // 云同步 MQTT 配置：设备会回一条同样结构的 setting 报文
  if (msg.setting && (msg.setting.mqtt_uri !== undefined || msg.setting.name !== undefined)) {
    if (msg.setting.name) state.name = msg.setting.name
    if (msg.setting.mqtt_uri !== undefined) {
      log(`收到 MQTT 配置: ${msg.setting.mqtt_uri}:${msg.setting.mqtt_port} user=${msg.setting.mqtt_user}`)
      return JSON.stringify({ name: state.name, mac: state.mac, setting: msg.setting })
    }
    if (msg.setting.ota !== undefined) {
      log(`收到 OTA 地址: ${msg.setting.ota}（模拟进度 0->100）`)
      return JSON.stringify({ name: state.name, mac: state.mac, ota_progress: 0 })
    }
  }

  if (msg.cmd === 'restart') {
    log('收到重启指令（模拟，不真的重启）')
    return JSON.stringify({ name: state.name, mac: state.mac })
  }

  if (msg.brightness === null) {
    reply.brightness = state.brightness
    reply.PM25 = state.PM25
    reply.formaldehyde = state.formaldehyde
    reply.temperature = state.temperature
    reply.humidity = state.humidity
    return JSON.stringify(reply)
  }
  if (typeof msg.brightness === 'number') {
    state.brightness = msg.brightness
    reply.brightness = state.brightness
    return JSON.stringify(reply)
  }

  for (let i = 0; i < 5; i++) {
    const key = `task_${i}`
    if (msg[key] === undefined) continue
    const t = msg[key]
    if (t && Object.keys(t).length === 0) {
      reply[key] = state.tasks[i]
      continue
    }
    if (t) {
      state.tasks[i] = { hour: t.hour, minute: t.minute, brightness: t.brightness, on: t.on }
      log(`task_${i} = ${JSON.stringify(state.tasks[i])}`)
      reply[key] = state.tasks[i]
    }
  }
  if (Object.keys(reply).length > 2) return JSON.stringify(reply)

  if (msg.interval === null || msg.version === null || msg.ssid === null || msg.zone === null) {
    reply.interval = state.interval
    reply.version = state.version
    reply.ssid = state.ssid
    reply.zone = state.zone
    return JSON.stringify(reply)
  }
  if (typeof msg.interval === 'number') {
    state.interval = msg.interval
    reply.interval = state.interval
    return JSON.stringify(reply)
  }
  if (typeof msg.zone === 'number') {
    state.zone = msg.zone
    reply.zone = state.zone
    return JSON.stringify(reply)
  }
  if (msg.time === -1) {
    reply.time = Math.floor(Date.now() / 1000)
    state.time = reply.time
    log(`校时 → ${reply.time}`)
    return JSON.stringify(reply)
  }
  if (typeof msg.brightness === 'number') reply.brightness = state.brightness
  return Object.keys(reply).length > 2 ? JSON.stringify(reply) : null
}

// ---- UDP 模式 ----
if (useUdp) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  sock.bind(DEVICE_PORT, () => {
    sock.setBroadcast(true)
    log(`UDP 监听 ${DEVICE_PORT}，回复到 255.255.255.255:${PHONE_PORT}`)
  })
  sock.on('message', (buf, rinfo) => {
    const text = buf.toString()
    const out = handle(text)
    if (!out) return
    log(`收 ${rinfo.address}:${rinfo.port} <- ${text}`)
    const payload = Buffer.from(out)
    sock.send(payload, PHONE_PORT, '255.255.255.255', () => {})
    sock.send(payload, PHONE_PORT, rinfo.address, () => {})
  })
}

// ---- MQTT 模式 ----
if (!useUdp) {
  // clientId 带随机后缀：固定 clientId 时，上一轮残留的假设备（同 mac）会和新的互相踢下线，
  // 症状是 set 报文丢失、首帧只能等周期上报（实测能拖到 27 秒，看起来像随机 flake）。
  const clientId = `fake-zm1-${mac}-${Math.random().toString(16).slice(2, 8)}`
  const client = mqtt.connect(`mqtt://${broker}`, { clientId, clean: true })
  const topicSet = `device/zm1/${mac}/set`
  const topicState = `device/zm1/${mac}/state`
  const topicSensor = `device/zm1/${mac}/sensor`
  const topicAvail = `device/zm1/${mac}/availability`

  client.on('connect', () => {
    log(`MQTT 已连接 ${broker}`)
    client.subscribe(topicSet, { qos: 1 })
    client.publish(topicAvail, '1', { qos: 1, retain: true })
    setInterval(() => {
      state.PM25 = 20 + Math.round(Math.random() * 40)
      state.formaldehyde = Number((0.01 + Math.random() * 0.05).toFixed(3))
      state.temperature = Number((20 + Math.random() * 6).toFixed(1))
      state.humidity = Number((40 + Math.random() * 30).toFixed(1))
      client.publish(
        topicSensor,
        JSON.stringify({
          name: state.name,
          mac: state.mac,
          PM25: state.PM25,
          formaldehyde: state.formaldehyde,
          temperature: state.temperature,
          humidity: state.humidity,
        }),
        { qos: 1 },
      )
    }, Math.max(1, state.interval) * 1000)
  })

  client.on('message', (topic, buf) => {
    if (topic !== topicSet) return
    const text = buf.toString()
    log(`收 ${text}`)
    const out = handle(text)
    if (!out) return
    log(`回 ${out}`)
    client.publish(topicState, out, { qos: 1 })
  })

  client.on('error', e => log('MQTT 错误', e.message))
}

process.on('SIGINT', () => process.exit(0))

log(`启动完成：mac=${mac} name=${name} 模式=${useUdp ? 'UDP' : `MQTT(${broker})`}`)
