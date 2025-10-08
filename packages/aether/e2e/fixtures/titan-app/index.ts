/**
 * Titan Test Application for Aether E2E Tests
 * Provides Netron server with HTTP and WebSocket transports
 */

import { Application, Module } from '@omnitron-dev/titan';
import { NetronModule } from '@omnitron-dev/titan/netron';
import { UserService } from './services/user.service.js';
import { StreamService } from './services/stream.service.js';
import { EventService } from './services/event.service.js';
import http from 'http';

@Module({
  imports: [
    NetronModule.forRoot({
      transports: [
        {
          type: 'http',
          port: 3333,
          host: '0.0.0.0',
          cors: true
        },
        {
          type: 'websocket',
          port: 3334,
          host: '0.0.0.0'
        }
      ]
    })
  ],
  providers: [UserService, StreamService, EventService]
})
class AppModule {}

async function bootstrap() {
  const app = await Application.create(AppModule, {
    disableGracefulShutdown: false
  });

  // Create health check endpoint
  const healthServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });

  healthServer.listen(3333, '0.0.0.0', () => {
    console.log('Health check server listening on http://0.0.0.0:3333/health');
  });

  await app.start();

  console.log('Titan test application started');
  console.log('- Netron HTTP transport: http://0.0.0.0:3333');
  console.log('- Netron WebSocket transport: ws://0.0.0.0:3334');
  console.log('- Services: UserService, StreamService, EventService');

  // Handle shutdown
  process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down...');
    healthServer.close();
    await app.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down...');
    healthServer.close();
    await app.stop();
    process.exit(0);
  });
}

bootstrap().catch(err => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
