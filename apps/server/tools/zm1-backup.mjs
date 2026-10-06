#!/usr/bin/env node
/**
 * zM1 配置备份 / 恢复工具（操作设备前建议先备份）。
 *
 * 备份：把设备**所有可读**的有效配置抓成 JSON（亮度、名称、固件版本、SSID、上报频率、时区、
 *       5 组定时任务），保存到 docs/device-backups/<mac>-<时间戳>.json。
 * 恢复：按备份文件把上面这些字段逐项写回，写完逐项回读比对，并打印差异表。
 *
 * 注意：设备**不会**回报它存储的 MQTT 服务器配置（mqtt_uri/port/user/password），
 *       所以「云同步 MQTT 配置」这一项无法备份 → 本工具不碰它，也不应单独试写。
 *
 * 用法（mac 用自己设备的 12 位小写十六进制地址）：
 *   node tools/zm1-backup.mjs --mac aabbccddeeff
 *   node tools/zm1-backup.mjs --mac aabbccddeeff --restore docs/device-backups/xxx.json
 *   node tools/zm1-backup.mjs --mac aabbccddeeff --restore xxx.json --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const API = process.env.ZCONTROL_API ?? 'http://127.0.0.1:8090/api';

const args = process.argv.slice(2);
function arg(name, def = '') {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
}
const mac = arg('mac', '').toLowerCase();
const restoreFile = arg('restore', '');
const dryRun = args.includes('--dry-run');
/** 默认备份目录固定在仓库的 docs/device-backups（不受调用时 cwd 影响） */
const backupDir = arg('dir', path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..', 'docs/device-backups'));

if (!mac || !/^[0-9a-f]{12}$/.test(mac)) {
  console.error('用法: node tools/zm1-backup.mjs --mac <12位mac> [--restore 备份文件] [--dry-run]');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, init) {
  const headers = init?.body !== undefined ? { 'content-type': 'application/json' } : {};
  const res = await fetch(API + pathname, { ...init, headers });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) throw new Error(`${pathname} → HTTP ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const sendCmd = (cmd) => api(`/devices/${mac}/cmd`, { method: 'POST', body: JSON.stringify({ cmd }) });
const readState = async () => (await api(`/devices/${mac}/state`)).state;
const readDevice = async () => {
  const { devices } = await api('/devices');
  const d = devices.find((x) => x.mac === mac);
  if (!d) throw new Error(`设备 ${mac} 不在后端设备表里，请先添加`);
  return d;
};

/** 逐一查询设备，等状态里出现对应字段（设备是异步回包的） */
async function fetchSnapshot({ waitMs = 2500 } = {}) {
  const device = await readDevice();
  await sendCmd({ brightness: null });
  await sendCmd({ version: null, interval: null, ssid: null, zone: null });
  await sendCmd({ task_0: {}, task_1: {}, task_2: {}, task_3: {}, task_4: {} });
  await sleep(waitMs);
  const state = await readState();
  return {
    mac,
    name: device.name,
    capturedAt: new Date().toISOString(),
    readable: {
      brightness: state.brightness ?? null,
      version: state.version ?? null,
      ssid: state.ssid ?? null,
      interval: state.interval ?? null,
      zone: state.zone ?? null,
    },
    tasks: Array.from({ length: 5 }, (_, i) => state.tasks?.[i] ?? null),
  };
}

function printSnapshot(label, snap) {
  console.log(`\n${label}`);
  console.log(`  mac=${snap.mac} name=${snap.name}`);
  console.log(
    `  亮度=${snap.readable.brightness} 版本=${snap.readable.version} SSID=${snap.readable.ssid} 上报频率=${snap.readable.interval}s 时区=${snap.readable.zone}`,
  );
  snap.tasks.forEach((t, i) => {
    console.log(
      `  task_${i}: ${t ? `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')} 亮度${t.brightness} ${t.on ? '启用' : '停用'}` : '（未获取到）'}`,
    );
  });
}

// ---------------------------------------------------------------------------
// 备份
// ---------------------------------------------------------------------------
async function backup() {
  const snap = await fetchSnapshot();
  for (const key of ['brightness', 'version', 'ssid', 'interval', 'zone']) {
    if (snap.readable[key] === null) {
      console.warn(`  ⚠ 字段 ${key} 未能读到，恢复时会跳过它`);
    }
  }
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const file = path.join(backupDir, `${mac}-${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify(snap, null, 2)}\n`, 'utf8');
  printSnapshot(`备份完成 → ${file}`, snap);
  return file;
}

// ---------------------------------------------------------------------------
// 恢复
// ---------------------------------------------------------------------------
async function restore(file) {
  if (!fs.existsSync(file)) throw new Error(`备份文件不存在: ${file}`);
  const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (snap.mac !== mac) throw new Error(`备份文件属于 ${snap.mac}，与 --mac ${mac} 不一致，拒绝执行`);

  printSnapshot('目标（备份内容）', snap);

  const current = await fetchSnapshot();
  printSnapshot('当前设备状态（恢复前）', current);

  const plan = [];
  if (snap.readable.brightness !== null) plan.push(['亮度', { brightness: snap.readable.brightness }]);
  if (snap.readable.interval !== null) plan.push(['上报频率', { interval: snap.readable.interval }]);
  if (snap.readable.zone !== null) plan.push(['时区', { zone: snap.readable.zone }]);
  snap.tasks.forEach((t, i) => {
    if (t) plan.push([`task_${i}`, { [`task_${i}`]: t }]);
  });
  if (snap.name && snap.name !== current.name) plan.push(['名称', { setting: { name: snap.name } }]);

  console.log('\n将要写回的项:');
  for (const [label, cmd] of plan) console.log(`  ${label}: ${JSON.stringify(cmd)}`);

  if (dryRun) {
    console.log('\n--dry-run：只打印不执行');
    return;
  }

  for (const [label, cmd] of plan) {
    process.stdout.write(`  写回 ${label} … `);
    await sendCmd(cmd);
    await sleep(600);
    console.log('已发送');
  }
  if (snap.readable.zone !== null) {
    // 设置时区后需追发一次校时
    await sendCmd({ time: -1 });
    console.log('  已追发校时 {time:-1}');
  }

  await sleep(3000);
  const after = await fetchSnapshot();
  printSnapshot('恢复后设备状态', after);

  // 差异比对
  const diffs = [];
  for (const key of ['brightness', 'version', 'ssid', 'interval', 'zone']) {
    if (snap.readable[key] !== after.readable[key]) {
      diffs.push(`${key}: 备份=${snap.readable[key]} 现在=${after.readable[key]}`);
    }
  }
  snap.tasks.forEach((t, i) => {
    const a = after.tasks[i];
    const same =
      (t === null && a === null) ||
      (t && a && t.hour === a.hour && t.minute === a.minute && t.brightness === a.brightness && t.on === a.on);
    if (!same) diffs.push(`task_${i}: 备份=${JSON.stringify(t)} 现在=${JSON.stringify(a)}`);
  });
  if (snap.name !== after.name) diffs.push(`name: 备份=${snap.name} 现在=${after.name}`);

  if (diffs.length === 0) {
    console.log('\n✅ 已恢复到备份状态，逐项比对一致');
  } else {
    console.log('\n⚠️ 存在差异（设备可能仍在回包，可稍后重跑备份比对）:');
    for (const d of diffs) console.log(`   - ${d}`);
    process.exitCode = 1;
  }
}

if (restoreFile) {
  await restore(restoreFile);
} else {
  await backup();
}
