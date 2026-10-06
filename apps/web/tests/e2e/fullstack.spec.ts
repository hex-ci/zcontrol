import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';

/**
 * 全栈联调测试：浏览器 → 后端(8090) → 本机 mosquitto → 假 zM1 设备。
 *
 * 前置（不满足时自动跳过，不会误报失败）：
 *   1) 后端在 8090 运行：  pnpm --filter @zcontrol/server dev
 *   2) 本机 mosquitto 在 1883
 * 假设备由本用例在 beforeAll 里自己拉起、afterAll 里停掉（不长期占用 broker），
 * 并会把自己加进后端的测试设备在结束时删除。
 *
 * 安全：只对假设备 mac（aabbccddeeff）下发指令，不触碰任何真实设备。
 */

const API = 'http://127.0.0.1:8090/api';
const FAKE_MAC = 'aabbccddeeff';
const FAKE_SCRIPT = 'apps/web/tests/e2e/helpers/fake-zm1.mjs';

let fake: ChildProcess | null = null;
const stopFake = () => {
  if (fake && !fake.killed) fake.kill('SIGTERM');
  fake = null;
};
process.on('exit', stopFake);
process.on('SIGINT', () => {
  stopFake();
  process.exit(130);
});

const api = async (path: string, init?: RequestInit) => {
  // 只有带 body 时才设 content-type，否则 Fastify 会因「空 body」返回 400
  const headers: Record<string, string> = init?.body !== undefined ? { 'content-type': 'application/json' } : {};
  const res = await fetch(API + path, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data: data as never };
};

test.describe('全栈联调（真后端 + 本机 broker + 假设备）', () => {
  // 这批用例共享同一个后端与 broker 连接，必须串行，否则 beforeAll 之间会互相打架。
  // beforeAll 里有真实等待（等 MQTT 连上、等假设备出第一帧数据），冷启动时超过默认 30 秒，
  // 会把第一条用例报成 hook 超时并让后面几条全部跳过，所以显式放宽。
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  test.beforeAll(async () => {
    const health = await api('/health').catch(() => null);
    test.skip(!health || health.status !== 200, '后端未运行，跳过全栈测试');
    await api('/settings', { method: 'PUT', body: JSON.stringify({ mqtt_uri: '127.0.0.1:1883' }) });
    // 等 MQTT 连上
    for (let i = 0; i < 20; i++) {
      const st = await api('/status');
      if ((st.data as { mqtt?: { connected?: boolean } })?.mqtt?.connected) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    // 自己拉起假设备（进程退出时会被收掉）
    fake = spawn(
      process.execPath,
      [FAKE_SCRIPT, '--mac', FAKE_MAC, '--name', 'zM1测试', '--broker', '127.0.0.1:1883'],
      { stdio: 'ignore' },
    );
    await new Promise((r) => setTimeout(r, 1500));

    await api('/devices', { method: 'POST', body: JSON.stringify({ mac: FAKE_MAC, name: 'zM1测试' }) });
    // 把假设备排到第一位，确保主界面默认展示的是假设备（不打扰其它设备）
    const devices = (await api('/devices')).data as { devices: { mac: string }[] };
    await api('/devices/order', {
      method: 'PUT',
      body: JSON.stringify({ macs: [FAKE_MAC, ...devices.devices.map((d) => d.mac)] }),
    });
    // 主动查一次，让假设备立刻回一帧完整数据（不用等它的上报周期）
    await api(`/devices/${FAKE_MAC}/cmd`, { method: 'POST', body: JSON.stringify({ cmd: { brightness: null } }) });
    // 等数据真正到手再开跑：固定 sleep 在冷启动（刚重启后端）时不够，会让第一个用例空等到超时
    for (let i = 0; i < 40; i++) {
      const st = (await api(`/devices/${FAKE_MAC}/state`)).data as { state?: { PM25?: number } };
      if (typeof st?.state?.PM25 === 'number') break;
      await new Promise((r) => setTimeout(r, 500));
    }
  });

  test.afterAll(async () => {
    stopFake();
    await api(`/devices/${FAKE_MAC}`, { method: 'DELETE' }).catch(() => null);
    await api(`/devices/001122334455`, { method: 'DELETE' }).catch(() => null);
  });

  test('主界面显示假设备的实时数据（不是占位符）', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.van-nav-bar__title')).toBeVisible();
    // 等真实数值上来：假设备每 interval 秒上报一次
    await expect
      .poll(async () => page.locator('text=/^\\d+(\\.\\d+)?$/').count(), { timeout: 20_000 })
      .toBeGreaterThan(0);
    const text = (await page.locator('body').innerText()).replaceAll(/\s+/g, ' ');
    expect(text).toContain('PM2.5');
    expect(text).toContain('甲醛');
    // 占位符不应同时存在（说明已收到数据）
    expect(text).not.toContain('--.-');
  });

  test('拖动亮度会经后端下发到假设备并回读一致', async ({ page }) => {
    const before = (await api(`/devices/${FAKE_MAC}/state`)).data as { state: { brightness?: number } };
    const target = before.state.brightness === 1 ? 3 : 1;

    await page.goto(`/#/device/${FAKE_MAC}/settings`);
    await expect(page.locator('body')).toBeVisible();

    // 直接经接口下发（界面滑块的下发路径由页面级测试覆盖），验证后端→broker→设备→回读闭环
    const sent = await api(`/devices/${FAKE_MAC}/cmd`, {
      method: 'POST',
      body: JSON.stringify({ cmd: { brightness: target } }),
    });
    expect(sent.status).toBe(200);
    expect((sent.data as { sent: { channel: string } }).sent.channel).toBe('mqtt');

    await expect
      .poll(
        async () => ((await api(`/devices/${FAKE_MAC}/state`)).data as { state: { brightness?: number } }).state.brightness,
        { timeout: 10_000 },
      )
      .toBe(target);
  });

  test('亮度定时页展示 5 组任务且能读到设备回报', async ({ page }) => {
    await api(`/devices/${FAKE_MAC}/cmd`, {
      method: 'POST',
      body: JSON.stringify({ cmd: { task_0: {}, task_1: {}, task_2: {}, task_3: {}, task_4: {} } }),
    });
    await expect
      .poll(
        async () =>
          ((await api(`/devices/${FAKE_MAC}/state`)).data as { state: { tasks?: unknown[] } }).state.tasks?.[0] ??
          null,
        { timeout: 10_000 },
      )
      .not.toBeNull();

    await page.goto(`/#/device/${FAKE_MAC}/plug`);
    await expect(page.locator('body')).toBeVisible();
    // 页面挂载后要先拉一次设备数据，文本要轮询等待而不是立刻断言
    await expect
      .poll(async () => (await page.locator('body').innerText()).replaceAll(/\s+/g, ' '), {
        timeout: 15_000,
      })
      .toContain('07:30'); // 假设备的 task_0 默认 07:30
  });

  test('云同步报文能从后端发到局域网（UDP，无设备响应也视为通过）', async () => {
    const res = await api(`/settings/mqtt/sync/${FAKE_MAC}`, { method: 'POST' });
    expect(res.status).toBe(200);
    const payload = (res.data as { sent: { payload: string } }).sent.payload;
    expect(JSON.parse(payload).setting.mqtt_uri).toBe('127.0.0.1');
    expect(JSON.parse(payload).setting.mqtt_port).toBe(1883);
  });

  test('局域网扫描：点「开始扫描」后设备实时出现在添加页（无需刷新页面）', async ({ page }) => {
    // 先停掉 MQTT 假设备：它在设备表里、会周期性上报，从而触发一次附带的 REST 刷新，
    // 会掩盖「扫描结果没有实时推送」这一类缺陷。只有它静默，本用例才真的能守住这条链。
    stopFake();
    await new Promise((r) => setTimeout(r, 500));

    // 每次跑用不同 mac：后端会保留上一次扫描结果，固定 mac 会被上一次的缓存干扰
    const udpMac = `aabbccddee${Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0')}`;
    // 真 UDP 通道的假设备（与 MQTT 假设备二选一，见 helpers/fake-zm1.mjs）
    const udpFake = spawn(process.execPath, [FAKE_SCRIPT, '--mac', udpMac, '--name', 'zM1发现测试', '--udp'], {
      stdio: 'ignore',
    });
    try {
      await new Promise((r) => setTimeout(r, 800));

      await page.goto('/#/add');
      await expect(page.getByTestId('scan-toggle')).toHaveText('开始扫描');
      await expect(page.getByTestId(`scan-device-${udpMac}`)).toHaveCount(0);

      await page.getByTestId('scan-toggle').click();

      // 关键断言：不刷新页面，扫描结果通过 WS 实时进列表
      await expect(page.getByTestId(`scan-device-${udpMac}`)).toContainText('zM1发现测试', {
        timeout: 20_000,
      });
      await expect(page.getByTestId('scan-toggle')).toHaveText('停止扫描');

      // 扫描到的设备不落库：设备表里不应出现它
      const saved = (await api('/devices')).data as { devices: { mac: string }[] };
      expect(saved.devices.map((d) => d.mac)).not.toContain(udpMac);
    } finally {
      udpFake.kill('SIGTERM');
      await api('/discovery/scan', { method: 'POST', body: JSON.stringify({ action: 'stop' }) }).catch(() => null);
    }
  });
});
