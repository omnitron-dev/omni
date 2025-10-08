import 'reflect-metadata';
/**
 * Titan Test Application for Aether E2E Tests (WebSocket)
 * Provides Netron server with WebSocket transport for browser client testing
 */

// Import from Titan source files directly (for tsx compatibility)
import { Netron } from '../../../../titan/src/netron/netron.js';
import { WebSocketServerAdapter } from '../../../../titan/src/netron/transport/websocket-transport.js';
import { UserService } from './services/user.service.js';
import { createMockLogger } from './test-utils.js';
import http from 'http';
import { WebSocketServer } from 'ws';

async function bootstrap() {
  const logger = createMockLogger();

  // Create Netron instance
  const netron = new Netron(logger);
  await netron.start();

  console.log('Netron WebSocket server started');

  // Create services
  const userService = new UserService();

  // Expose services
  await netron.peer.exposeService(userService);
  console.log('Services exposed: UserService');

  // Create WebSocket server
  const wss = new WebSocketServer({
    port: 3334,
    host: '0.0.0.0'
  });

  const wsServer = new WebSocketServerAdapter(wss, {
    port: 3334,
    host: '0.0.0.0'
  });

  // Set peer
  wsServer.setPeer(netron.peer);

  // Wait for server to start listening
  await new Promise<void>((resolve) => {
    wss.once('listening', () => {
      console.log('WebSocket server listening on ws://0.0.0.0:3334');
      resolve();
    });
  });

  // Create simple health check endpoint
  const healthServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
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

  // Log ready state
  console.log('Test application ready');
  console.log('- Netron WebSocket: ws://0.0.0.0:3334');
  console.log('- Health check: http://0.0.0.0:3336/health');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    healthServer.close();
    wss.close();
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
