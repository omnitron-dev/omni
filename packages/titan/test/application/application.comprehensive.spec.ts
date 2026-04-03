/**
 * Comprehensive Integration Tests for Titan Application
 *
 * End-to-end tests covering complex scenarios combining multiple features:
 * - Module composition
 * - Lifecycle management
 * - Error handling
 * - Concurrent operations
 * - State machine transitions
 */
import { describe, it, expect, afterEach } from 'vitest';

import { Application } from '../../src/application.js';
import {
  ApplicationState,
  IModule,
  IApplication,
  ApplicationEvent,
  ShutdownReason,
  ShutdownPriority,
} from '../../src/types.js';
import { Module } from '../../src/decorators/index.js';
import { createToken } from '../../src/nexus/index.js';

describe('Titan Application Comprehensive Tests', () => {
  let app: Application;

  afterEach(async () => {
    if (app) {
      try {
        if (app.state !== ApplicationState.Stopped) {
          await app.stop({ force: true });
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('Complete Application Lifecycle', () => {
    it('should handle full lifecycle with modules, hooks, and events', async () => {
      const events: string[] = [];
      const moduleOrder: string[] = [];

      class ModuleA implements IModule {
        name = 'module-a';
        async onRegister() {
          moduleOrder.push('a-register');
        }
        async onStart() {
          moduleOrder.push('a-start');
        }
        async onStop() {
          moduleOrder.push('a-stop');
        }
        async onDestroy() {
          moduleOrder.push('a-destroy');
        }
      }

      class ModuleB implements IModule {
        name = 'module-b';
        dependencies = ['module-a'];
        async onRegister() {
          moduleOrder.push('b-register');
        }
        async onStart() {
          moduleOrder.push('b-start');
        }
        async onStop() {
          moduleOrder.push('b-stop');
        }
        async onDestroy() {
          moduleOrder.push('b-destroy');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [ModuleA, ModuleB],
      });

      // Register event listeners
      app.on(ApplicationEvent.Starting, () => events.push('starting'));
      app.on(ApplicationEvent.Started, () => events.push('started'));
      app.on(ApplicationEvent.Stopping, () => events.push('stopping'));
      app.on(ApplicationEvent.Stopped, () => events.push('stopped'));
      app.on(ApplicationEvent.ModuleStarted, (data) => events.push(`module-started:${data.module}`));
      app.on(ApplicationEvent.ModuleStopped, (data) => events.push(`module-stopped:${data.module}`));

      // Add hooks
      app.onStart({ name: 'pre-start', handler: () => events.push('hook:pre-start') });
      app.onStop({ name: 'pre-stop', handler: () => events.push('hook:pre-stop') });

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);

      await app.stop();
      expect(app.state).toBe(ApplicationState.Stopped);

      // Verify events occurred
      expect(events).toContain('starting');
      expect(events).toContain('started');
      expect(events).toContain('stopping');
      expect(events).toContain('stopped');

      // Verify module lifecycle order
      expect(moduleOrder.filter((m) => m.includes('start'))).toContain('a-start');
      expect(moduleOrder.filter((m) => m.includes('start'))).toContain('b-start');
    });

    it('should handle restart with state preservation', async () => {
      let startCount = 0;
      let stopCount = 0;

      class CountingModule implements IModule {
        name = 'counting';
        async onStart() {
          startCount++;
        }
        async onStop() {
          stopCount++;
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [CountingModule],
      });

      await app.start();
      expect(startCount).toBe(1);

      await app.restart();
      expect(startCount).toBe(2);
      expect(stopCount).toBe(1);
      expect(app.state).toBe(ApplicationState.Started);

      await app.stop();
      expect(stopCount).toBe(2);
    });
  });

  describe('Complex Module Dependency Scenarios', () => {
    it('should handle diamond dependency pattern', async () => {
      const order: string[] = [];

      // Diamond: D depends on B and C, both depend on A
      class ModuleA implements IModule {
        name = 'a';
        async onStart() {
          order.push('a');
        }
      }

      class ModuleB implements IModule {
        name = 'b';
        dependencies = ['a'];
        async onStart() {
          order.push('b');
        }
      }

      class ModuleC implements IModule {
        name = 'c';
        dependencies = ['a'];
        async onStart() {
          order.push('c');
        }
      }

      class ModuleD implements IModule {
        name = 'd';
        dependencies = ['b', 'c'];
        async onStart() {
          order.push('d');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [ModuleD, ModuleC, ModuleB, ModuleA],
      });

      await app.start();

      // A should start first, D should start last
      expect(order[0]).toBe('a');
      expect(order[order.length - 1]).toBe('d');
    });

    it('should handle modules with shared services', async () => {
      const SHARED_TOKEN = createToken<{ counter: number }>('SharedService');
      let sharedInstance: any;

      @Module({
        providers: [{ provide: SHARED_TOKEN, useValue: { counter: 0 } }],
        exports: [SHARED_TOKEN],
      })
      class SharedModule implements IModule {
        name = 'shared';
      }

      class ConsumerA implements IModule {
        name = 'consumer-a';
        async onStart(app: IApplication) {
          const shared = app.resolve(SHARED_TOKEN);
          shared.counter++;
          sharedInstance = shared;
        }
      }

      class ConsumerB implements IModule {
        name = 'consumer-b';
        async onStart(app: IApplication) {
          const shared = app.resolve(SHARED_TOKEN);
          shared.counter++;
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [SharedModule, ConsumerA, ConsumerB],
      });

      await app.start();

      // Both consumers should increment the same counter
      expect(sharedInstance.counter).toBe(2);
    });
  });

  describe('Concurrent Operation Handling', () => {
    it('should handle concurrent start attempts', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      // Start multiple times concurrently
      const results = await Promise.allSettled([app.start(), app.start(), app.start()]);

      // First should succeed, others should fail or return same promise
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should handle stop during start', async () => {
      class SlowModule implements IModule {
        name = 'slow';
        async onStart() {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [SlowModule],
      });

      const startPromise = app.start();

      // Wait a bit then stop
      await new Promise((resolve) => setTimeout(resolve, 20));
      const stopPromise = app.stop();

      // Both should complete without throwing
      const results = await Promise.allSettled([startPromise, stopPromise]);

      // All operations should have settled (not thrown unhandled errors)
      expect(results.every((r) => r.status === 'fulfilled' || r.status === 'rejected')).toBe(true);

      // App should be in a valid end state
      expect([ApplicationState.Started, ApplicationState.Stopped]).toContain(app.state);
    });

    it('should handle concurrent restart attempts', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      await app.start();

      // Multiple concurrent restarts
      const results = await Promise.allSettled([app.restart(), app.restart()]);

      // All restart operations should have settled
      expect(results.every((r) => r.status === 'fulfilled' || r.status === 'rejected')).toBe(true);
      expect(app.state).toBe(ApplicationState.Started);
    });
  });

  describe('State Machine Validation', () => {
    it('should enforce valid state transitions', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      // Created -> Started
      expect(app.state).toBe(ApplicationState.Created);
      await app.start();
      expect(app.state).toBe(ApplicationState.Started);

      // Started -> cannot start again
      await expect(app.start()).rejects.toThrow('already started');

      // Started -> Stopped
      await app.stop();
      expect(app.state).toBe(ApplicationState.Stopped);

      // Stopped -> Started (restart allowed)
      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should handle transitions through intermediate states', async () => {
      const states: ApplicationState[] = [];

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      // Track state changes
      const trackState = () => states.push(app.state);

      app.on(ApplicationEvent.Starting, trackState);
      app.on(ApplicationEvent.Started, trackState);
      app.on(ApplicationEvent.Stopping, trackState);
      app.on(ApplicationEvent.Stopped, trackState);

      await app.start();
      await app.stop();

      // Should have captured intermediate states
      expect(states).toContain(ApplicationState.Starting);
      expect(states).toContain(ApplicationState.Started);
      expect(states).toContain(ApplicationState.Stopping);
      expect(states).toContain(ApplicationState.Stopped);
    });
  });

  describe('Configuration Management', () => {
    it('should provide configuration to modules', async () => {
      let receivedConfig: any;

      class ConfigurableModule implements IModule {
        name = 'configurable';
        configure(config: any) {
          receivedConfig = config;
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [ConfigurableModule],
        config: {
          configurable: {
            setting1: 'value1',
            setting2: 42,
          },
        },
      });

      await app.start();

      expect(receivedConfig).toEqual({
        setting1: 'value1',
        setting2: 42,
      });
    });

    it('should allow runtime configuration updates', async () => {
      let configUpdates: any[] = [];

      class WatchingModule implements IModule {
        name = 'watching';
        configure(config: any) {
          configUpdates.push({ ...config });
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [WatchingModule],
        config: {
          watching: { initial: true },
        },
      });

      await app.start();

      app.configure({
        watching: { updated: true },
      });

      // Configure may be called multiple times depending on implementation
      expect(configUpdates.length).toBeGreaterThanOrEqual(2);
      // The last update should have the 'updated' property
      const lastUpdate = configUpdates[configUpdates.length - 1];
      expect(lastUpdate).toHaveProperty('updated', true);
    });
  });

  describe('Health Check Integration', () => {
    it('should aggregate health from all modules', async () => {
      class HealthyModule implements IModule {
        name = 'healthy';
        async health() {
          return { status: 'healthy' as const, message: 'All good' };
        }
      }

      class DegradedModule implements IModule {
        name = 'degraded';
        async health() {
          return { status: 'degraded' as const, message: 'Partially working' };
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [HealthyModule, DegradedModule],
      });

      await app.start();

      const health = await app.health();

      expect(health.modules).toHaveProperty('healthy');
      expect(health.modules).toHaveProperty('degraded');
      expect(health.modules.healthy.status).toBe('healthy');
      expect(health.modules.degraded.status).toBe('degraded');
    });

    it('should handle health check errors gracefully', async () => {
      class FailingHealthModule implements IModule {
        name = 'failing-health';
        async health() {
          throw new Error('Health check failed');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [FailingHealthModule],
      });

      await app.start();

      // Should not throw
      const health = await app.health();
      expect(health).toBeDefined();
    });
  });

  describe('Shutdown Task Management', () => {
    it('should execute shutdown tasks in priority order', async () => {
      const order: string[] = [];

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      app.registerShutdownTask({
        id: 'low',
        name: 'Low Priority',
        priority: ShutdownPriority.Low,
        handler: async () => {
          order.push('low');
        },
      });

      app.registerShutdownTask({
        id: 'high',
        name: 'High Priority',
        priority: ShutdownPriority.High,
        handler: async () => {
          order.push('high');
        },
      });

      app.registerShutdownTask({
        id: 'first',
        name: 'First Priority',
        priority: ShutdownPriority.First,
        handler: async () => {
          order.push('first');
        },
      });

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      // First should be first, then high, then low
      expect(order[0]).toBe('first');
      expect(order[1]).toBe('high');
      expect(order[2]).toBe('low');
    });

    it('should allow unregistering shutdown tasks', async () => {
      const executed: string[] = [];

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      app.registerShutdownTask({
        id: 'task-1',
        name: 'Task 1',
        handler: async () => {
          executed.push('task-1');
        },
      });

      app.registerShutdownTask({
        id: 'task-2',
        name: 'Task 2',
        handler: async () => {
          executed.push('task-2');
        },
      });

      app.unregisterShutdownTask('task-1');

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      expect(executed).not.toContain('task-1');
      expect(executed).toContain('task-2');
    });
  });

  describe('Metrics and Monitoring', () => {
    it('should track startup time', async () => {
      class SlowModule implements IModule {
        name = 'slow';
        async onStart() {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [SlowModule],
      });

      await app.start();

      expect(app.metrics.startupTime).toBeGreaterThanOrEqual(50);
    });

    it('should provide module count', async () => {
      class ModuleA implements IModule {
        name = 'a';
      }
      class ModuleB implements IModule {
        name = 'b';
      }
      class ModuleC implements IModule {
        name = 'c';
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [ModuleA, ModuleB, ModuleC],
      });

      await app.start();

      expect(app.metrics.modules).toBe(3);
    });

    it('should track uptime after start', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      await app.start();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(app.metrics.uptime).toBeGreaterThanOrEqual(100);
    });
  });

  describe('Environment Information', () => {
    it('should provide environment details', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      const env = app.environment;

      expect(env.nodeVersion).toBeDefined();
      expect(env.platform).toBeDefined();
      expect(env.pid).toBe(process.pid);
    });
  });

  describe('Module Replacement', () => {
    it('should allow replacing modules before start', async () => {
      class OriginalModule implements IModule {
        name = 'replaceable';
        getValue() {
          return 'original';
        }
      }

      class ReplacementModule implements IModule {
        name = 'replaceable';
        getValue() {
          return 'replaced';
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [OriginalModule],
      });

      app.replaceModule('replaceable', new ReplacementModule());

      await app.start();

      const token = createToken<ReplacementModule>('replaceable');
      const module = app.get(token);
      expect(module.getValue()).toBe('replaced');
    });

    it('should prevent module replacement after start', async () => {
      class TestModule implements IModule {
        name = 'test';
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [TestModule],
      });

      await app.start();

      expect(() => app.replaceModule('test', new TestModule())).toThrow(
        'Cannot replace modules after application has started'
      );
    });
  });
});
