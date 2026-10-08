import { EV, bus } from '../core/bus.ts'
import { MAC_RE, TYPE_M1, TYPE_NAMES } from '../config.ts'
import type { DeviceDTO } from './dto.ts'
import type { M1State, Zm1Task } from './zm1.ts'
import { hasAnyTask, parseState } from './zm1.ts'
import type { Store } from '../store/db.ts'

/** 合并一帧上报到快照上：字段覆盖，定时任务逐组覆盖，记录来源 topic */
function mergeState(
  prev: M1State,
  state: Partial<M1State>,
  tasks: (Zm1Task | null)[],
  topic: string | null,
): M1State {
  const next: M1State = { ...prev, ...state }
  if (hasAnyTask(tasks)) {
    const base = prev.tasks ?? new Array(5).fill(null)
    next.tasks = base.map((t, i) => tasks[i] ?? t)
  }
  if (topic) {
    const last = topic.split('/').pop()
    if (last === 'state' || last === 'sensor') next.lastTopic = last
  }
  return next
}

/**
 * 设备注册表：内存中的设备列表 + 最新状态快照，落库由 Store 负责。
 */
export class Registry {
  private store: Store
  private list: DeviceDTO[] = []
  /**
   * 添加设备之前就收到的报文先缓存下来，添加设备时再套用。
   * 后端是常驻订阅，必须先缓存才能让新添加的设备立即带上最新状态。
   */
  private pending = new Map<
    string,
    {
      state: M1State
      name: string | null
      availability: boolean | null
      lastSource: 'mqtt' | 'udp'
      ts: number
    }
  >()

  constructor(store: Store) {
    this.store = store
    this.load()
  }

  load(): void {
    this.list = this.store.devices().map((row, index) => ({
      mac: row.mac,
      name: row.name,
      type: row.type,
      typeName: TYPE_NAMES[row.type] ?? '未知设备',
      online: false,
      ip: null,
      order: row.sort ?? index,
      state: {},
      updatedAt: 0,
    }))
    this.emit()
  }

  snapshot(): DeviceDTO[] {
    return this.list
  }

  find(mac: string): DeviceDTO | null {
    return this.list.find(d => d.mac === mac) ?? null
  }

  has(mac: string): boolean {
    return this.list.some(d => d.mac === mac)
  }

  add(name: string, mac: string, type = TYPE_M1): DeviceDTO {
    const lower = mac.toLowerCase()
    if (!MAC_RE.test(lower)) throw new Error('mac 必须是 12 位十六进制字符串')
    const exist = this.find(lower)
    if (exist) throw Object.assign(new Error('设备已存在'), { statusCode: 409 })
    const dto: DeviceDTO = {
      mac: lower,
      name: name || `zM1_${lower.slice(-4)}`,
      type,
      typeName: TYPE_NAMES[type] ?? '未知设备',
      online: false,
      ip: null,
      order: this.list.length,
      state: {},
      updatedAt: 0,
    }
    this.list.push(dto)
    this.store.insertDevice(dto.name, dto.type, dto.mac, this.list.length - 1)

    // 套用添加之前缓存到的报文
    const pending = this.pending.get(dto.mac)
    if (pending) {
      dto.state = pending.state
      dto.updatedAt = pending.ts
      if (pending.name) {
        dto.name = pending.name
        this.store.updateName(dto.mac, dto.name)
      }
      if (pending.availability !== null) dto.online = pending.availability
      else if (pending.lastSource === 'mqtt') dto.online = true
      this.pending.delete(dto.mac)
    }

    this.emit()
    return dto
  }

  remove(mac: string): boolean {
    const idx = this.list.findIndex(d => d.mac === mac)
    if (idx < 0) return false
    this.list.splice(idx, 1)
    this.store.deleteDevice(mac)
    this.persistOrder()
    this.emit()
    return true
  }

  rename(mac: string, name: string): DeviceDTO | null {
    const d = this.find(mac)
    if (!d) return null
    if (d.name === name) return d
    d.name = name
    this.store.updateName(mac, name)
    this.emit()
    return d
  }

  reorder(macs: string[]): DeviceDTO[] {
    const map = new Map(this.list.map(d => [d.mac, d]))
    const next: DeviceDTO[] = []
    for (const mac of macs) {
      const d = map.get(mac)
      if (d) {
        next.push(d)
        map.delete(mac)
      }
    }
    for (const d of map.values()) next.push(d)
    this.list = next
    this.persistOrder()
    this.emit()
    return this.list
  }

  private persistOrder(): void {
    this.list.forEach((d, i) => {
      d.order = i
    })
    this.store.reorder(this.list.map(d => d.mac))
  }

  setIp(mac: string, ip: string): void {
    const d = this.find(mac)
    if (d && d.ip !== ip) {
      d.ip = ip
      this.emit()
    }
  }

  /** availability 报文（payload 为 "1" 表示在线） */
  setOnline(mac: string, online: boolean): void {
    const d = this.find(mac)
    if (!d) {
      const p = this.pending.get(mac) ?? {
        state: {},
        name: null,
        availability: null,
        lastSource: 'mqtt' as const,
        ts: 0,
      }
      p.availability = online
      p.ts = Date.now()
      this.pending.set(mac, p)
      return
    }
    if (d.online !== online) {
      d.online = online
      d.updatedAt = Date.now()
      this.emit()
    }
  }

  /** 合并一帧上报数据（state / sensor 同一段逻辑） */
  applyState(
    mac: string,
    payload: Record<string, unknown>,
    topic: string | null,
    source: 'mqtt' | 'udp' = 'mqtt',
  ): void {
    const { state, tasks } = parseState(payload)
    const d = this.find(mac)

    if (!d) {
      const p = this.pending.get(mac) ?? {
        state: {},
        name: null,
        availability: null,
        lastSource: source,
        ts: 0,
      }
      p.state = mergeState(p.state, state, tasks, topic)
      if (typeof payload.name === 'string' && payload.name) p.name = payload.name
      p.lastSource = source
      p.ts = Date.now()
      this.pending.set(mac, p)
      return
    }

    d.state = mergeState(d.state, state, tasks, topic)
    // 能收到 MQTT 报文即说明设备连着 broker
    if (source === 'mqtt') d.online = true
    d.updatedAt = Date.now()
    this.emit()
  }

  emit(): void {
    bus.emit(EV.DEVICES, { devices: this.list })
  }
}
