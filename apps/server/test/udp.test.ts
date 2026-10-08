import dgram from 'node:dgram';
import { describe, expect, it } from 'vitest';
import { UdpService, subnetBroadcast } from '../src/transport/udp.ts';

/**
 * UDP 监听端口的行为约定：
 *  - 端口被占用（同一台机器上跑着第二个后端）时**必须明确失败**，不能静默共享端口：
 *    两个进程都开 reuseAddr 监听 10181 时，设备回包会被内核随机投递给其中一个，
 *    表现就是「云同步偶尔收不到回包」这种难查的问题。
 *  - 正常监听后要能把收到的报文交给回调（别因为改了 socket 选项把收包弄坏）。
 */

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = dgram.createSocket('udp4');
    s.once('error', reject);
    s.bind(0, () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

async function waitListening(svc: UdpService, expectListening: boolean, ms = 2000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (svc.status().listening === expectListening) return;
    await wait(20);
  }
  throw new Error(`等待 listening=${expectListening} 超时（实际 ${svc.status().listening}）`);
}

describe('UdpService 监听端口', () => {
  it('端口被占用时第二个实例明确报错、不进入监听', async () => {
    const port = await freePort();
    const errors: string[] = [];

    const first = new UdpService(() => {}, false, undefined, port);
    first.start();
    await waitListening(first, true);
    expect(first.status()).toEqual({ listening: true, port });

    const second = new UdpService(() => {}, false, (m) => errors.push(m), port);
    second.start();
    // bind 失败是异步事件，等它到达（listening 初始就是 false，不能拿它当判据）
    const deadline = Date.now() + 2000;
    while (!errors.length && Date.now() < deadline) await wait(20);
    expect(errors.join('\n')).toContain(`UDP 监听 ${port} 失败`);
    expect(second.status()).toEqual({ listening: false, port });

    first.stop();
    second.stop();
  });

  it('正常监听时能收到报文并交给回调', async () => {
    const port = await freePort();
    const got: string[] = [];
    const svc = new UdpService((_ip, _port, payload) => got.push(payload), false, undefined, port);
    svc.start();
    await waitListening(svc, true);

    const sender = dgram.createSocket('udp4');
    await new Promise<void>((resolve) =>
      sender.send('{"mac":"aabbccddeeff"}', port, '127.0.0.1', () => resolve()),
    );

    const deadline = Date.now() + 2000;
    while (!got.length && Date.now() < deadline) await wait(20);
    expect(got).toEqual(['{"mac":"aabbccddeeff"}']);

    sender.close();
    svc.stop();
  });

  it('stop 后端口释放，可以重新监听', async () => {
    const port = await freePort();
    const a = new UdpService(() => {}, false, undefined, port);
    a.start();
    await waitListening(a, true);
    a.stop();
    await wait(50);

    const b = new UdpService(() => {}, false, undefined, port);
    b.start();
    await waitListening(b, true);
    b.stop();
  });
});

describe('subnetBroadcast', () => {
  it('按掩码算子网广播地址', () => {
    expect(subnetBroadcast('192.168.1.50', '255.255.255.0')).toBe('192.168.1.255');
    expect(subnetBroadcast('172.17.0.1', '255.255.0.0')).toBe('172.17.255.255');
    expect(subnetBroadcast('10.8.0.5', '255.255.255.255')).toBe('10.8.0.5');
  });

  it('地址或掩码非法时返回 null', () => {
    expect(subnetBroadcast('not-an-ip', '255.255.255.0')).toBeNull();
    expect(subnetBroadcast('192.168.1.1', '255.255.0')).toBeNull();
  });
});
