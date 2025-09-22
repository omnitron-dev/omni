/**
 * Test Application Fixtures
 *
 * Complete application scenarios for testing
 */

import { Application, createApp } from '../../src/application.js';
import {
  IApplicationOptions,
  IModule,
  IApplication,
  ApplicationEvent
} from '../../src/types.js';
import {
  SimpleModule,
  DatabaseModule,
  HttpServerModule,
  CacheModule,
  MessageQueueModule,
  ApplicationModule,
  DependentModule,
  AuthService,
  UserService,
  NotificationService,
  AuthServiceToken,
  UserServiceToken,
  NotificationServiceToken
} from './test-modules.js';
import { Module, Injectable } from '../../src/decorators.js';
import { createToken } from '@nexus';

// ============================================================================
// Web Application
// ============================================================================

/**
 * Create a typical web application with HTTP, Database, and Cache
 */
export function createWebApplication(options: Partial<IApplicationOptions> = {}): Application {
  const app = createApp({
    name: 'web-app',
    version: '1.0.0',
    debug: false,
    disableGracefulShutdown: true,
    disableCoreModules: true,
    ...options,
    config: {
      http: { port: 3000 },
      database: { host: 'localhost', port: 5432, poolSize: 10 },
      cache: { ttl: 60000 },
      ...options.config
    }
  });

  const httpModule = new HttpServerModule();
  const dbModule = new DatabaseModule();
  const cacheModule = new CacheModule();

  app.use(httpModule);
  app.use(dbModule);
  app.use(cacheModule);

  return app;
}

// ============================================================================
// Microservice Application
// ============================================================================

@Injectable()
class HealthCheckService {
  async check(): Promise<{ status: string; services: any }> {
    return {
      status: 'healthy',
      services: {
        api: 'up',
        database: 'up',
        cache: 'up'
      }
    };
  }
}

@Module({
  providers: [
    HealthCheckService,
    { provide: 'CONFIG', useValue: { env: 'test' } }
  ],
  exports: [HealthCheckService]
})
class HealthModule extends SimpleModule {
  override readonly name = 'health';
}

/**
 * Create a microservice with health checks and monitoring
 */
export function createMicroserviceApplication(serviceName = 'microservice'): Application {
  const app = createApp({
    name: serviceName,
    version: '2.0.0',
    debug: false,
    disableGracefulShutdown: true,
    disableCoreModules: true,
    config: {
      service: { name: serviceName },
      health: { interval: 30000 },
      database: { host: 'db', port: 5432 },
      cache: { ttl: 30000 },
      queue: { workers: 5 }
    }
  });

  // Core infrastructure
  app.use(new DatabaseModule());
  app.use(new CacheModule());
  app.use(new MessageQueueModule());

  // Health monitoring
  app.use(new HealthModule());

  return app;
}

// ============================================================================
// Task Processing Application
// ============================================================================

class TaskProcessorModule extends SimpleModule {
  override readonly name = 'task-processor';
  override readonly dependencies = ['queue', 'database'];

  private queue?: MessageQueueModule;
  private tasksProcessed = 0;

  override async onStart(app: IApplication): Promise<void> {
    await super.onStart(app);

    // Get queue module
    this.queue = app.get(createToken<MessageQueueModule>('queue'));

    if (this.queue) {
      // Register task processors
      this.queue.onMessage('tasks', async (task: any) => {
        this.tasksProcessed++;
        // Process task
        app.emit(ApplicationEvent.Custom, {
          type: 'task:processed',
          task,
          count: this.tasksProcessed
        });
      });

      this.queue.onMessage('priority-tasks', async (task: any) => {
        this.tasksProcessed++;
        // Process priority task
        app.emit(ApplicationEvent.Custom, {
          type: 'task:priority:processed',
          task
        });
      });
    }
  }

  getProcessedCount(): number {
    return this.tasksProcessed;
  }
}

/**
 * Create a background task processing application
 */
export function createTaskProcessorApplication(): Application {
  const app = createApp({
    name: 'task-processor',
    version: '1.0.0',
    debug: false,
    disableGracefulShutdown: true,
    disableCoreModules: true,
    config: {
      database: { host: 'localhost', port: 5432 },
      queue: { workers: 10, retryAttempts: 3 },
      processor: { batchSize: 100, interval: 1000 }
    }
  });

  app.use(new DatabaseModule());
  app.use(new MessageQueueModule());
  app.use(new TaskProcessorModule());

  return app;
}

// ============================================================================
// API Gateway Application
// ============================================================================

class ApiGatewayModule extends SimpleModule {
  override readonly name = 'api-gateway';
  override readonly dependencies = ['http', 'cache'];

  private http?: HttpServerModule;
  private cache?: CacheModule;
  private routes = new Map<string, any>();

  override async onStart(app: IApplication): Promise<void> {
    await super.onStart(app);

    this.http = app.get(createToken<HttpServerModule>('http'));
    this.cache = app.get(createToken<CacheModule>('cache'));

    if (this.http) {
      // Setup API routes
      this.setupRoutes();

      // Add middleware
      this.http.addMiddleware(async (req: any, res: any, next: Function) => {
        // Rate limiting using cache
        const key = `rate:${req.ip}`;
        const count = this.cache?.get(key) || 0;

        if (count > 100) {
          res.status(429).send('Too many requests');
          return;
        }

        this.cache?.set(key, count + 1, 60000);
        next();
      });

      // CORS middleware
      this.http.addMiddleware((req: any, res: any, next: Function) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        next();
      });
    }
  }

  private setupRoutes(): void {
    if (!this.http) return;

    // Health endpoint
    this.http.addRoute('/health', async () => ({
      status: 'ok',
      timestamp: Date.now()
    }));

    // API routes
    this.http.addRoute('/api/v1/users', async () => {
      // Check cache
      const cached = this.cache?.get('users');
      if (cached) return cached;

      // Fetch users (mock)
      const users = [
        { id: 1, name: 'User 1' },
        { id: 2, name: 'User 2' }
      ];

      // Cache result
      this.cache?.set('users', users, 5000);
      return users;
    });

    this.http.addRoute('/api/v1/products', async () => {
      return { products: [] };
    });
  }

  registerRoute(path: string, handler: any): void {
    this.routes.set(path, handler);
    this.http?.addRoute(path, handler);
  }
}

/**
 * Create an API Gateway application
 */
export function createApiGatewayApplication(): Application {
  const app = createApp({
    name: 'api-gateway',
    version: '3.0.0',
    debug: false,
    disableGracefulShutdown: true,
    disableCoreModules: true,
    config: {
      http: { port: 8080 },
      cache: { ttl: 30000 },
      gateway: {
        rateLimit: 1000,
        corsOrigins: ['*'],
        timeout: 30000
      }
    }
  });

  app.use(new HttpServerModule());
  app.use(new CacheModule());
  app.use(new ApiGatewayModule());

  return app;
}

// ============================================================================
// Full-Stack Application
// ============================================================================

/**
 * Create a complete full-stack application with all features
 */
export function createFullStackApplication(): Application {
  const app = createApp({
    name: 'fullstack-app',
    version: '1.0.0',
    debug: true,
    disableGracefulShutdown: true,
    config: {
      http: { port: 3000 },
      database: {
        host: 'localhost',
        port: 5432,
        poolSize: 20,
        database: 'myapp'
      },
      cache: { ttl: 300000 },
      queue: { workers: 5 },
      auth: { sessionTimeout: 3600000 },
      notifications: { enabled: true }
    }
  });

  // Infrastructure modules
  const httpModule = new HttpServerModule();
  const dbModule = new DatabaseModule();
  const cacheModule = new CacheModule();
  const queueModule = new MessageQueueModule();

  app.use(httpModule);
  app.use(dbModule);
  app.use(cacheModule);
  app.use(queueModule);

  // Application module with services
  app.use(new ApplicationModule());

  // API Gateway
  app.use(new ApiGatewayModule());

  // Task processor
  app.use(new TaskProcessorModule());

  // Dependent module (uses db and cache)
  app.use(new DependentModule());

  return app;
}

// ============================================================================
// Minimal Application
// ============================================================================

/**
 * Create a minimal application with single module
 */
export function createMinimalApplication(): Application {
  const app = createApp({
    name: 'minimal',
    version: '0.1.0',
    debug: false,
    disableGracefulShutdown: true,
    disableCoreModules: true
  });

  app.use(new SimpleModule());

  return app;
}

// ============================================================================
// Application with Module Dependencies
// ============================================================================

class ModuleA extends SimpleModule {
  override readonly name = 'module-a';
  override readonly dependencies = ['module-b'];
}

class ModuleB extends SimpleModule {
  override readonly name = 'module-b';
  override readonly dependencies = ['module-c'];
}

class ModuleC extends SimpleModule {
  override readonly name = 'module-c';
}

/**
 * Create application with complex module dependencies
 */
export function createApplicationWithDependencies(): Application {
  const app = createApp({
    name: 'deps-app',
    version: '1.0.0',
    debug: false,
    disableGracefulShutdown: true,
    disableCoreModules: true
  });

  // Register in any order - should be sorted by dependencies
  app.use(new ModuleA());
  app.use(new ModuleC());
  app.use(new ModuleB());

  return app;
}

// ============================================================================
// Application with Circular Dependencies (for error testing)
// ============================================================================

class CircularA extends SimpleModule {
  override readonly name = 'circular-a';
  override readonly dependencies = ['circular-b'];
}

class CircularB extends SimpleModule {
  override readonly name = 'circular-b';
  override readonly dependencies = ['circular-a'];
}

/**
 * Create application with circular dependencies (should fail)
 */
export function createApplicationWithCircularDeps(): Application {
  const app = createApp({
    name: 'circular-app',
    version: '1.0.0',
    debug: false,
    disableGracefulShutdown: true,
    disableCoreModules: true
  });

  app.use(new CircularA());
  app.use(new CircularB());

  return app;
}

// ============================================================================
// Event-Driven Application
// ============================================================================

class EventProducerModule extends SimpleModule {
  override readonly name = 'event-producer';
  private interval: any = null;
  private eventCount = 0;

  override async onStart(app: IApplication): Promise<void> {
    await super.onStart(app);

    // Start producing events
    this.interval = setInterval(() => {
      this.eventCount++;
      app.emit(ApplicationEvent.Custom, {
        type: 'data:update',
        data: { count: this.eventCount, timestamp: Date.now() }
      });
    }, 100);
  }

  override async onStop(app: IApplication): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    await super.onStop(app);
  }

  getEventCount(): number {
    return this.eventCount;
  }
}

class EventConsumerModule extends SimpleModule {
  override readonly name = 'event-consumer';
  private eventsReceived = 0;
  private lastEvent: any = null;

  override async onStart(app: IApplication): Promise<void> {
    await super.onStart(app);

    // Listen for events
    app.on(ApplicationEvent.Custom, (event: any) => {
      if (event.type === 'data:update') {
        this.eventsReceived++;
        this.lastEvent = event.data;
      }
    });
  }

  getEventsReceived(): number {
    return this.eventsReceived;
  }

  getLastEvent(): any {
    return this.lastEvent;
  }
}

/**
 * Create an event-driven application
 */
export function createEventDrivenApplication(): Application {
  const app = createApp({
    name: 'event-app',
    version: '1.0.0',
    debug: false,
    disableGracefulShutdown: true,
    disableCoreModules: true
  });

  app.use(new EventProducerModule());
  app.use(new EventConsumerModule());

  return app;
}

// ============================================================================
// Application Factory
// ============================================================================

export enum ApplicationType {
  Web = 'web',
  Microservice = 'microservice',
  TaskProcessor = 'task-processor',
  ApiGateway = 'api-gateway',
  FullStack = 'fullstack',
  Minimal = 'minimal',
  WithDependencies = 'with-dependencies',
  EventDriven = 'event-driven'
}

/**
 * Factory to create different types of test applications
 */
export function createTestApplication(
  type: ApplicationType,
  options: Partial<IApplicationOptions> = {}
): Application {
  switch (type) {
    case ApplicationType.Web:
      return createWebApplication(options);
    case ApplicationType.Microservice:
      return createMicroserviceApplication(options.name);
    case ApplicationType.TaskProcessor:
      return createTaskProcessorApplication();
    case ApplicationType.ApiGateway:
      return createApiGatewayApplication();
    case ApplicationType.FullStack:
      return createFullStackApplication();
    case ApplicationType.Minimal:
      return createMinimalApplication();
    case ApplicationType.WithDependencies:
      return createApplicationWithDependencies();
    case ApplicationType.EventDriven:
      return createEventDrivenApplication();
    default:
      throw new Error(`Unknown application type: ${type}`);
  }
}