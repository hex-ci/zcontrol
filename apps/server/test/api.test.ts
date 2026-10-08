import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type BuiltApp } from '../src/app.ts';

const MAC = 'aabbccddeeff';
const MAC2 = '112233445566';

let built: BuiltApp;

beforeAll(async () => {
  built = await createApp({
    dataFile: ':memory:',
    startTransports: false,
    serveWeb: false,
    udpDryRun: true,
    logLevel: 'silent',
  });
});

afterAll(async () => {
  await built.app.close();
  built.ctx.store.close();
});

const get = (url: string) => built.app.inject({ method: 'GET', url });
const post = (url: string, payload?: unknown) =>
  built.app.inject({ method: 'POST', url, payload: payload as never });
const put = (url: string, payload?: unknown) =>
  built.app.inject({ method: 'PUT', url, payload: payload as never });
const patch = (url: string, payload?: unknown) =>
  built.app.inject({ method: 'PATCH', url, payload: payload as never });
const del = (url: string) => built.app.inject({ method: 'DELETE', url });

describe('后端接口（关键行为）', () => {
  it('health 可用', async () => {
    const res = await get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('新增设备：mac 规范化、非法 mac/类型被拒、重复 409', async () => {
    const ok = await post('/api/devices', { name: '客厅检测仪', mac: 'AA:BB:CC:DD:EE:FF', type: 4 });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().device.mac).toBe(MAC);

    const dup = await post('/api/devices', { mac: MAC, type: 4 });
    expect(dup.statusCode).toBe(409);

    const bad = await post('/api/devices', { mac: 'zz', type: 4 });
    expect(bad.statusCode).toBe(400);

    const wrongType = await post('/api/devices', { mac: MAC2, type: 8 });
    expect(wrongType.statusCode).toBe(400);
    expect(wrongType.json().error).toContain('仅支持 zM1');
  });

  it('改名 / 排序 / 删除', async () => {
    await post('/api/devices', { name: '书房检测仪', mac: MAC2, type: 4 });

    const renamed = await patch(`/api/devices/${MAC}`, { name: '客厅' });
    expect(renamed.json().device.name).toBe('客厅');

    const empty = await patch(`/api/devices/${MAC}`, { name: '  ' });
    expect(empty.statusCode).toBe(400);

    const ordered = await put('/api/devices/order', { macs: [MAC2, MAC] });
    expect(ordered.json().devices.map((d: { mac: string }) => d.mac)).toEqual([MAC2, MAC]);

    await post('/api/devices', { name: '临时', mac: 'aabbccddee01', type: 4 });
    const removed = await del('/api/devices/aabbccddee01');
    expect(removed.json().ok).toBe(true);
    expect((await get('/api/devices')).json().devices).toHaveLength(2);
  });

  it('下发指令：MQTT 未连接时走 UDP，payload 拼接一致', async () => {
    built.ctx.udp.sent.length = 0;
    const res = await post(`/api/devices/${MAC}/cmd`, { cmd: { brightness: 3 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().sent.channel).toBe('udp');
    expect(res.json().sent.payload).toBe(`{"mac":"${MAC}","brightness":3}`);
    expect(built.ctx.udp.sent.at(-1)?.payload).toBe(`{"mac":"${MAC}","brightness":3}`);
    expect(built.ctx.udp.sent.at(-1)?.port).toBe(10182);
  });

  it('always_UDP 开关可读写', async () => {
    expect((await get(`/api/devices/${MAC}/settings`)).json().always_UDP).toBe(false);
    await put(`/api/devices/${MAC}/settings`, { always_UDP: true });
    expect((await get(`/api/devices/${MAC}/settings`)).json().always_UDP).toBe(true);
    await put(`/api/devices/${MAC}/settings`, { always_UDP: false });
  });

  it('拒收未在白名单的指令（联动 za1 / 未知字段）', async () => {
    const za1 = await post(`/api/devices/${MAC}/cmd`, { cmd: { za1: {} } });
    expect(za1.statusCode).toBe(400);
    expect(za1.json().error).toContain('暂不支持');

    const junk = await post(`/api/devices/${MAC}/cmd`, { cmd: { whatever: 1 } });
    expect(junk.statusCode).toBe(400);

    const missing = await post('/api/devices/000000000000/cmd', { cmd: { brightness: 1 } });
    expect(missing.statusCode).toBe(404);
  });

  it('全局设置：脱敏返回、非法地址被拒、密码不外泄', async () => {
    const bad = await put('/api/settings', { mqtt_uri: 'host:abc' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain('格式错误');

    const ok = await put('/api/settings', {
      mqtt_uri: '192.168.1.10',
      mqtt_user: 'z',
      mqtt_password: '123456',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().settings.mqtt_uri).toBe('192.168.1.10:1883');
    expect(ok.json().settings.mqtt_password_set).toBe(true);
    expect(JSON.stringify(ok.json())).not.toContain('123456');
  });

  it('云同步：固定走 UDP，payload 拆出主机与端口', async () => {
    built.ctx.udp.sent.length = 0;
    const res = await post(`/api/settings/mqtt/sync/${MAC}`);
    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.json().sent.payload);
    expect(payload.setting).toEqual({
      mqtt_uri: '192.168.1.10',
      mqtt_port: 1883,
      mqtt_user: 'z',
      mqtt_password: '123456',
    });
    expect(built.ctx.udp.sent.at(-1)?.payload).toBe(res.json().sent.payload);
  });

  it('云同步后设备回包 setting 写进快照（界面据此确认设备实际保存的配置）', async () => {
    built.ctx.dispatcher.handleMqtt(
      `device/zm1/${MAC}/state`,
      JSON.stringify({
        name: 'zM1_1',
        mac: MAC,
        setting: {
          mqtt_uri: '192.168.1.10',
          mqtt_port: 1883,
          mqtt_user: 'z',
          mqtt_password: '123456',
        },
      }),
    );
    const device = (await get('/api/devices')).json().devices.find((d: { mac: string }) => d.mac === MAC);
    expect(device.state.mqttSetting).toEqual({
      mqtt_uri: '192.168.1.10',
      mqtt_port: 1883,
      mqtt_user: 'z',
    });
    // 密码既不落进快照、也不随接口回传
    expect(JSON.stringify(device)).not.toContain('123456');
  });

  it('设备上报：availability 置在线、sensor 合并进快照、任务合并', async () => {
    built.ctx.dispatcher.handleMqtt(`device/zm1/${MAC}/availability`, '1');
    built.ctx.dispatcher.handleMqtt(
      `device/zm1/${MAC}/sensor`,
      JSON.stringify({ mac: MAC, PM25: 42, formaldehyde: 0.03, temperature: 21.5, humidity: 55.5 }),
    );
    built.ctx.dispatcher.handleMqtt(
      `device/zm1/${MAC}/state`,
      JSON.stringify({ mac: MAC, brightness: 2, version: 'v0.0.4', task_0: { hour: 8, minute: 30, brightness: 4, on: 1 } }),
    );

    const device = (await get('/api/devices')).json().devices.find((d: { mac: string }) => d.mac === MAC);
    expect(device.online).toBe(true);
    expect(device.state.PM25).toBe(42);
    expect(device.state.temperature).toBe(21.5);
    expect(device.state.brightness).toBe(2);
    expect(device.state.version).toBe('v0.0.4');
    expect(device.state.tasks[0]).toEqual({ hour: 8, minute: 30, brightness: 4, on: 1 });

    built.ctx.dispatcher.handleMqtt(`device/zm1/${MAC}/availability`, '0');
    const off = (await get('/api/devices')).json().devices.find((d: { mac: string }) => d.mac === MAC);
    expect(off.online).toBe(false);
  });

  it('设备名称以设备上报为准（名称同步）', async () => {
    built.ctx.dispatcher.handleMqtt(`device/zm1/${MAC}/state`, JSON.stringify({ mac: MAC, name: 'zM1_FFFF' }));
    const device = (await get('/api/devices')).json().devices.find((d: { mac: string }) => d.mac === MAC);
    expect(device.name).toBe('zM1_FFFF');
  });

  it('局域网扫描：广播 device report，收集响应，停止后不再广播', async () => {
    built.ctx.udp.sent.length = 0;
    const start = await post('/api/discovery/scan', { action: 'start' });
    expect(start.json().active).toBe(true);
    expect(built.ctx.udp.sent.at(0)?.payload).toBe('{"cmd":"device report"}');

    built.ctx.dispatcher.handleUdp('192.168.1.60', 10182, JSON.stringify({ name: 'zM1_1234', mac: MAC2, type: 4 }));
    const listed = (await get('/api/discovery/scan')).json();
    expect(listed.devices.map((d: { mac: string }) => d.mac)).toContain(MAC2);

    const stop = await post('/api/discovery/scan', { action: 'stop' });
    expect(stop.json().active).toBe(false);
  });

  it('扫描发现的设备通过 WS 实时推送（此前没有推送，界面必须刷新才看得到）', async () => {
    // 假连接：记录 hub 广播出去的每一帧
    const frames: { type: string; data: unknown }[] = [];
    const fakeWs = {
      readyState: 1,
      send: (text: string) => frames.push(JSON.parse(text)),
      close: () => {},
      on: () => {},
    };
    const sockets = (built.hub as unknown as { sockets: Set<typeof fakeWs> }).sockets;
    sockets.add(fakeWs);
    try {
      await post('/api/discovery/scan', { action: 'start' });
      frames.length = 0;

      built.ctx.dispatcher.handleUdp(
        '192.168.1.60',
        10182,
        JSON.stringify({ name: 'zM1_1234', mac: MAC2, type: 4 }),
      );

      const scanFrame = frames.find((f) => f.type === 'scan');
      expect(scanFrame).toBeDefined();
      const devices = (scanFrame?.data as { devices: { mac: string }[] }).devices;
      expect(devices.map((d) => d.mac)).toContain(MAC2);
    } finally {
      sockets.delete(fakeWs);
      await post('/api/discovery/scan', { action: 'stop' });
    }
  });

  it('HA 配置：按设备名与 mac 生成，404 兜底', async () => {
    const res = await get(`/api/devices/${MAC}/ha-config`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { file_name: string; yaml: string };
    expect(body.file_name).toBe(`zm1_${MAC}_ha.yaml`);
    expect(body.yaml).toContain('mqtt:');
    expect(body.yaml).toContain(`device/zm1/${MAC}/sensor`);
    // 实体名用的是设备表里的当前名称
    const device = (await get('/api/devices'))
      .json()
      .devices.find((d: { mac: string }) => d.mac === MAC);
    expect(body.yaml).toContain(device.name);

    const missing = await get('/api/devices/000000000000/ha-config');
    expect(missing.statusCode).toBe(404);
  });

  it('导入导出：非法条目跳过并计数', async () => {
    const exported = (await get('/api/devices/export')).json();
    expect(exported.device).toHaveLength(2);

    const imported = await post('/api/devices/import', {
      device: [
        { name: '书房', mac: MAC2, type: 4 },
        { name: '新设备', mac: 'AaBbCcDdEe02', type: 4 },
        { name: '坏数据', mac: 'xx', type: 4 },
        { name: '其他类型', mac: 'aabbccddee03', type: 8 },
      ],
    });
    expect(imported.json()).toEqual({ total: 2, added: 1, dup: 1, invalid: 2 });
  });

  it('添加设备前收到的报文会缓存，添加时立即套用（名称/在线/数值）', async () => {
    const mac = 'abcdefabcdef';
    built.ctx.dispatcher.handleMqtt(`device/zm1/${mac}/availability`, '1');
    built.ctx.dispatcher.handleMqtt(
      `device/zm1/${mac}/sensor`,
      JSON.stringify({ mac, name: '测试设备', PM25: '7', temperature: '23.8', humidity: '42.7' }),
    );
    const created = await post('/api/devices', { mac });
    const device = created.json().device;
    expect(device.name).toBe('测试设备');
    expect(device.online).toBe(true);
    expect(device.state.PM25).toBe(7);
    expect(device.state.temperature).toBe(23.8);
    expect(device.state.lastTopic).toBe('sensor');
  });

  it('availability=0 覆盖「收到报文即在线」', async () => {
    const mac = 'abcdefabcdee';
    await post('/api/devices', { mac });
    built.ctx.dispatcher.handleMqtt(`device/zm1/${mac}/sensor`, JSON.stringify({ mac, PM25: 5 }));
    expect(
      (await get('/api/devices')).json().devices.find((d: { mac: string }) => d.mac === mac).online,
    ).toBe(true);
    built.ctx.dispatcher.handleMqtt(`device/zm1/${mac}/availability`, '0');
    expect(
      (await get('/api/devices')).json().devices.find((d: { mac: string }) => d.mac === mac).online,
    ).toBe(false);
  });

  it('前台未知路由返回 404，不崩', async () => {
    const res = await get('/api/nope');
    expect(res.statusCode).toBe(404);
  });
});
