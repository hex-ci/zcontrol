import { expect, test } from '@playwright/test';

/**
 * 亮度定时页（/device/:mac/plug）e2e
 *
 * 安全：全部 /api/** 用 page.route 拦截，WebSocket 用 page.routeWebSocket 屏蔽，
 * 不连真实 broker、不向真实设备下发任何报文。
 */

const MAC = 'aabbccddeeff';

/** 5 元素 tasks：第 2、5 组为 null（未获取到），覆盖 亮度!=0 / 亮度==0 / null 三种显示 */
const TASKS = [
  { hour: 8, minute: 30, brightness: 4, on: 1 },
  null,
  { hour: 0, minute: 0, brightness: 0, on: 0 },
  { hour: 23, minute: 5, brightness: 2, on: 0 },
  null,
];

const DEVICE = {
  mac: MAC,
  name: '测试检测仪',
  type: 4,
  typeName: 'zM1空气检测仪',
  online: true,
  ip: '192.168.1.50',
  order: 0,
  state: { brightness: 2, tasks: TASKS },
  updatedAt: Date.now(),
};

const STATUS = {
  mqtt: { connected: true, uri: '127.0.0.1:1883', error: null },
  udp: { listening: true, port: 10181 },
  scan: { active: false },
  version: '1.0.0',
  versionName: '1.0.0',
  localIps: [],
};

const SETTINGS = {
  mqtt_uri: '127.0.0.1:1883',
  mqtt_user: '',
  mqtt_clientid: '',
  mqtt_password_set: false,
  version_no_ask: '',
};

/** 「当前时间 + h 小时 m 分钟」得到的 hour/minute */
function plus(d: Date, h: number, m: number) {
  const t = new Date(d.getTime());
  t.setHours(t.getHours() + h);
  t.setMinutes(t.getMinutes() + m);
  return { hour: t.getHours(), minute: t.getMinutes() };
}

test('亮度定时页：5 行任务 / HH:mm / 动作文案 / 开关下发 / 两个弹窗下发', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') pageErrors.push(`console.error: ${m.text()}`);
  });

  const cmds: Record<string, unknown>[] = [];

  // 屏蔽真实 WebSocket：后端 hello 快照不会覆盖 fixture
  await page.routeWebSocket('**/ws', () => {});

  await page.route(/\/api\/status$/, (r) => r.fulfill({ json: STATUS }));
  await page.route(/\/api\/settings$/, (r) => r.fulfill({ json: SETTINGS }));
  await page.route(/\/api\/devices$/, (r) => r.fulfill({ json: { devices: [DEVICE] } }));
  await page.route(/\/api\/devices\/[^/]+\/cmd$/, async (r) => {
    const body = r.request().postDataJSON() as { cmd: Record<string, unknown> };
    cmds.push(body.cmd);
    await r.fulfill({
      json: {
        sent: { channel: 'mqtt', topic: `device/zm1/${MAC}/set`, payload: JSON.stringify(body.cmd) },
      },
    });
  });

  await page.goto(`/#/device/${MAC}/plug`);

  // 顶部工具栏 + 返回（首屏需等待 Vite 首次编译，放宽超时）
  const navBar = page.locator('.van-nav-bar');
  await expect(navBar).toContainText('亮度定时', { timeout: 20_000 });
  await expect(navBar.locator('.van-nav-bar__left')).toBeVisible();

  // 5 行任务
  const rows = page.getByTestId('task-row');
  await expect(rows).toHaveCount(5);

  // 时间格式 HH:mm；动作文案 brightness!=0 → 亮度:4，==0 → 关屏，null → 占位
  await expect(rows.nth(0)).toContainText('08:30');
  await expect(rows.nth(0)).toContainText('亮度:4');
  await expect(rows.nth(1)).toContainText('--:--');
  await expect(rows.nth(2)).toContainText('00:00');
  await expect(rows.nth(2)).toContainText('关屏');
  await expect(rows.nth(3)).toContainText('23:05');
  await expect(rows.nth(3)).toContainText('亮度:2');
  await expect(rows.nth(4)).toContainText('--:--');

  // 进入页面即查询 5 组任务
  await expect
    .poll(() => cmds.some((c) => Object.keys(c).length === 5 && Object.keys(c).every((k) => k.startsWith('task_'))))
    .toBe(true);
  expect(cmds.find((c) => Object.keys(c).length === 5)).toEqual({
    task_0: {},
    task_1: {},
    task_2: {},
    task_3: {},
    task_4: {},
  });

  // 开关切换 → 立即下发 task_N（on 取开关勾选态）
  await rows.nth(0).locator('.van-switch').click();
  await expect
    .poll(() => cmds.some((c) => Object.keys(c).length === 1 && 'task_0' in c && (c.task_0 as { on: number }).on === 0))
    .toBe(true);
  expect(cmds.find((c) => 'task_0' in c && (c.task_0 as { on: number }).on === 0)).toEqual({
    task_0: { hour: 8, minute: 30, brightness: 4, on: 0 },
  });

  // 点行 → 设置定时任务弹窗（默认值取当前任务）→ 确认下发 on:1
  await rows.nth(0).click();
  await expect(page.getByText('设置定时任务')).toBeVisible();
  await expect(page.getByText('重复:每天')).toBeVisible();
  const editSelected = await page.locator('.van-picker-column__item--selected').allInnerTexts();
  expect(editSelected).toContain('08');
  expect(editSelected).toContain('30');
  expect(editSelected).toContain('4');
  await page.getByRole('button', { name: '确认' }).click();
  await expect(page.getByText('设置定时任务')).toBeHidden();
  await expect
    .poll(() =>
      cmds.some(
        (c) =>
          'task_0' in c &&
          Object.keys(c).length === 1 &&
          (c.task_0 as { on: number }).on === 1 &&
          (c.task_0 as { brightness: number }).brightness === 4,
      ),
    )
    .toBe(true);
  expect(cmds.filter((c) => 'task_0' in c && Object.keys(c).length === 1).at(-1)).toEqual({
    task_0: { hour: 8, minute: 30, brightness: 4, on: 1 },
  });

  // 点行 → 改动作档位（选「关闭」）→ 确认下发 brightness:0
  await rows.nth(3).click();
  await expect(page.getByText('设置定时任务')).toBeVisible();
  await page.locator('.van-picker-column__item', { hasText: '关闭' }).click();
  await page.getByRole('button', { name: '确认' }).click();
  await expect
    .poll(() =>
      cmds.some(
        (c) => 'task_3' in c && Object.keys(c).length === 1 && (c.task_3 as { brightness: number }).brightness === 0,
      ),
    )
    .toBe(true);
  expect(cmds.find((c) => 'task_3' in c && Object.keys(c).length === 1)).toEqual({
    task_3: { hour: 23, minute: 5, brightness: 0, on: 1 },
  });

  // 设置倒计时 → 固定 task_4，hour/minute = 当前时间 + 偏移（默认 1 小时 0 分，动作 关闭）
  await page.getByRole('button', { name: '设置倒计时' }).click();
  await expect(page.getByText('设置倒计时时间')).toBeVisible();
  await expect(page.getByText('注意:倒计时占用最后一组定时任务')).toBeVisible();
  const cdSelected = await page.locator('.van-picker-column__item--selected').allInnerTexts();
  expect(cdSelected).toContain('01');
  expect(cdSelected).toContain('00');
  expect(cdSelected).toContain('关闭');

  const before = new Date();
  await page.getByRole('button', { name: '确认' }).click();
  await expect(page.getByText('设置倒计时时间')).toBeHidden();
  const after = new Date();

  await expect
    .poll(() => cmds.some((c) => 'task_4' in c && Object.keys(c).length === 1))
    .toBe(true);
  const cd = cmds.filter((c) => 'task_4' in c && Object.keys(c).length === 1).at(-1)!.task_4 as {
    hour: number;
    minute: number;
    brightness: number;
    on: number;
  };
  expect(cd.brightness).toBe(0);
  expect(cd.on).toBe(1);
  // 允许点击跨越分钟边界：取点击前后的预期值集合
  expect([plus(before, 1, 0), plus(after, 1, 0)]).toContainEqual({ hour: cd.hour, minute: cd.minute });

  await page.screenshot({ path: 'docs/screenshots/11-plug-page.png', fullPage: true });

  expect(pageErrors).toEqual([]);
});
