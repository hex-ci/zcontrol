import fs from 'node:fs'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import { DB_FILE, WEB_DIST } from './config.ts'
import { registerRoutes } from './api/routes.ts'
import { Dispatcher } from './core/dispatcher.ts'
import type { AppCtx } from './core/context.ts'
import { DiscoveryService } from './transport/discovery.ts'
import { MqttService, defaultClientId } from './transport/mqtt.ts'
import { UdpService } from './transport/udp.ts'
import { Registry } from './device/registry.ts'
import { Store } from './store/db.ts'
import { SettingsStore } from './store/settings.ts'
import { WsHub } from './ws/hub.ts'

export interface CreateAppOptions {
  dataFile?: string
  /** 是否启动 UDP 监听与 MQTT 连接（测试时关掉，避免占用 10181 与连真 broker） */
  startTransports?: boolean
  /** 是否托管前端构建产物 */
  serveWeb?: boolean
  /** 测试用：UDP 只记录发包不真正发送 */
  udpDryRun?: boolean
  logLevel?: string
}

export interface BuiltApp {
  app: FastifyInstance
  ctx: AppCtx
  hub: WsHub
}

/** 装配整个后端（index.ts 与测试共用） */
export async function createApp(options: CreateAppOptions = {}): Promise<BuiltApp> {
  const app = Fastify({ logger: { level: options.logLevel ?? process.env.LOG_LEVEL ?? 'info' } })

  // 顺序：存储 → 设备表 → 传输 → 分发 → 推送 → 路由
  const store = new Store(options.dataFile ?? DB_FILE)
  const settings = new SettingsStore(store)
  const registry = new Registry(store)

  const udp = new UdpService(
    (ip, port, payload) => dispatcher.handleUdp(ip, port, payload),
    options.udpDryRun ?? false,
    message => app.log.error(message),
  )
  const mqtt = new MqttService((topic, payload) => dispatcher.handleMqtt(topic, payload))
  const discovery = new DiscoveryService(udp)
  const dispatcher = new Dispatcher(registry, discovery)

  const ctx: AppCtx = {
    store,
    settings,
    registry,
    mqtt,
    udp,
    discovery,
    dispatcher,
    allowConnect: options.startTransports ?? true,
  }

  await app.register(websocket)
  const hub = new WsHub(ctx)
  hub.register(app)
  registerRoutes(app, ctx)

  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500
    if (status >= 500) app.log.error(err)
    const message = err instanceof Error ? err.message : String(err)
    reply.code(status).send({ error: message })
  })

  const serveWeb = options.serveWeb ?? true
  if (serveWeb && fs.existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST, index: ['index.html'] })
    app.log.info(`静态资源目录: ${WEB_DIST}`)
  }
  else if (serveWeb) {
    app.log.warn(`未找到前端构建产物 ${WEB_DIST}，仅提供 API（开发期请用 vite dev server）`)
  }

  if (options.startTransports ?? true) {
    udp.start()
    const uri = settings.mqttUri()
    if (uri) {
      mqtt.connect(uri, settings.mqttClientId() || defaultClientId(), settings.mqttUser(), settings.mqttPassword())
      app.log.info(`MQTT 连接: ${uri}`)
    }
    else {
      app.log.info('未配置 MQTT 服务器：当前仅走 UDP 广播通道')
    }
  }

  return { app, ctx, hub }
}
