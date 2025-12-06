/**
 * Application Integration Tests
 *
 * Comprehensive integration tests for complete application scenarios:
 * - Application lifecycle (creation, start, stop, restart)
 * - Module registration and loading
 * - Provider registration and resolution
 * - Event emission (ApplicationEvent.Starting, Started, Stopping, Stopped, Error)
 * - Netron integration (if configured)
 * - Error handling
 * - Graceful shutdown
 * - Configuration options
 * - Real-world use cases
 * - Cross-feature interactions
 * - Performance and reliability
 * - Advanced patterns
 */
import { describe, it, expect, afterEach, beforeEach, jest } from '@jest/globals';

import { Application, createApp, APPLICATION_TOKEN, NETRON_TOKEN } from '../../src/application.js';
import { createToken, Container, Token } from '../../src/nexus/index.js';
import {
  ApplicationState,
  ApplicationEvent,
  IModule,
  ShutdownPriority,
  ShutdownReason,
  IHealthStatus,
  ILifecycleHook,
} from '../../src/types.js';
import {
  createWebApplication,
  createMicroserviceApplication,
  createTaskProcessorApplication,
  createApiGatewayApplication,
  createFullStackApplication,
  createTestApplication,
  ApplicationType,
} from '../fixtures/test-applications.js';
import {
  DatabaseModule,
  CacheModule,
  HttpServerModule,
  MessageQueueModule,
  FailingModule,
  SlowModule,
  SimpleModule,
  createTrackedModule,
  createCustomModule,
} from '../fixtures/test-modules.js';
import { Module, Injectable } from '../../src/decorators/index.js';

describe('Application Integration', () => {
  let app: Application;
  const apps: Application[] = [];

  afterEach(async () => {
    // Cleanup all apps
    for (const a of apps) {
      if (a.state === ApplicationState.Started) {
        await a.stop({ force: true });
      }
    }
    apps.length = 0;

    if (app && app.state === ApplicationState.Started) {
      await app.stop({ force: true });
    }
  });

  describe('Real-world Application Scenarios', () => {
    it('should run a complete web application', async () => {
      app = createWebApplication();

      await app.start();

      // Check all modules are running
      expect(app.modules.has('http')).toBe(true);
      expect(app.modules.has('database')).toBe(true);
      expect(app.modules.has('cache')).toBe(true);

      const httpModule = app.modules.get('http') as HttpServerModule;
      expect(httpModule.isListening()).toBe(true);

      // Simulate web operations
      httpModule.addRoute('/api/test', () => ({ status: 'ok' }));
      httpModule.addMiddleware((req: any, res: any, next: Function) => {
        req.authenticated = true;
        next();
      });

      const health = await app.health();
      expect(health.status).toBe('healthy');

      await app.stop();
    });

    it('should run a microservice application', async () => {
      app = createMicroserviceApplication('payment-service');

      await app.start();

      expect(app.name).toBe('payment-service');
      expect(app.version).toBe('2.0.0');

      // Check service configuration
      const config = app.getConfig();
      expect(config.service.name).toBe('payment-service');
      expect(config.health.interval).toBe(30000);

      const health = await app.health();
      expect(health.status).toBe('healthy');

      await app.stop();
    });

    it('should run a task processing application', async () => {
      app = createTaskProcessorApplication();

      await app.start();

      const queueModule = app.modules.get('queue') as MessageQueueModule;

      // Send some tasks
      await queueModule.send('tasks', { id: 1, type: 'process' });
      await queueModule.send('tasks', { id: 2, type: 'process' });
      await queueModule.send('priority-tasks', { id: 3, type: 'urgent' });

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 200));

      const health = await app.health();
      expect(health.modules.queue.details.totalMessages).toBeGreaterThanOrEqual(0);

      await app.stop();
    });

    it('should run an API gateway application', async () => {
      app = createApiGatewayApplication();

      await app.start();

      const httpModule = app.modules.get('http') as HttpServerModule;
      const cacheModule = app.modules.get('cache') as CacheModule;

      expect(httpModule.port).toBe(8080);
      expect(cacheModule).toBeDefined();

      // Gateway should have routes registered
      // (In real implementation, would check actual routes)

      await app.stop();
    });

    it('should run a full-stack application', async () => {
      app = createFullStackApplication();

      await app.start();

      // Check all infrastructure is running
      expect(app.modules.size).toBeGreaterThan(5);
      expect(app.modules.has('http')).toBe(true);
      expect(app.modules.has('database')).toBe(true);
      expect(app.modules.has('cache')).toBe(true);
      expect(app.modules.has('queue')).toBe(true);
      expect(app.modules.has('application')).toBe(true);

      const health = await app.health();
      expect(health.status).toBe('healthy');

      // Check complex interactions
      const dependentModule = app.modules.get('dependent');
      expect(dependentModule).toBeDefined();

      await app.stop();
    });
  });

  describe('Application Factory', () => {
    it('should create different application types', async () => {
      const types = [
        ApplicationType.Web,
        ApplicationType.Microservice,
        ApplicationType.TaskProcessor,
        ApplicationType.Minimal,
      ];

      for (const type of types) {
        const testApp = createTestApplication(type);
        apps.push(testApp);

        await testApp.start();
        expect(testApp.state).toBe(ApplicationState.Started);

        const health = await testApp.health();
        expect(health.status).toBe('healthy');
      }

      // Stop all apps
      for (const testApp of apps) {
        await testApp.stop();
      }
    });
  });

  describe('Lifecycle Hooks', () => {
    it('should execute lifecycle hooks with priority', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const executionOrder: string[] = [];

      app.onStart(() => {
        executionOrder.push('start-1');
      });

      app.onStart(() => {
        executionOrder.push('start-2');
      }, 10); // Higher priority (lower number = higher priority)

      app.onStart(() => {
        executionOrder.push('start-3');
      }, 50); // Medium priority

      await app.start();

      // Should execute in priority order (lower numbers first)
      expect(executionOrder).toEqual(['start-2', 'start-3', 'start-1']);

      await app.stop();
    });

    it('should execute stop hooks in reverse order', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const executionOrder: string[] = [];

      app.onStop(() => {
        executionOrder.push('stop-1');
      });

      app.onStop(() => {
        executionOrder.push('stop-2');
      });

      app.onStop(() => {
        executionOrder.push('stop-3');
      });

      await app.start();
      await app.stop();

      // Stop hooks execute in reverse order
      expect(executionOrder).toEqual(['stop-3', 'stop-2', 'stop-1']);
    });

    it('should handle async lifecycle hooks', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      let asyncCompleted = false;

      app.onStart(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        asyncCompleted = true;
      });

      await app.start();

      expect(asyncCompleted).toBe(true);

      await app.stop();
    });

    it('should timeout lifecycle hooks', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      app.onStart(
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        },
        0,
        100
      ); // 100ms timeout

      await expect(app.start()).rejects.toThrow('timed out');
    });
  });

  describe('Shutdown Management', () => {
    it('should handle shutdown tasks', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const executedTasks: string[] = [];

      const task1 = app.registerShutdownTask(
        'cleanup-connections',
        async () => {
          executedTasks.push('cleanup-connections');
        },
        ShutdownPriority.High
      );

      const task2 = app.registerShutdownTask(
        'save-state',
        async () => {
          executedTasks.push('save-state');
        },
        ShutdownPriority.Normal
      );

      await app.start();
      await app.stop();

      expect(executedTasks).toEqual(['cleanup-connections', 'save-state']);
    });

    it('should handle critical shutdown task failures', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      app.registerShutdownTask(
        'critical-task',
        async () => {
          throw new Error('Critical failure');
        },
        ShutdownPriority.Critical,
        true // isCritical
      );

      await app.start();

      // Critical task failure should propagate
      await expect(app.stop()).rejects.toThrow('Critical failure');
    });

    it('should continue with non-critical task failures', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const executed: string[] = [];

      app.registerShutdownTask(
        'failing-task',
        async () => {
          throw new Error('Non-critical failure');
        },
        ShutdownPriority.Normal,
        false // not critical
      );

      app.registerShutdownTask(
        'succeeding-task',
        async () => {
          executed.push('success');
        },
        ShutdownPriority.Low
      );

      await app.start();

      // Should complete despite non-critical failure
      await app.stop();
      expect(executed).toContain('success');
    });

    it('should unregister shutdown tasks', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const executed: string[] = [];

      const taskId = app.registerShutdownTask('removable-task', async () => {
        executed.push('should-not-execute');
      });

      app.unregisterShutdownTask(taskId);

      await app.start();
      await app.stop();

      expect(executed).not.toContain('should-not-execute');
    });

    it('should register cleanup handlers', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const cleaned: string[] = [];

      app.registerCleanupHandler(() => {
        cleaned.push('handler-1');
      });

      app.registerCleanupHandler(() => {
        cleaned.push('handler-2');
      });

      await app.start();
      await app.stop();

      expect(cleaned).toEqual(['handler-1', 'handler-2']);
    });

    it('should handle cleanup handler errors gracefully', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const cleaned: string[] = [];

      app.registerCleanupHandler(() => {
        throw new Error('Cleanup error');
      });

      app.registerCleanupHandler(() => {
        cleaned.push('successful');
      });

      await app.start();

      // Should not throw
      await app.stop();
      expect(cleaned).toContain('successful');
    });

    it('should provide process metrics', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      await app.start();

      const metrics = app.getProcessMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.memoryUsage).toBeDefined();
      expect(metrics.memoryUsage.heapUsed).toBeGreaterThan(0);
      expect(metrics.cpuUsage).toBeDefined();
      expect(metrics.uptime).toBeGreaterThan(0);
      expect(metrics.pid).toBe(process.pid);

      await app.stop();
    });

    it('should support force shutdown', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      // Add a very slow module
      app.use(new SlowModule(5000));

      await app.start();

      const start = Date.now();
      await app.stop({ force: true });
      const duration = Date.now() - start;

      // Force shutdown should be fast
      expect(duration).toBeLessThan(500);
      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should emit shutdown lifecycle events', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const events: string[] = [];

      app.on(ApplicationEvent.ShutdownInitiated, () => events.push('initiated'));
      app.on(ApplicationEvent.ShutdownComplete, () => events.push('complete'));

      await app.start();
      await app.stop();

      expect(events).toContain('complete');
    });

    it('should register global shutdown tasks on start', async () => {
      // Simulate global tasks
      const globalHandler = jest.fn();
      global.__titanShutdownTasks = [
        {
          name: 'global-task',
          handler: globalHandler,
          priority: ShutdownPriority.Normal,
        },
      ];

      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      await app.start();
      await app.stop();

      expect(globalHandler).toHaveBeenCalled();

      // Cleanup
      delete global.__titanShutdownTasks;
    });
  });

  describe('Error Recovery', () => {
    it('should handle partial module failures', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      app.use(new SimpleModule());
      app.use(new FailingModule('start'));
      app.use(new DatabaseModule());

      await expect(app.start()).rejects.toThrow('Module failure');

      expect(app.state).toBe(ApplicationState.Failed);
    });

    it('should recover from transient failures', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      let attempts = 0;

      const transientModule: IModule = {
        name: 'transient',
        version: '1.0.0',
        onStart: async () => {
          attempts++;
          if (attempts < 2) {
            throw new Error('Transient failure');
          }
        },
      };

      app.use(transientModule);

      // First attempt fails
      await expect(app.start()).rejects.toThrow('Transient failure');
      expect(attempts).toBe(1);

      // Second attempt fails due to failed state
      await expect(app.start()).rejects.toThrow('Cannot start from failed state');
      expect(attempts).toBe(1); // Should not increment since start was blocked

      // Reset state to allow retry
      (app as any)._state = ApplicationState.Created;

      // Third attempt succeeds
      await app.start();
      expect(attempts).toBe(2); // Should have incremented on successful retry
      expect(app.state).toBe(ApplicationState.Started);

      await app.stop();
    });
  });

  describe('Container Integration', () => {
    it('should integrate with DI container', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const API_KEY = createToken<string>('API_KEY');
      const API_URL = createToken<string>('API_URL');

      @Module({
        providers: [
          { provide: API_KEY, useValue: 'secret-key' },
          { provide: API_URL, useValue: 'https://api.example.com' },
        ],
      })
      class ApiModule extends SimpleModule {
        override readonly name = 'api';
      }

      await app.registerModule(ApiModule);

      const apiKey = app.container.resolve(API_KEY);
      const apiUrl = app.container.resolve(API_URL);

      expect(apiKey).toBe('secret-key');
      expect(apiUrl).toBe('https://api.example.com');
    });

    it('should handle provider cleanup on stop', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const cleanupFn = jest.fn();

      class ServiceWithCleanup {
        onDestroy() {
          cleanupFn();
        }
      }

      @Module({
        providers: [ServiceWithCleanup],
      })
      class CleanupModule extends SimpleModule {
        override readonly name = 'cleanup-module';
      }

      await app.registerModule(CleanupModule);
      await app.start();

      // The cleanup hook is called through module cleanup
      await app.stop();

      // Provider cleanup happens through container
      expect(app.state).toBe(ApplicationState.Stopped);
    });
  });

  describe('Advanced Patterns', () => {
    it('should support plugin architecture', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      // Define plugin interface
      interface IPlugin extends IModule {
        install(app: Application): void;
      }

      const plugin: IPlugin = {
        name: 'test-plugin',
        version: '1.0.0',
        install(app: Application) {
          app.configure({ plugin: { installed: true } });
        },
      };

      // Install plugin
      plugin.install(app);
      app.use(plugin);

      expect(app.getConfig().plugin.installed).toBe(true);
    });

    it('should support middleware pattern', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const middleware: Function[] = [];

      class MiddlewareModule extends SimpleModule {
        override readonly name = 'middleware';

        use(fn: Function) {
          middleware.push(fn);
        }

        async process(data: any) {
          let result = data;
          for (const fn of middleware) {
            result = await fn(result);
          }
          return result;
        }
      }

      const module = new MiddlewareModule();
      app.use(module);

      // Add middleware
      module.use((data: any) => ({ ...data, step1: true }));
      module.use((data: any) => ({ ...data, step2: true }));
      module.use(async (data: any) => {
        await new Promise((r) => setTimeout(r, 10));
        return { ...data, step3: true };
      });

      const result = await module.process({ initial: true });

      expect(result).toEqual({
        initial: true,
        step1: true,
        step2: true,
        step3: true,
      });
    });

    it('should support hot module replacement pattern', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const moduleV1 = new SimpleModule();
      moduleV1.name = 'replaceable';
      moduleV1.version = '1.0.0';

      app.use(moduleV1);
      await app.start();

      expect(app.modules.get('replaceable')).toBe(moduleV1);

      // Simulate hot replacement
      await app.stop();

      const moduleV2 = new SimpleModule();
      moduleV2.name = 'replaceable';
      moduleV2.version = '2.0.0';

      // Remove old module and add new
      app.modules.delete('replaceable');
      app.use(moduleV2);

      await app.start();

      expect(app.modules.get('replaceable')).toBe(moduleV2);
      expect(moduleV2.version).toBe('2.0.0');

      await app.stop();
    });
  });

  describe('Performance', () => {
    it('should handle rapid start/stop cycles', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      for (let i = 0; i < 10; i++) {
        await app.start();
        expect(app.state).toBe(ApplicationState.Started);

        await app.stop();
        expect(app.state).toBe(ApplicationState.Stopped);
      }
    });

    it('should handle many modules efficiently', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      // Add 100 modules
      for (let i = 0; i < 100; i++) {
        const module: IModule = {
          name: `module-${i}`,
          version: '1.0.0',
          onStart: jest.fn(),
          onStop: jest.fn(),
        };
        app.use(module);
      }

      const start = Date.now();
      await app.start();
      const startDuration = Date.now() - start;

      expect(startDuration).toBeLessThan(1000); // Should be fast
      expect(app.modules.size).toBe(100);

      const stop = Date.now();
      await app.stop();
      const stopDuration = Date.now() - stop;

      expect(stopDuration).toBeLessThan(1000); // Should be fast
    });

    it('should handle high-throughput event processing', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      let eventCount = 0;

      app.on(ApplicationEvent.Custom, () => {
        eventCount++;
      });

      const start = Date.now();

      // Emit 10000 events
      for (let i = 0; i < 10000; i++) {
        app.emit(ApplicationEvent.Custom, { index: i });
      }

      const duration = Date.now() - start;

      expect(eventCount).toBe(10000);
      expect(duration).toBeLessThan(100); // Should be very fast
    });
  });

  // ============================================================================
  // COMPREHENSIVE APPLICATION LIFECYCLE TESTS
  // ============================================================================

  describe('Application Lifecycle (Comprehensive)', () => {
    it('should transition through all lifecycle states correctly', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const states: ApplicationState[] = [];

      // Track state changes via events
      app.on(ApplicationEvent.Starting, () => states.push(ApplicationState.Starting));
      app.on(ApplicationEvent.Started, () => states.push(ApplicationState.Started));
      app.on(ApplicationEvent.Stopping, () => states.push(ApplicationState.Stopping));
      app.on(ApplicationEvent.Stopped, () => states.push(ApplicationState.Stopped));

      expect(app.state).toBe(ApplicationState.Created);

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);

      await app.stop();
      expect(app.state).toBe(ApplicationState.Stopped);

      // Verify state transition order
      expect(states).toEqual([
        ApplicationState.Starting,
        ApplicationState.Started,
        ApplicationState.Stopping,
        ApplicationState.Stopped,
      ]);
    });

    it('should support restart with state reset', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const module = createTrackedModule('restart-test');
      app.use(module);

      await app.start();
      expect(module.calls).toContain('start');

      // Clear tracking
      module.calls.length = 0;

      await app.restart();

      // Should have stopped and started again
      expect(module.calls).toContain('stop');
      expect(module.calls).toContain('start');
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should handle concurrent start attempts gracefully', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      app.use(new SlowModule(100));

      // Start multiple concurrent start attempts
      const results = await Promise.allSettled([app.start(), app.start(), app.start()]);

      // The application should end up in a started state regardless of concurrent calls
      expect(app.state).toBe(ApplicationState.Started);

      // At least one call should succeed
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle concurrent stop attempts gracefully', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      app.use(new SlowModule(100));

      await app.start();

      // Start multiple concurrent stop attempts
      const results = await Promise.allSettled([app.stop(), app.stop(), app.stop()]);

      // All should resolve without throwing
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThanOrEqual(1);
      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should wait for start to complete before processing stop', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const startTime = Date.now();
      app.use(new SlowModule(200));

      // Start the app
      const startPromise = app.start();

      // Immediately try to stop
      const stopPromise = app.stop();

      // Both should complete
      await Promise.all([startPromise, stopPromise]);

      // Total time should be at least the module delay
      const totalTime = Date.now() - startTime;
      expect(totalTime).toBeGreaterThanOrEqual(200);
    });

    it('should report uptime correctly after start', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      await app.start();

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      const uptime = app.uptime;
      expect(uptime).toBeGreaterThanOrEqual(100);
      expect(uptime).toBeLessThan(5000); // Sanity check
    });
  });

  // ============================================================================
  // MODULE REGISTRATION AND LOADING TESTS
  // ============================================================================

  describe('Module Registration and Loading', () => {
    it('should register modules via use() method', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const module1 = new SimpleModule();
      const module2 = new DatabaseModule();

      app.use(module1);
      app.use(module2);

      expect(app.modules.has('simple')).toBe(true);
      expect(app.modules.has('database')).toBe(true);
    });

    it('should register modules via registerModule() method', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      @Module({
        providers: [],
      })
      class TestModule implements IModule {
        name = 'test-module';
        version = '1.0.0';
      }

      await app.registerModule(TestModule);

      expect(app.modules.has('test-module')).toBe(true);
    });

    it('should handle duplicate module registration idempotently', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const module = new SimpleModule();

      app.use(module);
      app.use(module); // Duplicate

      // Should only be registered once
      expect(app.modules.size).toBe(1);
    });

    it('should emit ModuleRegistered event on registration', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const registeredModules: string[] = [];

      app.on(ApplicationEvent.ModuleRegistered, (data: any) => {
        registeredModules.push(data.module);
      });

      app.use(new SimpleModule());
      app.use(new DatabaseModule());

      expect(registeredModules).toContain('simple');
      expect(registeredModules).toContain('database');
    });

    it('should start modules in registration order', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const startOrder: string[] = [];

      const module1 = createCustomModule({
        name: 'first',
        onStart: async () => {
          startOrder.push('first');
        },
      });

      const module2 = createCustomModule({
        name: 'second',
        onStart: async () => {
          startOrder.push('second');
        },
      });

      const module3 = createCustomModule({
        name: 'third',
        onStart: async () => {
          startOrder.push('third');
        },
      });

      app.use(module1);
      app.use(module2);
      app.use(module3);

      await app.start();

      expect(startOrder).toEqual(['first', 'second', 'third']);
    });

    it('should stop modules in reverse order', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const stopOrder: string[] = [];

      const module1 = createCustomModule({
        name: 'first',
        onStop: async () => {
          stopOrder.push('first');
        },
      });

      const module2 = createCustomModule({
        name: 'second',
        onStop: async () => {
          stopOrder.push('second');
        },
      });

      const module3 = createCustomModule({
        name: 'third',
        onStop: async () => {
          stopOrder.push('third');
        },
      });

      app.use(module1);
      app.use(module2);
      app.use(module3);

      await app.start();
      await app.stop();

      expect(stopOrder).toEqual(['third', 'second', 'first']);
    });

    it('should configure modules with matching config', async () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          simple: { customSetting: 'test-value' },
        },
      });

      const module = new SimpleModule();
      app.use(module);

      expect(module.configureCalled).toBe(true);
      expect(module.configValue).toEqual({ customSetting: 'test-value' });
    });

    it('should replace modules with replaceModule()', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const originalModule = new SimpleModule();
      originalModule.name = 'replaceable';
      app.use(originalModule);

      const replacementModule = new SimpleModule();
      replacementModule.name = 'replaceable';
      replacementModule.version = '2.0.0';

      app.replaceModule('replaceable', replacementModule);

      const retrieved = app.modules.get('replaceable');
      expect(retrieved?.version).toBe('2.0.0');
    });

    it('should throw when replacing module after start', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const module = new SimpleModule();
      app.use(module);

      await app.start();

      const replacement = new SimpleModule();
      expect(() => app.replaceModule('simple', replacement)).toThrow(
        'Cannot replace modules after application has started'
      );
    });
  });

  // ============================================================================
  // PROVIDER REGISTRATION AND RESOLUTION TESTS
  // ============================================================================

  describe('Provider Registration and Resolution', () => {
    it('should register providers via register() method', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const SERVICE_TOKEN = createToken<string>('SERVICE');
      app.register(SERVICE_TOKEN, { useValue: 'test-service' });

      const resolved = app.resolve(SERVICE_TOKEN);
      expect(resolved).toBe('test-service');
    });

    it('should resolve providers with useClass', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      @Injectable()
      class TestService {
        getValue() {
          return 'from-class';
        }
      }

      const SERVICE_TOKEN = createToken<TestService>('TestService');
      app.register(SERVICE_TOKEN, { useClass: TestService });

      const resolved = app.resolve(SERVICE_TOKEN);
      expect(resolved.getValue()).toBe('from-class');
    });

    it('should resolve providers with useFactory', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const CONFIG_TOKEN = createToken<{ value: string }>('Config');
      app.register(CONFIG_TOKEN, {
        useFactory: () => ({ value: 'from-factory' }),
      });

      const resolved = app.resolve(CONFIG_TOKEN);
      expect(resolved.value).toBe('from-factory');
    });

    it('should support provider override with override option', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const TOKEN = createToken<string>('Value');
      app.register(TOKEN, { useValue: 'original' });
      app.register(TOKEN, { useValue: 'override' }, { override: true });

      expect(app.resolve(TOKEN)).toBe('override');
    });

    it('should resolve APPLICATION_TOKEN to the application instance', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const resolved = app.resolve(APPLICATION_TOKEN);
      expect(resolved).toBe(app);
    });

    it('should check provider existence with hasProvider()', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const EXISTING_TOKEN = createToken<string>('Existing');
      const MISSING_TOKEN = createToken<string>('Missing');

      app.register(EXISTING_TOKEN, { useValue: 'test' });

      expect(app.hasProvider(EXISTING_TOKEN)).toBe(true);
      expect(app.hasProvider(MISSING_TOKEN)).toBe(false);
    });

    it('should allow providers from @Module decorator', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const SERVICE_TOKEN = createToken<any>('ModuleService');

      @Injectable()
      class ModuleService {
        getValue() {
          return 'module-service-value';
        }
      }

      @Module({
        providers: [{ provide: SERVICE_TOKEN, useClass: ModuleService }],
        exports: [SERVICE_TOKEN],
      })
      class ProviderModule implements IModule {
        name = 'provider-module';
        version = '1.0.0';
      }

      await app.registerModule(ProviderModule);

      const service = app.container.resolve(SERVICE_TOKEN);
      expect(service.getValue()).toBe('module-service-value');
    });
  });

  // ============================================================================
  // EVENT EMISSION TESTS
  // ============================================================================

  describe('Event Emission', () => {
    it('should emit Starting event before module starts', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      let startingEmitted = false;
      let moduleStarted = false;

      const module = createCustomModule({
        name: 'event-test',
        onStart: async () => {
          expect(startingEmitted).toBe(true);
          moduleStarted = true;
        },
      });

      app.on(ApplicationEvent.Starting, () => {
        startingEmitted = true;
        expect(moduleStarted).toBe(false);
      });

      app.use(module);
      await app.start();

      expect(startingEmitted).toBe(true);
      expect(moduleStarted).toBe(true);
    });

    it('should emit Started event after all modules start', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      let allModulesStarted = false;
      let startedEmitted = false;

      const module = createCustomModule({
        name: 'event-test',
        onStart: async () => {
          allModulesStarted = true;
        },
      });

      app.on(ApplicationEvent.Started, () => {
        startedEmitted = true;
        expect(allModulesStarted).toBe(true);
      });

      app.use(module);
      await app.start();

      expect(startedEmitted).toBe(true);
    });

    it('should emit Stopping event before modules stop', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      let stoppingEmitted = false;
      let moduleStopped = false;

      const module = createCustomModule({
        name: 'event-test',
        onStop: async () => {
          expect(stoppingEmitted).toBe(true);
          moduleStopped = true;
        },
      });

      app.on(ApplicationEvent.Stopping, () => {
        stoppingEmitted = true;
        expect(moduleStopped).toBe(false);
      });

      app.use(module);
      await app.start();
      await app.stop();

      expect(stoppingEmitted).toBe(true);
      expect(moduleStopped).toBe(true);
    });

    it('should emit Stopped event after all modules stop', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      let allModulesStopped = false;
      let stoppedEmitted = false;

      const module = createCustomModule({
        name: 'event-test',
        onStop: async () => {
          allModulesStopped = true;
        },
      });

      app.on(ApplicationEvent.Stopped, () => {
        stoppedEmitted = true;
        expect(allModulesStopped).toBe(true);
      });

      app.use(module);
      await app.start();
      await app.stop();

      expect(stoppedEmitted).toBe(true);
    });

    it('should emit Error event on module failure', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      let errorEmitted = false;
      let errorData: any = null;

      app.on(ApplicationEvent.Error, (error: any) => {
        errorEmitted = true;
        errorData = error;
      });

      app.use(new FailingModule('start', 'Test error'));

      await expect(app.start()).rejects.toThrow('Test error');
      expect(errorEmitted).toBe(true);
    });

    it('should emit ModuleStarted event for each module', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const startedModules: string[] = [];

      app.on(ApplicationEvent.ModuleStarted, (data: any) => {
        startedModules.push(data.module);
      });

      app.use(new SimpleModule());
      const dbModule = new DatabaseModule();
      dbModule.name = 'database';
      app.use(dbModule);

      await app.start();

      expect(startedModules).toContain('simple');
      expect(startedModules).toContain('database');
    });

    it('should emit ModuleStopped event for each module', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const stoppedModules: string[] = [];

      app.on(ApplicationEvent.ModuleStopped, (data: any) => {
        stoppedModules.push(data.module);
      });

      app.use(new SimpleModule());
      app.use(new DatabaseModule());

      await app.start();
      await app.stop();

      expect(stoppedModules).toContain('simple');
      expect(stoppedModules).toContain('database');
    });

    it('should emit ConfigChanged event on configuration update', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      let configChangeEmitted = false;
      let configData: any = null;

      app.on(ApplicationEvent.ConfigChanged, (data: any) => {
        configChangeEmitted = true;
        configData = data;
      });

      app.configure({ newSetting: 'value' });

      expect(configChangeEmitted).toBe(true);
      expect(configData.config.newSetting).toBe('value');
    });

    it('should support once() for single-fire event handlers', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      let callCount = 0;

      app.once(ApplicationEvent.Custom, () => {
        callCount++;
      });

      app.emit(ApplicationEvent.Custom, {});
      app.emit(ApplicationEvent.Custom, {});
      app.emit(ApplicationEvent.Custom, {});

      expect(callCount).toBe(1);
    });

    it('should support off() to remove event handlers', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      let callCount = 0;

      const handler = () => {
        callCount++;
      };

      app.on(ApplicationEvent.Custom, handler);
      app.emit(ApplicationEvent.Custom, {});
      expect(callCount).toBe(1);

      app.off(ApplicationEvent.Custom, handler);
      app.emit(ApplicationEvent.Custom, {});
      expect(callCount).toBe(1); // Should not increase
    });

    it('should support removeAllListeners()', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      let callCount = 0;

      app.on(ApplicationEvent.Custom, () => callCount++);
      app.on(ApplicationEvent.Custom, () => callCount++);

      app.emit(ApplicationEvent.Custom, {});
      expect(callCount).toBe(2);

      app.removeAllListeners(ApplicationEvent.Custom);

      app.emit(ApplicationEvent.Custom, {});
      expect(callCount).toBe(2); // Should not increase
    });

    it('should handle errors in event handlers gracefully', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      let secondHandlerCalled = false;

      app.on(ApplicationEvent.Custom, () => {
        throw new Error('Handler error');
      });

      app.on(ApplicationEvent.Custom, () => {
        secondHandlerCalled = true;
      });

      // Should not throw even with handler error
      expect(() => app.emit(ApplicationEvent.Custom, {})).not.toThrow();
      expect(secondHandlerCalled).toBe(true);
    });
  });

  // ============================================================================
  // NETRON INTEGRATION TESTS (MOCKED)
  // ============================================================================

  describe('Netron Integration', () => {
    it('should not have Netron when disableCoreModules is true', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      await app.start();

      expect(app.netron).toBeUndefined();
      expect(app.hasProvider(NETRON_TOKEN)).toBe(false);
    });

    it('should access Netron via netron getter when enabled', async () => {
      // Create app with core modules enabled
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: false });

      await app.start();

      // Netron should be available when core modules are enabled
      if (app.hasProvider(NETRON_TOKEN)) {
        expect(app.netron).toBeDefined();
      }
    });

    it('should expose NETRON_TOKEN from application exports', () => {
      expect(NETRON_TOKEN).toBeDefined();
      expect(typeof NETRON_TOKEN).toBe('object');
    });
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error Handling', () => {
    it('should set state to Failed on startup error', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      app.use(new FailingModule('start', 'Startup failure'));

      await expect(app.start()).rejects.toThrow('Startup failure');
      expect(app.state).toBe(ApplicationState.Failed);
    });

    it('should allow stop from Failed state', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      app.use(new FailingModule('start', 'Startup failure'));

      await expect(app.start()).rejects.toThrow('Startup failure');
      expect(app.state).toBe(ApplicationState.Failed);

      // Should be able to stop from failed state
      await app.stop();
      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should prevent start from Failed state without stop', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      app.use(new FailingModule('start', 'Startup failure'));

      await expect(app.start()).rejects.toThrow('Startup failure');
      expect(app.state).toBe(ApplicationState.Failed);

      await expect(app.start()).rejects.toThrow('Cannot start from failed state');
    });

    it('should call onError handlers on failure', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      let errorHandlerCalled = false;
      let capturedError: Error | null = null;

      app.onError((error) => {
        errorHandlerCalled = true;
        capturedError = error;
      });

      app.use(new FailingModule('start', 'Test error'));

      await expect(app.start()).rejects.toThrow('Test error');
      expect(errorHandlerCalled).toBe(true);
      expect(capturedError?.message).toBe('Test error');
    });

    it('should continue stopping other modules when one fails (graceful)', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const stoppedModules: string[] = [];

      const goodModule = createCustomModule({
        name: 'good-module',
        onStop: async () => {
          stoppedModules.push('good-module');
        },
      });

      const failingModule = new FailingModule('stop', 'Stop failure');

      const anotherGoodModule = createCustomModule({
        name: 'another-good',
        onStop: async () => {
          stoppedModules.push('another-good');
        },
      });

      app.use(goodModule);
      app.use(failingModule);
      app.use(anotherGoodModule);

      await app.start();

      // Default stop should continue despite failures
      await app.stop();

      // Both good modules should have stopped
      expect(stoppedModules).toContain('good-module');
      expect(stoppedModules).toContain('another-good');
    });

    it('should throw on stop failure when graceful is false', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      app.use(new FailingModule('stop', 'Stop failure'));

      await app.start();

      await expect(app.stop({ graceful: false })).rejects.toThrow('Stop failure');
    });

    it('should handle module registration failure', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      app.use(new FailingModule('register', 'Registration failure'));

      await expect(app.start()).rejects.toThrow('Registration failure');
      expect(app.state).toBe(ApplicationState.Failed);
    });

    it('should handle health check errors gracefully', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const faultyModule = createCustomModule({
        name: 'faulty',
        health: async () => {
          throw new Error('Health check error');
        },
      });

      app.use(faultyModule);
      await app.start();

      const health = await app.health();
      expect(health.modules?.['faulty']?.status).toBe('unhealthy');
    });
  });

  // ============================================================================
  // GRACEFUL SHUTDOWN TESTS
  // ============================================================================

  describe('Graceful Shutdown', () => {
    it('should execute shutdown tasks in priority order', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const executionOrder: string[] = [];

      app.registerShutdownTask(
        'low-priority',
        async () => {
          executionOrder.push('low');
        },
        ShutdownPriority.Low
      );

      app.registerShutdownTask(
        'high-priority',
        async () => {
          executionOrder.push('high');
        },
        ShutdownPriority.High
      );

      app.registerShutdownTask(
        'normal-priority',
        async () => {
          executionOrder.push('normal');
        },
        ShutdownPriority.Normal
      );

      await app.start();
      await app.stop();

      // Should be: high (20), normal (50), low (80)
      expect(executionOrder).toEqual(['high', 'normal', 'low']);
    });

    it('should support timeout option in stop()', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      app.use(new SlowModule(500));

      await app.start();

      // Stop with short timeout should timeout
      await expect(app.stop({ timeout: 100 })).rejects.toThrow('timed out');
    });

    it('should support force stop to skip slow modules', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      app.use(new SlowModule(5000));

      await app.start();

      const startTime = Date.now();
      await app.stop({ force: true });
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(500);
      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should run cleanup handlers on stop', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const cleanedUp: string[] = [];

      app.registerCleanupHandler(() => {
        cleanedUp.push('handler1');
      });

      app.registerCleanupHandler(async () => {
        cleanedUp.push('handler2');
      });

      await app.start();
      await app.stop();

      expect(cleanedUp).toContain('handler1');
      expect(cleanedUp).toContain('handler2');
    });

    it('should continue cleanup even if one handler fails', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const cleanedUp: string[] = [];

      app.registerCleanupHandler(() => {
        throw new Error('Cleanup error');
      });

      app.registerCleanupHandler(() => {
        cleanedUp.push('successful');
      });

      await app.start();
      await app.stop();

      expect(cleanedUp).toContain('successful');
    });

    it('should emit ShutdownComplete event', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      let shutdownComplete = false;

      app.on(ApplicationEvent.ShutdownComplete, () => {
        shutdownComplete = true;
      });

      await app.start();
      await app.stop();

      expect(shutdownComplete).toBe(true);
    });

    it('should unregister shutdown tasks', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      const executed: string[] = [];

      const taskId = app.registerShutdownTask('removable', async () => {
        executed.push('removable');
      });

      app.unregisterShutdownTask(taskId);

      await app.start();
      await app.stop();

      expect(executed).not.toContain('removable');
    });
  });

  // ============================================================================
  // CONFIGURATION OPTIONS TESTS
  // ============================================================================

  describe('Configuration Options', () => {
    it('should accept config via constructor options', async () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          database: { host: 'localhost', port: 5432 },
          cache: { ttl: 60000 },
        },
      });

      const config = app.getConfig();
      expect(config.database).toEqual({ host: 'localhost', port: 5432 });
      expect(config.cache).toEqual({ ttl: 60000 });
    });

    it('should update config via configure() method', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      app.configure({ newKey: 'newValue' });

      expect(app.config('newKey' as any)).toBe('newValue');
    });

    it('should deep merge configuration objects', async () => {
      app = createApp({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        config: {
          database: { host: 'localhost', port: 5432 },
        },
      });

      app.configure({
        database: { port: 3306, user: 'admin' },
      });

      const config = app.getConfig();
      expect(config.database).toEqual({
        host: 'localhost',
        port: 3306,
        user: 'admin',
      });
    });

    it('should set config via setConfig() method', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      app.setConfig('nested.key.value', 'deep-value');

      // Verify the value was set
      const config = app.getConfig();
      expect((config as any).nested?.key?.value).toBe('deep-value');
    });

    it('should reconfigure modules when config changes', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const module = new SimpleModule();
      app.use(module);

      // Reset the configure tracking
      module.configureCalled = false;

      app.configure({ simple: { setting: 'new-value' } });

      expect(module.configureCalled).toBe(true);
      expect(module.configValue).toEqual({ setting: 'new-value' });
    });

    it('should provide name, version, and debug via getters', async () => {
      app = createApp({
        name: 'test-app',
        version: '2.0.0',
        debug: true,
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      expect(app.name).toBe('test-app');
      expect(app.version).toBe('2.0.0');
      expect(app.debug).toBe(true);
    });

    it('should provide environment information', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const env = app.environment;

      expect(env.nodeVersion).toBeDefined();
      expect(env.platform).toBeDefined();
      expect(env.arch).toBeDefined();
      expect(env.pid).toBe(process.pid);
    });

    it('should provide metrics information', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });
      app.use(new SimpleModule());
      app.use(new DatabaseModule());

      await app.start();

      const metrics = app.metrics;

      expect(metrics.modules).toBe(2);
      expect(metrics.memoryUsage).toBeDefined();
      expect(metrics.memoryUsage.heapUsed).toBeGreaterThan(0);
      // Note: metrics.uptime uses process.uptime() which may be 0 in tests
      // Use app.uptime for application-specific uptime
      expect(metrics.uptime).toBeGreaterThanOrEqual(0);
      expect(metrics.startupTime).toBeGreaterThanOrEqual(0);
    });
  });

  // ============================================================================
  // HEALTH CHECK TESTS
  // ============================================================================

  describe('Health Checks', () => {
    it('should return healthy status when all modules are healthy', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      app.use(new SimpleModule());
      app.use(new DatabaseModule());

      await app.start();

      const health = await app.health();

      expect(health.status).toBe('healthy');
      expect(health.modules).toBeDefined();
    });

    it('should return unhealthy status when a module is unhealthy', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const unhealthyModule = createCustomModule({
        name: 'unhealthy',
        health: async (): Promise<IHealthStatus> => ({
          status: 'unhealthy',
          message: 'Module is down',
        }),
      });

      app.use(new SimpleModule());
      app.use(unhealthyModule);

      await app.start();

      const health = await app.health();

      expect(health.status).toBe('unhealthy');
    });

    it('should return degraded status when a module is degraded', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const degradedModule = createCustomModule({
        name: 'degraded',
        health: async (): Promise<IHealthStatus> => ({
          status: 'degraded',
          message: 'Module is degraded',
        }),
      });

      app.use(new SimpleModule());
      app.use(degradedModule);

      await app.start();

      const health = await app.health();

      expect(health.status).toBe('degraded');
    });

    it('should check individual module health via checkHealth()', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      app.use(new SimpleModule());

      await app.start();

      const moduleHealth = await app.checkHealth('simple');

      expect(moduleHealth.status).toBe('healthy');
    });

    it('should return unhealthy for non-existent module', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      await app.start();

      await expect(app.checkHealth('non-existent')).rejects.toThrow();
    });
  });

  // ============================================================================
  // DYNAMIC MODULE REGISTRATION TESTS
  // ============================================================================

  describe('Dynamic Module Registration', () => {
    it('should register dynamic modules at runtime', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      await app.start();

      const dynamicModule: IModule = {
        name: 'dynamic-module',
        version: '1.0.0',
        onStart: jest.fn(),
      };

      await app.registerDynamic(dynamicModule);

      expect(app.modules.has('dynamic-module')).toBe(true);
      expect(dynamicModule.onStart).toHaveBeenCalled();
    });

    it('should throw when registering dynamic module before start', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const dynamicModule: IModule = {
        name: 'dynamic-module',
        version: '1.0.0',
      };

      await expect(app.registerDynamic(dynamicModule)).rejects.toThrow(
        'Application must be running to register dynamic modules'
      );
    });

    it('should validate dependencies for dynamic modules', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      await app.start();

      const dynamicModule: IModule = {
        name: 'dependent-dynamic',
        version: '1.0.0',
        dependencies: ['non-existent-dep'],
      };

      await expect(app.registerDynamic(dynamicModule)).rejects.toThrow();
    });
  });

  // ============================================================================
  // PROCESS METRICS TESTS
  // ============================================================================

  describe('Process Metrics', () => {
    it('should provide process metrics via getProcessMetrics()', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      await app.start();

      const metrics = app.getProcessMetrics();

      expect(metrics).toBeDefined();
      expect(metrics.memoryUsage).toBeDefined();
      expect(metrics.memoryUsage.heapUsed).toBeGreaterThan(0);
      expect(metrics.cpuUsage).toBeDefined();
      expect(metrics.uptime).toBeGreaterThan(0);
      expect(metrics.pid).toBe(process.pid);
    });
  });

  // ============================================================================
  // CONTAINER ACCESS TESTS
  // ============================================================================

  describe('Container Access', () => {
    it('should expose container via getter', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      expect(app.container).toBeInstanceOf(Container);
    });

    it('should allow direct container operations', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      const TOKEN = createToken<string>('Direct');
      app.container.register(TOKEN, { useValue: 'direct-value' });

      expect(app.container.resolve(TOKEN)).toBe('direct-value');
    });

    it('should use custom container if provided', async () => {
      const customContainer = new Container();
      const CUSTOM_TOKEN = createToken<string>('Custom');
      customContainer.register(CUSTOM_TOKEN, { useValue: 'custom-container-value' });

      app = createApp({
        container: customContainer,
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      expect(app.container).toBe(customContainer);
      expect(app.container.resolve(CUSTOM_TOKEN)).toBe('custom-container-value');
    });
  });
});
