import 'reflect-metadata';
/**
 * Simple Titan WebSocket Server for Aether E2E Tests
 * Uses Netron's built-in WebSocket transport
 */

import { Netron } from '../../../../titan/src/netron/netron.js';
import { WebSocketTransport } from '../../../../titan/src/netron/transport/websocket-transport.js';
import { UserService } from './services/user.service.js';
import { createMockLogger } from './test-utils.js';
import http from 'http';

async function bootstrap() {
  const logger = createMockLogger();

  // Create Netron instance
  const netron = new Netron(logger);

  // Register WebSocket transport (must be a factory function)
  netron.registerTransport('websocket', () => new WebSocketTransport());

  // Configure WebSocket server
  netron.registerTransportServer('websocket', {
    name: 'websocket',
    options: {
      port: 3334,
      host: '0.0.0.0'
    }
  });

  // Start Netron (this will create and start the WebSocket server)
  await netron.start();

  console.log('Netron started with WebSocket transport');

  // Create and expose services
  const userService = new UserService();
  await netron.peer.exposeService(userService);
  console.log('Services exposed: UserService@1.0.0');

  // Create health check endpoint
  const healthServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: ['UserService@1.0.0'],
        transports: { websocket: 3334 }
      }));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  healthServer.listen(3336, '0.0.0.0', () => {
    console.log('Health check server listening on http://0.0.0.0:3336/health');
  });

  console.log('Test application ready');
  console.log('- WebSocket: ws://0.0.0.0:3334');
  console.log('- Health: http://0.0.0.0:3336/health');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    healthServer.close();
    await netron.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((error) => {
  console.error('Bootstrap failed:', error);
  process.exit(1);
});
