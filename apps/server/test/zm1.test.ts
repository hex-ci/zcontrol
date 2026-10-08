import { describe, expect, it } from 'vitest'
import {
  buildCommand,
  buildMqttSyncPayload,
  isNewerVersion,
  parseMqttSetting,
  parseMqttUri,
  parseState,
  parseTask,
  validateCommand,
} from '../src/device/zm1.ts'

const MAC = 'aabbccddeeff'

describe('parseState（字段解析）', () => {
  it('解析 sensor 上报的四个数值', () => {
    const { state } = parseState({
      name: 'zM1_1234',
      mac: MAC,
      PM25: 57,
      formaldehyde: 0.02,
      temperature: 23.8,
      humidity: 64,
    })
    expect(state.PM25).toBe(57)
    expect(state.formaldehyde).toBe(0.02)
    expect(state.temperature).toBe(23.8)
    expect(state.humidity).toBe(64)
  })

  it('字符串数字也接受（固件可能带引号上报）', () => {
    const { state } = parseState({ mac: MAC, PM25: '35', temperature: '20' })
    expect(state.PM25).toBe(35)
    expect(state.temperature).toBe(20)
  })

  it('只有 4 个字段齐全的 task 才算有效', () => {
    const { tasks } = parseState({
      mac: MAC,
      task_0: { hour: 8, minute: 30, brightness: 4, on: 1 },
      task_1: { hour: 8, minute: 30, brightness: 4 },
      task_2: {},
    })
    expect(tasks[0]).toEqual({ hour: 8, minute: 30, brightness: 4, on: 1 })
    expect(tasks[1]).toBeNull()
    expect(tasks[2]).toBeNull()
  })

  it('缺少字段的 frame 不产生任何 state 覆盖', () => {
    const { state } = parseState({ mac: MAC, unknown: 1 })
    expect(Object.keys(state)).toEqual([])
  })

  it('parseTask 对非对象返回 null', () => {
    expect(parseTask(null)).toBeNull()
    expect(parseTask('x')).toBeNull()
    expect(parseTask({ hour: 1, minute: 2, brightness: 3, on: 4 })).toEqual({
      hour: 1,
      minute: 2,
      brightness: 3,
      on: 4,
    })
  })
})

describe('parseMqttSetting（云同步回包）', () => {
  it('解析设备回包的 MQTT 配置，密码字段不解析', () => {
    const { state } = parseState({
      name: 'zM1_1234',
      mac: MAC,
      setting: {
        mqtt_uri: '192.168.1.10',
        mqtt_port: 1883,
        mqtt_user: 'z',
        mqtt_password: 'secret',
      },
    })
    expect(state.mqttSetting).toEqual({ mqtt_uri: '192.168.1.10', mqtt_port: 1883, mqtt_user: 'z' })
    expect(JSON.stringify(state)).not.toContain('secret')
  })

  it('空配置回包（即清空设备上的 MQTT 设置）照样认得', () => {
    expect(parseMqttSetting({ mqtt_uri: '', mqtt_port: 0, mqtt_user: '' })).toEqual({
      mqtt_uri: '',
      mqtt_port: 0,
      mqtt_user: '',
    })
  })

  it('没有 mqtt_uri 的 setting（名称/OTA 等）不产生 mqttSetting', () => {
    expect(parseMqttSetting({ ota: 'https://example.com/ota.bin' })).toBeNull()
    expect(parseMqttSetting({ name: '测试检测仪' })).toBeNull()
    expect(parseMqttSetting({})).toBeNull()
    expect(parseMqttSetting('x')).toBeNull()
    expect(parseState({ mac: MAC, setting: { name: '测试检测仪' } }).state.mqttSetting).toBeUndefined()
  })
})

describe('validateCommand / buildCommand（下发报文白名单）', () => {
  it('mac 恒为第一个字段', () => {
    expect(buildCommand(MAC, { brightness: 3 })).toBe('{"mac":"aabbccddeeff","brightness":3}')
  })

  it('查询亮度：brightness 为 null', () => {
    expect(buildCommand(MAC, { brightness: null })).toBe('{"mac":"aabbccddeeff","brightness":null}')
  })

  it('查询 5 组定时任务', () => {
    const payload = buildCommand(MAC, { task_0: {}, task_1: {}, task_2: {}, task_3: {}, task_4: {} })
    expect(payload).toContain('"task_0":{}')
    expect(payload).toContain('"task_4":{}')
  })

  it('设置单组定时任务', () => {
    expect(buildCommand(MAC, { task_0: { hour: 8, minute: 30, brightness: 4, on: 1 } })).toBe(
      '{"mac":"aabbccddeeff","task_0":{"hour":8,"minute":30,"brightness":4,"on":1}}',
    )
  })

  it('查询设置信息 / 设置名称 / 时区 / 校时 / 重启 / OTA', () => {
    expect(buildCommand(MAC, { version: null, interval: null, ssid: null, zone: null })).toBe(
      '{"mac":"aabbccddeeff","version":null,"interval":null,"ssid":null,"zone":null}',
    )
    expect(buildCommand(MAC, { setting: { name: '我的检测仪' } })).toBe(
      '{"mac":"aabbccddeeff","setting":{"name":"我的检测仪"}}',
    )
    expect(buildCommand(MAC, { zone: 480 })).toBe('{"mac":"aabbccddeeff","zone":480}')
    expect(buildCommand(MAC, { time: -1 })).toBe('{"mac":"aabbccddeeff","time":-1}')
    expect(buildCommand(MAC, { cmd: 'restart' })).toBe('{"mac":"aabbccddeeff","cmd":"restart"}')
    expect(buildCommand(MAC, { setting: { ota: 'https://x/ota.bin' } })).toContain('ota.bin')
  })

  it('拒绝非白名单字段', () => {
    expect(validateCommand({ foo: 1 })).toContain('不允许的字段')
    expect(validateCommand({})).toBe('指令不能为空')
  })

  it('拒绝本次未实现的联动字段（za1 / repeat / action）', () => {
    expect(validateCommand({ za1: {} })).toContain('暂不支持')
    expect(validateCommand({ task_0: { hour: 1, minute: 1, brightness: 1, on: 1, repeat: 127 } })).toContain(
      '不允许的字段',
    )
  })

  it('亮度/间隔/时区/任务字段范围校验', () => {
    expect(validateCommand({ brightness: 5 })).toContain('brightness')
    expect(validateCommand({ brightness: '3' })).toBeNull()
    expect(validateCommand({ interval: 0 })).toContain('interval')
    expect(validateCommand({ interval: 256 })).toContain('interval')
    expect(validateCommand({ interval: 255 })).toBeNull()
    expect(validateCommand({ zone: -721 })).toContain('zone')
    expect(validateCommand({ zone: 840 })).toBeNull()
    // 字段写 null 表示「查询」，除 time 外的字段都允许
    expect(validateCommand({ interval: null, zone: null })).toBeNull()
    expect(validateCommand({ time: 0 })).toContain('time')
    expect(validateCommand({ task_0: { hour: 24, minute: 0, brightness: 1, on: 1 } })).toContain('hour')
    expect(validateCommand({ task_0: { hour: 1, minute: 60, brightness: 1, on: 1 } })).toContain('minute')
    expect(validateCommand({ task_0: { hour: 1, minute: 1, brightness: 5, on: 1 } })).toContain('brightness')
    expect(validateCommand({ task_0: { hour: 1, minute: 1, brightness: 1, on: 2 } })).toContain('on')
  })

  it('OTA 地址必须 http 开头；名称最长 32 字节', () => {
    expect(validateCommand({ setting: { ota: 'ftp://x' } })).toContain('http')
    expect(validateCommand({ setting: { name: 'a'.repeat(33) } })).toContain('32 字节')
    expect(validateCommand({ setting: { name: '正常名字' } })).toBeNull()
  })
})

describe('parseMqttUri（mqtt_uri 校验）', () => {
  it('只有主机名时补 1883', () => {
    expect(parseMqttUri('192.168.1.1')).toEqual({ host: '192.168.1.1', port: 1883, valid: true })
  })
  it('带端口', () => {
    expect(parseMqttUri('mqtt.example.com:1884')).toEqual({
      host: 'mqtt.example.com',
      port: 1884,
      valid: true,
    })
  })
  it('空值合法（用于清除配置）', () => {
    expect(parseMqttUri('').valid).toBe(true)
  })
  it('端口非法则判为非法', () => {
    expect(parseMqttUri('host:abc').valid).toBe(false)
    expect(parseMqttUri('a:b:c').valid).toBe(false)
  })
})

describe('buildMqttSyncPayload（云同步报文）', () => {
  it('拆分主机与端口，密码原样带上', () => {
    const payload = buildMqttSyncPayload({
      name: 'zM1_1234',
      mac: MAC,
      mqttUri: 'mqtt.example.com:1883',
      mqttUser: 'z',
      mqttPassword: '123456',
    })
    expect(JSON.parse(payload)).toEqual({
      name: 'zM1_1234',
      mac: MAC,
      setting: { mqtt_uri: 'mqtt.example.com', mqtt_port: 1883, mqtt_user: 'z', mqtt_password: '123456' },
    })
  })

  it('未配置服务器时发送空值（删除语义）', () => {
    const payload = buildMqttSyncPayload({ name: 'n', mac: MAC, mqttUri: '', mqttUser: '', mqttPassword: '' })
    expect(JSON.parse(payload).setting).toEqual({
      mqtt_uri: '',
      mqtt_port: 0,
      mqtt_user: '',
      mqtt_password: '',
    })
  })
})

describe('isNewerVersion（版本比较）', () => {
  it('按数字段比较', () => {
    expect(isNewerVersion('v0.0.4', 'v0.0.3')).toBe(true)
    expect(isNewerVersion('v0.0.3', 'v0.0.4')).toBe(false)
    expect(isNewerVersion('v0.1.0', 'v0.0.9')).toBe(true)
  })
})
