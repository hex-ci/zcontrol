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
 */
const toasted = new Map<string, string>();

export function notifyMqttSyncAck(mac: string, payload: unknown): void {
  if (typeof payload !== 'object' || payload === null) return;
  const setting = (payload as { setting?: unknown }).setting;
  if (typeof setting !== 'object' || setting === null) return;

  const s = setting as { mqtt_uri?: unknown; mqtt_port?: unknown; mqtt_user?: unknown };
  // 只有带 mqtt_uri 的 setting 才是 MQTT 配置回包（下发名称/OTA 时 device 也可能回 setting）
  if (typeof s.mqtt_uri !== 'string') return;

  const port = typeof s.mqtt_port === 'number' ? s.mqtt_port : 0;
  const user = typeof s.mqtt_user === 'string' ? s.mqtt_user : '';
  const key = `${s.mqtt_uri}:${port}/${user}`;
  if (toasted.get(mac) === key) return;
  toasted.set(mac, key);

  const name = useDeviceStore().byMac(mac)?.name ?? mac;
  showToast({
    message: `已设置"${name}"mqtt服务器:\n${s.mqtt_uri}:${port}\n${user}`,
    duration: 5000,
  });
}
