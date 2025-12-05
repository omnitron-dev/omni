/**
 * Priceverse 2.0 - Application Entry Point
 */

import { Application } from '@omnitron-dev/titan';
import { HttpTransport } from '@omnitron-dev/titan/netron/transport/http';
import { CONFIG_SERVICE_TOKEN, type ConfigService } from '@omnitron-dev/titan/module/config';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await Application.create(AppModule, {
    name: 'priceverse',
    version: '2.0.0',
  });

  // Get config before start to configure transports
  const config = await app.container.resolveAsync<ConfigService>(CONFIG_SERVICE_TOKEN);
  const appConfig = config.get('app') as { port?: number; host?: string } | undefined;
  const port = appConfig?.port ?? 3000;
  const host = appConfig?.host ?? '0.0.0.0';

  // Register HTTP transport via Netron API (before start)
  if (app.netron) {
    app.netron.registerTransport('http', () => new HttpTransport());
    app.netron.registerTransportServer('http', {
      name: 'http',
      options: { port, host, cors: true },
    });
  }

  // Start application - Netron automatically starts HTTP server
  await app.start();

  console.log(`Priceverse 2.0 listening on http://${host}:${port}`);
  console.log(`Services: ${app.netron?.getServiceNames().join(', ') ?? 'none'}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start Priceverse:', error);
  process.exit(1);
});
