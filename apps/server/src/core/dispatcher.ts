import { EV, bus } from '../core/bus.ts';
import { AVAILABILITY_RE } from '../config.ts';
import type { Registry } from '../device/registry.ts';
import type { DiscoveryService } from '../transport/discovery.ts';

/**
 * 报文分发规则：
 *  1. topic 以 availability 结尾 → payload 非 JSON，按正则取 mac，payload=="1" 为在线；
 *  2. 其余 payload → JSON，必须含 mac；
 *     含 mac+type+name 的视为对 {"cmd":"device report"} 的响应（走扫描列表）；
 *     否则作为设备数据合并进注册表并推给前端；
 *  3. 任何含 name 的报文都同步更新设备名称。
 */
export class Dispatcher {
  private registry: Registry;
  private discovery: DiscoveryService;

  constructor(registry: Registry, discovery: DiscoveryService) {
    this.registry = registry;
    this.discovery = discovery;
  }

  handleMqtt(topic: string, payload: string): void {
    this.handle(topic, payload, 'mqtt', null);
  }

  handleUdp(ip: string, port: number, payload: string): void {
    this.handle(null, payload, 'udp', ip);
  }

  private handle(topic: string | null, text: string, source: 'mqtt' | 'udp', ip: string | null): void {
    const ts = Date.now();

    // 1) availability：非 JSON
    if (topic && topic.endsWith('availability')) {
      const m = AVAILABILITY_RE.exec(topic);
      if (m) {
        const mac = m[2];
        this.registry.setOnline(mac, text === '1');
        bus.emit(EV.DATA, { mac, source, topic, payload: text, ts });
      }
      return;
    }

    // 2) JSON 报文
    let obj: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
      obj = parsed as Record<string, unknown>;
    } catch {
      return;
    }

    const mac = typeof obj.mac === 'string' ? obj.mac.toLowerCase() : null;
    if (!mac) return;

    if (typeof obj.name === 'string' && typeof obj.type === 'number') {
      // 对 {"cmd":"device report"} 的响应
      this.discovery.report(obj.name, mac, obj.type, ip);
      if (ip) this.registry.setIp(mac, ip);
    } else {
      if (ip) this.registry.setIp(mac, ip);
      this.registry.applyState(mac, obj, topic, source);
      bus.emit(EV.DATA, { mac, source, topic, payload: obj, ts });
    }

    // 3) 名称同步
    if (typeof obj.name === 'string' && obj.name.length > 0 && this.registry.has(mac)) {
      this.registry.rename(mac, obj.name);
    }
  }
}
