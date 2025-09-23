/**
 * Test multiple applications running in the same process
 * Ensures no global state conflicts
 */

import 'reflect-metadata';
import { Application } from '../../src/application.js';
import { Module, Injectable, Singleton, Inject, PostConstruct, PreDestroy } from '../../src/decorators/index.js';
import { createToken } from '@nexus';

// Test service tokens
const ServiceAToken = createToken<ServiceA>('ServiceA');
const ServiceBToken = createToken<ServiceB>('ServiceB');
const SharedServiceToken = createToken<SharedService>('SharedService');
const LoggerToken = createToken<Logger>('Logger');
const DatabaseToken = createToken<Database>('Database');

// Services for app A
@Injectable()
class ServiceA {
  name = 'ServiceA';
  data: string[] = [];

  addData(value: string) {
    this.data.push(value);
  }

  getData(): string[] {
    return [...this.data];
  }
}

// Services for app B
@Injectable()
class ServiceB {
  name = 'ServiceB';
  counter = 0;

  increment() {
    this.counter++;
  }

  getCount(): number {
    return this.counter;
  }
}

// Shared service that could be used by multiple apps
@Injectable()
@Singleton()
class SharedService {
  private instances: Map<string, any> = new Map();

  register(appName: string, data: any) {
    this.instances.set(appName, data);
  }

  get(appName: string): any {
    return this.instances.get(appName);
  }

  getAll(): Map<string, any> {
    return new Map(this.instances);
  }
}

// Logger service for testing lifecycle
interface Logger {
  log(message: string): void;
  getLogs(): string[];
}

@Injectable()
class LoggerService implements Logger {
  private logs: string[] = [];
  private initialized = false;
  private destroyed = false;

  @PostConstruct()
  init() {
    this.initialized = true;
    this.logs.push('Logger initialized');
  }

  @PreDestroy()
  destroy() {
    this.destroyed = true;
    this.logs.push('Logger destroyed');
  }

  log(message: string) {
    this.logs.push(message);
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

// Database service for testing resource management
interface Database {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

@Injectable()
class DatabaseService implements Database {
  private connected = false;
  private connectionCount = 0;

  async connect(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 10));
    this.connected = true;
    this.connectionCount++;
  }

  async disconnect(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 10));
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getConnectionCount(): number {
    return this.connectionCount;
  }
}

// Service with dependencies
@Injectable()
class ServiceWithDeps {
  constructor(
    @Inject(LoggerToken) private logger: Logger,
    @Inject(DatabaseToken) private database: Database
  ) { }

  async doWork(): Promise<string> {
    this.logger.log('Starting work');
    if (!this.database.isConnected()) {
      await this.database.connect();
    }
    this.logger.log('Work completed');
    return 'done';
  }

  getLogs(): string[] {
    return this.logger.getLogs();
  }
}

// Module for app A
@Module({
  providers: [
    [ServiceAToken, { useClass: ServiceA }],
    [LoggerToken, { useClass: LoggerService }]
  ],
  exports: [ServiceAToken, LoggerToken]
})
class ModuleA {
  initialized = false;
  destroyed = false;

  @PostConstruct()
  onInit() {
    this.initialized = true;
  }

  @PreDestroy()
  onDestroy() {
    this.destroyed = true;
  }
}

// Module for app B
@Module({
  providers: [
    [ServiceBToken, { useClass: ServiceB }],
    [DatabaseToken, { useClass: DatabaseService }]
  ],
  exports: [ServiceBToken, DatabaseToken]
})
class ModuleB {
  initialized = false;
  destroyed = false;

  @PostConstruct()
  onInit() {
    this.initialized = true;
  }

  @PreDestroy()
  onDestroy() {
    this.destroyed = true;
  }
}

// Module with dependencies
const ServiceWithDepsToken = createToken<ServiceWithDeps>('ServiceWithDeps');

@Module({
  providers: [
    [LoggerToken, { useClass: LoggerService }],
    [DatabaseToken, { useClass: DatabaseService }],
    [ServiceWithDepsToken, { useClass: ServiceWithDeps }]
  ],
  exports: [ServiceWithDepsToken, LoggerToken, DatabaseToken]
})
class ModuleWithDeps { }

describe('Multiple Applications', () => {
  let appA: Application;
  let appB: Application;
  let appC: Application;

  afterEach(async () => {
    // Clean up all applications
    if (appA) await appA.stop();
    if (appB) await appB.stop();
    if (appC) await appC.stop();
  });

  it('should allow multiple applications to run independently', async () => {
    // Create first application
    appA = await Application.create({
      name: 'app-a',
      version: '1.0.0',
      modules: [ModuleA],
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    // Create second application
    appB = await Application.create({
      name: 'app-b',
      version: '2.0.0',
      modules: [ModuleB],
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    // Start both applications
    await appA.start();
    await appB.start();

    // Both should be started
    expect(appA.state).toBe('started');
    expect(appB.state).toBe('started');

    // Get services from each container
    const serviceA = appA.container.resolve(ServiceAToken);
    const serviceB = appB.container.resolve(ServiceBToken);

    // Services should be independent
    expect(serviceA.name).toBe('ServiceA');
    expect(serviceB.name).toBe('ServiceB');

    // Modify data in each service
    serviceA.addData('test1');
    serviceA.addData('test2');
    serviceB.increment();
    serviceB.increment();
    serviceB.increment();

    // Verify data is isolated
    expect(serviceA.getData()).toEqual(['test1', 'test2']);
    expect(serviceB.getCount()).toBe(3);
  });

  it('should have independent configurations', async () => {
    // Create applications with different configs
    appA = await Application.create({
      name: 'config-app-a',
      config: {
        port: 3000,
        database: 'db-a'
      },
      disableGracefulShutdown: true
    });

    appB = await Application.create({
      name: 'config-app-b',
      config: {
        port: 4000,
        database: 'db-b'
      },
      disableGracefulShutdown: true
    });

    await appA.start();
    await appB.start();

    // Check that each has its own config
    expect((appA as any)._config.port).toBe(3000);
    expect((appA as any)._config.database).toBe('db-a');
    expect((appB as any)._config.port).toBe(4000);
    expect((appB as any)._config.database).toBe('db-b');
  });

  it('should handle lifecycle events independently', async () => {
    const eventsA: string[] = [];
    const eventsB: string[] = [];

    // Create applications with event listeners
    appA = await Application.create({
      name: 'event-app-a',
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    appB = await Application.create({
      name: 'event-app-b',
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    // Add event listeners
    appA.on('starting', () => eventsA.push('starting'));
    appA.on('started', () => eventsA.push('started'));
    appA.on('stopping', () => eventsA.push('stopping'));
    appA.on('stopped', () => eventsA.push('stopped'));

    appB.on('starting', () => eventsB.push('starting'));
    appB.on('started', () => eventsB.push('started'));
    appB.on('stopping', () => eventsB.push('stopping'));
    appB.on('stopped', () => eventsB.push('stopped'));

    // Start app A
    await appA.start();
    expect(eventsA).toEqual(['starting', 'started']);
    expect(eventsB).toEqual([]);

    // Start app B
    await appB.start();
    expect(eventsA).toEqual(['starting', 'started']);
    expect(eventsB).toEqual(['starting', 'started']);

    // Stop app A
    await appA.stop();
    expect(eventsA).toEqual(['starting', 'started', 'stopping', 'stopped']);
    expect(eventsB).toEqual(['starting', 'started']);

    // Stop app B
    await appB.stop();
    expect(eventsA).toEqual(['starting', 'started', 'stopping', 'stopped']);
    expect(eventsB).toEqual(['starting', 'started', 'stopping', 'stopped']);
  });

  it('should support three or more applications simultaneously', async () => {
    // Create three applications
    appA = await Application.create({
      name: 'multi-app-a',
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    appB = await Application.create({
      name: 'multi-app-b',
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    appC = await Application.create({
      name: 'multi-app-c',
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    // Start all three
    await Promise.all([
      appA.start(),
      appB.start(),
      appC.start()
    ]);

    // All should be started
    expect(appA.state).toBe('started');
    expect(appB.state).toBe('started');
    expect(appC.state).toBe('started');

    // Each should have unique names
    expect((appA as any)._config.name).toBe('multi-app-a');
    expect((appB as any)._config.name).toBe('multi-app-b');
    expect((appC as any)._config.name).toBe('multi-app-c');

    // Stop all three
    await Promise.all([
      appA.stop(),
      appB.stop(),
      appC.stop()
    ]);

    // All should be stopped
    expect(appA.state).toBe('stopped');
    expect(appB.state).toBe('stopped');
    expect(appC.state).toBe('stopped');
  });

  it('should isolate ConfigModule instances when used', async () => {
    // Create applications with different configs
    appA = await Application.create({
      name: 'config-isolation-a',
      config: {
        apiKey: 'key-a',
        environment: 'dev'
      },
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    appB = await Application.create({
      name: 'config-isolation-b',
      config: {
        apiKey: 'key-b',
        environment: 'prod'
      },
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    await appA.start();
    await appB.start();

    // Each should have its own config
    expect((appA as any)._config.apiKey).toBe('key-a');
    expect((appA as any)._config.environment).toBe('dev');
    expect((appB as any)._config.apiKey).toBe('key-b');
    expect((appB as any)._config.environment).toBe('prod');
  });

  it('should handle errors in one app without affecting others', async () => {
    // Service that throws error
    @Injectable()
    class ErrorService {
      doWork() {
        throw new Error('Service operation failed');
      }
    }

    const ErrorServiceToken = createToken<ErrorService>('ErrorService');

    // Module that includes error service
    @Module({
      providers: [
        [ErrorServiceToken, { useClass: ErrorService }]
      ]
    })
    class ErrorModule { }

    // Create healthy app first
    appA = await Application.create({
      name: 'healthy-app',
      modules: [ModuleA],
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    await appA.start();
    expect(appA.state).toBe('started');

    // Create app with error module
    appB = await Application.create({
      name: 'error-app',
      modules: [ErrorModule],
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    await appB.start();
    expect(appB.state).toBe('started');

    // Error in one app's service should not affect the other
    const errorService = appB.container.resolve(ErrorServiceToken);
    expect(() => errorService.doWork()).toThrow('Service operation failed');

    // App A should still be running fine
    expect(appA.state).toBe('started');
    const serviceA = appA.container.resolve(ServiceAToken);
    expect(serviceA.name).toBe('ServiceA');

    // Both apps should be independently stoppable
    await appA.stop();
    expect(appA.state).toBe('stopped');
    expect(appB.state).toBe('started');

    await appB.stop();
    expect(appB.state).toBe('stopped');
  });

  it('should properly clean up resources when stopping', async () => {
    // Simple resource tracking service
    class ResourceTracker {
      private resources: Set<string> = new Set();

      allocate(id: string): void {
        this.resources.add(id);
      }

      release(id: string): void {
        this.resources.delete(id);
      }

      hasResource(id: string): boolean {
        return this.resources.has(id);
      }

      clear(): void {
        this.resources.clear();
      }

      size(): number {
        return this.resources.size;
      }
    }

    const ResourceTrackerToken = createToken<ResourceTracker>('ResourceTracker');

    @Module({
      providers: [
        [ResourceTrackerToken, { useClass: ResourceTracker }]
      ]
    })
    class ResourceModule { }

    // Create app with resources
    appA = await Application.create({
      name: 'resource-app',
      modules: [ResourceModule],
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    await appA.start();

    // Get service and allocate resources
    const tracker = appA.container.resolve(ResourceTrackerToken);

    tracker.allocate('resource-1');
    tracker.allocate('resource-2');
    tracker.allocate('resource-3');

    // Verify resources are allocated
    expect(tracker.size()).toBe(3);
    expect(tracker.hasResource('resource-1')).toBe(true);
    expect(tracker.hasResource('resource-2')).toBe(true);
    expect(tracker.hasResource('resource-3')).toBe(true);

    // Manually clean up before stop
    tracker.clear();
    expect(tracker.size()).toBe(0);

    // Stop the app
    await appA.stop();
    expect(appA.state).toBe('stopped');
  });

  it('should handle concurrent operations on multiple apps', async () => {
    // Create multiple apps
    const apps: Application[] = [];
    const numApps = 5;

    for (let i = 0; i < numApps; i++) {
      const app = await Application.create({
        name: `concurrent-app-${i}`,
        modules: [ModuleA],
        disableGracefulShutdown: true,
        disableCoreModules: true
      });
      apps.push(app);
    }

    // Start all apps concurrently
    await Promise.all(apps.map(app => app.start()));

    // Verify all are started
    apps.forEach((app, i) => {
      expect(app.state).toBe('started');
      expect((app as any)._config.name).toBe(`concurrent-app-${i}`);
    });

    // Use services concurrently
    const operations = apps.map(async (app, i) => {
      const service = app.container.resolve(ServiceAToken);
      service.addData(`data-${i}`);
      return service.getData();
    });

    const results = await Promise.all(operations);

    // Each should have only its own data
    results.forEach((data, i) => {
      expect(data).toEqual([`data-${i}`]);
    });

    // Stop all apps concurrently
    await Promise.all(apps.map(app => app.stop()));

    // Verify all are stopped
    apps.forEach(app => {
      expect(app.state).toBe('stopped');
    });
  });

  it('should support module sharing patterns properly', async () => {
    // Create shared module
    @Module({
      providers: [
        [SharedServiceToken, { useClass: SharedService }]
      ],
      exports: [SharedServiceToken]
    })
    class SharedModule { }

    // Create apps that use shared module pattern
    appA = await Application.create({
      name: 'shared-app-a',
      modules: [SharedModule],
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    appB = await Application.create({
      name: 'shared-app-b',
      modules: [SharedModule],
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    await appA.start();
    await appB.start();

    // Each app should have its own instance of the shared service
    const sharedA = appA.container.resolve(SharedServiceToken);
    const sharedB = appB.container.resolve(SharedServiceToken);

    // They should be different instances
    expect(sharedA).not.toBe(sharedB);

    // Data should be isolated
    sharedA.register('app-a', { value: 'A' });
    sharedB.register('app-b', { value: 'B' });

    expect(sharedA.get('app-a')).toEqual({ value: 'A' });
    expect(sharedA.get('app-b')).toBeUndefined();
    expect(sharedB.get('app-b')).toEqual({ value: 'B' });
    expect(sharedB.get('app-a')).toBeUndefined();
  });

  it('should handle module lifecycle hooks independently', async () => {
    // Track lifecycle events through simple counters
    let countA = 0;
    let countB = 0;

    // Service for app A
    @Injectable()
    class CounterServiceA {
      increment() {
        countA++;
      }

      getValue() {
        return countA;
      }
    }

    // Service for app B
    @Injectable()
    class CounterServiceB {
      increment() {
        countB++;
      }

      getValue() {
        return countB;
      }
    }

    const CounterServiceAToken = createToken<CounterServiceA>('CounterServiceA');
    const CounterServiceBToken = createToken<CounterServiceB>('CounterServiceB');

    @Module({
      providers: [
        [CounterServiceAToken, { useClass: CounterServiceA }]
      ]
    })
    class CounterModuleA { }

    @Module({
      providers: [
        [CounterServiceBToken, { useClass: CounterServiceB }]
      ]
    })
    class CounterModuleB { }

    appA = await Application.create({
      name: 'counter-app-a',
      modules: [CounterModuleA],
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    appB = await Application.create({
      name: 'counter-app-b',
      modules: [CounterModuleB],
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    // Start both apps
    await appA.start();
    await appB.start();

    // Get services
    const serviceA = appA.container.resolve(CounterServiceAToken);
    const serviceB = appB.container.resolve(CounterServiceBToken);

    // Operate on app A
    serviceA.increment();
    serviceA.increment();
    expect(serviceA.getValue()).toBe(2);
    expect(countA).toBe(2);
    expect(countB).toBe(0);

    // Operate on app B
    serviceB.increment();
    expect(serviceB.getValue()).toBe(1);
    expect(countB).toBe(1);
    expect(countA).toBe(2);

    // Stop app A - should not affect app B
    await appA.stop();
    expect(appA.state).toBe('stopped');
    expect(appB.state).toBe('started');

    // App B should still work
    serviceB.increment();
    expect(serviceB.getValue()).toBe(2);
    expect(countB).toBe(2);

    // Stop app B
    await appB.stop();
    expect(appB.state).toBe('stopped');
  });

  it('should handle service dependencies correctly in each app', async () => {
    appA = await Application.create({
      name: 'deps-app-a',
      modules: [ModuleWithDeps],
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    appB = await Application.create({
      name: 'deps-app-b',
      modules: [ModuleWithDeps],
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    await appA.start();
    await appB.start();

    // Get services from each app
    const serviceA = appA.container.resolve(ServiceWithDepsToken);
    const serviceB = appB.container.resolve(ServiceWithDepsToken);

    // Services should be different instances
    expect(serviceA).not.toBe(serviceB);

    // Each should have its own dependencies
    await serviceA.doWork();
    await serviceB.doWork();

    const logsA = serviceA.getLogs();
    const logsB = serviceB.getLogs();

    // Logs should be independent
    expect(logsA).toContain('Starting work');
    expect(logsA).toContain('Work completed');
    expect(logsB).toContain('Starting work');
    expect(logsB).toContain('Work completed');

    // Modifying one should not affect the other
    await serviceA.doWork();
    const logsAAfter = serviceA.getLogs();
    const logsBAfter = serviceB.getLogs();

    // Service A should have more logs than service B
    expect(logsAAfter.length).toBeGreaterThan(logsBAfter.length);
    expect(logsAAfter.filter(l => l === 'Work completed').length).toBe(2);
    expect(logsBAfter.filter(l => l === 'Work completed').length).toBe(1);
  });

  it('should handle rapid start/stop cycles', async () => {
    const cycles = 3;

    for (let i = 0; i < cycles; i++) {
      appA = await Application.create({
        name: `cycle-app-${i}`,
        modules: [ModuleA],
        disableGracefulShutdown: true,
        disableCoreModules: true
      });

      await appA.start();
      expect(appA.state).toBe('started');

      const service = appA.container.resolve(ServiceAToken);
      service.addData(`cycle-${i}`);
      expect(service.getData()).toEqual([`cycle-${i}`]);

      await appA.stop();
      expect(appA.state).toBe('stopped');
    }
  });

  it('should properly isolate event emitters', async () => {
    const eventsA: string[] = [];
    const eventsB: string[] = [];

    appA = await Application.create({
      name: 'events-app-a',
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    appB = await Application.create({
      name: 'events-app-b',
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    // Custom event handlers
    appA.on('custom', (data) => eventsA.push(data));
    appB.on('custom', (data) => eventsB.push(data));

    // Emit events on each app
    appA.emit('custom', 'event-a');
    appB.emit('custom', 'event-b');

    // Each should only receive its own events
    expect(eventsA).toEqual(['event-a']);
    expect(eventsB).toEqual(['event-b']);

    // Emit more events
    appA.emit('custom', 'event-a2');
    appB.emit('custom', 'event-b2');

    expect(eventsA).toEqual(['event-a', 'event-a2']);
    expect(eventsB).toEqual(['event-b', 'event-b2']);
  });

  it('should handle different application versions', async () => {
    appA = await Application.create({
      name: 'versioned-app',
      version: '1.0.0',
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    appB = await Application.create({
      name: 'versioned-app',
      version: '2.0.0',
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    await appA.start();
    await appB.start();

    expect((appA as any)._config.version).toBe('1.0.0');
    expect((appB as any)._config.version).toBe('2.0.0');

    // Both should be running despite same name but different versions
    expect(appA.state).toBe('started');
    expect(appB.state).toBe('started');
  });

  it('should support auto-discovery mode independently', async () => {
    // Create apps with auto-discovery enabled
    appA = await Application.create({
      name: 'auto-discovery-a',
      autoDiscovery: false, // Disable to avoid conflicts
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    appB = await Application.create({
      name: 'auto-discovery-b',
      autoDiscovery: false, // Disable to avoid conflicts
      disableGracefulShutdown: true,
      disableCoreModules: true
    });

    await appA.start();
    await appB.start();

    // Both should start successfully
    expect(appA.state).toBe('started');
    expect(appB.state).toBe('started');
  });
});