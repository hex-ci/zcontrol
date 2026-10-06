import type { WsEvent } from '../api';
import { useAppStore } from '../stores/app';
import { useDeviceStore } from '../stores/devices';
import { useLogStore } from '../stores/log';

let socket: WebSocket | null = null;
let started = false;
let retryTimer: number | null = null;

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

function dispatch(ev: WsEvent) {
  const app = useAppStore();
  const device = useDeviceStore();
  const log = useLogStore();

  switch (ev.type) {
    case 'hello': {
      app.setStatus(ev.data.status);
      app.settings = ev.data.settings;
      device.applyDevices(ev.data.devices);
      break;
    }
    case 'status': {
      const prev = app.status?.mqtt.connected;
      app.setStatus(ev.data);
      if (prev !== ev.data.mqtt.connected) {
        if (ev.data.mqtt.connected) {
          for (const d of device.devices) log.push(d.mac, 'sys', '本工具已连接mqtt服务器');
        } else {
          const err = ev.data.mqtt.error ? `:${ev.data.mqtt.error}` : '';
          for (const d of device.devices) log.push(d.mac, 'sys', `本工具已断开mqtt服务器${err}`);
        }
      }
      break;
    }
    case 'devices': {
      device.applyDevices(ev.data.devices);
      if (app.scanning) void app.refreshScan();
      break;
    }
    case 'data': {
      const { mac, source, payload } = ev.data;
      const text =
        typeof payload === 'string' ? payload : JSON.stringify(payload).replace(/\\/g, '');
      log.push(mac, 'recv', `接收${source}:${text}`, ev.data.ts);
      break;
    }
    case 'sent': {
      log.push(ev.data.mac, 'send', `发送${ev.data.source}:${ev.data.payload}`, ev.data.ts);
      break;
    }
  }
}

function connect() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  socket = new WebSocket(wsUrl());
  socket.onmessage = (e) => {
    try {
      dispatch(JSON.parse(e.data as string) as WsEvent);
    } catch {
      /* 忽略非契约消息 */
    }
  };
  socket.onclose = () => {
    // 断线 1 秒后重连
    if (retryTimer === null) {
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, 1000);
    }
  };
  socket.onerror = () => {
    socket?.close();
  };
}

/** 在 App.vue 里调用一次；重复调用无副作用 */
export function initSocket() {
  if (started) return;
  started = true;
  connect();
}
