import path from 'node:path'

export const APP_VERSION = '1.0.0'
export const APP_VERSION_NAME = 'zControl Web v1.0.0'
export const PORT = Number(process.env.PORT ?? 8090)
export const DATA_DIR = process.env.ZCONTROL_DATA ?? path.resolve(process.cwd(), 'data')
export const DB_FILE = path.join(DATA_DIR, 'databases.db')
export const WEB_DIST = process.env.ZCONTROL_WEB_DIST ?? path.resolve(process.cwd(), '../web/dist')

/** 本机监听端口与设备 UDP 端口 */
export const PHONE_UDP_PORT = 10181
export const DEVICE_UDP_PORT = 10182
export const BROADCAST_ADDR = '255.255.255.255'
export const MQTT_QOS = 1
export const MQTT_URI_DEFAULT_PORT = 1883

/** 本项目只支持的设备类型：zM1 空气检测仪 */
export const TYPE_M1 = 4

/** 设备类型 → 显示名（本项目只支持 zM1） */
export const TYPE_NAMES: Record<number, string> = {
  4: 'zM1空气检测仪',
}

/** zM1 的 MQTT topic 中间段 */
export const TYPE_TOPIC = 'zm1'

/** 12 位小写十六进制 mac */
export const MAC_RE = /^[0-9a-f]{12}$/
/** availability 主题正则：device/<type>/<mac>/availability */
export const AVAILABILITY_RE = /^device\/(.*?)\/([0-9a-f]{12})\/(.*)$/

/** 订阅的设备上报通配 topic */
export const MQTT_SUB_TOPICS = ['device/zm1/+/state', 'device/zm1/+/sensor', 'device/zm1/+/availability']

/** mDNS 服务类型（部分固件支持） */
export const MDNS_SERVICE = '_zcontrol._tcp'
export const MDNS_TYPE = 'zcontrol'

/** 局域网扫描时每 2.5 秒广播一次 */
export const SCAN_INTERVAL_MS = 2500
export const SCAN_REPORT_PAYLOAD = '{"cmd":"device report"}'

/**
 * 固件发布源：OTA 版本检查与固件下载地址的来源。
 * 默认指向 zM1 固件社区发布地址，可用环境变量覆盖为自己维护的发布源。
 */
export const FIRMWARE_RELEASE_LATEST
  = process.env.ZCONTROL_FIRMWARE_RELEASE_LATEST
    ?? 'https://gitee.com/api/v5/repos/a2633063/zM1/releases/latest'
export const FIRMWARE_RELEASE_TAG
  = process.env.ZCONTROL_FIRMWARE_RELEASE_TAG
    ?? 'https://gitee.com/api/v5/repos/a2633063/Release/releases/tags/zM1'
export const FIRMWARE_RELEASE_TAG_PREFIX = 'zM1发布地址_'

/** 校时成功阈值（设备时间需大于此值才算有效） */
export const TIME_VALID_THRESHOLD = 1586000000
