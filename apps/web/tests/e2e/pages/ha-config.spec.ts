import { expect, test, type Page } from '@playwright/test';

/**
 * 设备设置页「Home Assistant → 生成 MQTT 配置」e2e：
 *   入口 → 后端生成 YAML → 弹窗展示 → 复制 / 下载。
 *
 * 安全：/api/** 全部 page.route 拦截，WebSocket mock 掉；不连真实后端，也不向设备下发任何报文。
 */
test.use({ trace: 'off', permissions: ['clipboard-read', 'clipboard-write'] });
test.describe.configure({ timeout: 90_000 });

const MAC = 'aabbccddeeff';

const STATUS = {
  mqtt: { connected: true, uri: '192.168.1.10:1883', error: null },
  udp: { listening: true, port: 10181 },
  scan: { active: false },
  version: '1.0.0',
  versionName: '1.0.0',
  localIps: ['192.168.1.50'],
};

const SETTINGS = {
  mqtt_uri: '192.168.1.10:1883',
  mqtt_user: '',
  mqtt_clientid: 'zcontrol-web',
  mqtt_password_set: false,
  version_no_ask: '',
};

const DEVICE = {
  mac: MAC,
  name: '悟空M1',
  type: 4,
  typeName: 'zM1空气检测仪',
  online: true,
  ip: '192.168.1.50',
  order: 0,
  state: { version: 'v1.0.0', interval: 60, ssid: 'TestWiFi', zone: 0 },
  updatedAt: 1700000000000,
};

/** 后端返回的 YAML（真实格式见 apps/server/src/device/ha-config.ts） */
const YAML = [
  '# zM1 空气检测仪 · Home Assistant MQTT 配置',
  'mqtt:',
  '  sensor:',
  '    # 温度',
  `    - name: zm1_${MAC}_temperature`,
  `      unique_id: zm1_${MAC}_temperature`,
  `      state_topic: "device/zm1/${MAC}/sensor"`,
  '      device_class: temperature',
  '      device:',
  '        identifiers:',
  `          - "zm1_${MAC}"`,
  '        name: "悟空M1"',
  '  light:',
  `    - name: zm1_${MAC}_brightness`,
  '      schema: template',
].join('\n');

async function setup(page: Page): Promise<{ haRequests: string[] }> {
  const haRequests: string[] = [];

  await page.routeWebSocket(/\/ws$/, () => {
    /* 静默 mock：不连真实后端 */
  });
  await page.route('**/api/status', (route) => route.fulfill({ json: STATUS }));
  await page.route('**/api/settings', (route) => route.fulfill({ json: SETTINGS }));
  await page.route('**/api/devices', (route) => route.fulfill({ json: { devices: [DEVICE] } }));
  await page.route('**/api/devices/*/settings', (route) => route.fulfill({ json: { always_UDP: false } }));
  await page.route('**/api/devices/*/cmd', (route) =>
    route.fulfill({ json: { sent: { channel: 'mqtt', topic: `device/zm1/${MAC}/set`, payload: '' } } }),
  );
  await page.route('**/api/devices/*/ha-config', (route) => {
    haRequests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { file_name: `zm1_${MAC}_ha.yaml`, yaml: YAML } });
  });

  return { haRequests };
}

async function openSettings(page: Page): Promise<void> {
  await page.goto(`/#/device/${MAC}/settings`);
  await expect(page.getByTestId('ha-config-entry')).toBeVisible();
}

test('设备设置页：生成 HA 配置并展示 YAML', async ({ page }) => {
  const { haRequests } = await setup(page);
  await openSettings(page);

  // 未点之前不请求后端
  expect(haRequests).toHaveLength(0);

  await page.getByTestId('ha-config-entry').click();
  await expect.poll(() => haRequests.length).toBe(1);
  expect(haRequests[0]).toBe(`/api/devices/${MAC}/ha-config`);

  const yaml = page.getByTestId('ha-yaml');
  await expect(yaml).toBeVisible();
  await expect(yaml).toContainText('mqtt:');
  await expect(yaml).toContainText(`state_topic: "device/zm1/${MAC}/sensor"`);
  await expect(yaml).toContainText('schema: template');
  // 实体名必须是 mac 命名（entity_id 不变，用户面板不被改坏），设备中文名只出现在 device.name
  await expect(yaml).toContainText(`name: zm1_${MAC}_temperature`);
  await expect(yaml).not.toContainText('悟空M1 温度');
  await expect(yaml).toContainText('name: "悟空M1"');
  // 说明文案里点明只生成文本
  await expect(page.getByText(/不向设备下发任何数据/)).toBeVisible();
});

test('设备设置页：HA 配置可复制到剪贴板', async ({ page }) => {
  await setup(page);
  await openSettings(page);
  await page.getByTestId('ha-config-entry').click();
  await expect(page.getByTestId('ha-yaml')).toBeVisible();

  await page.getByTestId('ha-copy').click();
  await expect(page.locator('.van-toast')).toContainText('已复制HA配置');

  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain('mqtt:');
  expect(clip).toContain(`device/zm1/${MAC}/sensor`);
});

test('设备设置页：HA 配置可下载为 yaml 文件', async ({ page }) => {
  await setup(page);
  await openSettings(page);
  await page.getByTestId('ha-config-entry').click();
  await expect(page.getByTestId('ha-yaml')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('ha-download').click(),
  ]);
  expect(download.suggestedFilename()).toBe(`zm1_${MAC}_ha.yaml`);
});
