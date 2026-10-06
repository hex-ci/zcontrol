import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { EV, bus } from '../core/bus.ts';
import { MQTT_QOS, MQTT_SUB_TOPICS, MQTT_URI_DEFAULT_PORT } from '../config.ts';

export interface MqttStatus {
  connected: boolean;
  uri: string;
  error: string | null;
}

/**
 * MQTT 传输层：
 * cleanSession(true)、keepAlive 60s、连接超时 30s、自动重连、qos 1、最大在途 100。
 */
export class MqttService {
  client: MqttClient | null = null;
  uri = '';
  connected = false;
  lastError: string | null = null;
  private clientId = '';
  private readonly onMessage: (topic: string, payload: string) => void;

  constructor(onMessage: (topic: string, payload: string) => void) {
    this.onMessage = onMessage;
  }

  status(): MqttStatus {
    return { connected: this.connected, uri: this.uri, error: this.lastError };
  }

  private emitStatus() {
    bus.emit(EV.MQTT_STATUS, this.status());
  }

  /** uri 形如 `主机:端口`，也容忍 `mqtt://主机:端口` */
  connect(uri: string, clientId: string, user: string, password: string): void {
    const raw = (uri ?? '').trim();
    if (raw.length < 3) {
      this.lastError = 'MQTT 服务器地址为空';
      this.emitStatus();
      return;
    }
    this.disconnect();
    this.uri = raw;
    this.clientId = clientId || defaultClientId();

    const url = toMqttUrl(raw);
    const options: mqtt.IClientOptions = {
      clientId: this.clientId,
      clean: true, // setCleanSession(true)
      keepalive: 60, // setKeepAliveInterval(60)
      connectTimeout: 30_000, // setConnectionTimeout(30)
      reconnectPeriod: 1000, // 断线 1 秒后重连
      protocolVersion: 4, // MQTT 3.1.1，兼容 ESP 固件
      resubscribe: true,
      maxInflight: 100,
    };
    if (user) options.username = user;
    if (password) options.password = password;

    const client = mqtt.connect(url, options);
    this.client = client;

    client.on('connect', () => {
      this.connected = true;
      this.lastError = null;
      // 订阅设备上报主题
      client.subscribe(MQTT_SUB_TOPICS, { qos: MQTT_QOS });
      this.emitStatus();
    });

    client.on('message', (topic, payload) => {
      this.onMessage(topic, payload.toString());
    });

    client.on('error', (e: Error) => {
      this.lastError = e.message;
      this.emitStatus();
    });

    client.on('close', () => {
      if (this.connected) {
        this.connected = false;
        this.emitStatus();
      }
    });

    client.on('offline', () => {
      if (this.connected) {
        this.connected = false;
        this.emitStatus();
      }
    });

    client.on('reconnect', () => {
      this.connected = false;
      this.emitStatus();
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  publish(topic: string, payload: string, qos = MQTT_QOS): void {
    if (!this.client || !this.connected) throw new Error('MQTT 未连接');
    this.client.publish(topic, payload, { qos });
  }

  disconnect(): void {
    if (this.client) {
      const c = this.client;
      this.client = null;
      this.connected = false;
      try {
        c.end(true);
      } catch {
        /* 忽略关闭异常 */
      }
    }
  }

  getClientId(): string {
    return this.clientId;
  }
}

export function defaultClientId(): string {
  return `zControl_Web_${Math.floor(Math.random() * 10000)}`;
}

/** 保证 MQTT URL 带协议前缀 */
export function toMqttUrl(uri: string): string {
  const raw = uri.trim();
  if (raw.startsWith('mqtt://') || raw.startsWith('tcp://')) return raw;
  const withPort = raw.includes(':') ? raw : `${raw}:${MQTT_URI_DEFAULT_PORT}`;
  return `mqtt://${withPort}`;
}
