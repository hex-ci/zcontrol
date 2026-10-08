import { expect, test, type Page } from '@playwright/test';

/**
 * 顶栏「可点区域」守卫。
 *
 * Vant 默认给左/右区容器加 `van-haptics-feedback`（cursor:pointer + 按下变暗），
 * 右区容器还挂着 click-right——但它上面是我们的三个图标按钮，容器自身没有监听，
 * 于是整块空白也像按钮、点下去却没有任何反应（用户报过这个）。现在用 `:clickable="false"`
 * 关掉容器级假象，只让真正的控件自己有光标和按压反馈。
 *
 * 安全：/api/** 与 WebSocket 全部 mock，不连后端、不发 UDP、不碰真机。
 */
test.use({ trace: 'off' });
test.describe.configure({ timeout: 90_000 });

const MAC = 'aabbccddeeff';

const DEVICE = {
  mac: MAC,
  name: '测试检测仪',
  type: 4,
  typeName: 'zM1空气检测仪',
  online: true,
  ip: '192.168.1.50',
  order: 0,
  state: { brightness: 3, version: 'v1.0.0', interval: 60, ssid: 'TestWiFi', zone: 0 },
  updatedAt: 1700000000000,
};

interface Harness {
  syncPosts: number;
}

async function mockBackend(page: Page): Promise<Harness> {
  const h: Harness = { syncPosts: 0 };
  await page.routeWebSocket(/\/ws$/, () => {});
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
  await page.route('**/api/devices/*/cmd', (r) =>
    r.fulfill({ json: { sent: { channel: 'mqtt', topic: `device/zm1/${MAC}/set`, payload: '' } } }),
  );
  await page.route('**/api/settings/mqtt/sync/*', (r) => {
    h.syncPosts++;
    return r.fulfill({ json: { sent: { channel: 'udp', payload: '{}' } } });
  });
  return h;
}

test('右侧整块区域不是可点样式，只有三个图标是', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/');
  await expect(page.getByTestId('nav-sync')).toBeVisible();

  const info = await page.evaluate(() => {
    const right = document.querySelector('.van-nav-bar__right') as HTMLElement;
    return {
      rightClass: right.className,
      rightCursor: getComputedStyle(right).cursor,
      buttons: [...document.querySelectorAll('[data-testid^="nav-"]')].map((b) => ({
        id: (b as HTMLElement).dataset.testid,
        cursor: getComputedStyle(b).cursor,
      })),
    };
  });

  // 容器：没有 Vant 的「可点」类、光标不是手型
  expect(info.rightClass).not.toContain('van-haptics-feedback');
  expect(info.rightCursor).not.toBe('pointer');
  // 图标：明确是可点样式
  expect(info.buttons).toHaveLength(3);
  for (const b of info.buttons) expect(b.cursor).toBe('pointer');
});

test('点右侧空白处什么都不会发生', async ({ page }) => {
  const h = await mockBackend(page);
  await page.goto('/');
  await expect(page.getByTestId('nav-sync')).toBeVisible();

  const right = await page.locator('.van-nav-bar__right').boundingBox();
  if (!right) throw new Error('右侧区域未渲染');
  const urlBefore = page.url();

  // 容器左边缘往里 6px（图标左侧的空白），以及图标之间
  for (const x of [right.x + 6, right.x + right.width - 6]) {
    await page.mouse.click(x, right.y + right.height / 2);
  }
  await page.waitForTimeout(500);

  expect(h.syncPosts).toBe(0); // 没触发云同步
  expect(page.url()).toBe(urlBefore); // 也没跳转
  expect(await page.locator('.van-toast').count()).toBe(0);
});

test('左侧菜单图标仍可点（打开抽屉）', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/');
  await expect(page.getByTestId('nav-sync')).toBeVisible();

  const leftIcon = page.locator('.van-nav-bar__left .van-icon-bars');
  await expect(leftIcon).toBeVisible();
  await expect(leftIcon.locator('xpath=..')).toHaveCSS('cursor', 'pointer');

  await leftIcon.click();
  await expect(page.getByTestId('drawer-panel')).toHaveClass(/translate-x-0/);
});
