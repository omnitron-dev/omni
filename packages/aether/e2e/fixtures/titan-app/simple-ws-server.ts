import 'reflect-metadata';
/**
 * Simple WebSocket Test Server for Aether E2E Tests
 * Provides basic Netron protocol over WebSocket for browser client testing
 */

import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { UserService } from './services/user.service.js';

// Simple message format
interface WsMessage {
  id: string;
  type: 'call' | 'response' | 'error';
  service?: string;
  method?: string;
  args?: any[];
  result?: any;
  error?: { message: string; code?: string };
}

// Create service instance
const userService = new UserService();

// Track methods
const serviceMethods = new Map<string, Function>();
serviceMethods.set('getUser', userService.getUser.bind(userService));
serviceMethods.set('getUsers', userService.getUsers.bind(userService));
serviceMethods.set('findUsers', userService.findUsers.bind(userService));
serviceMethods.set('createUser', userService.createUser.bind(userService));
serviceMethods.set('updateUser', userService.updateUser.bind(userService));
serviceMethods.set('deleteUser', userService.deleteUser.bind(userService));
serviceMethods.set('unreliableMethod', userService.unreliableMethod.bind(userService));
serviceMethods.set('slowMethod', userService.slowMethod.bind(userService));

async function bootstrap() {
  // Create WebSocket server
  const wss = new WebSocketServer({
    port: 3334,
    host: '0.0.0.0'
  });

  console.log('WebSocket server listening on ws://0.0.0.0:3334');

  wss.on('connection', (ws: WebSocket) => {
    console.log('Client connected');

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString()) as WsMessage;
        console.log('Received message:', message.type, message.method);

        if (message.type === 'call') {
          const method = serviceMethods.get(message.method!);
          if (!method) {
            ws.send(JSON.stringify({
              id: message.id,
              type: 'error',
              error: { message: `Method ${message.method} not found`, code: 'METHOD_NOT_FOUND' }
            }));
            return;
          }

          try {
            const result = await method(...(message.args || []));
            ws.send(JSON.stringify({
              id: message.id,
              type: 'response',
              result
            }));
          } catch (error: any) {
            ws.send(JSON.stringify({
              id: message.id,
              type: 'error',
              error: { message: error.message, code: 'METHOD_ERROR' }
            }));
          }
        }
      } catch (error: any) {
        console.error('Error processing message:', error);
        ws.send(JSON.stringify({
          id: 'error',
          type: 'error',
          error: { message: error.message }
        }));
      }
    });

    ws.on('close', () => {
      console.log('Client disconnected');
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  // Health check server
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
  const shutdown = () => {
    console.log('Shutting down...');
    healthServer.close();
    wss.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((error) => {
  console.error('Bootstrap failed:', error);
  process.exit(1);
});
