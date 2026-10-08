import { describe, expect, it } from 'vitest'
import { buildHaConfig, haConfigFileName } from '../src/device/ha-config.ts'

const MAC = 'aabbccddeeff'

describe('buildHaConfig（Home Assistant 配置生成）', () => {
  const yaml = buildHaConfig({ mac: MAC, name: '测试检测仪' })

  it('生成 4 个 sensor + 1 个 light，主题按 mac 拼全', () => {
    expect(yaml).toContain('mqtt:')
    expect(yaml).toContain('  sensor:')
    expect(yaml).toContain('  light:')
    expect((yaml.match(/unique_id:/g) ?? []).length).toBe(5)
    expect(yaml).toContain(`state_topic: "device/zm1/${MAC}/sensor"`)
    expect(yaml).toContain(`state_topic: "device/zm1/${MAC}/state"`)
    expect(yaml).toContain(`command_topic: "device/zm1/${MAC}/set"`)
    expect(yaml).toContain(`availability_topic: "device/zm1/${MAC}/availability"`)
    expect(yaml).toContain('payload_available: "1"')
    expect(yaml).toContain('payload_not_available: "0"')
    // 四个数值都有设备类、单位与统计口径
    for (const dc of ['temperature', 'humidity', 'pm25', 'volatile_organic_compounds']) {
      expect(yaml).toContain(`device_class: ${dc}`)
    }
    expect(yaml).toContain('state_class: measurement')
    expect(yaml).toContain('icon: "mdi:thermometer"')
    expect(yaml).toContain('icon: "mdi:blur"')
    // μ 必须是希腊字母 U+03BC：HA 的单位常量按该字符比对
    expect(yaml).toContain('unit_of_measurement: "μg/m³"')
    expect(yaml).toContain('unit_of_measurement: "°C"')
  })

  it('实体名与 unique_id 沿用 PC 模板的 mac 命名（entity_id 不变，不打断用户面板）', () => {
    for (const id of ['temperature', 'humidity', 'pm25', 'hcho', 'brightness']) {
      expect(yaml).toContain(`    - name: zm1_${MAC}_${id}`)
      expect(yaml).toContain(`      unique_id: zm1_${MAC}_${id}`)
    }
    // 设备名只出现在 device.name（分组）与注释里，不参与实体名
    expect(yaml).not.toContain('测试检测仪 温度')
    expect(yaml).toContain('name: "测试检测仪"')
  })

  it('unique_id 唯一，且 5 个实体都归到同一台 device 下', () => {
    const ids = [...yaml.matchAll(/unique_id: (\S+)/g)].map(m => m[1] ?? '')
    expect(ids).toHaveLength(5)
    expect(new Set(ids).size).toBe(5)
    expect(ids.every(id => id.startsWith(`zm1_${MAC}_`))).toBe(true)
    expect((yaml.match(/identifiers:/g) ?? []).length).toBe(5)
    expect(yaml).toContain(`          - "zm1_${MAC}"`)
  })

  it('亮度按 64 一档折回 1..4，关闭写 0，未带亮度按最亮，状态模板按 brightness 判开关', () => {
    expect(yaml).toContain('(brightness / 64) | round(0, \'ceil\') | int')
    expect(yaml).toContain('{% if brightness is defined and brightness is not none %}')
    expect(yaml).toContain('}, "brightness": 4{% endif %}')
    expect(yaml).toContain('"brightness": 0')
    expect(yaml).toContain('{{ \'off\' if value_json.brightness == 0 else \'on\' }}')
    // 第 4 档回读要夹到 255：不夹会得到 256，超出 HA 亮度上限
    expect(yaml).toContain('{{ [value_json.brightness | int(0) * 64, 255] | min }}')
  })

  it('数值容错：字符串上报也转成数字', () => {
    expect(yaml).toContain('value_template: "{{ value_json.temperature | float(0) }}"')
    expect(yaml).toContain('value_template: "{{ value_json.formaldehyde | float(0) }}"')
  })

  it('mac 归一为小写；名称只有空白时回落到 zM1_XXXX', () => {
    const y = buildHaConfig({ mac: 'AABBCCDDEEFF', name: '   ' })
    expect(y).toContain(`device/zm1/${MAC}/sensor`)
    expect(y).not.toContain('AABBCCDDEEFF')
    expect(y).toContain('name: "zM1_eeff"')
  })

  it('名称里的引号会被转义（不破坏 YAML）', () => {
    const y = buildHaConfig({ mac: MAC, name: 'a"b' })
    expect(y).toContain('name: "a\\"b"')
  })

  it('下载文件名带 mac', () => {
    expect(haConfigFileName('AABBCCDDEEFF')).toBe(`zm1_${MAC}_ha.yaml`)
  })
})
