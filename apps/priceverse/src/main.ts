/**
 * Priceverse - Application Entry Point
 */

import { Application } from '@omnitron-dev/titan';
import { HttpTransport } from '@omnitron-dev/titan/netron/transport/http';
import { CONFIG_SERVICE_TOKEN, type ConfigService } from '@omnitron-dev/titan/module/config';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import { AppModule } from './app.module.js';
import { EXCHANGE_MANAGER_TOKEN, STREAM_AGGREGATOR_TOKEN } from './shared/tokens.js';
import type { ExchangeManagerService } from './modules/collector/services/exchange-manager.service.js';
import type { StreamAggregatorService } from './modules/aggregator/services/stream-aggregator.service.js';

async function bootstrap() {
  const app = await Application.create(AppModule, {
    name: 'priceverse',
    version: '1.0.0',
  });

  // Get logger early for consistent logging
  const loggerModule = await app.container.resolveAsync<ILoggerModule>(LOGGER_SERVICE_TOKEN);
  const logger = loggerModule.logger;

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
      options: { port, host, cors: true, logging: true },
    });
  }

  // Start application - Netron automatically starts HTTP server
  await app.start();

  // Manually start services that need initialization
  // (Titan's @PostConstruct doesn't auto-execute for services)
  try {
    const exchangeManager = await app.container.resolveAsync<ExchangeManagerService>(EXCHANGE_MANAGER_TOKEN);
    await exchangeManager.start();
    logger.info({ module: 'Main' }, 'Exchange manager started');
  } catch (error) {
    logger.error({ module: 'Main', error }, 'Failed to start exchange manager');
  }

  try {
    const streamAggregator = await app.container.resolveAsync<StreamAggregatorService>(STREAM_AGGREGATOR_TOKEN);
    await streamAggregator.start();
    logger.info({ module: 'Main' }, 'Stream aggregator started');
  } catch (error) {
    logger.error({ module: 'Main', error }, 'Failed to start stream aggregator');
  }

  logger.info({ module: 'Main', host, port }, `Priceverse listening on http://${host}:${port}`);
  logger.info({ module: 'Main', services: app.netron?.getServiceNames() ?? [] }, 'Services registered');
}

bootstrap().catch((error) => {
  // Fallback to console.error for bootstrap failures (logger not available yet)
  const errorLog = {
    level: 60,
    time: new Date().toISOString(),
    pid: process.pid,
    name: 'titan-app',
    module: 'Main',
    msg: 'Failed to start Priceverse',
    error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
  };
  console.log(JSON.stringify(errorLog));
  process.exit(1);
});
