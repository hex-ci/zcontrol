import { PORT } from './config.ts';
import { createApp } from './app.ts';

const { app, ctx } = await createApp();

await app.listen({ port: PORT, host: '0.0.0.0' });

const shutdown = () => {
  ctx.udp.stop();
  ctx.discovery.stopMdns();
  ctx.mqtt.disconnect();
  ctx.store.close();
  void app.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
