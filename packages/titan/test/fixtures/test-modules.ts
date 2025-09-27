/**
 * Test Module Fixtures for Titan Application Testing
 *
 * These fixtures represent realistic module patterns used in production applications
 */

import {
  IModule,
  IApplication,
  IHealthStatus,
  ApplicationEvent
} from '../../src/types.js';
import { Application, createApp } from '../../src/application.js';
import { Injectable, Module, Service } from '../../src/decorators/index.js';
import { createToken, Token } from '@nexus';

// ============================================================================
// Basic Module Fixtures
// ============================================================================

/**
 * Simple module with all lifecycle hooks
 */
export class SimpleModule implements IModule {
  readonly name = 'simple';
  readonly version = '1.0.0';

  startCalled = false;
  stopCalled = false;
  registerCalled = false;
  destroyCalled = false;
  configureCalled = false;
  configValue: any = null;

  async onRegister(app: IApplication): Promise<void> {
    this.registerCalled = true;
  }

  async onStart(app: IApplication): Promise<void> {
    this.startCalled = true;
  }

  async onStop(app: IApplication): Promise<void> {
    this.stopCalled = true;
  }

  async onDestroy(): Promise<void> {
    this.destroyCalled = true;
  }

  configure(config: any): void {
    this.configureCalled = true;
    this.configValue = config;
  }

  async health(): Promise<IHealthStatus> {
    return {
      status: this.startCalled ? 'healthy' : 'unhealthy',
      message: 'Simple module health check',
      details: {
        started: this.startCalled,
        config: this.configValue
      }
    };
  }
}

/**
 * Module that takes time to start/stop
 */
export class SlowModule implements IModule {
  readonly name = 'slow';
  readonly version = '1.0.0';

  constructor(public delay = 100) {
  }

  async onStart(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, this.delay));
  }

  async onStop(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, this.delay));
  }
}

/**
 * Module that fails during lifecycle
 */
export class FailingModule implements IModule {
  readonly name = 'failing';
  readonly version = '1.0.0';

  constructor(
    public failOn: 'start' | 'stop' | 'register' | 'destroy' = 'start',
    public errorMessage = 'Module failure'
  ) {
  }

  async onRegister(): Promise<void> {
    if (this.failOn === 'register') {
      throw new Error(this.errorMessage);
    }
  }

  async onStart(): Promise<void> {
    if (this.failOn === 'start') {
      throw new Error(this.errorMessage);
    }
  }

  async onStop(): Promise<void> {
    if (this.failOn === 'stop') {
      throw new Error(this.errorMessage);
    }
  }

  async onDestroy(): Promise<void> {
    if (this.failOn === 'destroy') {
      throw new Error(this.errorMessage);
    }
  }
}

// ============================================================================
// Realistic Application Modules
// ============================================================================

/**
 * Database module - represents database connection management
 */
export class DatabaseModule implements IModule {
  readonly name = 'database';
  readonly version = '2.0.0';
  readonly dependencies = ['config'];

  private connection: any = null;
  private pool: any[] = [];
  private config: any = {};

  configure(config: any): void {
    this.config = config;
  }

  async onStart(app: IApplication): Promise<void> {
    // Simulate database connection
    this.connection = {
      id: Math.random().toString(36).substring(7),
      host: this.config.host || 'localhost',
      port: this.config.port || 5432
    };

    // Initialize connection pool
    for (let i = 0; i < (this.config.poolSize || 10); i++) {
      this.pool.push({
        id: i,
        busy: false,
        connection: { ...this.connection }
      });
    }
  }

  async onStop(): Promise<void> {
    // Close all connections
    this.pool = [];
    this.connection = null;
  }

  async health(): Promise<IHealthStatus> {
    const activeConnections = this.pool.filter(c => !c.busy).length;
    return {
      status: this.connection ? 'healthy' : 'unhealthy',
      message: 'Database connection status',
      details: {
        connected: !!this.connection,
        poolSize: this.pool.length,
        activeConnections,
        config: {
          host: this.config.host,
          port: this.config.port
        }
      }
    };
  }

  // Public methods for database operations
  async query(sql: string): Promise<any> {
    if (!this.connection) throw new Error('Database not connected');
    return { rows: [], sql };
  }

  getConnection() {
    return this.connection;
  }
}

/**
 * HTTP Server module - represents web server
 */
export class HttpServerModule implements IModule {
  readonly name = 'http';
  readonly version = '1.0.0';
  readonly dependencies = ['config', 'logger'];

  private server: any = null;
  private routes: Map<string, Function> = new Map();
  private middleware: Function[] = [];
  public port: number = 3000;

  configure(config: any): void {
    this.port = config.port || 3000;
  }

  async onStart(app: IApplication): Promise<void> {
    // Simulate server start
    this.server = {
      listening: true,
      port: this.port,
      address: `http://localhost:${this.port}`
    };

    // Emit server started event
    app.emit('server:started' as any, {
      port: this.port
    });
  }

  async onStop(app: IApplication): Promise<void> {
    if (this.server) {
      this.server.listening = false;
      this.server = null;

      app.emit('server:stopped' as any, {});
    }
  }

  async health(): Promise<IHealthStatus> {
    return {
      status: this.server?.listening ? 'healthy' : 'unhealthy',
      message: 'HTTP server status',
      details: {
        listening: this.server?.listening || false,
        port: this.port,
        routes: this.routes.size,
        middleware: this.middleware.length
      }
    };
  }

  // Public API
  addRoute(path: string, handler: Function): void {
    this.routes.set(path, handler);
  }

  addMiddleware(middleware: Function): void {
    this.middleware.push(middleware);
  }

  isListening(): boolean {
    return this.server?.listening || false;
  }
}

/**
 * Cache module - represents caching service
 */
export class CacheModule implements IModule {
  readonly name = 'cache';
  readonly version = '1.2.0';
  readonly dependencies = ['config'];

  private cache: Map<string, { value: any; expires: number }> = new Map();
  private ttl: number = 60000; // Default 1 minute
  private cleanupInterval: any = null;

  configure(config: any): void {
    this.ttl = config.ttl || 60000;
  }

  async onStart(): Promise<void> {
    // Start cleanup interval
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, item] of this.cache.entries()) {
        if (item.expires < now) {
          this.cache.delete(key);
        }
      }
    }, 10000); // Cleanup every 10 seconds
  }

  async onStop(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
  }

  async health(): Promise<IHealthStatus> {
    return {
      status: 'healthy',
      message: 'Cache service status',
      details: {
        entries: this.cache.size,
        ttl: this.ttl,
        cleanupRunning: !!this.cleanupInterval
      }
    };
  }

  // Public API
  set(key: string, value: any, ttl?: number): void {
    const expires = Date.now() + (ttl || this.ttl);
    this.cache.set(key, { value, expires });
  }

  get(key: string): any {
    const item = this.cache.get(key);
    if (!item) return undefined;

    if (item.expires < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }

    return item.value;
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Message Queue module - represents async message processing
 */
export class MessageQueueModule implements IModule {
  readonly name = 'queue';
  readonly version = '1.0.0';
  readonly dependencies = ['database'];

  private queues: Map<string, any[]> = new Map();
  private processors: Map<string, Function> = new Map();
  private processing = false;
  private processInterval: any = null;

  async onStart(app: IApplication): Promise<void> {
    this.processing = true;

    // Start processing loop
    this.processInterval = setInterval(() => {
      if (this.processing) {
        this.processMessages();
      }
    }, 100);
  }

  async onStop(): Promise<void> {
    this.processing = false;

    if (this.processInterval) {
      clearInterval(this.processInterval);
      this.processInterval = null;
    }
  }

  async health(): Promise<IHealthStatus> {
    let totalMessages = 0;
    for (const queue of this.queues.values()) {
      totalMessages += queue.length;
    }

    return {
      status: this.processing ? 'healthy' : 'unhealthy',
      message: 'Message queue status',
      details: {
        processing: this.processing,
        queues: this.queues.size,
        processors: this.processors.size,
        totalMessages
      }
    };
  }

  // Public API
  async send(queue: string, message: any): Promise<void> {
    if (!this.queues.has(queue)) {
      this.queues.set(queue, []);
    }
    this.queues.get(queue)!.push(message);
  }

  onMessage(queue: string, processor: Function): void {
    this.processors.set(queue, processor);
    if (!this.queues.has(queue)) {
      this.queues.set(queue, []);
    }
  }

  private async processMessages(): Promise<void> {
    for (const [queue, messages] of this.queues.entries()) {
      const processor = this.processors.get(queue);
      if (processor && messages.length > 0) {
        const message = messages.shift();
        try {
          await processor(message);
        } catch (error) {
          // Re-queue on error
          messages.push(message);
        }
      }
    }
  }
}

// ============================================================================
// Service-based Modules (using decorators)
// ============================================================================

// Service tokens
export const AuthServiceToken = createToken<AuthService>('AuthService');
export const UserServiceToken = createToken<UserService>('UserService');
export const NotificationServiceToken = createToken<NotificationService>('NotificationService');

/**
 * Authentication Service
 */
@Injectable()
@Service('AuthService')
export class AuthService {
  private sessions: Map<string, any> = new Map();

  async login(username: string, password: string): Promise<string> {
    const token = Math.random().toString(36).substring(7);
    this.sessions.set(token, { username, loginTime: Date.now() });
    return token;
  }

  async logout(token: string): Promise<void> {
    this.sessions.delete(token);
  }

  async validateToken(token: string): Promise<boolean> {
    return this.sessions.has(token);
  }

  getSession(token: string): any {
    return this.sessions.get(token);
  }
}

/**
 * User Service
 */
@Injectable()
@Service('UserService')
export class UserService {
  private users: Map<string, any> = new Map();

  constructor() {
    // Add some default users
    this.users.set('1', { id: '1', name: 'Admin', role: 'admin' });
    this.users.set('2', { id: '2', name: 'User', role: 'user' });
  }

  async getUser(id: string): Promise<any> {
    return this.users.get(id);
  }

  async createUser(data: any): Promise<any> {
    const id = Math.random().toString(36).substring(7);
    const user = { id, ...data };
    this.users.set(id, user);
    return user;
  }

  async updateUser(id: string, data: any): Promise<any> {
    const user = this.users.get(id);
    if (!user) throw new Error('User not found');

    const updated = { ...user, ...data };
    this.users.set(id, updated);
    return updated;
  }

  async deleteUser(id: string): Promise<void> {
    this.users.delete(id);
  }

  getAllUsers(): any[] {
    return Array.from(this.users.values());
  }
}

/**
 * Notification Service
 */
@Injectable()
@Service('NotificationService')
export class NotificationService {
  private notifications: any[] = [];
  private subscribers: Map<string, Function[]> = new Map();

  async send(userId: string, message: string, type: 'info' | 'warning' | 'error' = 'info'): Promise<void> {
    const notification = {
      id: Math.random().toString(36).substring(7),
      userId,
      message,
      type,
      timestamp: Date.now(),
      read: false
    };

    this.notifications.push(notification);

    // Notify subscribers
    const handlers = this.subscribers.get(userId) || [];
    for (const handler of handlers) {
      handler(notification);
    }
  }

  subscribe(userId: string, handler: Function): void {
    if (!this.subscribers.has(userId)) {
      this.subscribers.set(userId, []);
    }
    this.subscribers.get(userId)!.push(handler);
  }

  getNotifications(userId: string): any[] {
    return this.notifications.filter(n => n.userId === userId);
  }

  markAsRead(notificationId: string): void {
    const notification = this.notifications.find(n => n.id === notificationId);
    if (notification) {
      notification.read = true;
    }
  }
}

/**
 * Complete Application Module with services
 */
@Module({
  providers: [
    AuthService,
    UserService,
    NotificationService,
    { provide: AuthServiceToken, useClass: AuthService },
    { provide: UserServiceToken, useClass: UserService },
    { provide: NotificationServiceToken, useClass: NotificationService }
  ],
  exports: [
    AuthServiceToken,
    UserServiceToken,
    NotificationServiceToken
  ]
})
export class ApplicationModule implements IModule {
  readonly name = 'application';
  readonly version = '1.0.0';

  constructor(
    // Services will be injected if DI is properly configured
  ) {
  }

  async onStart(app: IApplication): Promise<void> {
    // Initialize application services
  }

  async health(): Promise<IHealthStatus> {
    return {
      status: 'healthy',
      message: 'Application module is running'
    };
  }
}

// ============================================================================
// Module with Dependencies
// ============================================================================

/**
 * Module that depends on other modules
 */
/**
 * Auth module mock
 */
export class AuthModule implements IModule {
  name = 'auth';
  version = '1.0.0';
  private isAuthenticated = false;

  configure(config: any): void {
    // Configure authentication settings
  }

  async onStart(app: IApplication): Promise<void> {
    this.isAuthenticated = true;
  }

  async onStop(app: IApplication): Promise<void> {
    this.isAuthenticated = false;
  }

  async health(): Promise<IHealthStatus> {
    return {
      status: this.isAuthenticated ? 'healthy' : 'unhealthy',
      message: 'Auth module status'
    };
  }
}

/**
 * Notifications module mock
 */
export class NotificationsModule implements IModule {
  name = 'notifications';
  version = '1.0.0';
  private connected = false;

  configure(config: any): void {
    // Configure notification channels
  }

  async onStart(app: IApplication): Promise<void> {
    this.connected = true;
  }

  async onStop(app: IApplication): Promise<void> {
    this.connected = false;
  }

  async health(): Promise<IHealthStatus> {
    return {
      status: this.connected ? 'healthy' : 'unhealthy',
      message: 'Notifications module status'
    };
  }
}

export class DependentModule implements IModule {
  readonly name = 'dependent';
  readonly version = '1.0.0';
  readonly dependencies = ['database', 'cache'];

  private db?: DatabaseModule;
  private cache?: CacheModule;

  async onStart(app: IApplication): Promise<void> {
    // Get dependencies
    this.db = app.get(createToken<DatabaseModule>('database'));
    this.cache = app.get(createToken<CacheModule>('cache'));

    if (!this.db || !this.cache) {
      throw new Error('Required dependencies not found');
    }
  }

  async health(): Promise<IHealthStatus> {
    return {
      status: this.db && this.cache ? 'healthy' : 'unhealthy',
      message: 'Dependent module status',
      details: {
        hasDatabase: !!this.db,
        hasCache: !!this.cache
      }
    };
  }

  async performOperation(): Promise<any> {
    if (!this.db || !this.cache) {
      throw new Error('Module not properly initialized');
    }

    // Check cache first
    const cached = this.cache.get('operation-result');
    if (cached) return cached;

    // Query database
    const result = await this.db.query('SELECT * FROM data');

    // Cache result
    this.cache.set('operation-result', result, 5000);

    return result;
  }
}

// ============================================================================
// Module Creation Helpers
// ============================================================================

/**
 * Create a module that tracks lifecycle calls
 */
export function createTrackedModule(name: string): SimpleModule & { calls: string[] } {
  const module = new SimpleModule();
  module.name = name;
  const calls: string[] = [];

  const tracked = Object.assign(module, { calls });

  // Override methods to track calls
  const originalOnRegister = module.onRegister.bind(module);
  tracked.onRegister = async (app: IApplication) => {
    calls.push('register');
    return originalOnRegister(app);
  };

  const originalOnStart = module.onStart.bind(module);
  tracked.onStart = async (app: IApplication) => {
    calls.push('start');
    return originalOnStart(app);
  };

  const originalOnStop = module.onStop.bind(module);
  tracked.onStop = async (app: IApplication) => {
    calls.push('stop');
    return originalOnStop(app);
  };

  const originalOnDestroy = module.onDestroy.bind(module);
  tracked.onDestroy = async () => {
    calls.push('destroy');
    return originalOnDestroy();
  };

  return tracked;
}

/**
 * Create a module with custom behavior
 */
export function createCustomModule(options: {
  name: string;
  version?: string;
  dependencies?: string[];
  onStart?: (app: IApplication) => Promise<void>;
  onStop?: (app: IApplication) => Promise<void>;
  health?: () => Promise<IHealthStatus>;
}): IModule {
  return {
    name: options.name,
    version: options.version || '1.0.0',
    dependencies: options.dependencies,
    onStart: options.onStart,
    onStop: options.onStop,
    health: options.health || (async () => ({
      status: 'healthy',
      message: `${options.name} is healthy`
    }))
  };
}

/**
 * Create an application with modules that have dependencies
 */
export function createApplicationWithDependencies() {
  const app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

  // Create modules with proper dependency chain
  // module-a depends on module-b, module-b depends on module-c
  const moduleC = createCustomModule({
    name: 'module-c',
    dependencies: []
  });

  const moduleB = createCustomModule({
    name: 'module-b',
    dependencies: ['module-c']
  });

  const moduleA = createCustomModule({
    name: 'module-a',
    dependencies: ['module-b']
  });

  // Register in arbitrary order - the framework should sort them
  app.use(moduleA);
  app.use(moduleB);
  app.use(moduleC);

  return app;
}

/**
 * Create an application with circular dependencies (for testing)
 */
export function createApplicationWithCircularDeps() {
  const app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

  // Create modules with circular dependencies
  const moduleA = createCustomModule({
    name: 'moduleA',
    dependencies: ['moduleB']
  });

  const moduleB = createCustomModule({
    name: 'moduleB',
    dependencies: ['moduleA'] // Circular dependency
  });

  app.use(moduleA);
  app.use(moduleB);

  return app;
}

/**
 * Create a web application with HTTP and database modules
 */
export function createWebApplication(options: any = {}) {
  const app = createApp({
    disableGracefulShutdown: true,
    disableCoreModules: true,
    ...options
  });

  // Register web-related modules
  app.use(new HttpServerModule());
  app.use(new DatabaseModule());

  return app;
}

/**
 * Create a full-stack application with all modules
 */
export function createFullStackApplication(options: any = {}) {
  const app = createApp({
    disableGracefulShutdown: true,
    disableCoreModules: true,
    config: {
      http: { port: 3000, timeout: 30000 },
      database: { host: 'localhost', port: 5432 },
      cache: { ttl: 60000 },
      queue: { enabled: true },
      auth: { enabled: true, secret: 'test-secret' },
      notifications: { enabled: true, channels: ['email', 'push'] },
      ...(options.config || {})
    },
    ...options
  });

  // Register all modules
  app.use(new DatabaseModule());
  app.use(new CacheModule());
  app.use(new HttpServerModule());
  app.use(new MessageQueueModule());
  app.use(new ApplicationModule());
  app.use(new AuthModule());
  app.use(new NotificationsModule());

  return app;
}