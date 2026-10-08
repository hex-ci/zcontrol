import { Bonjour } from 'bonjour-service'
import type { Service } from 'bonjour-service'
import { EV, bus } from '../core/bus.ts'
import { MAC_RE, MDNS_TYPE, SCAN_INTERVAL_MS, SCAN_REPORT_PAYLOAD, TYPE_M1, TYPE_NAMES } from '../config.ts'
import type { DeviceDTO } from '../device/dto.ts'
import type { UdpService } from './udp.ts'

interface FoundDevice {
  mac: string
  name: string
  type: number
  ip: string | null
  lastSeen: number
}

/**
 * 局域网设备发现：
 * 每 2.5 秒向 255.255.255.255:10182 广播 {"cmd":"device report"}，
 * 设备回 {name, mac, type} 的报文即视为发现。
 * 另有 mDNS（_zcontrol._tcp）通道作为补充。
 */
export class DiscoveryService {
  active = false
  private found = new Map<string, FoundDevice>()
  private timer: NodeJS.Timeout | null = null
  private udp: UdpService
  private bonjour: Bonjour | null = null
  private mdnsStarted = false

  constructor(udp: UdpService) {
    this.udp = udp
  }

  start(): void {
    this.active = true
    if (!this.timer) {
      const tick = () => {
        try {
          this.udp.send(SCAN_REPORT_PAYLOAD)
        }
        catch {
          /* UDP 未就绪时忽略，下一次再试 */
        }
      }
      tick()
      this.timer = setInterval(tick, SCAN_INTERVAL_MS)
    }
    this.startMdns()
    bus.emit(EV.SCAN, { active: true })
    this.emit()
  }

  stop(): void {
    this.active = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    bus.emit(EV.SCAN, { active: false })
    this.emit()
  }

  clear(): void {
    this.found.clear()
    this.emit()
  }

  /** 设备上报 {name, mac, type} 时调用 */
  report(name: string, mac: string, type: number, ip: string | null): void {
    const lower = mac.toLowerCase()
    if (!MAC_RE.test(lower)) return
    this.found.set(lower, { mac: lower, name, type, ip, lastSeen: Date.now() })
    this.emit()
  }

  list(): DeviceDTO[] {
    return [...this.found.values()]
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((f, index) => ({
        mac: f.mac,
        name: f.name,
        type: f.type,
        typeName: TYPE_NAMES[f.type] ?? '未知设备',
        online: true,
        ip: f.ip,
        order: index,
        state: {},
        updatedAt: f.lastSeen,
      }))
  }

  private emit(): void {
    bus.emit(EV.SCAN_FOUND, { devices: this.list() })
  }

  /** mDNS：_zcontrol._tcp 广播的设备（部分固件支持） */
  private startMdns(): void {
    if (this.mdnsStarted) return
    this.mdnsStarted = true
    try {
      this.bonjour = new Bonjour()
      this.bonjour.find({ type: MDNS_TYPE }, (service: Service) => {
        const txt = (service.txt ?? {}) as Record<string, unknown>
        const rawMac = typeof txt.mac === 'string' ? txt.mac : ''
        const mac = rawMac.replaceAll(/[^0-9a-fA-F]/g, '').toLowerCase()
        if (!MAC_RE.test(mac)) return
        const ip = service.addresses?.[0] ?? null
        const name = typeof txt.name === 'string' ? txt.name : service.name
        this.report(name, mac, TYPE_M1, ip)
      })
    }
    catch {
      this.bonjour = null
    }
  }

  stopMdns(): void {
    if (this.bonjour) {
      try {
        this.bonjour.destroy()
      }
      catch {
        /* 忽略 */
      }
      this.bonjour = null
    }
    this.mdnsStarted = false
  }
}
