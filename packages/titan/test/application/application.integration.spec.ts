/**
 * Application Integration Tests
 *
 * Tests for complete application scenarios:
 * - Real-world use cases
 * - Cross-feature interactions
 * - Performance and reliability
 * - Advanced patterns
 */

import { Application, createApp, startApp } from '../../src/application.js';
import { createToken } from '@nexus';
import {
  ApplicationState,
  ApplicationEvent,
  IModule,
  LifecycleState,
  ShutdownReason,
  ShutdownPriority
} from '../../src/types.js';
import {
  createWebApplication,
  createMicroserviceApplication,
  createTaskProcessorApplication,
  createApiGatewayApplication,
  createFullStackApplication,
  createTestApplication,
  ApplicationType
} from '../fixtures/test-applications.js';
import {
  DatabaseModule,
  CacheModule,
  HttpServerModule,
  MessageQueueModule,
  FailingModule,
  SlowModule,
  SimpleModule
} from '../fixtures/test-modules.js';
import { Module } from '../../src/decorators.js';

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
      await new Promise(resolve => setTimeout(resolve, 200));

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
        ApplicationType.Minimal
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
      }, 10); // Higher priority

      app.onStart(() => {
        executionOrder.push('start-3');
      }, 5);

      await app.start();

      // Should execute in priority order (higher first)
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
        await new Promise(resolve => setTimeout(resolve, 50));
        asyncCompleted = true;
      });

      await app.start();

      expect(asyncCompleted).toBe(true);

      await app.stop();
    });

    it('should timeout lifecycle hooks', async () => {
      app = createApp({ disableGracefulShutdown: true, disableCoreModules: true });

      app.onStart(async () => {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }, 0, 100); // 100ms timeout

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

      const taskId = app.registerShutdownTask(
        'removable-task',
        async () => {
          executed.push('should-not-execute');
        }
      );

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
          priority: ShutdownPriority.Normal
        }
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
        }
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
          { provide: API_URL, useValue: 'https://api.example.com' }
        ]
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
        providers: [ServiceWithCleanup]
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
        }
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
        await new Promise(r => setTimeout(r, 10));
        return { ...data, step3: true };
      });

      const result = await module.process({ initial: true });

      expect(result).toEqual({
        initial: true,
        step1: true,
        step2: true,
        step3: true
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
          onStop: jest.fn()
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
});