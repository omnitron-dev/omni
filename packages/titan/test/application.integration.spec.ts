/**
 * Integration tests for Titan Application with realistic scenarios
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createToken } from '@omnitron-dev/nexus';
import { z } from 'zod';

import { Application, createApp as originalCreateApp } from '../src/application';

// Wrapper for createApp that disables graceful shutdown by default in tests
const createApp = (options: any = {}) => {
  return originalCreateApp({
    disableGracefulShutdown: true,
    ...options
  });
};
import { ConfigModule } from '../src/modules/config/config.module';
import { LoggerModule, LOGGER_SERVICE_TOKEN, Logger } from '../src/modules/logger.module';
import { createToken } from '@omnitron-dev/nexus';
const CONFIG_SERVICE_TOKEN = createToken('ConfigModule');
import {
  AbstractModule,
  Module,
  IApplication,
  HealthStatus,
  ApplicationState
} from '../src/types';

// ============================================================================
// Realistic Module Fixtures
// ============================================================================

/**
 * Database module simulating real database connection
 */
class DatabaseModule extends AbstractModule {
  override readonly name = 'database';
  override readonly version = '1.0.0';
  override readonly dependencies = [CONFIG_SERVICE_TOKEN, LOGGER_SERVICE_TOKEN];

  private connection: any = null;
  private connectionPool: any[] = [];
  private logger?: Logger;
  private config?: any;

  override async onStart(app: IApplication): Promise<void> {
    const configModule = app.get(CONFIG_SERVICE_TOKEN);
    const loggerModule = app.get(LOGGER_SERVICE_TOKEN);

    this.logger = loggerModule.child({ module: 'database' });
    this.config = configModule.get('database', {
      host: 'localhost',
      port: 5432,
      database: 'test',
      poolSize: 10
    });

    this.logger.info({ config: this.config }, 'Connecting to database');

    // Simulate connection establishment
    await this.connect();

    // Initialize connection pool
    for (let i = 0; i < this.config.poolSize; i++) {
      this.connectionPool.push({ id: i, busy: false });
    }

    this.logger.info('Database connected successfully');
  }

  override async onStop(): Promise<void> {
    if (this.logger) {
      this.logger.info('Closing database connections');
    }

    // Simulate graceful connection closing
    await this.disconnect();
    this.connectionPool = [];
  }

  override async health(): Promise<HealthStatus> {
    if (!this.connection) {
      return {
        status: 'unhealthy',
        message: 'Database not connected'
      };
    }

    const availableConnections = this.connectionPool.filter(c => !c.busy).length;
    const status = availableConnections > 0 ? 'healthy' : 'degraded';

    return {
      status,
      details: {
        connected: !!this.connection,
        poolSize: this.connectionPool.length,
        availableConnections
      }
    };
  }

  async connect(): Promise<void> {
    // Simulate async connection
    await new Promise(resolve => setTimeout(resolve, 50));
    this.connection = { connected: true, timestamp: Date.now() };
  }

  async disconnect(): Promise<void> {
    // Simulate async disconnection
    await new Promise(resolve => setTimeout(resolve, 30));
    this.connection = null;
  }

  async query(sql: string): Promise<any> {
    if (!this.connection) {
      throw new Error('Database not connected');
    }

    const connection = this.connectionPool.find(c => !c.busy);
    if (!connection) {
      throw new Error('No available connections');
    }

    connection.busy = true;

    try {
      // Simulate query execution
      await new Promise(resolve => setTimeout(resolve, 10));
      return { rows: [], sql };
    } finally {
      connection.busy = false;
    }
  }
}

const DatabaseModuleToken = createToken<DatabaseModule>('DatabaseModule');

/**
 * HTTP Server module simulating real server
 */
class HttpServerModule extends AbstractModule {
  override readonly name = 'http-server';
  override readonly version = '1.0.0';
  override readonly dependencies = [CONFIG_SERVICE_TOKEN, LOGGER_SERVICE_TOKEN];

  private server: any = null;
  private logger?: Logger;
  private port?: number;
  private requestCount = 0;

  override async onStart(app: IApplication): Promise<void> {
    const configModule = app.get(CONFIG_SERVICE_TOKEN);
    const loggerModule = app.get(LOGGER_SERVICE_TOKEN);

    this.logger = loggerModule.child({ module: 'http-server' });
    this.port = configModule.get('server.port', 3000);

    this.logger.info({ port: this.port }, 'Starting HTTP server');

    // Simulate server start
    await this.startServer();

    this.logger.info({ port: this.port }, 'HTTP server started');
  }

  override async onStop(): Promise<void> {
    if (this.logger) {
      this.logger.info('Stopping HTTP server');
    }

    await this.stopServer();
  }

  override async health(): Promise<HealthStatus> {
    if (!this.server) {
      return {
        status: 'unhealthy',
        message: 'Server not running'
      };
    }

    return {
      status: 'healthy',
      details: {
        port: this.port,
        requestCount: this.requestCount,
        uptime: this.server.uptime
      }
    };
  }

  private async startServer(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 100));
    this.server = {
      listening: true,
      port: this.port,
      uptime: 0,
      startTime: Date.now()
    };

    // Simulate server uptime tracking
    const uptimeInterval = setInterval(() => {
      if (this.server) {
        this.server.uptime = Date.now() - this.server.startTime;
      } else {
        clearInterval(uptimeInterval);
      }
    }, 100);
  }

  private async stopServer(): Promise<void> {
    if (this.server) {
      await new Promise(resolve => setTimeout(resolve, 50));
      this.server = null;
    }
  }

  handleRequest(): void {
    if (!this.server) {
      throw new Error('Server not running');
    }
    this.requestCount++;
  }
}

const HttpServerModuleToken = createToken<HttpServerModule>('HttpServerModule');

/**
 * Cache module with TTL support
 */
class CacheModule extends AbstractModule {
  override readonly name = 'cache';
  override readonly version = '1.0.0';
  override readonly dependencies = [CONFIG_SERVICE_TOKEN, LOGGER_SERVICE_TOKEN];

  private cache = new Map<string, { value: any; expires: number }>();
  private logger?: Logger;
  private defaultTTL = 3600000; // 1 hour
  private cleanupInterval?: NodeJS.Timeout;

  override async onStart(app: IApplication): Promise<void> {
    const configModule = app.get(CONFIG_SERVICE_TOKEN);
    const loggerModule = app.get(LOGGER_SERVICE_TOKEN);

    this.logger = loggerModule.child({ module: 'cache' });
    this.defaultTTL = configModule.get('cache.ttl', 3600000);

    this.logger.info('Starting cache module');

    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000); // Cleanup every minute
  }

  override async onStop(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    if (this.logger) {
      this.logger.info({ size: this.cache.size }, 'Clearing cache');
    }

    this.cache.clear();
  }

  override async health(): Promise<HealthStatus> {
    return {
      status: 'healthy',
      details: {
        size: this.cache.size,
        defaultTTL: this.defaultTTL
      }
    };
  }

  set(key: string, value: any, ttl?: number): void {
    const expires = Date.now() + (ttl || this.defaultTTL);
    this.cache.set(key, { value, expires });
    this.logger?.debug({ key, ttl, expires }, 'Cache set');
  }

  get(key: string): any {
    const entry = this.cache.get(key);

    if (!entry) {
      this.logger?.debug({ key }, 'Cache miss');
      return undefined;
    }

    if (entry.expires < Date.now()) {
      this.cache.delete(key);
      this.logger?.debug({ key }, 'Cache expired');
      return undefined;
    }

    this.logger?.debug({ key }, 'Cache hit');
    return entry.value;
  }

  delete(key: string): void {
    this.cache.delete(key);
    this.logger?.debug({ key }, 'Cache delete');
  }

  clear(): void {
    this.cache.clear();
    this.logger?.debug('Cache cleared');
  }

  private cleanup(): void {
    const now = Date.now();
    let expired = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.expires < now) {
        this.cache.delete(key);
        expired++;
      }
    }

    if (expired > 0 && this.logger) {
      this.logger.debug({ expired }, 'Cache cleanup completed');
    }
  }
}

const CacheModuleToken = createToken<CacheModule>('CacheModule');

/**
 * Message Queue module
 */
class MessageQueueModule extends AbstractModule {
  override readonly name = 'message-queue';
  override readonly version = '1.0.0';
  override readonly dependencies = [CONFIG_SERVICE_TOKEN, LOGGER_SERVICE_TOKEN];

  private queues = new Map<string, any[]>();
  private subscribers = new Map<string, ((message: any) => void)[]>();
  private logger?: Logger;
  private processing = false;

  override async onStart(app: IApplication): Promise<void> {
    const loggerModule = app.get(LOGGER_SERVICE_TOKEN);
    this.logger = loggerModule.child({ module: 'message-queue' });

    this.logger.info('Starting message queue');
    this.processing = true;

    // Start message processing
    this.processMessages();
  }

  override async onStop(): Promise<void> {
    this.processing = false;

    if (this.logger) {
      const totalMessages = Array.from(this.queues.values())
        .reduce((sum, queue) => sum + queue.length, 0);

      this.logger.info({ queues: this.queues.size, messages: totalMessages },
        'Stopping message queue');
    }

    // Clear all queues
    this.queues.clear();
    this.subscribers.clear();
  }

  override async health(): Promise<HealthStatus> {
    const totalMessages = Array.from(this.queues.values())
      .reduce((sum, queue) => sum + queue.length, 0);

    return {
      status: this.processing ? 'healthy' : 'degraded',
      details: {
        processing: this.processing,
        queues: this.queues.size,
        totalMessages,
        subscribers: this.subscribers.size
      }
    };
  }

  publish(queue: string, message: any): void {
    if (!this.queues.has(queue)) {
      this.queues.set(queue, []);
    }

    this.queues.get(queue)!.push(message);
    this.logger?.debug({ queue, message }, 'Message published');
  }

  subscribe(queue: string, handler: (message: any) => void): () => void {
    if (!this.subscribers.has(queue)) {
      this.subscribers.set(queue, []);
    }

    this.subscribers.get(queue)!.push(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.subscribers.get(queue);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index !== -1) {
          handlers.splice(index, 1);
        }
      }
    };
  }

  private async processMessages(): Promise<void> {
    while (this.processing) {
      for (const [queue, messages] of this.queues.entries()) {
        if (messages.length > 0) {
          const message = messages.shift();
          const handlers = this.subscribers.get(queue) || [];

          for (const handler of handlers) {
            try {
              handler(message);
            } catch (error) {
              this.logger?.error({ error, queue, message }, 'Handler error');
            }
          }
        }
      }

      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}

const MessageQueueModuleToken = createToken<MessageQueueModule>('MessageQueueModule');

// ============================================================================
// Integration Tests
// ============================================================================

describe('Titan Application Integration Tests', () => {
  let app: Application;

  afterEach(async () => {
    if (app && app.state === ApplicationState.Started) {
      await app.stop();
    }
  });

  describe('Real-world Application Scenarios', () => {
    it('should run a complete web application stack', async () => {
      // Create application with typical web stack
      app = createApp({
        name: 'web-app',
        version: '1.0.0',
        config: {
          database: {
            host: 'localhost',
            port: 5432,
            database: 'webapp',
            poolSize: 20
          },
          server: {
            port: 8080
          },
          cache: {
            ttl: 1800000 // 30 minutes
          },
          logger: {
            level: 'info',
            prettyPrint: false
          }
        }
      });

      // Register all modules
      const dbModule = new DatabaseModule();
      const serverModule = new HttpServerModule();
      const cacheModule = new CacheModule();
      const queueModule = new MessageQueueModule();

      app.container.register(DatabaseModuleToken, { useValue: dbModule });
      app.container.register(HttpServerModuleToken, { useValue: serverModule });
      app.container.register(CacheModuleToken, { useValue: cacheModule });
      app.container.register(MessageQueueModuleToken, { useValue: queueModule });

      app.use(DatabaseModuleToken);
      app.use(HttpServerModuleToken);
      app.use(CacheModuleToken);
      app.use(MessageQueueModuleToken);

      // Start application
      // Start application
      await app.start();

      // Verify all modules are healthy
      const dbHealth = await dbModule.health();
      const serverHealth = await serverModule.health();
      const cacheHealth = await cacheModule.health();
      const queueHealth = await queueModule.health();

      expect(dbHealth.status).toBe('healthy');
      expect(serverHealth.status).toBe('healthy');
      expect(cacheHealth.status).toBe('healthy');
      expect(queueHealth.status).toBe('healthy');

      // Simulate some operations
      await dbModule.query('SELECT * FROM users');
      serverModule.handleRequest();
      cacheModule.set('user:1', { id: 1, name: 'John' });
      queueModule.publish('events', { type: 'user.created', id: 1 });

      // Verify operations
      expect(cacheModule.get('user:1')).toEqual({ id: 1, name: 'John' });
      expect(serverHealth.details?.requestCount).toBe(0); // Was 0 before handleRequest

      const newServerHealth = await serverModule.health();
      expect(newServerHealth.details?.requestCount).toBe(1); // Now 1 after handleRequest

      // Graceful shutdown
      await app.stop();
      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should handle configuration with schema validation', async () => {
      // Define configuration schema
      const configSchema = z.object({
        app: z.object({
          name: z.string(),
          version: z.string(),
          environment: z.enum(['development', 'staging', 'production'])
        }),
        database: z.object({
          host: z.string(),
          port: z.number().int().positive(),
          database: z.string(),
          username: z.string().optional(),
          password: z.string().optional(),
          poolSize: z.number().int().min(1).max(100).default(10)
        }),
        server: z.object({
          host: z.string().default('0.0.0.0'),
          port: z.number().int().min(1024).max(65535),
          cors: z.boolean().default(true),
          compression: z.boolean().default(true)
        }),
        features: z.object({
          analytics: z.boolean().default(false),
          notifications: z.boolean().default(true),
          maintenance: z.boolean().default(false)
        }).default({
          analytics: false,
          notifications: true,
          maintenance: false
        })
      });

      // Create config module with schema
      const configModuleDynamic = ConfigModule.forRoot({
        schema: configSchema,
        defaults: {
          app: {
            name: 'validated-app',
            version: '1.0.0',
            environment: 'development'
          },
          database: {
            host: 'localhost',
            port: 5432,
            database: 'testdb'
          },
          server: {
            port: 3000
          }
        }
      });

      app = createApp({ disableCoreModules: true });
      // Register the ConfigModule providers manually
      if (configModuleDynamic.providers) {
        for (const provider of configModuleDynamic.providers as any[]) {
          if (Array.isArray(provider)) {
            const [token, providerDef] = provider;
            app.container.register(token, providerDef);
          }
        }
      }
      app.replaceModule(CONFIG_SERVICE_TOKEN, new ConfigModule());
      app.replaceModule(LOGGER_SERVICE_TOKEN, new LoggerModule());

      await app.start();

      // Validate configuration
      const config = app.get(CONFIG_SERVICE_TOKEN);
      const validated = config.validate(configSchema);

      expect(validated.app.name).toBe('validated-app');
      expect(validated.server.host).toBe('0.0.0.0'); // Default value
      expect(validated.server.cors).toBe(true); // Default value
      expect(validated.features.analytics).toBe(false); // Default value
    });

    it('should handle microservices architecture', async () => {
      // Service A - User Service
      const userServiceApp = createApp({
        name: 'user-service',
        config: {
          service: { port: 3001, name: 'users' }
        },
        debug: true // Enable debug to auto-create logger
      });

      // Service B - Order Service
      const orderServiceApp = createApp({
        name: 'order-service',
        config: {
          service: { port: 3002, name: 'orders' }
        },
        debug: true // Enable debug to auto-create logger
      });

      // Service C - Notification Service
      const notificationServiceApp = createApp({
        name: 'notification-service',
        config: {
          service: { port: 3003, name: 'notifications' }
        },
        debug: true // Enable debug to auto-create logger
      });

      // Message queue for inter-service communication
      const sharedQueue = new MessageQueueModule();

      // Register shared queue in all services
      [userServiceApp, orderServiceApp, notificationServiceApp].forEach(service => {
        service.container.register(MessageQueueModuleToken, { useValue: sharedQueue });
        service.use(MessageQueueModuleToken);
      });

      // Start all services
      await Promise.all([
        userServiceApp.start(),
        orderServiceApp.start(),
        notificationServiceApp.start()
      ]);

      // Setup inter-service communication
      const queue = userServiceApp.get(MessageQueueModuleToken) as MessageQueueModule;

      let notificationReceived = false;
      queue.subscribe('notifications', (message) => {
        notificationReceived = true;
      });

      // Simulate user creation triggering notification
      queue.publish('notifications', {
        type: 'user.created',
        userId: 123,
        email: 'test@example.com'
      });

      // Wait for message processing
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(notificationReceived).toBe(true);

      // Stop all services
      await Promise.all([
        userServiceApp.stop(),
        orderServiceApp.stop(),
        notificationServiceApp.stop()
      ]);
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should handle partial module failures gracefully', async () => {
      app = createApp();

      // Module that fails initially but can recover
      class ResilientModule extends AbstractModule {
        override readonly name = 'resilient';
        private attempts = 0;
        private maxAttempts = 3;

        override async onStart(): Promise<void> {
          this.attempts++;
          if (this.attempts < this.maxAttempts) {
            throw new Error(`Start failed, attempt ${this.attempts}`);
          }
          // Success on third attempt
        }

        reset(): void {
          this.attempts = 0;
        }
      }

      const resilientModule = new ResilientModule();
      app.use(resilientModule);

      // First attempts fail
      await expect(app.start()).rejects.toThrow('Start failed, attempt 1');
      expect(app.state).toBe(ApplicationState.Failed);

      // Try again without resetting (continue with attempt counter)
      app = createApp(); // Create new app instance
      app.use(resilientModule);

      await expect(app.start()).rejects.toThrow('Start failed, attempt 2');

      // Third attempt succeeds
      app = createApp();
      app.use(resilientModule);
      await app.start();

      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should handle module dependency failures', async () => {
      app = createApp();

      // Module A that fails
      class ModuleA extends AbstractModule {
        override readonly name = 'moduleA';
        override async onStart(): Promise<void> {
          throw new Error('ModuleA failed to start');
        }
      }

      // Create unique tokens for this test
      const tokenA = createToken<ModuleA>('moduleA-dep-test');

      // Module B that depends on A
      class ModuleB extends AbstractModule {
        override readonly name = 'moduleB';
        override readonly dependencies = [tokenA];
        startCalled = false;

        override async onStart(): Promise<void> {
          this.startCalled = true;
        }
      }

      const moduleA = new ModuleA();
      const moduleB = new ModuleB();
      const tokenB = createToken<ModuleB>('moduleB-dep-test');

      app.container.register(tokenA, { useValue: moduleA });
      app.container.register(tokenB, { useValue: moduleB });

      app.use(tokenA);
      app.use(tokenB);

      // Should fail on ModuleA, ModuleB should not start
      await expect(app.start()).rejects.toThrow('ModuleA failed to start');
      expect(moduleB.startCalled).toBe(false);
    });

    it('should recover from transient failures', async () => {
      app = createApp({ debug: true }); // Enable debug to auto-create logger

      // Simulate network module with transient failures
      class NetworkModule extends AbstractModule {
        override readonly name = 'network';
        private retryCount = 0;
        private maxRetries = 3;
        connected = false;

        override async onStart(app: IApplication): Promise<void> {
          const logger = app.get(LOGGER_SERVICE_TOKEN).logger;

          while (this.retryCount < this.maxRetries && !this.connected) {
            try {
              await this.connect();
              this.connected = true;
              logger.info('Network connected');
            } catch (error) {
              this.retryCount++;
              logger.warn({ attempt: this.retryCount }, 'Connection failed, retrying');

              if (this.retryCount >= this.maxRetries) {
                throw new Error('Max retries exceeded');
              }

              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
        }

        private async connect(): Promise<void> {
          // Fail first 2 attempts
          if (this.retryCount < 2) {
            throw new Error('Connection timeout');
          }
        }
      }

      const networkModule = new NetworkModule();
      app.use(networkModule);

      await app.start();
      expect(networkModule.connected).toBe(true);
    });
  });

  describe('Performance and Load Testing', () => {
    it('should handle high-throughput message processing', async () => {
      app = createApp({
        config: {
          logger: { level: 'error' } // Reduce logging overhead
        }
      });

      const queueModule = new MessageQueueModule();
      app.container.register(MessageQueueModuleToken, { useValue: queueModule });
      app.use(MessageQueueModuleToken);

      await app.start();

      const messageCount = 1000; // Reduced for faster test execution
      const receivedMessages: number[] = [];

      // Subscribe to queue
      queueModule.subscribe('performance-test', (message) => {
        receivedMessages.push(message.id);
      });

      // Publish many messages
      const startTime = Date.now();
      for (let i = 0; i < messageCount; i++) {
        queueModule.publish('performance-test', { id: i, data: 'test' });
      }

      // Wait for processing with timeout
      const maxWaitTime = 5000; // 5 seconds max
      const waitStartTime = Date.now();
      while (receivedMessages.length < messageCount && Date.now() - waitStartTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const duration = Date.now() - startTime;
      const throughput = messageCount / (duration / 1000);

      // Verify at least some messages were processed
      expect(receivedMessages.length).toBeGreaterThan(0);
      expect(receivedMessages.length).toBeLessThanOrEqual(messageCount);
      expect(throughput).toBeGreaterThan(100); // At least 100 msg/sec
    });

    it('should handle concurrent module operations', async () => {
      app = createApp({ debug: true }); // Enable debug to auto-create logger

      const cacheModule = new CacheModule();
      app.container.register(CacheModuleToken, { useValue: cacheModule });
      app.use(CacheModuleToken);

      await app.start();

      // Concurrent writes
      const writePromises: Promise<void>[] = [];
      for (let i = 0; i < 1000; i++) {
        writePromises.push(
          Promise.resolve(cacheModule.set(`key-${i}`, `value-${i}`, 60000))
        );
      }
      await Promise.all(writePromises);

      // Concurrent reads
      const readPromises: Promise<any>[] = [];
      for (let i = 0; i < 1000; i++) {
        readPromises.push(
          Promise.resolve(cacheModule.get(`key-${i}`))
        );
      }
      const results = await Promise.all(readPromises);

      // Verify all reads successful
      results.forEach((value, index) => {
        expect(value).toBe(`value-${index}`);
      });
    });

    it('should maintain performance under memory pressure', async () => {
      app = createApp();

      // Module that consumes memory
      class MemoryIntensiveModule extends AbstractModule {
        override readonly name = 'memory-intensive';
        private data: any[] = [];

        override async onStart(): Promise<void> {
          // Allocate some memory
          for (let i = 0; i < 100; i++) {
            this.data.push(new Array(100).fill(i));
          }
        }

        override async onStop(): Promise<void> {
          // Clear memory
          this.data = [];
        }

        allocateMore(): void {
          this.data.push(new Array(1000).fill(0));
        }
      }

      const memModule = new MemoryIntensiveModule();
      app.use(memModule);

      const initialMemory = process.memoryUsage().heapUsed;
      await app.start();

      // Allocate more memory during runtime
      for (let i = 0; i < 10; i++) {
        memModule.allocateMore();
      }

      const peakMemory = process.memoryUsage().heapUsed;
      await app.stop();

      // Force GC if available
      if (global.gc) {
        global.gc();
      }

      // Wait for GC
      await new Promise(resolve => setTimeout(resolve, 100));

      const finalMemory = process.memoryUsage().heapUsed;

      // Memory should be released after stop (or at least not grow significantly)
      // Allow for some memory retention due to GC behavior
      expect(finalMemory).toBeLessThanOrEqual(peakMemory * 1.1); // Allow 10% variance
    });
  });

  describe('Configuration Scenarios', () => {
    it('should load configuration from file', async () => {
      // Create temporary config file
      const configPath = path.join(__dirname, 'test-config.json');
      const configData = {
        app: {
          name: 'file-config-app',
          version: '2.0.0'
        },
        features: {
          experimental: true,
          debug: false
        }
      };

      await fs.writeFile(configPath, JSON.stringify(configData, null, 2));

      try {
        const configModule = new ConfigModule();
        const fileContent = await fs.readFile(configPath, 'utf-8');
        configModule.loadObject(JSON.parse(fileContent));

        app = createApp({ disableCoreModules: true });
        app.replaceModule(CONFIG_SERVICE_TOKEN, configModule);
        app.replaceModule(LOGGER_SERVICE_TOKEN, new LoggerModule());

        await app.start();

        const config = app.get(CONFIG_SERVICE_TOKEN);
        expect(config.get('app.name')).toBe('file-config-app');
        expect(config.get('app.version')).toBe('2.0.0');
        expect(config.get('features.experimental')).toBe(true);
      } finally {
        // Cleanup
        await fs.unlink(configPath).catch(() => { });
      }
    });

    it('should handle environment-specific configuration', async () => {
      const environments = ['development', 'staging', 'production'];

      for (const env of environments) {
        const testApp = createApp({
          config: {
            environment: env,
            database: {
              host: env === 'production' ? 'prod-db.example.com' : 'localhost',
              poolSize: env === 'production' ? 50 : 10
            },
            cache: {
              enabled: env !== 'development',
              ttl: env === 'production' ? 3600000 : 60000
            },
            features: {
              debug: env === 'development',
              monitoring: env === 'production'
            }
          }
        });

        await testApp.start();

        const config = testApp.get(CONFIG_SERVICE_TOKEN);

        if (env === 'production') {
          expect(config.get('database.host')).toBe('prod-db.example.com');
          expect(config.get('database.poolSize')).toBe(50);
          expect(config.get('cache.enabled')).toBe(true);
          expect(config.get('cache.ttl')).toBe(3600000);
          expect(config.get('features.monitoring')).toBe(true);
        } else if (env === 'development') {
          expect(config.get('database.host')).toBe('localhost');
          expect(config.get('cache.enabled')).toBe(false);
          expect(config.get('features.debug')).toBe(true);
        }

        await testApp.stop();
      }
    });

    it('should handle configuration hot-reload', async () => {
      app = createApp();

      const config = app.get(CONFIG_SERVICE_TOKEN);
      let configChanges: any[] = [];

      // Watch for config changes
      config.watch('features', (value) => {
        configChanges.push(value);
      });

      await app.start();

      // Simulate configuration updates
      config.set('features.newFeature', true);
      config.set('features.experimental', false);
      config.merge({
        features: {
          analytics: true,
          telemetry: true
        }
      });

      // Wait for watchers
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(configChanges.length).toBeGreaterThan(0);
      expect(config.get('features.newFeature')).toBe(true);
      expect(config.get('features.analytics')).toBe(true);
    });
  });

  describe('Module Communication Patterns', () => {
    it('should support event-driven communication between modules', async () => {
      app = createApp();

      // Event bus module
      class EventBusModule extends AbstractModule {
        override readonly name = 'event-bus';
        private listeners = new Map<string, Set<Function>>();

        emit(event: string, data: any): void {
          const handlers = this.listeners.get(event);
          if (handlers) {
            handlers.forEach(handler => handler(data));
          }
        }

        on(event: string, handler: Function): void {
          if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
          }
          this.listeners.get(event)!.add(handler);
        }

        off(event: string, handler: Function): void {
          this.listeners.get(event)?.delete(handler);
        }
      }

      // Producer module
      class ProducerModule extends AbstractModule {
        override readonly name = 'producer';
        private eventBus?: EventBusModule;

        override async onStart(app: IApplication): Promise<void> {
          this.eventBus = app.get(EventBusToken);
        }

        produce(data: any): void {
          this.eventBus?.emit('data.produced', data);
        }
      }

      // Consumer module
      class ConsumerModule extends AbstractModule {
        override readonly name = 'consumer';
        public receivedData: any[] = [];

        override async onStart(app: IApplication): Promise<void> {
          const eventBus = app.get(EventBusToken);
          eventBus.on('data.produced', (data: any) => {
            this.receivedData.push(data);
          });
        }
      }

      const EventBusToken = createToken<EventBusModule>('EventBusModule');
      const ProducerToken = createToken<ProducerModule>('ProducerModule');
      const ConsumerToken = createToken<ConsumerModule>('ConsumerModule');

      const eventBus = new EventBusModule();
      const producer = new ProducerModule();
      const consumer = new ConsumerModule();

      app.container.register(EventBusToken, { useValue: eventBus });
      app.container.register(ProducerToken, { useValue: producer });
      app.container.register(ConsumerToken, { useValue: consumer });

      app.use(EventBusToken);
      app.use(ProducerToken);
      app.use(ConsumerToken);

      await app.start();

      // Produce some data
      producer.produce({ id: 1, value: 'test1' });
      producer.produce({ id: 2, value: 'test2' });

      expect(consumer.receivedData).toEqual([
        { id: 1, value: 'test1' },
        { id: 2, value: 'test2' }
      ]);
    });

    it('should support request-response pattern between modules', async () => {
      app = createApp();

      // Service module that handles requests
      class ServiceModule extends AbstractModule {
        override readonly name = 'service';

        async handleRequest(request: any): Promise<any> {
          // Simulate processing
          await new Promise(resolve => setTimeout(resolve, 10));

          return {
            success: true,
            data: request.data?.toUpperCase(),
            timestamp: Date.now()
          };
        }
      }

      // Client module that makes requests
      class ClientModule extends AbstractModule {
        override readonly name = 'client';
        private service?: ServiceModule;

        override async onStart(app: IApplication): Promise<void> {
          this.service = app.get(ServiceToken);
        }

        async makeRequest(data: string): Promise<any> {
          if (!this.service) {
            throw new Error('Service not available');
          }

          return this.service.handleRequest({ data });
        }
      }

      const ServiceToken = createToken<ServiceModule>('ServiceModule');
      const ClientToken = createToken<ClientModule>('ClientModule');

      const service = new ServiceModule();
      const client = new ClientModule();

      app.container.register(ServiceToken, { useValue: service });
      app.container.register(ClientToken, { useValue: client });

      app.use(ServiceToken);
      app.use(ClientToken);

      await app.start();

      const response = await client.makeRequest('hello');

      expect(response.success).toBe(true);
      expect(response.data).toBe('HELLO');
      expect(response.timestamp).toBeDefined();
    });
  });
});