# zControl Web · 接口契约（冻结）

> 前端与后端之间的唯一约定。改这里必须同步 `apps/server/src` 与 `apps/web/src/api.ts`。
> 设备只支持 **zM1（type=4）**。

## 1. 数据类型

```ts
/** zM1 定时任务 */
interface Zm1Task { hour: number; minute: number; brightness: number; on: number }
// brightness: 0=关屏 1..4=亮度档；on: 0/1。共 5 组 task_0..task_4，task_4 被倒计时占用

/** 设备最新快照（后端合并 state/sensor/availability 后的结果） */
interface M1State {
  PM25?: number;            // ug/m³
  formaldehyde?: number;    // mg/m³
  temperature?: number;     // ℃
  humidity?: number;        // %
  brightness?: number;      // 0..4
  time?: number;            // 校时结果：UTC 秒级时间戳（<1586000000 视为失败）
  version?: string;         // 固件版本
  interval?: number;        // 上报频率（秒，1..255）
  ssid?: string;            // 连接的热点
  zone?: number;            // 时区分钟偏移（-720..840，中国 480）
  ota_progress?: number;    // 0..99 进行中；>=100 成功；-1 失败
  tasks?: (Zm1Task | null)[]; // 长度 5，未获取为 null
  lastTopic?: 'state' | 'sensor' | null;
}

interface DeviceDTO {
  mac: string; name: string; type: number; typeName: string;
  online: boolean; ip: string | null; order: number;
  state: M1State; updatedAt: number;
}

interface MqttStatus { connected: boolean; uri: string; error: string | null }
interface AppStatus {
  mqtt: MqttStatus;
  udp: { listening: boolean; port: number };
  scan: { active: boolean };
  version: string;
  versionName: string;
  localIps: string[];
}
interface AppSettings {
  mqtt_uri: string;        // "host:port" 形式，如 192.168.1.10:1883
  mqtt_user: string;
  mqtt_clientid: string;
  mqtt_password_set: boolean;  // 密码永不回传明文
  version_no_ask: string;
}
```

## 2. REST（前缀 `/api`，均返回 JSON；失败 `{ error: string }` + 4xx/5xx）

| 方法 | 路径 | 请求体 | 响应 |
| --- | --- | --- | --- |
| GET | `/health` | — | `{ ok, name, version, node, ts }` |
| GET | `/status` | — | `AppStatus` |
| GET | `/devices` | — | `{ devices: DeviceDTO[] }` |
| POST | `/devices` | `{ name, mac, type }` | `{ device: DeviceDTO }`；重复 mac → 409 |
| PATCH | `/devices/:mac` | `{ name }` | `{ device: DeviceDTO }` |
| DELETE | `/devices/:mac` | — | `{ ok: true }` |
| PUT | `/devices/order` | `{ macs: string[] }` | `{ devices: DeviceDTO[] }` |
| GET | `/devices/:mac/state` | — | `{ state: M1State }` |
| POST | `/devices/:mac/cmd` | `{ cmd: object }` | `{ sent: { channel: 'mqtt' \| 'udp', topic: string \| null, payload: string } }` |
| GET | `/devices/:mac/settings` | — | `{ always_UDP: boolean }` |
| PUT | `/devices/:mac/settings` | `{ always_UDP?: boolean }` | `{ always_UDP: boolean }` |
| GET | `/settings` | — | `AppSettings` |
| PUT | `/settings` | `{ mqtt_uri?, mqtt_user?, mqtt_password?, mqtt_clientid? }` | `{ settings: AppSettings, mqtt: MqttStatus }` |
| POST | `/settings/mqtt/sync/:mac` | — | `{ sent: { channel: 'udp', payload: string } }`（云同步，固定走 UDP 广播） |
| GET | `/discovery/scan` | — | `{ active: boolean, devices: DeviceDTO[] }` |
| POST | `/discovery/scan` | `{ action: 'start' \| 'stop' }` | `{ active: boolean, devices: DeviceDTO[] }` |
| GET | `/devices/export` | — | `{ device: { name, mac, type, type_name }[] }` |
| POST | `/devices/import` | `{ device: { name, mac, type }[] }` | `{ total: number, added: number, dup: number, invalid: number }` |
| GET | `/devices/:mac/ota/check` | — | `{ hasUpdate: boolean, current: string, tag_name: string, title: string, message: string, ota: string \| null }` |

### 2.1 `/devices/:mac/cmd` 的 `cmd` 取值（后端会注入 `mac` 字段后下发）

| 场景 | `cmd` |
| --- | --- |
| 查询亮度/传感器 | `{ "brightness": null }` |
| 设置亮度 | `{ "brightness": 3 }`（0..4） |
| 查询 5 组定时任务 | `{ "task_0": {}, "task_1": {}, "task_2": {}, "task_3": {}, "task_4": {} }` |
| 设置某组定时任务 | `{ "task_0": { "hour": 8, "minute": 30, "brightness": 4, "on": 1 } }` |
| 设置倒计时（固定第 5 组） | `{ "task_4": { "hour": 9, "minute": 30, "brightness": 4, "on": 1 } }` |
| 查询设置信息 | `{ "version": null, "interval": null, "ssid": null, "zone": null }` |
| 设置名称 | `{ "setting": { "name": "我的检测仪" } }` |
| 设置时区 | `{ "zone": 480 }`（随后需再发一次 `{ "time": -1 }`） |
| 手动校时 | `{ "time": -1 }` |
| 设置上报频率 | `{ "interval": 60 }`（1..255） |
| 重启设备 | `{ "cmd": "restart" }` |
| OTA 升级 | `{ "setting": { "ota": "https://.../ota.bin" } }` |

> 发送通道由后端决定：设备设置 `always_UDP=true` → 强制 UDP；否则 MQTT 已连接 → 发布到 `device/zm1/{mac}/set`；否则走 UDP 广播 `255.255.255.255:10182`。

## 3. WebSocket `/ws`

服务端 → 客户端，均为 `{ type, data }`：

| type | data | 说明 |
| --- | --- | --- |
| `hello` | `{ status, devices, settings }` | 连接建立时全量快照 |
| `status` | `AppStatus` | MQTT/UDP/扫描状态变化 |
| `devices` | `{ devices: DeviceDTO[] }` | 设备增删改、名称/在线/顺序变化 |
| `data` | `{ mac, source, topic, payload, ts }` | 设备上报（payload 为对象；availability 为字符串 `"1"`/`"0"`） |
| `sent` | `{ mac, source, topic, payload, ts }` | 后端已下发的报文（前端记日志用） |

> 前端不发送任何 WS 消息，全部走 REST。

## 4. 前端约定

- 路由：`/`（主界面：抽屉 + 工具栏 + 设备页签）、`/device/:mac/plug`（亮度定时）、`/device/:mac/settings`（设备设置）、`/device/:mac/link`（配网说明）、`/settings`（应用设置）、`/add`（增加设备）、`/sort`（排序）、`/about`（帮助/关于）。
- 状态：`stores/app.ts`（状态与设置与扫描）、`stores/devices.ts`（设备列表与指令下发）、`stores/log.ts`（设备日志，键为 mac）。
- 实时：`composables/useSocket.ts` 在 `App.vue` 里初始化一次，收到 `data`/`sent`/`status` 自动写入 store 与日志。
- 样式：**不写自定义 CSS**。布局用 Tailwind 工具类，控件用 Vant 组件与其 props。主题色：`#3F51B5`（主色）、`#303F9F`（深主色）、`#FF4081`（强调色）、zM1 数据卡片深色面 `#3F3F3F` + 白字。
- 日志格式：首行 `---- yyyy/MM/dd HH:mm:ss ----`，之后每行 `[HH:mm:ss.sss]内容`。
