#!/usr/bin/env node
/**
 * 只读 MQTT 嗅探工具（不发布任何报文，可安全用于观察设备）：
 *   node tools/mqtt-sniff.mjs --broker 127.0.0.1:1883 --topic "device/zm1/+/+" --sec 15
 */
import process from 'node:process';
import mqtt from 'mqtt';

const args = process.argv.slice(2);
function arg(name, def = '') {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const broker = arg('broker', '127.0.0.1:1883');
const topic = arg('topic', 'device/zm1/+/+');
const sec = Number(arg('sec', '15'));
const user = arg('user', '');
const pass = arg('pass', '');

const options = { clientId: `zcontrol-sniff-${Date.now() % 100000}`, clean: true };
if (user) options.username = user;
if (pass) options.password = pass;

const client = mqtt.connect(`mqtt://${broker}`, options);
const seen = new Map();

client.on('connect', () => {
  console.log(`已连接 ${broker}（只读订阅 ${topic}，${sec} 秒后退出）`);
  client.subscribe(topic, { qos: 1 });
});

client.on('message', (t, buf) => {
  const text = buf.toString();
  const mac = t.split('/')[2] ?? '?';
  const kind = t.split('/')[3] ?? '?';
  const count = (seen.get(mac) ?? 0) + 1;
  seen.set(mac, count);
  console.log(`${new Date().toISOString()} ${t}\n  ${text.slice(0, 400)}`);
});

client.on('error', (e) => {
  console.error('MQTT 错误:', e.message);
  process.exit(1);
});

setTimeout(() => {
  client.end(true);
  console.log('--- 汇总 ---');
  for (const [mac, n] of seen) console.log(`mac=${mac} 收到 ${n} 条`);
  if (seen.size === 0) console.log('（未收到任何报文）');
  process.exit(0);
}, sec * 1000);
