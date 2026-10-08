import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

/**
 * 云同步（主页顶栏右侧的 ⇄ 图标）相关 e2e：
 *   1) 点该入口下发本机 MQTT 配置；
 *   2) 设备回包 setting → 弹 Toast 确认设备实际保存的配置（原版 DeviceFragment 的行为）；
 *   3) 设备列表为空时点该入口 → 弹框提示而不是静默返回；
 *   4) 设备设置页显示设备当前保存的 MQTT 服务器；
 *   5) 3 秒没等到回包 → 提示可「重发」（最多 3 次），收到回包则正常确认。
 *
 * 安全：所有 /api/** 用 page.route 拦截、WebSocket 用 routeWebSocket mock，
 * 不连真实后端/broker，也不向任何真实设备下发报文。
 */
test.use({ trace: 'off' });
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

function deviceFixture(state: Record<string, unknown>) {
  return {
    mac: MAC,
    name: '悟空M1',
    type: 4,
    typeName: 'zM1空气检测仪',
    online: true,
    ip: '192.168.1.50',
    order: 0,
    state,
    updatedAt: 1700000000000,
  };
}

interface Harness {
  syncPosts: string[];
  ws: () => WebSocketRoute | null;
}

/** 拦截全部接口；devices 用 fixtures 里给定的设备列表 */
async function mockBackend(
  page: Page,
  state: Record<string, unknown>,
  options: { empty?: boolean } = {},
): Promise<Harness> {
  let ws: WebSocketRoute | null = null;
  const h: Harness = { syncPosts: [], ws: () => ws };

  await page.routeWebSocket(/\/ws$/, (socket) => {
    ws = socket;
  });
  await page.route('**/api/status', (route) => route.fulfill({ json: STATUS }));
  await page.route('**/api/settings', (route) => route.fulfill({ json: SETTINGS }));
  await page.route('**/api/devices', (route) =>
    route.fulfill({ json: { devices: options.empty ? [] : [deviceFixture(state)] } }),
  );
  await page.route('**/api/settings/mqtt/sync/*', async (route) => {
    h.syncPosts.push(new URL(route.request().url()).pathname);
    await route.fulfill({ json: { sent: { channel: 'udp', payload: '{}' } } });
  });
  await page.route('**/api/devices/*/settings', (route) => route.fulfill({ json: { always_UDP: false } }));
  await page.route('**/api/devices/*/cmd', (route) =>
    route.fulfill({ json: { sent: { channel: 'mqtt', topic: `device/zm1/${MAC}/set`, payload: '' } } }),
  );

  return h;
}

async function openApp(page: Page, hash = '/'): Promise<void> {
  await page.goto(`/#${hash}`);
  try {
    await expect(page.locator('#app > div')).toBeVisible({ timeout: 4000 });
  } catch {
    await page.reload();
    await expect(page.locator('#app > div')).toBeVisible();
  }
}

test('云同步：点顶栏入口下发配置，设备回包 setting 后弹确认', async ({ page }) => {
  const h = await mockBackend(page, { brightness: 3, version: 'v1.0.0' });
  await openApp(page);

  // 1) 点云同步入口 → 调一次云同步接口，并提示已发送
  await page.getByTestId('nav-sync').click();
  await expect.poll(() => h.syncPosts.length).toBe(1);
  expect(h.syncPosts[0]).toBe(`/api/settings/mqtt/sync/${MAC}`);
  await expect(page.locator('.van-toast')).toContainText('已发送MQTT配置');

  // 2) 设备回报它现在保存的配置 → 弹确认（内容 = 设备实际保存值，不是本机配置）
  await expect.poll(() => h.ws() !== null).toBe(true);
  h.ws()?.send(
    JSON.stringify({
      type: 'data',
      data: {
        mac: MAC,
        source: 'udp',
        topic: null,
        payload: {
          name: '悟空M1',
          mac: MAC,
          setting: {
            mqtt_uri: '192.168.1.10',
            mqtt_port: 1883,
            mqtt_user: 'z',
            mqtt_password: '',
          },
        },
        ts: Date.now(),
      },
    }),
  );

  await expect(page.locator('.van-toast')).toContainText('已设置"悟空M1"mqtt服务器');
  await expect(page.locator('.van-toast')).toContainText('192.168.1.10:1883');
  await expect(page.locator('.van-toast')).toContainText('z');
});

test('云同步：设备回包里的名称/OTA 设置不会误弹 MQTT 确认', async ({ page }) => {
  const h = await mockBackend(page, {});
  await openApp(page);
  await expect.poll(() => h.ws() !== null).toBe(true);

  h.ws()?.send(
    JSON.stringify({
      type: 'data',
      data: {
        mac: MAC,
        source: 'mqtt',
        topic: `device/zm1/${MAC}/state`,
        payload: { mac: MAC, setting: { name: '悟空M1' } },
        ts: Date.now(),
      },
    }),
  );

  // 日志里有这条报文，但没有 MQTT 确认弹窗
  await page.getByTestId('m1-log-toggle').click();
  await expect(page.getByTestId('m1-log')).toContainText('接收mqtt:');
  await expect(page.locator('.van-toast')).toHaveCount(0);
});

test('云同步：设备列表为空时弹框提示，且不发任何请求', async ({ page }) => {
  const h = await mockBackend(page, {}, { empty: true });
  await openApp(page);

  await expect(page.getByText('还没有设备，先去「增加设备」添加')).toBeVisible();
  await page.getByTestId('nav-sync').click();

  await expect(page.getByText('设备列表为空')).toBeVisible();
  await expect(page.getByText('请先添加设备')).toBeVisible();
  expect(h.syncPosts).toHaveLength(0);
});

test('设备设置页：显示设备当前保存的 MQTT 服务器', async ({ page }) => {
  await mockBackend(page, {
    version: 'v1.0.0',
    interval: 60,
    ssid: 'TestWiFi',
    zone: 0,
    mqttSetting: { mqtt_uri: '192.168.1.10', mqtt_port: 1883, mqtt_user: 'z' },
  });
  await openApp(page, `/device/${MAC}/settings`);

  const cell = page.getByTestId('device-mqtt-setting');
  await expect(cell).toBeVisible();
  await expect(cell).toContainText('设备MQTT服务器');
  await expect(cell).toContainText('192.168.1.10:1883');
  await expect(cell).toContainText('用户:z');
});

test('设备设置页：还没收到回包时给出获取提示', async ({ page }) => {
  await mockBackend(page, { version: 'v1.0.0', interval: 60, ssid: 'TestWiFi', zone: 0 });
  await openApp(page, `/device/${MAC}/settings`);

  const cell = page.getByTestId('device-mqtt-setting');
  await expect(cell).toBeVisible();
  await expect(cell).toContainText('未获取到设备保存的配置');
});

test('云同步：3 秒没等到回包 → 提示「重发」；重发后收到回包则确认', async ({ page }) => {
  const h = await mockBackend(page, { brightness: 3 });
  await openApp(page);
  await expect.poll(() => h.ws() !== null).toBe(true);

  await page.getByTestId('nav-sync').click();
  await expect.poll(() => h.syncPosts.length).toBe(1);
  await expect(page.locator('.van-toast')).toContainText('已发送MQTT配置到"悟空M1"');

  // 设备不回包 → 3 秒后提示可以重发（不能像以前那样静默）
  await expect(page.getByText('未收到设备回包')).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(/3 秒内没等到设备回包/)).toBeVisible();

  await page.getByRole('button', { name: '重发' }).click();
  await expect.poll(() => h.syncPosts.length).toBe(2);
  await expect(page.locator('.van-toast')).toContainText('已重发(2)到"悟空M1"');

  // 这次设备回包了 → 弹它实际保存的配置，并且不再重发
  h.ws()?.send(
    JSON.stringify({
      type: 'data',
      data: {
        mac: MAC,
        source: 'udp',
        topic: null,
        payload: {
          name: '悟空M1',
          mac: MAC,
          setting: {
            mqtt_uri: '192.168.1.10',
            mqtt_port: 1883,
            mqtt_user: 'z',
            mqtt_password: '',
          },
        },
        ts: Date.now(),
      },
    }),
  );
  await expect(page.locator('.van-toast')).toContainText('已设置"悟空M1"mqtt服务器');
  await page.waitForTimeout(3500);
  expect(h.syncPosts).toHaveLength(2);
});

test('云同步：连续 3 次都没等到回包 → 给出最终提示，不再重发', async ({ page }) => {
  const h = await mockBackend(page, {});
  await openApp(page);

  await page.getByTestId('nav-sync').click();

  await expect(page.getByText('未收到设备回包')).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: '重发' }).click();
  await expect(page.getByText('未收到设备回包')).toBeVisible({ timeout: 8000 });
  await page.getByRole('button', { name: '重发' }).click();

  await expect(page.getByText(/下发 3 次 MQTT 配置/)).toBeVisible({ timeout: 8000 });
  expect(h.syncPosts).toHaveLength(3);

  await page.waitForTimeout(3500);
  expect(h.syncPosts).toHaveLength(3);
});
