import { expect, test, type Page } from '@playwright/test';

/**
 * 图标守卫。
 *
 * Vant 的 `van-icon` 只认它自带图标表里的名字：名字写错时不报错、不警告，
 * 只是 `::before` 没有字形，按钮退化成一片空白区域——云同步入口曾用 `cloud-o`
 * （Vant 4 没有这个图标），顶栏上那个按钮就是 16px 宽的空白，用户完全看不到入口。
 *
 * 这里逐页检查每个渲染出来的图标都有真实字形，并顺带守住「云同步入口可见」。
 *
 * 安全：/api/** 与 WebSocket 全部 mock，不连后端、不发 UDP、不碰任何真机。
 */
test.use({ trace: 'off' });
test.describe.configure({ timeout: 90_000 });

const MAC = 'aabbccddeeff';

/** 每个页面都要走一遍：页面换了图标也可能引入无效名字 */
const ROUTES = ['/', '/add', '/settings', '/about', `/device/${MAC}/settings`, `/device/${MAC}/plug`];

const DEVICE = {
  mac: MAC,
  name: '测试检测仪',
  type: 4,
  typeName: 'zM1空气检测仪',
  online: true,
  ip: '192.168.1.50',
  order: 0,
  state: {
    brightness: 3,
    version: 'v1.0.0',
    interval: 60,
    ssid: 'TestWiFi',
    zone: 0,
    PM25: 30,
    temperature: 23.3,
    humidity: 48.9,
    formaldehyde: 0.04,
    tasks: [null, null, null, null, null],
  },
  updatedAt: 1700000000000,
};

async function mockBackend(page: Page): Promise<void> {
  await page.routeWebSocket(/\/ws$/, () => {
    /* 静默 mock：不连真实后端 */
  });
  await page.route('**/api/status', (r) =>
    r.fulfill({
      json: {
        mqtt: { connected: true, uri: '192.168.1.10:1883', error: null },
        udp: { listening: true, port: 10181 },
        scan: { active: false },
        version: '1.0.0',
        versionName: '1.0.0',
        localIps: ['192.168.1.50'],
      },
    }),
  );
  await page.route('**/api/settings', (r) =>
    r.fulfill({
      json: {
        mqtt_uri: '192.168.1.10:1883',
        mqtt_user: '',
        mqtt_clientid: 'zcontrol-web',
        mqtt_password_set: false,
        version_no_ask: '',
      },
    }),
  );
  await page.route('**/api/devices', (r) => r.fulfill({ json: { devices: [DEVICE] } }));
  await page.route('**/api/devices/*/settings', (r) => r.fulfill({ json: { always_UDP: false } }));
  await page.route('**/api/devices/*/cmd', (r) =>
    r.fulfill({ json: { sent: { channel: 'mqtt', topic: `device/zm1/${MAC}/set`, payload: '' } } }),
  );
  await page.route('**/api/discovery/scan', (r) =>
    r.fulfill({ json: { active: false, devices: [] } }),
  );
}

/** 找出没有字形的图标（名字不在 Vant 图标表里） */
async function invalidIcons(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.van-icon')]
      .map((el) => ({
        cls: el.className,
        content: getComputedStyle(el, '::before').content,
      }))
      .filter((i) => i.content === 'none' || i.content === '' || i.content === 'normal')
      .map((i) => `${i.cls} → ::before=${i.content}`),
  );
}

for (const route of ROUTES) {
  test(`${route}：所有图标都有真实字形`, async ({ page }) => {
    await mockBackend(page);
    await page.goto(`/#${route}`);
    await expect(page.locator('#app > div')).toBeVisible();

    const bad = await invalidIcons(page);
    expect(bad, `无效图标（名字不在 Vant 图标表里）:\n${bad.join('\n')}`).toEqual([]);
  });
}

test('云同步入口可见：图标有真实字形 + 点按区域和另外两个图标一致', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/');
  const entry = page.getByTestId('nav-sync');
  await expect(entry).toBeVisible();

  // 图标本身有字形（曾用不存在的 cloud-o，渲染出来是空的）
  const iconContent = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="nav-sync"] .van-icon');
    return el ? getComputedStyle(el, '::before').content : null;
  });
  expect(iconContent).not.toBeNull();
  expect(['none', '', 'normal']).not.toContain(iconContent);

  // 点按区域要和『?』『✎』两个图标（34px）同级：坏掉的图标只有 16px
  const syncBox = await entry.boundingBox();
  const docBox = await page.getByTestId('nav-doc').boundingBox();
  expect(syncBox?.width ?? 0).toBeGreaterThan(30);
  expect(Math.abs((syncBox?.width ?? 0) - (docBox?.width ?? 0))).toBeLessThanOrEqual(2);
});

test('设备名较长时，云同步入口不被挤出可视区', async ({ page }) => {
  await mockBackend(page);
  await page.route('**/api/devices', (r) =>
    r.fulfill({ json: { devices: [{ ...DEVICE, name: '公司开放原子开源基金会22层茶水间检测仪' }] } }),
  );
  await page.goto('/');

  const entry = page.getByTestId('nav-sync');
  await expect(entry).toBeVisible();
  const box = await entry.boundingBox();
  const bar = await page.locator('.van-nav-bar').boundingBox();
  expect(box && bar && box.x + box.width <= bar.x + bar.width + 1).toBe(true);
});
