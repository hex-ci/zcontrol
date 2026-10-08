/**
 * 生成 Home Assistant 用的 MQTT YAML 配置（用户粘贴进 configuration.yaml）。
 *
 * 生成结构沿用早期在 PC 端控制工具里验证过的那套模板：
 * sensor×4（温度 / 湿度 / PM2.5 / 甲醛）+ light（`schema: template`，控制屏幕亮度），
 * 实体名与 unique_id 用 `zm1_<mac>_<字段>`，中文显示名交给 `customize.yaml`。
 *
 * 本版在该模板上补齐：device_class / state_class / availability / device 分组 / 数值容错，
 * 并保持 HA 当前版本 `mqtt:` YAML 配置的键名。
 *
 * 两条刻意的设计约束（改之前先读）：
 *   1. 实体名与 unique_id 用 `zm1_<mac>_<字段>`，**不要改成中文名**：
 *      HA 的 entity_id 由 name 生成，用户既有的面板（历史曲线/卡片）引用的是这些 ID，
 *      换个名字等于把面板打断；生成物必须能作为旧条目的整体替换。
 *   2. 用 `mqtt:` → `sensor:` / `light:` 的分域写法，与用户现有配置一致，
 *      追加进已有 `mqtt:` 段即可（HA 文档另有一种「按项列出」的等价写法，不要混用）。
 *
 * 只生成文本、不发任何报文：设备侧无感，用户自行粘贴后重启/重载 HA 生效。
 */

/** YAML 双引号标量转义（mac/名称来自设备表，理论上不会有引号，仍然转义） */
function q(v: string): string {
  return `"${v.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

interface SensorSpec {
  /** 实体后缀：name / unique_id 用 `zm1_<mac>_<id>` */
  id: string;
  /** 中文标签（只出现在注释里） */
  label: string;
  deviceClass: string;
  unit: string;
  icon: string;
  /** 状态模板（对上报值做数值容错） */
  value: string;
}

/** zM1 sensor topic 上的四个数值（见 docs/PROTOCOL.md §4） */
const SENSORS: SensorSpec[] = [
  {
    id: 'temperature',
    label: '温度',
    deviceClass: 'temperature',
    unit: '°C',
    icon: 'mdi:thermometer',
    value: 'value_json.temperature | float(0)',
  },
  {
    id: 'humidity',
    label: '湿度',
    deviceClass: 'humidity',
    unit: '%',
    icon: 'mdi:water-percent',
    value: 'value_json.humidity | float(0)',
  },
  {
    id: 'pm25',
    label: 'PM2.5',
    deviceClass: 'pm25',
    // μ 是希腊字母 U+03BC：HA 的单位常量按这个字符比对，换成微符号 µ(U+00B5) 会不匹配
    unit: 'μg/m³',
    icon: 'mdi:blur',
    value: 'value_json.PM25 | float(0)',
  },
  {
    id: 'hcho',
    label: '甲醛',
    // HA 没有甲醛专用 class；volatile_organic_compounds 是唯一接受 mg/m³ 的近似类
    deviceClass: 'volatile_organic_compounds',
    unit: 'mg/m³',
    icon: 'mdi:chemical-weapon',
    value: 'value_json.formaldehyde | float(0)',
  },
];

/** 生成一份可直接粘贴的 `mqtt:` YAML 片段 */
export function buildHaConfig(params: { mac: string; name: string }): string {
  const mac = params.mac.toLowerCase();
  const name = params.name.trim() || `zM1_${mac.slice(-4)}`;
  const sensorTopic = `device/zm1/${mac}/sensor`;
  const stateTopic = `device/zm1/${mac}/state`;
  const availabilityTopic = `device/zm1/${mac}/availability`;
  /** 实体名/unique_id（= HA entity_id 的来源，必须与旧模板一致） */
  const eid = (id: string): string => `zm1_${mac}_${id}`;

  /** 每个实体都挂同一个 device，HA 里会归到一台设备下（不影响 entity_id） */
  const device = [
    '      device:',
    '        identifiers:',
    `          - ${q(`zm1_${mac}`)}`,
    `        name: ${q(name)}`,
    '        manufacturer: "Phicomm"',
    '        model: "zM1 空气检测仪"',
  ].join('\n');

  const sensors = SENSORS.map((s) =>
    [
      `    # ${s.label}`,
      `    - name: ${eid(s.id)}`,
      `      unique_id: ${eid(s.id)}`,
      `      state_topic: ${q(sensorTopic)}`,
      `      availability_topic: ${q(availabilityTopic)}`,
      '      payload_available: "1"',
      '      payload_not_available: "0"',
      `      device_class: ${s.deviceClass}`,
      `      unit_of_measurement: ${q(s.unit)}`,
      '      state_class: measurement',
      `      icon: ${q(s.icon)}`,
      `      value_template: ${q(`{{ ${s.value} }}`)}`,
      device,
    ].join('\n'),
  ).join('\n');

  return [
    '# zM1 空气检测仪 · Home Assistant MQTT 配置',
    `# 设备：${name}（mac ${mac}）`,
    '# 用法：把下面 sensor / light 两项追加到 configuration.yaml 里已有的 mqtt: 段下；',
    '#       若还没有 mqtt: 段，则整段粘贴到文件顶层；然后重启 HA',
    '#       （或「开发者工具 → YAML → 重新加载 MQTT 实体」）。',
    `# 实体名与 unique_id 仍为 ${eid('<字段>')}（与原版 PC 工具一致），实体 ID 不变，`,
    '# 中文显示名继续在 customize.yaml 里维护；该设备若已按旧模板配过，请用本段整体替换旧条目',
    '# （unique_id 相同，同时存在 HA 会报重复并忽略后一条）。',
    'mqtt:',
    '  sensor:',
    sensors,
    '  light:',
    '    # 屏幕亮度（设备只有 0..4 档）',
    `    - name: ${eid('brightness')}`,
    `      unique_id: ${eid('brightness')}`,
    '      schema: template',
    `      command_topic: ${q(`device/zm1/${mac}/set`)}`,
    `      state_topic: ${q(stateTopic)}`,
    `      availability_topic: ${q(availabilityTopic)}`,
    '      payload_available: "1"',
    '      payload_not_available: "0"',
    '      # HA 侧 0..255 按 64 一档折回设备档位（1..64→1，65..128→2，129..192→3，193..255→4），',
    '      # 不带亮度时按最亮（4）开屏（HA 可能把 brightness 传成 none，也要挡）',
    '      command_on_template: >-',
    `        {"mac": ${q(mac)}{% if brightness is defined and brightness is not none %}, "brightness": {{ (brightness / 64) | round(0, 'ceil') | int }}{% else %}, "brightness": 4{% endif %}}`,
    '      command_off_template: >-',
    `        {"mac": ${q(mac)}, "brightness": 0}`,
    '      state_template: >-',
    "        {{ 'off' if value_json.brightness == 0 else 'on' }}",
    '      brightness_template: >-',
    '        {{ [value_json.brightness | int(0) * 64, 255] | min }}',
    device,
    '',
  ].join('\n');
}

/** 下载用的文件名（照抄 PC 端 `zm1_<mac>.yaml` 的习惯） */
export function haConfigFileName(mac: string): string {
  return `zm1_${mac.toLowerCase()}_ha.yaml`;
}
