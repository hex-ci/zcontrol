#!/usr/bin/env node
/**
 * 开源发布前审计：扫全部将进入仓库的文本文件，检查
 *   1) 来源项目 / 内部流程 / 个人隐私类禁用词
 *   2) 真实设备信息（mac / SSID / 本机内网地址 / 本机路径）
 *   3) 常见凭据形态（token / key / 私钥）
 *   4) 需人工确认项（例如固件发布源地址）—— 不计为失败
 *
 * 用法：node scripts/release-audit.mjs   （在项目根执行；有阻断项时退出码为 1）
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'test-results', 'playwright-report', 'blob-report', '.git', '.playwright', '_internal',
]);
const TEXT_EXT = new Set(['.ts', '.vue', '.md', '.json', '.mjs', '.js', '.css', '.html', '.yaml', '.yml', '.txt', '.sh', '.cjs']);
const SPECIAL = new Set(['LICENSE', '.gitignore']);
/** 审计脚本自身包含这些模式，跳过以免自指 */
const SKIP_FILES = new Set(['scripts/release-audit.mjs']);

/** 阻断项：命中即视为不可发布 */
const BLOCKING = {
  '来源项目/作者': /SmartControl|zip_zhang|zip?[_-]?zhang/i,
  '移植措辞': /复刻|移植自|Android|安卓|原 ?app|原版 app|子代理|delegate_task/,
  '内部流程/人名': /Hermes|hermes-agent|飞书|feishu|zhaochang|拍板/i,
  '打赏/隐私声明': /打赏|支付宝|alipay|PrivacyPolicy|隐私政策|隐私声明/,
  '真实设备信息': /b0f8931db91b|b0f89327921a|b0f89324522a|leona_new|客厅M1|银色M1/,
  '其它设备型号': /zTC1|zDC1|zA1\b|zS7|zClock|zMOPS|zRGBW|zKey51|zButtonMate|z485toMqtt|z86_3Key|按键伴侣|智能排插|空气净化器|体重秤|点阵时钟/,
  '本机路径/真实内网地址': /\/home\/zhaochang|192\.168\.1\.(8|246)\b/,
  '凭据形态': /ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{20,}\./,
};

/** 提示项：需要人工确认，但不阻断发布 */
const ADVISORY = {
  '固件发布源地址（OTA 功能依赖）': /a2633063/,
};

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name));
    } else {
      const ext = path.extname(entry.name);
      const rel = path.relative(ROOT, path.join(dir, entry.name));
      if (SKIP_FILES.has(rel)) continue;
      if (TEXT_EXT.has(ext) || SPECIAL.has(entry.name)) files.push(path.join(dir, entry.name));
    }
  }
})(ROOT);

function scan(rules) {
  let total = 0;
  for (const [label, re] of Object.entries(rules)) {
    const hits = [];
    for (const file of files) {
      const rel = path.relative(ROOT, file);
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (re.test(line)) hits.push(`${rel}:${i + 1}  …${line.trim().slice(0, 120)}`);
        });
    }
    total += hits.length;
    const icon = hits.length ? '❌' : '✅';
    console.log(`${icon} 【${label}】${hits.length} 处`);
    for (const h of hits.slice(0, 10)) console.log('     ' + h);
    if (hits.length > 10) console.log(`     …还有 ${hits.length - 10} 处`);
  }
  return total;
}

console.log('=== 阻断项 ===');
const blocking = scan(BLOCKING);
console.log('\n=== 需人工确认（不阻断）===');
const advisory = scan(ADVISORY);
console.log(`\n扫描 ${files.length} 个文件：阻断项 ${blocking} 处，提示项 ${advisory} 处`);
process.exit(blocking ? 1 : 0);
