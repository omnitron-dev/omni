/**
 * Simple E2E Test Server (JavaScript ESM)
 * Uses compiled Titan package
 */

import { Netron } from '@omnitron-dev/titan/netron';
import { HttpNativeServer } from '@omnitron-dev/titan/netron/transport/http';
import http from 'http';

// Simple logger
const logger = {
  trace: () => {},
  debug: () => {},
  info: (msg) => console.log('[INFO]', typeof msg === 'object' ? JSON.stringify(msg) : msg),
  warn: (msg) => console.warn('[WARN]', typeof msg === 'object' ? JSON.stringify(msg) : msg),
  error: (msg) => console.error('[ERROR]', typeof msg === 'object' ? JSON.stringify(msg) : msg),
  fatal: (msg) => console.error('[FATAL]', typeof msg === 'object' ? JSON.stringify(msg) : msg),
  child: function() { return this; },
  level: 'info'
};

// Define test service class manually (no decorators needed for now)
class TestService {
  constructor() {
    this.users = [
      { id: '1', name: 'Alice', email: 'alice@test.com', age: 30 },
      { id: '2', name: 'Bob', email: 'bob@test.com', age: 25 },
      { id: '3', name: 'Charlie', email: 'charlie@test.com', age: 35 },
    ];
  }

  async hello(name) {
    await new Promise(resolve => setTimeout(resolve, 50));
    return `Hello, ${name}!`;
  }

  async getUsers() {
    await new Promise(resolve => setTimeout(resolve, 100));
    return this.users;
  }

  async getUser(id) {
    await new Promise(resolve => setTimeout(resolve, 50));
    return this.users.find(u => u.id === id) || null;
  }

  async createUser(user) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const newUser = {
      id: String(this.users.length + 1),
      ...user
    };
    this.users.push(newUser);
    return newUser;
  }

  async updateUser(id, updates) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const index = this.users.findIndex(u => u.id === id);
    if (index === -1) return null;

    this.users[index] = { ...this.users[index], ...updates };
    return this.users[index];
  }

  async deleteUser(id) {
    await new Promise(resolve => setTimeout(resolve, 50));
    const index = this.users.findIndex(u => u.id === id);
    if (index === -1) return false;

    this.users.splice(index, 1);
    return true;
  }

  async throwError(message) {
    await new Promise(resolve => setTimeout(resolve, 50));
    throw new Error(message);
  }

  async slowMethod(delayMs) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    return `Completed after ${delayMs}ms`;
  }

  async batchOperation(items) {
    await new Promise(resolve => setTimeout(resolve, 100));
    return {
      processed: items.map(item => item.toUpperCase()),
      count: items.length
    };
  }
}

// Bootstrap
async function bootstrap() {
  try {
    logger.info('Starting E2E test server...');

    // Create Netron
    const netron = new Netron(logger);
    await netron.start();

    logger.info('Netron started');

    // Create and expose service
    const testService = new TestService();

    // Manually create service definition since we're not using decorators
    const serviceDefinition = {
      name: 'TestService',
      version: '1.0.0',
      instance: testService,
      methods: new Map([
        ['hello', { name: 'hello', handler: testService.hello.bind(testService), public: true }],
        ['getUsers', { name: 'getUsers', handler: testService.getUsers.bind(testService), public: true }],
        ['getUser', { name: 'getUser', handler: testService.getUser.bind(testService), public: true }],
        ['createUser', { name: 'createUser', handler: testService.createUser.bind(testService), public: true }],
        ['updateUser', { name: 'updateUser', handler: testService.updateUser.bind(testService), public: true }],
        ['deleteUser', { name: 'deleteUser', handler: testService.deleteUser.bind(testService), public: true }],
        ['throwError', { name: 'throwError', handler: testService.throwError.bind(testService), public: true }],
        ['slowMethod', { name: 'slowMethod', handler: testService.slowMethod.bind(testService), public: true }],
        ['batchOperation', { name: 'batchOperation', handler: testService.batchOperation.bind(testService), public: true }],
      ])
    };

    await netron.peer.exposeService(serviceDefinition);

    logger.info('TestService exposed');

    // Create HTTP server
    const httpServer = new HttpNativeServer({
      port: 3400,
      host: '0.0.0.0',
      cors: true
    });

    httpServer.setPeer(netron.peer);
    await httpServer.listen();

    logger.info({ port: 3400 }, 'HTTP server listening');

    // Health check
    const healthServer = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          timestamp: new Date().toISOString(),
          services: ['TestService@1.0.0'],
          transports: { http: 3400 }
        }));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    healthServer.listen(3402, '0.0.0.0', () => {
      logger.info({ port: 3402 }, 'Health check server listening');
    });

    // Shutdown
    const shutdown = async () => {
      logger.info('Shutting down...');
      healthServer.close();
      await httpServer.close();
      await netron.stop();
      process.exit(0);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    logger.info({
      http: 'http://0.0.0.0:3400',
      health: 'http://0.0.0.0:3402/health'
    }, 'E2E test server ready');

  } catch (error) {
    logger.error({ error: error.message, stack: error.stack }, 'Failed to start server');
    process.exit(1);
  }
}

bootstrap();
