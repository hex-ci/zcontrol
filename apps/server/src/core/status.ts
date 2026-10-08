import os from 'node:os'
import { APP_VERSION, APP_VERSION_NAME, TYPE_TOPIC } from '../config.ts'
import type { AppCtx, AppStatus } from './context.ts'

export function localIps(): string[] {
  const out: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address)
    }
  }
  return out
}

export function buildStatus(ctx: AppCtx): AppStatus {
  return {
    mqtt: ctx.mqtt.status(),
    udp: ctx.udp.status(),
    scan: { active: ctx.discovery.active },
    version: APP_VERSION,
    versionName: APP_VERSION_NAME,
    localIps: localIps(),
  }
}

/**
 * 发送一条 zM1 指令：
 *   always_UDP=true 或 MQTT 未连接 → UDP 广播；否则 MQTT 发到 device/zm1/{mac}/set。
 */
export function sendCommand(
  ctx: AppCtx,
  mac: string,
  cmd: Record<string, unknown>,
): { channel: 'mqtt' | 'udp', topic: string | null, payload: string } {
  const device = ctx.registry.find(mac)
  if (!device) throw Object.assign(new Error('设备不存在'), { statusCode: 404 })
  const topic = `device/${TYPE_TOPIC}/${mac}/set`
  const alwaysUdp = ctx.settings.alwaysUdp(mac)
  const payload = buildPayload(mac, cmd)
  const useUdp = alwaysUdp || !ctx.mqtt.isConnected()
  if (useUdp) {
    ctx.udp.send(payload)
    return { channel: 'udp', topic: null, payload }
  }
  ctx.mqtt.publish(topic, payload)
  return { channel: 'mqtt', topic, payload }
}

function buildPayload(mac: string, cmd: Record<string, unknown>): string {
  const out: Record<string, unknown> = { mac }
  for (const [k, v] of Object.entries(cmd)) out[k] = v
  return JSON.stringify(out)
}
