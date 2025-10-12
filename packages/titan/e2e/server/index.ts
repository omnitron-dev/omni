/**
 * Titan E2E Test Server
 * Provides HTTP and WebSocket transports for browser testing
 */

import { Netron } from '@omnitron-dev/titan/netron';
import { HttpNativeServer } from '@omnitron-dev/titan/netron/transport/http';
// import { WebSocketServer } from '@omnitron-dev/titan/netron/transport/websocket';
import { TestService } from './services/test.service.js';
import http from 'http';

// Create minimal logger (using any to avoid complex type requirements)
const logger: any = {
  trace: () => {},
  debug: () => {},
  info: (msg: any) => console.log('[INFO]', typeof msg === 'string' ? msg : msg),
  warn: (msg: any) => console.warn('[WARN]', typeof msg === 'string' ? msg : msg),
  error: (msg: any) => console.error('[ERROR]', typeof msg === 'string' ? msg : msg),
  fatal: (msg: any) => console.error('[FATAL]', typeof msg === 'string' ? msg : msg),
  child: () => logger,
  time: () => () => {},
  isLevelEnabled: () => true,
};

async function bootstrap() {
  try {
    // Create Netron instance
    const netron = new Netron(logger);
    await netron.start();

    logger.info('Netron started');

    // Create and expose test service
    const testService = new TestService();
    await netron.peer.exposeService(testService);

    logger.info('TestService exposed');

    // Create HTTP server
    const httpServer = new HttpNativeServer({
      port: 3400,
      host: '0.0.0.0',
      cors: true,
    });

    httpServer.setPeer(netron.peer);
    await httpServer.listen();

    logger.info({ port: 3400 }, 'HTTP server listening');

    // TODO: Create WebSocket server when ready
    // const wsServer = new WebSocketServer({
    //   port: 3401,
    //   host: '0.0.0.0'
    // });
    // wsServer.setPeer(netron.peer);
    // await wsServer.listen();
    // logger.info({ port: 3401 }, 'WebSocket server listening');

    // Health check endpoint
    const healthServer = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            timestamp: new Date().toISOString(),
            services: ['TestService@1.0.0'],
            transports: {
              http: 3400,
              // ws: 3401
            },
          })
        );
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    healthServer.listen(3402, '0.0.0.0', () => {
      logger.info({ port: 3402 }, 'Health check server listening');
    });

    // Shutdown handler
    const shutdown = async () => {
      logger.info('Shutting down...');
      healthServer.close();
      await httpServer.close();
      // await wsServer?.close();
      await netron.stop();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    logger.info(
      {
        http: 'http://0.0.0.0:3400',
        // ws: 'ws://0.0.0.0:3401',
        health: 'http://0.0.0.0:3402/health',
      },
      'E2E test server ready'
    );
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

bootstrap();
