import type { FastifyInstance } from 'fastify';
import {
  APP_VERSION,
  FIRMWARE_RELEASE_LATEST,
  FIRMWARE_RELEASE_TAG,
  FIRMWARE_RELEASE_TAG_PREFIX,
  MAC_RE,
  TYPE_M1,
} from '../config.ts';
import { EV, bus } from '../core/bus.ts';
import type { AppCtx } from '../core/context.ts';
import { buildStatus, sendCommand } from '../core/status.ts';
import { buildMqttSyncPayload, isNewerVersion, parseMqttUri, validateCommand } from '../device/zm1.ts';
import { buildHaConfig, haConfigFileName } from '../device/ha-config.ts';

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

async function fetchJson(url: string, timeoutMs = 12_000): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw httpError(502, `请求 ${url} 失败: HTTP ${res.status}`);
  const data: unknown = await res.json();
  if (typeof data !== 'object' || data === null) throw httpError(502, '返回内容不是 JSON 对象');
  return data as Record<string, unknown>;
}

export function registerRoutes(app: FastifyInstance, ctx: AppCtx): void {
  app.get('/api/health', async () => ({
    ok: true,
    name: 'zcontrol-server',
    version: APP_VERSION,
    node: process.version,
    ts: new Date().toISOString(),
  }));

  app.get('/api/status', async () => buildStatus(ctx));

  // ---- 设备列表 ----

  app.get('/api/devices', async () => ({ devices: ctx.registry.snapshot() }));

  app.post('/api/devices', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; mac?: string; type?: number };
    const mac = String(body.mac ?? '')
      .replaceAll(/[^0-9a-fA-F]/g, '')
      .toLowerCase();
    if (!MAC_RE.test(mac)) throw httpError(400, 'mac 必须是 12 位十六进制');
    const type = body.type ?? TYPE_M1;
    if (type !== TYPE_M1) throw httpError(400, '仅支持 zM1（type=4）');
    const device = ctx.registry.add(String(body.name ?? '').trim() || `zM1_${mac.slice(-4)}`, mac, type);
    reply.code(201);
    return { device };
  });

  app.patch('/api/devices/:mac', async (req) => {
    const { mac } = req.params as { mac: string };
    const { name } = (req.body ?? {}) as { name?: string };
    const trimmed = String(name ?? '').trim();
    if (!trimmed) throw httpError(400, '名称不能为空');
    if (Buffer.byteLength(trimmed, 'utf8') > 32) throw httpError(400, '名称最长 32 字节');
    const device = ctx.registry.rename(mac.toLowerCase(), trimmed);
    if (!device) throw httpError(404, '设备不存在');
    return { device };
  });

  app.delete('/api/devices/:mac', async (req) => {
    const { mac } = req.params as { mac: string };
    const ok = ctx.registry.remove(mac.toLowerCase());
    if (!ok) throw httpError(404, '设备不存在');
    return { ok: true };
  });

  app.put('/api/devices/order', async (req) => {
    const { macs } = (req.body ?? {}) as { macs?: string[] };
    if (!Array.isArray(macs)) throw httpError(400, 'macs 必须是数组');
    return { devices: ctx.registry.reorder(macs.map((m) => m.toLowerCase())) };
  });

  app.get('/api/devices/export', async () => ({
    device: ctx.registry.snapshot().map((d) => ({
      name: d.name,
      mac: d.mac,
      type: d.type,
      type_name: d.typeName,
    })),
  }));

  app.post('/api/devices/import', async (req) => {
    const { device } = (req.body ?? {}) as {
      device?: { name?: string; mac?: string; type?: number }[];
    };
    if (!Array.isArray(device)) throw httpError(400, 'device 必须是数组');
    let total = 0;
    let added = 0;
    let dup = 0;
    let invalid = 0;
    for (const item of device) {
      const mac = String(item?.mac ?? '')
        .replaceAll(/[^0-9a-fA-F]/g, '')
        .toLowerCase();
      const type = item?.type ?? TYPE_M1;
      const name = String(item?.name ?? '').trim();
      if (!MAC_RE.test(mac) || type !== TYPE_M1 || !name) {
        invalid++;
        continue;
      }
      total++;
      if (ctx.registry.has(mac)) {
        dup++;
        continue;
      }
      ctx.registry.add(name, mac, type);
      added++;
    }
    return { total, added, dup, invalid };
  });

  // ---- 单设备 ----

  app.get('/api/devices/:mac/state', async (req) => {
    const { mac } = req.params as { mac: string };
    const device = ctx.registry.find(mac.toLowerCase());
    if (!device) throw httpError(404, '设备不存在');
    return { state: device.state };
  });

  app.get('/api/devices/:mac/settings', async (req) => {
    const { mac } = req.params as { mac: string };
    if (!ctx.registry.has(mac.toLowerCase())) throw httpError(404, '设备不存在');
    return { always_UDP: ctx.settings.alwaysUdp(mac.toLowerCase()) };
  });

  app.put('/api/devices/:mac/settings', async (req) => {
    const { mac } = req.params as { mac: string };
    const lower = mac.toLowerCase();
    if (!ctx.registry.has(lower)) throw httpError(404, '设备不存在');
    const body = (req.body ?? {}) as { always_UDP?: boolean };
    if (body.always_UDP !== undefined) ctx.settings.setAlwaysUdp(lower, Boolean(body.always_UDP));
    return { always_UDP: ctx.settings.alwaysUdp(lower) };
  });

  /** 下发 zM1 指令（唯一写入口，字段白名单在 device/zm1.ts） */
  app.post('/api/devices/:mac/cmd', async (req) => {
    const { mac } = req.params as { mac: string };
    const lower = mac.toLowerCase();
    const { cmd } = (req.body ?? {}) as { cmd?: Record<string, unknown> };
    if (!cmd || typeof cmd !== 'object') throw httpError(400, 'cmd 必须是对象');
    const error = validateCommand(cmd);
    if (error) throw httpError(400, error);
    const sent = sendCommand(ctx, lower, cmd);
    bus.emit(EV.SENT, {
      mac: lower,
      source: sent.channel,
      topic: sent.topic,
      payload: sent.payload,
      ts: Date.now(),
    });
    return { sent };
  });

  app.get('/api/devices/:mac/ota/check', async (req) => {
    const { mac } = req.params as { mac: string };
    const device = ctx.registry.find(mac.toLowerCase());
    if (!device) throw httpError(404, '设备不存在');
    const current = device.state.version ?? '';
    const latest = await fetchJson(FIRMWARE_RELEASE_LATEST);
    const tagName = typeof latest.tag_name === 'string' ? latest.tag_name : '';
    if (!tagName) throw httpError(502, '获取最新版本信息失败');
    const title = typeof latest.name === 'string' ? latest.name : '';
    const message = typeof latest.body === 'string' ? latest.body : '';
    const hasUpdate = current ? isNewerVersion(tagName, current) : tagName !== current;

    let ota: string | null = null;
    if (hasUpdate) {
      const rel = await fetchJson(FIRMWARE_RELEASE_TAG);
      if (rel.name === FIRMWARE_RELEASE_TAG_PREFIX + tagName && typeof rel.body === 'string') {
        ota = rel.body.trim();
      }
    }
    return { hasUpdate, current, tag_name: tagName, title, message, ota };
  });

  /**
   * Home Assistant 的 MQTT 配置片段（纯文本生成，不发任何报文给设备）。
   * 对应 PC 端参考实现的「生成 HA 配置」按钮。
   */
  app.get('/api/devices/:mac/ha-config', async (req) => {
    const { mac } = req.params as { mac: string };
    const device = ctx.registry.find(mac.toLowerCase());
    if (!device) throw httpError(404, '设备不存在');
    return {
      file_name: haConfigFileName(device.mac),
      yaml: buildHaConfig({ mac: device.mac, name: device.name }),
    };
  });

  // ---- 全局设置 ----

  app.get('/api/settings', async () => ctx.settings.masked());

  app.put('/api/settings', async (req) => {
    const body = (req.body ?? {}) as {
      mqtt_uri?: string;
      mqtt_user?: string;
      mqtt_password?: string;
      mqtt_clientid?: string;
      version_no_ask?: string;
    };
    if (body.mqtt_uri !== undefined) {
      const parsed = parseMqttUri(body.mqtt_uri);
      if (!parsed.valid) {
        throw httpError(400, '保存失败!格式错误.\n格式:地址:端口\n如192.168.1.1:1883');
      }
      // 只填主机时补默认端口，落库保存规范化后的 `主机:端口`
      body.mqtt_uri = body.mqtt_uri.trim() ? `${parsed.host}:${parsed.port}` : '';
    }
    const before = {
      uri: ctx.settings.mqttUri(),
      user: ctx.settings.mqttUser(),
      pass: ctx.settings.mqttPassword(),
      clientId: ctx.settings.mqttClientId(),
    };
    ctx.settings.set(body);
    const after = {
      uri: ctx.settings.mqttUri(),
      user: ctx.settings.mqttUser(),
      pass: ctx.settings.mqttPassword(),
      clientId: ctx.settings.mqttClientId(),
    };
    const changed =
      before.uri !== after.uri ||
      before.user !== after.user ||
      before.pass !== after.pass ||
      before.clientId !== after.clientId;
    if (changed && after.uri && ctx.allowConnect) {
      ctx.mqtt.connect(after.uri, after.clientId, after.user, after.pass);
    }
    return { settings: ctx.settings.masked(), mqtt: ctx.mqtt.status() };
  });

  /** 云同步：把后端保存的 MQTT 配置下发给设备（固定走 UDP） */
  app.post('/api/settings/mqtt/sync/:mac', async (req) => {
    const { mac } = req.params as { mac: string };
    const device = ctx.registry.find(mac.toLowerCase());
    if (!device) throw httpError(404, '设备不存在');
    const payload = buildMqttSyncPayload({
      name: device.name,
      mac: device.mac,
      mqttUri: ctx.settings.mqttUri(),
      mqttUser: ctx.settings.mqttUser(),
      mqttPassword: ctx.settings.mqttPassword(),
    });
    ctx.udp.send(payload);
    bus.emit(EV.SENT, { mac: device.mac, source: 'udp', topic: null, payload, ts: Date.now() });
    return { sent: { channel: 'udp', payload } };
  });

  // ---- 局域网发现 ----

  app.get('/api/discovery/scan', async () => ({
    active: ctx.discovery.active,
    devices: ctx.discovery.list(),
  }));

  app.post('/api/discovery/scan', async (req) => {
    const { action } = (req.body ?? {}) as { action?: string };
    if (action === 'start') {
      ctx.discovery.clear();
      ctx.discovery.start();
    } else if (action === 'stop') {
      ctx.discovery.stop();
    } else {
      throw httpError(400, "action 只能是 'start' 或 'stop'");
    }
    return { active: ctx.discovery.active, devices: ctx.discovery.list() };
  });
}
