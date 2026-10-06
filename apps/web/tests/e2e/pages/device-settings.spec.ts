import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * zM1 设备设置页 e2e。
 * 安全：全部 /api/** 走 page.route 拦截，绝不下发到真实设备/后端。
 */

// 关闭 trace：多个 spec 并行/被并行执行时会竞争 test-results/ 产物目录，
// 导致 browserContext.close 时 trace 文件 ENOENT 的伪失败（与本用例断言无关）。
test.use({ trace: 'off' });

const MAC = 'aabbccddeeff';

const BASE_STATE = {
  version: 'v1.0.0',
  ssid: 'TestWiFi',
  zone: 0,
  interval: 60,
  time: 1586000000,
};

const DEVICE = {
  mac: MAC,
  name: '测试检测仪',
  type: 4,
  typeName: 'zM1空气检测仪',
  online: true,
  ip: '192.168.1.50',
  order: 0,
  state: BASE_STATE,
  updatedAt: 1759700000000,
};

const OTA_WITH_UPDATE = {
  hasUpdate: true,
  current: 'v1.0.0',
  tag_name: 'v1.2.3',
  title: 'zM1 新版本说明',
  message: '修复已知问题',
  ota: 'https://example.com/zM1/ota.bin',
};

const OTA_LATEST = {
  hasUpdate: false,
  current: 'v1.0.0',
  tag_name: 'v1.0.0',
  title: '',
  message: '',
  ota: null,
};

interface Harness {
  /** 每次 POST /devices/:mac/cmd 的 cmd 对象（已剥离后端注入的 mac） */
  cmds: Record<string, unknown>[];
  otaChecks: number;
  settingsPuts: { always_UDP?: boolean }[];
  /** 通过 mock 的 /ws 推送 devices 事件（模拟设备回包，驱动响应式回显） */
  pushState: (patch: Record<string, unknown>) => void;
}

async function setup(
  page: Page,
  opts: { ota?: unknown; device?: unknown } = {},
): Promise<Harness> {
  let socket: { send(data: string): void } | null = null;
  const h: Harness = {
    cmds: [],
    otaChecks: 0,
    settingsPuts: [],
    pushState: (patch) => {
      socket?.send(
        JSON.stringify({
          type: 'devices',
          data: { devices: [{ ...DEVICE, state: { ...BASE_STATE, ...patch } }] },
        }),
      );
    },
  };

  // 静默 mock WebSocket：不连真实后端，避免真实设备事件（另一进程的 fake-zm1）
  // 通过 /ws 推送 devices 覆盖本用例的 REST fixture；同时保留 socket 以便用例主动推送。
  await page.routeWebSocket(/\/ws$/, (ws) => {
    socket = ws;
  });

  await page.route('**/api/**', async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    const fulfill = (body: unknown): Promise<void> =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

    if (path === '/api/devices' && method === 'GET') {
      return fulfill({ devices: [opts.device ?? DEVICE] });
    }

    if (path === `/api/devices/${MAC}/settings`) {
      if (method === 'PUT') {
        h.settingsPuts.push(req.postDataJSON() as { always_UDP?: boolean });
        return fulfill({ always_UDP: true });
      }
      return fulfill({ always_UDP: false });
    }

    if (path === `/api/devices/${MAC}/cmd` && method === 'POST') {
      h.cmds.push((req.postDataJSON() as { cmd: Record<string, unknown> }).cmd);
      return fulfill({
        sent: { channel: 'mqtt', topic: `device/zm1/${MAC}/set`, payload: req.postData() ?? '' },
      });
    }

    if (path === `/api/devices/${MAC}/ota/check`) {
      h.otaChecks += 1;
      return fulfill(opts.ota ?? OTA_WITH_UPDATE);
    }

    if (path === '/api/status') {
      return fulfill({
        mqtt: { connected: true, uri: '127.0.0.1:1883', error: null },
        udp: { listening: true, port: 10181 },
        scan: { active: false },
        version: '1.0.0',
        versionName: '1.0.0',
        localIps: ['192.168.1.10'],
      });
    }

    if (path === '/api/settings') {
      return fulfill({
        mqtt_uri: '127.0.0.1:1883',
        mqtt_user: 'u',
        mqtt_clientid: 'c',
        mqtt_password_set: false,
        version_no_ask: '',
      });
    }

    return fulfill({});
  });

  return h;
}

async function open(page: Page): Promise<void> {
  await page.goto(`/#/device/${MAC}/settings`);
  await expect(page.getByText('设备设置').first()).toBeVisible();
  // 等待设备（含 state）加载完成，避免交互早于 /api/devices 返回
  await expect(page.getByText('测试检测仪').first()).toBeVisible();
}

test('设备设置页条目齐全（并截图）', async ({ page }) => {
  await setup(page);
  await open(page);

  const expected = [
    '名称',
    'MAC地址(点击复制)',
    '总是通过UDP发送数据',
    '即使连接MQTT服务器,也使用UDP发送数据',
    '连接的热点',
    '时区',
    '上报频率(秒)',
    '当前版本(点击检查新版本)',
    '手动校时',
    '自动校时异常时使用',
    '重启设备',
    '重新获取数据',
  ];
  for (const t of expected) {
    await expect(page.getByText(t).first()).toBeVisible();
  }

  // fixture state 回显
  await expect(page.getByText('测试检测仪').first()).toBeVisible();
  await expect(page.getByText('TestWiFi').first()).toBeVisible();
  await expect(page.getByText('v1.0.0').first()).toBeVisible();
  await expect(page.getByText('aabbccddeeff').first()).toBeVisible();
  await expect(page.getByText('UTC', { exact: true }).first()).toBeVisible();

  await page.screenshot({ path: 'docs/screenshots/12-device-settings.png', fullPage: true });
});

test('时区选择器 33 项，选 UTC+08:00 下发 zone 与 time', async ({ page }) => {
  const h = await setup(page);
  await open(page);

  await page.getByText('时区').click();

  const options = page.locator('.van-picker-column__item');
  await expect(options).toHaveCount(33);

  await page.getByText('UTC+08:00', { exact: true }).click();
  await page.locator('.van-picker__confirm').click();

  await expect(page.getByText('已发送时区/校时请求,请等待校时结果返回')).toBeVisible();
  await expect.poll(() => h.cmds.length).toBe(2);
  expect(h.cmds[0]).toEqual({ zone: 480 });
  expect(h.cmds[1]).toEqual({ time: -1 });
});

test('上报频率超出 1-255 报错且不下发，合法值下发', async ({ page }) => {
  const h = await setup(page);
  await open(page);

  const input = page.locator('.van-dialog .van-field__control');

  // 超范围：300
  await page.getByText('上报频率(秒)').click();
  await input.fill('300');
  await page.locator('.van-dialog__confirm').click();
  await expect(page.getByText('输入有误!范围1-255')).toBeVisible();
  await page.waitForTimeout(300);
  expect(h.cmds).toHaveLength(0);

  // 下界外：0
  await page.getByText('上报频率(秒)').click();
  await input.fill('0');
  await page.locator('.van-dialog__confirm').click();
  await expect(page.getByText('输入有误!范围1-255')).toBeVisible();
  await page.waitForTimeout(300);
  expect(h.cmds).toHaveLength(0);

  // 合法：60
  await page.getByText('上报频率(秒)').click();
  await input.fill('60');
  await page.locator('.van-dialog__confirm').click();
  await expect.poll(() => h.cmds.length).toBe(1);
  expect(h.cmds[0]).toEqual({ interval: 60 });
});

test('重启设备需确认后才下发', async ({ page }) => {
  const h = await setup(page);
  await open(page);

  await page.getByText('重启设备').click();
  await expect(page.getByText('重启设备?')).toBeVisible();
  await expect(
    page.getByText('如果设备死机此处重启可能无效,依然需要手动拔插插头才能重启设备'),
  ).toBeVisible();

  // 未确认前不下发
  expect(h.cmds).toHaveLength(0);

  await page.getByRole('button', { name: '确定' }).click();
  await expect.poll(() => h.cmds.length).toBe(1);
  expect(h.cmds[0]).toEqual({ cmd: 'restart' });
});

test('重新获取数据下发完整查询报文', async ({ page }) => {
  const h = await setup(page);
  await open(page);

  await page.getByText('重新获取数据').click();
  await expect.poll(() => h.cmds.length).toBe(1);
  expect(h.cmds[0]).toEqual({ version: null, interval: null, ssid: null, zone: null });
});

test('点当前版本会 GET ota/check 并可按响应弹窗更新', async ({ page }) => {
  const h = await setup(page);
  await open(page);

  await page.getByText('当前版本(点击检查新版本)').click();
  await expect.poll(() => h.otaChecks).toBe(1);

  await expect(page.getByText('获取到最新版本:v1.2.3')).toBeVisible();
  await expect(page.getByText('zM1 新版本说明')).toBeVisible();
  await expect(page.getByText('修复已知问题')).toBeVisible();

  expect(h.cmds).toHaveLength(0);
  await page.getByRole('button', { name: '更新' }).click();
  await expect.poll(() => h.cmds.length).toBe(1);
  expect(h.cmds[0]).toEqual({ setting: { ota: 'https://example.com/zM1/ota.bin' } });
});

test('已是最新版本时只弹 Toast', async ({ page }) => {
  const h = await setup(page, { ota: OTA_LATEST });
  await open(page);

  await page.getByText('当前版本(点击检查新版本)').click();
  await expect(page.getByText('已是最新版本')).toBeVisible();
  expect(h.cmds).toHaveLength(0);
});

test('未获取到版本时提示并重新获取数据', async ({ page }) => {
  const device = { ...DEVICE, state: { ssid: 'TestWiFi', zone: 0, interval: 60 } };
  const h = await setup(page, { device });
  await open(page);

  await page.getByText('当前版本(点击检查新版本)').click();
  await expect(page.getByText('未获取到当前设备版本')).toBeVisible();
  await expect(page.getByText('请点击重新获取数据.获取到当前设备版本后重试.')).toBeVisible();
  expect(h.otaChecks).toBe(0);

  await page.getByRole('button', { name: '确定' }).click();
  await expect.poll(() => h.cmds.length).toBe(1);
  expect(h.cmds[0]).toEqual({ version: null, interval: null, ssid: null, zone: null });
});

test('长按手动校时行弹出固件地址输入框', async ({ page }) => {
  const h = await setup(page);
  await open(page);

  const cell = page.locator('.van-cell').filter({ hasText: '手动校时' });
  const longPress = async (): Promise<void> => {
    await cell.dispatchEvent('mousedown');
    await page.waitForTimeout(900); // 组件内阈值 600ms，留足余量（这台机器并发负载高）
    await cell.dispatchEvent('mouseup');
  };

  // 只定位到「当前这个」弹窗：上一个弹窗关闭后可能仍留在 DOM 里，
  // 直接写 .van-dialog 会打到旧元素上（并行满负荷时实测会偶发失败）。
  const dialog = () => page.locator('.van-dialog').filter({ hasText: '请输入固件下载地址' }).last();
  const input = () => dialog().locator('.van-field__control');

  await longPress();
  await expect(dialog()).toBeVisible();
  await expect(page.getByText('警告:输入错误的地址可能导致固件损坏!')).toBeVisible();

  await input().fill('ftp://not-http/ota.bin');
  await dialog().locator('.van-dialog__confirm').click();
  await expect(page.getByText('地址不合法')).toBeVisible();
  await expect(dialog()).toBeHidden();
  expect(h.cmds).toHaveLength(0);

  // 合法 http 地址才下发
  await longPress();
  await expect(dialog()).toBeVisible();
  await input().fill('http://example.com/zM1/ota.bin');
  await dialog().locator('.van-dialog__confirm').click();
  await expect.poll(() => h.cmds.length).toBe(1);
  expect(h.cmds[0]).toEqual({ setting: { ota: 'http://example.com/zM1/ota.bin' } });
});

test('收到校时结果按 GMT+0 显示 yyyy-MM-dd HH:mm:ss', async ({ page }) => {
  const h = await setup(page);
  await open(page);

  await page.getByText('手动校时').click();
  await expect(page.getByText('手动校时?')).toBeVisible();
  await page.getByRole('button', { name: '确定' }).click();
  await expect.poll(() => h.cmds.length).toBe(1);
  expect(h.cmds[0]).toEqual({ time: -1 });
  await page.waitForTimeout(300);

  // 模拟设备回校时结果：1700000000 = 2023-11-14T22:13:20Z
  h.pushState({ time: 1700000000 });
  await expect(page.getByText('校时结果:2023-11-14 22:13:20')).toBeVisible();
});

test('校时结果小于阈值提示失败', async ({ page }) => {
  const h = await setup(page);
  await open(page);

  await page.getByText('手动校时').click();
  await page.getByRole('button', { name: '确定' }).click();
  await expect.poll(() => h.cmds.length).toBe(1);
  await page.waitForTimeout(300);

  h.pushState({ time: 1000000000 });
  await expect(page.getByText('校时失败,请重试')).toBeVisible();
});

test('OTA 进度弹窗与成功/失败提示', async ({ page }) => {
  const h = await setup(page);
  await open(page);

  // 进行中：0-99
  h.pushState({ ota_progress: 42 });
  await expect(page.getByText('正在获取最新固件版本,请稍后....')).toBeVisible();
  await expect(page.getByText('进度:42%')).toBeVisible();

  // 结束：>=100 → 成功
  h.pushState({ ota_progress: 100 });
  await expect(page.getByText('固件更新成功!')).toBeVisible();
});

test('OTA 进度 -1 提示失败', async ({ page }) => {
  const h = await setup(page);
  await open(page);

  h.pushState({ ota_progress: 7 });
  await expect(page.getByText('进度:7%')).toBeVisible();

  h.pushState({ ota_progress: -1 });
  await expect(page.getByText('固件更新失败!请重试')).toBeVisible();
});
