import dgram from 'node:dgram'
import os from 'node:os'
import { EV, bus } from '../core/bus.ts'
import { BROADCAST_ADDR, DEVICE_UDP_PORT, PHONE_UDP_PORT } from '../config.ts'

export interface UdpStatus {
  listening: boolean
  port: number
}

/**
 * UDP 传输层：
 * 本机监听 10181（PHONE_UDP_PORT），发送到 255.255.255.255:10182（DEVICE_UDP_PORT）。
 */
export class UdpService {
  socket: dgram.Socket | null = null
  listening = false
  /** 测试用：只记录不真正发包 */
  dryRun = false
  sent: { payload: string, ip: string, port: number }[] = []
  private readonly onMessage: (ip: string, port: number, payload: string) => void
  private readonly onError?: (message: string) => void
  private readonly port: number

  constructor(
    onMessage: (ip: string, port: number, payload: string) => void,
    dryRun = false,
    onError?: (message: string) => void,
    port: number = PHONE_UDP_PORT,
  ) {
    this.onMessage = onMessage
    this.dryRun = dryRun
    this.onError = onError
    this.port = port
  }

  status(): UdpStatus {
    return { listening: this.listening, port: this.port }
  }

  start(): void {
    if (this.socket) return
    // 刻意不开 reuseAddr：两个后端进程同时监听 10181 时，设备回包会被内核随机
    // 投递给其中一个，表现为"云同步偶尔收不到回包"。宁可第二个进程启动就报错。
    const socket = dgram.createSocket({ type: 'udp4' })
    this.socket = socket

    socket.on('message', (msg, rinfo) => {
      this.onMessage(rinfo.address, rinfo.port, msg.toString())
    })

    socket.on('error', (err) => {
      this.listening = false
      this.onError?.(
        `UDP 监听 ${this.port} 失败：${err.message}（同一台机器上是否已有另一个后端进程在跑？）`,
      )
      bus.emit(EV.UDP_STATUS, this.status())
    })

    socket.on('listening', () => {
      this.listening = true
      try {
        socket.setBroadcast(true)
      }
      catch {
        /* 某些内核/容器不允许，广播发送时会显式报错 */
      }
      bus.emit(EV.UDP_STATUS, this.status())
    })

    try {
      socket.bind(this.port)
    }
    catch {
      this.listening = false
    }
  }

  stop(): void {
    if (!this.socket) return
    const s = this.socket
    this.socket = null
    this.listening = false
    try {
      s.close()
    }
    catch {
      /* 忽略 */
    }
  }

  /** 发送 UDP 报文 → 255.255.255.255:10182 */
  send(payload: string, ip: string = BROADCAST_ADDR, port: number = DEVICE_UDP_PORT): void {
    if (!payload) return
    if (this.dryRun) {
      this.sent.push({ payload, ip, port })
      return
    }
    const socket = this.socket
    if (!socket) throw new Error('UDP socket 未启动')
    const buf = Buffer.from(payload, 'utf8')
    const targets = ip === BROADCAST_ADDR ? this.broadcastTargets() : [ip]
    for (const target of targets) {
      socket.send(buf, port, target, () => {
        /* 广播丢包是常态，不抛错 */
      })
    }
  }

  /**
   * 全局广播 255.255.255.255 之外，再按各网卡的子网广播地址各发一份。
   * 部分路由器/AP 会丢弃 255.255.255.255，补子网广播可提高一把即中的概率。
   */
  broadcastTargets(): string[] {
    const set = new Set<string>([BROADCAST_ADDR])
    for (const list of Object.values(os.networkInterfaces())) {
      for (const ni of list ?? []) {
        if (ni.family !== 'IPv4' || ni.internal) continue
        const bc = subnetBroadcast(ni.address, ni.netmask)
        if (bc) set.add(bc)
      }
    }
    return [...set]
  }
}

/** 由地址与掩码算子网广播地址 */
export function subnetBroadcast(address: string, netmask: string): string | null {
  const a = address.split('.').map(Number)
  const m = netmask.split('.').map(Number)
  if (a.length !== 4 || m.length !== 4 || a.some(Number.isNaN) || m.some(Number.isNaN)) return null
  const b = a.map((oct, i) => {
    const mask = m[i] ?? 0
    return (oct & mask) | (~mask & 0xff)
  })
  return b.join('.')
}
