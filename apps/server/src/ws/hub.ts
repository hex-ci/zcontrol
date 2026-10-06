import type { FastifyInstance } from 'fastify';
import { EV, bus } from '../core/bus.ts';
import type { AppCtx } from '../core/context.ts';
import { buildStatus } from '../core/status.ts';

/** 只依赖 ws 的结构，避免直接引用 @fastify/websocket 的内部类型 */
interface WsLike {
  send(data: string): void;
  close(): void;
  readyState: number;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

/** 后端事件 → 推送给所有前端连接 */
export class WsHub {
  private sockets = new Set<WsLike>();
  private ctx: AppCtx;

  constructor(ctx: AppCtx) {
    this.ctx = ctx;
    this.wire();
  }

  private wire(): void {
    bus.on(EV.MQTT_STATUS, () => this.broadcast('status', buildStatus(this.ctx)));
    bus.on(EV.UDP_STATUS, () => this.broadcast('status', buildStatus(this.ctx)));
    bus.on(EV.SCAN, () => this.broadcast('status', buildStatus(this.ctx)));
    bus.on(EV.SCAN_FOUND, (data) => this.broadcast('scan', data));
    bus.on(EV.DEVICES, (data) => this.broadcast('devices', data));
    bus.on(EV.DATA, (data) => this.broadcast('data', data));
    bus.on(EV.SENT, (data) => this.broadcast('sent', data));
  }

  register(app: FastifyInstance): void {
    app.register(async (f) => {
      f.get('/ws', { websocket: true }, (socket) => {
        const ws = socket as unknown as WsLike;
        this.sockets.add(ws);
        const hello = {
          type: 'hello',
          data: {
            status: buildStatus(this.ctx),
            devices: this.ctx.registry.snapshot(),
            settings: this.ctx.settings.masked(),
            // 扫描状态随首帧下发，重连后列表与按钮状态立刻一致
            scan: { active: this.ctx.discovery.active, devices: this.ctx.discovery.list() },
          },
        };
        try {
          ws.send(JSON.stringify(hello));
        } catch {
          /* 忽略首帧失败 */
        }
        ws.on('close', () => this.sockets.delete(ws));
        ws.on('error', () => this.sockets.delete(ws));
      });
    });
  }

  broadcast(type: string, data: unknown): void {
    const text = JSON.stringify({ type, data });
    for (const ws of [...this.sockets]) {
      if (ws.readyState !== 1) {
        this.sockets.delete(ws);
        continue;
      }
      try {
        ws.send(text);
      } catch {
        this.sockets.delete(ws);
      }
    }
  }

  get size(): number {
    return this.sockets.size;
  }
}
