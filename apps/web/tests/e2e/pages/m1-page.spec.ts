import { expect, test, type Page, type WebSocketRoute } from '@playwright/test';

/**
 * zM1 设备主页面（DeviceM1Page.vue）e2e 验证。
 *
 * 安全：本文件不连真实 broker、不发 UDP 广播、不向真实设备下发任何报文。
 * 所有 /api/** 请求都用 page.route 拦截并返回固定 fixture（结构照 docs/API.md），
 * WebSocket 也用 routeWebSocket mock 掉，不连后端。
 */

const MAC = 'aabbccddeeff';

// 共享开发机上会有多个 Playwright 进程并发跑（默认 outputDir 都是 test-results/），
// 并发进程启动时会清掉 test-results，导致本文件在 context.close 写 trace 时报 ENOENT。
// 本文件全程 page.route 自给自足，关掉 trace 即可免疫；同时放宽超时适配并发时的机器负载。
test.use({ trace: 'off' });
test.describe.configure({ timeout: 90_000 });

const statusFixture = {
  mqtt: { connected: true, uri: '192.168.1.10:1883', error: null },
  udp: { listening: true, port: 10181 },
  scan: { active: false },
  version: '1.0.0',
  versionName: '1.0.0',
  localIps: ['192.168.1.50'],
};

const settingsFixture = {
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

/** 拦截全部接口，返回固定 fixture；返回 cmds（记录每条下发 cmd）与 mock 的 ws */
async function mockBackend(page: Page, state: Record<string, unknown>) {
  const cmds: Record<string, unknown>[] = [];
  let ws: WebSocketRoute | null = null;

  // 不调用 connectToServer：前端拿到一个“已连接但无消息”的 socket，避免真实后端干扰
  await page.routeWebSocket(/\/ws$/, (socket) => {
    ws = socket;
  });
  await page.route('**/api/status', (route) => route.fulfill({ json: statusFixture }));
  await page.route('**/api/settings', (route) => route.fulfill({ json: settingsFixture }));
  await page.route('**/api/devices', (route) =>
    route.fulfill({ json: { devices: [deviceFixture(state)] } }),
  );
  await page.route('**/api/devices/*/cmd', async (route) => {
    const body = route.request().postDataJSON() as { cmd: Record<string, unknown> };
    cmds.push(body.cmd);
    await route.fulfill({
      json: { sent: { channel: 'mqtt', topic: `device/zm1/${MAC}/set`, payload: '' } },
    });
  });

  return { cmds, ws: () => ws };
}

/**
 * 打开主界面。
 * Vite dev server 首次遇到新依赖会触发现场预构建（504 Outdated Optimize Dep），
 * 此时路由的动态 import 会失败、页面留空壳；这里重载一次兜底，避免假失败。
 */
async function openApp(page: Page) {
  await page.goto('/');
  try {
    await expect(page.locator('#app > div')).toBeVisible({ timeout: 4000 });
  } catch {
    await page.reload();
    await expect(page.locator('#app > div')).toBeVisible();
  }
}

/** 从页面顶部下拉 120px（下拉刷新） */
async function pullToRefresh(page: Page) {
  const x = 206;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: 140 }] });
  for (const y of [180, 220, 260]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** 用 CDP 触摸事件把亮度滑块从当前档位拖到最右 */
async function dragSliderToEnd(page: Page) {
  const track = await page.locator('.van-slider').boundingBox();
  const button = await page.locator('.van-slider__button-wrapper').boundingBox();
  if (!track || !button) throw new Error('亮度滑块未渲染');

  const startX = Math.round(button.x + button.width / 2);
  const startY = Math.round(button.y + button.height / 2);
  const endX = Math.round(track.x + track.width - 1);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: startX, y: startY }],
  });
  for (const x of [Math.round((startX + endX) / 2), endX]) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: startY }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('zM1 主页：四个数值区/亮度/日志/入口 与下发报文', async ({ page }) => {
  const { cmds, ws } = await mockBackend(page, {
    PM25: 57,
    formaldehyde: 0.02,
    temperature: 23.8,
    humidity: 64.0,
    brightness: 3,
    zone: 480,
    interval: 60,
    version: '1.2.3',
    ssid: 'TestWiFi',
    time: 1700000000,
    tasks: [null, null, null, null, null],
    lastTopic: 'state',
  });

  await openApp(page);

  // 1) 四个数值区可见且格式正确
  await expect(page.getByTestId('m1-pm25')).toBeVisible();
  await expect(page.getByTestId('m1-pm25')).toHaveText('57');
  await expect(page.getByTestId('m1-formaldehyde')).toBeVisible();
  await expect(page.getByTestId('m1-formaldehyde')).toHaveText('0.02');
  await expect(page.getByTestId('m1-temperature')).toBeVisible();
  await expect(page.getByTestId('m1-temperature')).toHaveText('23.8℃');
  await expect(page.getByTestId('m1-humidity')).toBeVisible();
  await expect(page.getByTestId('m1-humidity')).toHaveText('64.0%');

  // 固定文案与单位
  await expect(page.getByText('PM2.5', { exact: true })).toBeVisible();
  await expect(page.getByText('甲醛', { exact: true })).toBeVisible();
  await expect(page.getByText('ug/m³')).toBeVisible();
  await expect(page.getByText('mg/m³')).toBeVisible();
  // 在线状态（MQTT 已连接 + availability=1）
  await expect(page.getByText('在线', { exact: true })).toBeVisible();

  // 2) 亮度滑块可见（seekBar max=4，进度来自 state.brightness=3）
  await expect(page.locator('.van-slider')).toBeVisible();
  const knob = page.locator('.van-slider [role="slider"]');
  await expect(knob).toBeVisible();
  await expect(knob).toHaveAttribute('aria-valuenow', '3');
  await expect(knob).toHaveAttribute('aria-valuemax', '4');

  // 3) 日志区存在，首行是 header 时间
  await expect(page.getByTestId('m1-log')).toBeVisible();
  await expect(page.getByTestId('m1-log-header')).toHaveText(
    /^---- \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} ----$/,
  );
  // 后端推一条 data 事件（mock ws），日志区应多出一行 `[HH:mm:ss.sss]接收mqtt:...`
  await expect.poll(() => ws() !== null).toBe(true);
  ws()?.send(
    JSON.stringify({
      type: 'data',
      data: {
        mac: MAC,
        source: 'mqtt',
        topic: `device/zm1/${MAC}/state`,
        payload: { mac: MAC, PM25: 57 },
        ts: Date.now(),
      },
    }),
  );
  await expect(page.getByTestId('m1-log')).toContainText(/\[\d{2}:\d{2}:\d{2}\.\d{3}\]接收mqtt:/);

  // 4) ServiceConnected（延迟 800ms）→ 查询 {"brightness":null}
  await expect.poll(() => cmds.length).toBeGreaterThan(0);
  expect(cmds[0]).toEqual({ brightness: null });

  // 5) 拖动亮度滑块结束 → {"brightness":4}
  await dragSliderToEnd(page);
  await expect.poll(() => cmds[cmds.length - 1]).toEqual({ brightness: 4 });

  // 截图（Pixel 7 视口）
  await page.screenshot({ path: 'docs/screenshots/10-m1-page.png' });

  // 6) 连接状态变化时也发一次查询，状态标签变「未连接」
  ws()?.send(
    JSON.stringify({
      type: 'status',
      data: { ...statusFixture, mqtt: { ...statusFixture.mqtt, connected: false } },
    }),
  );
  await expect
    .poll(() => cmds.filter((c) => c.brightness === null).length)
    .toBeGreaterThanOrEqual(2);
  await expect(page.getByText('未连接', { exact: true })).toBeVisible();

  // 7) 下拉刷新（swipeRefreshLayout）也发查询 {"brightness":null}
  const before = cmds.length;
  await pullToRefresh(page);
  await expect.poll(() => cmds.length).toBeGreaterThan(before);
  expect(cmds[cmds.length - 1]).toEqual({ brightness: null });

  // 8) 长按日志区 → 确认框「清除log?」，确认后清空（写入一行 'log已经清空'）
  const box = await page.getByTestId('m1-log').boundingBox();
  if (!box) throw new Error('日志区未渲染');
  await page.mouse.move(box.x + 40, box.y + 20);
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await expect(page.getByText('清除log?')).toBeVisible();
  await page.getByRole('button', { name: '确认' }).click();
  await expect(page.getByTestId('m1-log')).toContainText('log已经清空');

  // 7) 点击「亮度定时」→ 跳转 /device/:mac/plug
  await page.getByTestId('m1-brightness-task').click();
  await expect(page).toHaveURL(new RegExp(`#/device/${MAC}/plug$`));
});

test('zM1 主页：未收到数据时显示占位', async ({ page }) => {
  const { cmds } = await mockBackend(page, {});

  await openApp(page);

  await expect(page.getByTestId('m1-pm25')).toHaveText('---');
  await expect(page.getByTestId('m1-formaldehyde')).toHaveText('-.--');
  await expect(page.getByTestId('m1-temperature')).toHaveText('--.-℃');
  await expect(page.getByTestId('m1-humidity')).toHaveText('--.-%');
  // 未收到亮度数据时 seekBar 停在初始进度 0
  await expect(page.locator('.van-slider [role="slider"]')).toHaveAttribute('aria-valuenow', '0');
  await expect(page.getByTestId('m1-log')).toBeVisible();
  // 挂载查询仍会下发
  await expect.poll(() => cmds.length).toBeGreaterThan(0);
  expect(cmds[0]).toEqual({ brightness: null });
});
