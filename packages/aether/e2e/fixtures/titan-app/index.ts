import 'reflect-metadata';
/**
 * Titan Test Application for Aether E2E Tests
 * Provides Netron server with HTTP transport for browser client testing
 */

// Import from Titan source files directly (for tsx compatibility)
import { Netron } from '../../../../titan/src/netron/netron.js';
import { HttpNativeServer as HttpServer } from '../../../../titan/src/netron/transport/http/index.js';
import { UserService } from './services/user.service.js';
import { createMockLogger } from './test-utils.js';
import http from 'http';

async function bootstrap() {
  const logger = createMockLogger();

  // Create Netron instance
  const netron = new Netron(logger);
  await netron.start();

  console.log('Netron server started');

  // Create services
  const userService = new UserService();

  // Expose services
  await netron.peer.exposeService(userService);
  console.log('Services exposed: UserService');

  // Create HTTP server with CORS enabled for browser E2E tests
  const httpServer = new HttpServer({
    port: 3333,
    host: '0.0.0.0',
    cors: true,
  });

  // Attach server to peer
  httpServer.setPeer(netron.peer);

  // Start HTTP server
  await httpServer.listen();
  console.log('HTTP server listening on http://0.0.0.0:3333');

  // Create simple health check endpoint
  const healthServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          timestamp: new Date().toISOString(),
          services: ['UserService@1.0.0'],
          transports: { http: 3333 },
        })
      );
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  healthServer.listen(3335, '0.0.0.0', () => {
    console.log('Health check server listening on http://0.0.0.0:3335/health');
  });

  // Log ready state
  console.log('Test application ready');
  console.log('- Netron HTTP: http://0.0.0.0:3333');
  console.log('- Health check: http://0.0.0.0:3335/health');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    healthServer.close();
    await httpServer.close();
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
