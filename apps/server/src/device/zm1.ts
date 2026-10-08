/**
 * zM1 协议编解码。所有下发报文都由这里构造与校验：未在白名单内的字段一律拒绝，
 * 目的是不因为界面 bug 或误用把异常报文写进设备。
 */

export interface Zm1Task {
  hour: number;
  minute: number;
  brightness: number;
  on: number;
}

/**
 * 设备回包的 MQTT 配置（云同步下发后设备回报的 setting 报文）。
 * 密码字段一律不解析、不落库、不回传。
 */
export interface Zm1MqttSetting {
  mqtt_uri: string;
  mqtt_port: number;
  mqtt_user: string;
}

export interface M1State {
  PM25?: number;
  formaldehyde?: number;
  temperature?: number;
  humidity?: number;
  brightness?: number;
  time?: number;
  version?: string;
  interval?: number;
  ssid?: string;
  zone?: number;
  ota_progress?: number;
  /** 设备当前保存的 MQTT 服务器（只有收到过 setting 回包才有） */
  mqttSetting?: Zm1MqttSetting;
  tasks?: (Zm1Task | null)[];
  lastTopic?: 'state' | 'sensor' | null;
}

export const TASK_COUNT = 5;
/** json 中字段为 null 表示「查询」 */
export const QUERY = null;

function toNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toStr(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 单个定时任务：4 个字段齐全且合规才算有效 */
export function parseTask(v: unknown): Zm1Task | null {
  if (!isPlainObject(v)) return null;
  const hour = toNum(v.hour);
  const minute = toNum(v.minute);
  const brightness = toNum(v.brightness);
  const on = toNum(v.on);
  if (hour === undefined || minute === undefined || brightness === undefined || on === undefined) {
    return null;
  }
  return { hour, minute, brightness, on };
}

/** 解析设备回包的 `setting` 里的 MQTT 配置（只有带 mqtt_uri 才认，密码字段忽略） */
export function parseMqttSetting(v: unknown): Zm1MqttSetting | null {
  if (!isPlainObject(v)) return null;
  const uri = toStr(v.mqtt_uri);
  if (uri === undefined) return null;
  return {
    mqtt_uri: uri,
    mqtt_port: toNum(v.mqtt_port) ?? 0,
    mqtt_user: toStr(v.mqtt_user) ?? '',
  };
}

/** 解析设备上报的 JSON（state / sensor 走同一段逻辑） */
export function parseState(payload: Record<string, unknown>): {
  state: Partial<M1State>;
  tasks: (Zm1Task | null)[];
} {
  const state: Partial<M1State> = {};
  const tasks: (Zm1Task | null)[] = new Array(TASK_COUNT).fill(null);

  const pm25 = toNum(payload.PM25);
  if (pm25 !== undefined) state.PM25 = pm25;

  const formaldehyde = toNum(payload.formaldehyde);
  if (formaldehyde !== undefined) state.formaldehyde = formaldehyde;

  const temperature = toNum(payload.temperature);
  if (temperature !== undefined) state.temperature = temperature;

  const humidity = toNum(payload.humidity);
  if (humidity !== undefined) state.humidity = humidity;

  const brightness = toNum(payload.brightness);
  if (brightness !== undefined) state.brightness = brightness;

  const time = toNum(payload.time);
  if (time !== undefined) state.time = time;

  const interval = toNum(payload.interval);
  if (interval !== undefined) state.interval = interval;

  const zone = toNum(payload.zone);
  if (zone !== undefined) state.zone = zone;

  const otaProgress = toNum(payload.ota_progress);
  if (otaProgress !== undefined) state.ota_progress = otaProgress;

  const version = toStr(payload.version);
  if (version !== undefined) state.version = version;

  const ssid = toStr(payload.ssid);
  if (ssid !== undefined) state.ssid = ssid;

  const mqttSetting = parseMqttSetting(payload.setting);
  if (mqttSetting) state.mqttSetting = mqttSetting;

  for (let i = 0; i < TASK_COUNT; i++) {
    const t = parseTask(payload[`task_${i}`]);
    if (t) tasks[i] = t;
  }

  return { state, tasks };
}

/** 是否需要把 tasks 合并进快照（有任意一组有效才合并） */
export function hasAnyTask(tasks: (Zm1Task | null)[]): boolean {
  return tasks.some((t) => t !== null);
}

// ---------------------------------------------------------------------------
// 下发报文构造与校验
// ---------------------------------------------------------------------------

const TOP_ALLOWED = new Set([
  'brightness',
  'time',
  'interval',
  'zone',
  'version',
  'ssid',
  'cmd',
  'setting',
  'task_0',
  'task_1',
  'task_2',
  'task_3',
  'task_4',
]);

const SETTING_ALLOWED = new Set(['name', 'ota', 'mqtt_uri', 'mqtt_port', 'mqtt_user', 'mqtt_password']);

/** 明确不支持的能力（拒绝而不是静默丢弃） */
const REJECTED_KEYS = new Set(['za1', 'repeat', 'action', 'lock']);

function err(msg: string): string {
  return msg;
}

/** 返回 null 表示合法，否则返回错误说明 */
export function validateCommand(cmd: Record<string, unknown>): string | null {
  if (!isPlainObject(cmd)) return '指令必须是对象';
  const keys = Object.keys(cmd);
  if (keys.length === 0) return '指令不能为空';

  for (const k of keys) {
    if (REJECTED_KEYS.has(k)) return `字段 ${k} 暂不支持`;
    if (!TOP_ALLOWED.has(k)) return `不允许的字段: ${k}`;
  }

  if ('brightness' in cmd) {
    const v = cmd.brightness;
    if (v !== QUERY) {
      const n = toNum(v);
      if (n === undefined || !Number.isInteger(n) || n < 0 || n > 4) return 'brightness 必须为 null 或 0-4';
    }
  }

  if ('time' in cmd) {
    const n = toNum(cmd.time);
    if (n === undefined || !Number.isInteger(n) || (n !== -1 && n <= 0)) return 'time 必须为 -1 或正整数时间戳';
  }

  if ('interval' in cmd) {
    if (cmd.interval !== QUERY) {
      const n = toNum(cmd.interval);
      if (n === undefined || !Number.isInteger(n) || n < 1 || n > 255) return 'interval 必须为 null 或 1-255';
    }
  }

  if ('zone' in cmd) {
    if (cmd.zone !== QUERY) {
      const n = toNum(cmd.zone);
      if (n === undefined || !Number.isInteger(n) || n < -720 || n > 840) return 'zone 必须为 null 或 -720..840 分钟';
    }
  }

  for (const k of ['version', 'ssid'] as const) {
    if (k in cmd && cmd[k] !== null) return `${k} 只能为 null（查询）`;
  }

  if ('cmd' in cmd && cmd.cmd !== 'restart') return 'cmd 只支持 restart';

  if ('setting' in cmd) {
    const s = cmd.setting;
    if (!isPlainObject(s)) return 'setting 必须是对象';
    for (const [k, v] of Object.entries(s)) {
      if (!SETTING_ALLOWED.has(k)) return `setting 不允许的字段: ${k}`;
      if (k === 'name') {
        if (typeof v !== 'string' || v.length === 0) return 'name 必须是非空字符串';
        if (Buffer.byteLength(v, 'utf8') > 32) return 'name 最长 32 字节';
      }
      if (k === 'ota') {
        if (typeof v !== 'string' || !v.startsWith('http')) return 'ota 必须是以 http 开头的地址';
      }
      if (k === 'mqtt_port') {
        const n = toNum(v);
        if (n === undefined || !Number.isInteger(n) || n < 0 || n > 65535) return 'mqtt_port 不合法';
      }
    }
  }

  for (let i = 0; i < TASK_COUNT; i++) {
    const key = `task_${i}`;
    if (!(key in cmd)) continue;
    const v = cmd[key];
    if (!isPlainObject(v)) return `${key} 必须是对象`;
    if (Object.keys(v).length === 0) continue; // {} = 查询
    const t = v as Record<string, unknown>;
    for (const f of Object.keys(t)) {
      if (!['hour', 'minute', 'brightness', 'on'].includes(f)) return `${key} 不允许的字段: ${f}`;
    }
    const hour = toNum(t.hour);
    const minute = toNum(t.minute);
    const brightness = toNum(t.brightness);
    const on = toNum(t.on);
    if (hour === undefined || !Number.isInteger(hour) || hour < 0 || hour > 23) return `${key}.hour 必须 0-23`;
    if (minute === undefined || !Number.isInteger(minute) || minute < 0 || minute > 59) return `${key}.minute 必须 0-59`;
    if (brightness === undefined || !Number.isInteger(brightness) || brightness < 0 || brightness > 4) {
      return `${key}.brightness 必须 0-4`;
    }
    if (on === undefined || !Number.isInteger(on) || (on !== 0 && on !== 1)) return `${key}.on 必须 0 或 1`;
  }

  return null;
}

/** 构造下发的 JSON（mac 恒为第一个字段） */
export function buildCommand(mac: string, cmd: Record<string, unknown>): string {
  const error = validateCommand(cmd);
  if (error) throw new Error(err(error));
  const out: Record<string, unknown> = { mac };
  for (const [k, v] of Object.entries(cmd)) out[k] = v;
  return JSON.stringify(out);
}

/**
 * 云同步 payload：{name, mac, setting:{mqtt_uri, mqtt_port, mqtt_user, mqtt_password}}，
 * mqtt_uri 只带主机名。
 */
export function buildMqttSyncPayload(params: {
  name: string;
  mac: string;
  mqttUri: string;
  mqttUser: string;
  mqttPassword: string;
}): string {
  const { host, port } = parseMqttUri(params.mqttUri);
  const setting = params.mqttUri
    ? { mqtt_uri: host, mqtt_port: port, mqtt_user: params.mqttUser, mqtt_password: params.mqttPassword }
    : { mqtt_uri: '', mqtt_port: 0, mqtt_user: '', mqtt_password: '' };
  return JSON.stringify({ name: params.name, mac: params.mac, setting });
}

/** 解析 mqtt_uri：`主机:端口`，只填主机时补 1883 */
export function parseMqttUri(uri: string): { host: string; port: number; valid: boolean } {
  const raw = (uri ?? '').trim();
  if (!raw) return { host: '', port: 0, valid: true };
  const parts = raw.split(':');
  if (parts.length === 1) return { host: parts[0], port: 1883, valid: parts[0].length > 0 };
  if (parts.length === 2) {
    const port = Number(parts[1]);
    const ok = parts[0].length > 0 && Number.isInteger(port) && port > 0 && port <= 65535;
    return { host: parts[0], port: ok ? port : 1883, valid: ok };
  }
  return { host: '', port: 0, valid: false };
}

/** 比较版本标签（去掉非数字字符后逐段比大小） */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (s: string) =>
    s
      .replaceAll(/[^.1234567890]/g, '')
      .split('.')
      .map((x) => Number.parseInt(x, 10) || 0);
  const a = parse(candidate);
  const b = parse(current);
  for (let i = 0; i < a.length && i < b.length; i++) {
    if (b[i] < a[i]) return true;
    if (b[i] > a[i]) return false;
  }
  return a.length > b.length;
}
