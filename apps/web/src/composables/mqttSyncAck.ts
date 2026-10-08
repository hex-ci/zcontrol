import { showToast } from 'vant';
import { useDeviceStore } from '../stores/devices';

/**
 * 云同步确认：设备收到 MQTT 配置后会回一条带 `setting` 的报文
 * （原版应用在此弹「已设置"设备名"mqtt服务器: 地址:端口 / 用户名」）。
 *
 * 这里只在**实时收到**的报文上弹（WS 的 data 事件），不用快照回放：
 * 页面加载时 REST/WS 快照里可能本来就有设备上次保存的配置（state topic 是 retained），
 * 那是历史值，弹一次纯属噪声；设备真回了包才代表「刚才那次下发它收下了」。
 *
 * 同一台设备连续收到完全相同的一份配置只弹一次，避免重复包刷屏。
 * 另外对外提供 onMqttSyncAck：云同步流程靠它判断"有没有等到回包"（超时后提示重发）。
 */

export interface MqttSyncAck {
  mac: string;
  mqtt_uri: string;
  mqtt_port: number;
  mqtt_user: string;
}

type AckHandler = (ack: MqttSyncAck) => void;

const handlers = new Set<AckHandler>();
const toasted = new Map<string, string>();

/** 订阅「设备回报了 MQTT 配置」事件；返回取消订阅函数 */
export function onMqttSyncAck(handler: AckHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

/** 解析设备回包里的 MQTT 配置；不是配置回包时返回 null */
export function parseMqttSyncAck(mac: string, payload: unknown): MqttSyncAck | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const setting = (payload as { setting?: unknown }).setting;
  if (typeof setting !== 'object' || setting === null) return null;

  const s = setting as { mqtt_uri?: unknown; mqtt_port?: unknown; mqtt_user?: unknown };
  // 只有带 mqtt_uri 的 setting 才是 MQTT 配置回包（下发名称/OTA 时 device 也可能回 setting）
  if (typeof s.mqtt_uri !== 'string') return null;

  return {
    mac,
    mqtt_uri: s.mqtt_uri,
    mqtt_port: typeof s.mqtt_port === 'number' ? s.mqtt_port : 0,
    mqtt_user: typeof s.mqtt_user === 'string' ? s.mqtt_user : '',
  };
}

export function notifyMqttSyncAck(mac: string, payload: unknown): void {
  const ack = parseMqttSyncAck(mac, payload);
  if (!ack) return;

  // 先通知等待方（云同步的重发判断），再决定要不要弹 toast
  for (const handler of [...handlers]) handler(ack);

  const key = `${ack.mqtt_uri}:${ack.mqtt_port}/${ack.mqtt_user}`;
  if (toasted.get(mac) === key) return;
  toasted.set(mac, key);

  const name = useDeviceStore().byMac(mac)?.name ?? mac;
  showToast({
    message: `已设置 "${name}" MQTT 服务器:\n${ack.mqtt_uri}:${ack.mqtt_port}\n${ack.mqtt_user}`,
    duration: 5000,
  });
}
