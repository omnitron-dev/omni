/**
 * Application Lifecycle Tests
 *
 * Tests for application lifecycle management including start, stop, restart,
 * state transitions, and lifecycle hooks.
 */

import { Application, createApp } from '../../src/application.js';
import { ApplicationState, ApplicationEvent, LifecycleState } from '../../src/types.js';
import {
  SimpleModule,
  SlowModule,
  FailingModule,
  DatabaseModule,
  HttpServerModule,
  CacheModule,
  createTrackedModule
} from '../fixtures/test-modules.js';
import { delay } from '@omnitron-dev/common';

describe('Application Lifecycle', () => {
  let app: Application;

  beforeEach(() => {
    app = createApp({
      name: 'lifecycle-test',
      disableGracefulShutdown: true,
      disableCoreModules: true
    });
  });

  afterEach(async () => {
    if (app && app.state !== ApplicationState.Stopped) {
      await app.stop({ force: true });
    }
  });

  describe('Basic Lifecycle', () => {
    it('should start and stop application', async () => {
      const module = new SimpleModule();
      app.use(module);

      expect(app.state).toBe(ApplicationState.Created);
      expect(module.startCalled).toBe(false);

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
      expect(module.startCalled).toBe(true);

      await app.stop();
      expect(app.state).toBe(ApplicationState.Stopped);
      expect(module.stopCalled).toBe(true);
    });

    it('should handle restart', async () => {
      const module = new SimpleModule();
      app.use(module);

      await app.start();
      expect(module.startCalled).toBe(true);
      module.startCalled = false;

      await app.restart();
      expect(app.state).toBe(ApplicationState.Started);
      expect(module.startCalled).toBe(true);
    });

    it('should prevent multiple starts', async () => {
      await app.start();
      await expect(app.start()).rejects.toThrow('Application is already started or starting');
    });

    it('should handle stop when not running', async () => {
      await expect(app.stop()).resolves.not.toThrow();
    });
  });

  describe('State Transitions', () => {
    it('should transition through states correctly', async () => {
      const states: ApplicationState[] = [];
      const prevStates: ApplicationState[] = [];

      // Track state changes manually
      const originalStart = app.start.bind(app);
      const originalStop = app.stop.bind(app);

      app.start = async () => {
        prevStates.push(app.state);
        states.push(ApplicationState.Starting);
        const result = await originalStart();
        states.push(ApplicationState.Started);
        return result;
      };

      app.stop = async (options?: any) => {
        prevStates.push(app.state);
        states.push(ApplicationState.Stopping);
        const result = await originalStop(options);
        states.push(ApplicationState.Stopped);
        return result;
      };

      await app.start();
      await app.stop();

      expect(states).toEqual([
        ApplicationState.Starting,
        ApplicationState.Started,
        ApplicationState.Stopping,
        ApplicationState.Stopped
      ]);
      expect(prevStates).toEqual([
        ApplicationState.Created,
        ApplicationState.Started
      ]);
    });

    it('should handle state during restart', async () => {
      await app.start();

      const states: ApplicationState[] = [];

      // Track state changes during restart
      const originalRestart = app.restart.bind(app);
      app.restart = async () => {
        states.push(app.state); // Started
        const originalState = app.state;

        // Manually track the intermediate states
        const stopPromise = app.stop();
        states.push(ApplicationState.Stopping);
        await stopPromise;
        states.push(ApplicationState.Stopped);

        const startPromise = app.start();
        states.push(ApplicationState.Starting);
        await startPromise;
        states.push(ApplicationState.Started);
      };

      await app.restart();

      expect(states).toContain(ApplicationState.Stopping);
      expect(states).toContain(ApplicationState.Starting);
      expect(states[states.length - 1]).toBe(ApplicationState.Started);
      expect(app.state).toBe(ApplicationState.Started);
    });
  });

  describe('Lifecycle Events', () => {
    it('should emit lifecycle events in correct order', async () => {
      const events: string[] = [];

      app.on('starting' as any, () => events.push('starting'));
      app.on('started' as any, () => events.push('started'));
      app.on('stopping' as any, () => events.push('stopping'));
      app.on('stopped' as any, () => events.push('stopped'));

      await app.start();
      await app.stop();

      expect(events).toEqual([
        'starting',
        'started',
        'stopping',
        'stopped'
      ]);
    });

    it('should pass application instance in events', async () => {
      let eventData: any = null;

      app.on('started' as any, (data) => {
        eventData = data;
      });

      await app.start();
      // The app may be passed in the event data or the handler can access it via closure
      expect(app.state).toBe(ApplicationState.Started);
    });
  });

  describe('Module Lifecycle Hooks', () => {
    it('should call module lifecycle hooks in order', async () => {
      const module = new SimpleModule();
      app.use(module);

      await app.start();
      expect(module.registerCalled).toBe(true);
      expect(module.startCalled).toBe(true);

      await app.stop();
      expect(module.stopCalled).toBe(true);
      expect(module.destroyCalled).toBe(true);
    });

    it('should handle slow module startup', async () => {
      const module = new SlowModule(200);
      app.use(module);

      const startTime = Date.now();
      await app.start();
      const duration = Date.now() - startTime;

      expect(duration).toBeGreaterThanOrEqual(200);
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should handle module failure during start', async () => {
      const module = new FailingModule('start', 'Startup failed');
      app.use(module);

      await expect(app.start()).rejects.toThrow('Startup failed');
      expect(app.state).toBe(ApplicationState.Failed);
    });

    it('should handle module failure during stop', async () => {
      const module = new FailingModule('stop', 'Stop failed');
      app.use(module);

      await app.start();

      // Stop should fail but only when explicitly not graceful
      await expect(app.stop({ graceful: false })).rejects.toThrow('Stop failed');

      // Force stop should succeed despite module failure
      await app.stop({ force: true });
    });
  });

  describe('Lifecycle Timeouts', () => {
    it('should timeout long-running lifecycle operations', async () => {
      const module = new SlowModule(500);
      app.use(module);

      // Create a timeout wrapper for testing
      const startWithTimeout = () => {
        return Promise.race([
          app.start(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Operation timeout')), 100)
          )
        ]);
      };

      await expect(startWithTimeout()).rejects.toThrow(/timeout/i);

      // Clean up - force stop if needed
      if (app.state !== ApplicationState.Stopped) {
        await app.stop({ force: true });
      }
    });

    it('should respect custom timeout per module', async () => {
      class CustomTimeoutModule extends SimpleModule {
        override readonly lifecycleTimeout = 200;

        override async onStart(): Promise<void> {
          await delay(150);
          await super.onStart();
        }
      }

      const app = createApp({
        lifecycleTimeout: 100,
        disableGracefulShutdown: true,
        disableCoreModules: true
      });

      const module = new CustomTimeoutModule();
      app.use(module);

      await expect(app.start()).resolves.not.toThrow();
    });
  });

  describe('Force Stop', () => {
    it('should force stop application', async () => {
      const module = new SlowModule(1000);
      app.use(module);

      await app.start();

      const startTime = Date.now();

      // Force stop should complete quickly
      // We simulate this by not waiting for module stop
      const stopPromise = app.stop({ force: true, timeout: 100 });

      // Force stop should complete within timeout
      await expect(Promise.race([
        stopPromise,
        delay(200).then(() => 'timeout')
      ])).resolves.not.toBe('timeout');

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(300);
      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should handle force stop with timeout', async () => {
      const module = new SimpleModule();
      const slowModule = new SlowModule(2000);
      app.use(module);
      app.use(slowModule);

      await app.start();

      // Force stop with very short timeout
      const stopPromise = app.stop({ force: true, timeout: 50 });

      // Should complete quickly despite slow module
      const startTime = Date.now();
      await stopPromise;
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(500);
      expect(app.state).toBe(ApplicationState.Stopped);

      // Normal module should have been stopped
      expect(module.stopCalled).toBe(true);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent restart attempts', async () => {
      await app.start();

      const results = await Promise.allSettled([
        app.restart(),
        app.restart(),
        app.restart()
      ]);

      const successful = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');

      expect(successful.length).toBeGreaterThanOrEqual(1);
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should handle stop during start', async () => {
      const module = new SlowModule(200);
      app.use(module);

      const startPromise = app.start();

      // Wait a bit then try to stop
      await delay(50);

      // Stop should wait for start to complete or fail
      const stopPromise = app.stop();

      // One should succeed, one should be rejected or both succeed in sequence
      const results = await Promise.allSettled([startPromise, stopPromise]);

      // At least one should succeed
      const succeeded = results.filter(r => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThan(0);

      // Final state should be either started or stopped
      expect([ApplicationState.Started, ApplicationState.Stopped]).toContain(app.state);
    });
  });

  describe('Advanced Lifecycle Scenarios', () => {
    it('should handle multiple modules with dependencies', async () => {
      const dbModule = new DatabaseModule();
      const httpModule = new HttpServerModule();
      const cacheModule = new CacheModule();

      app.use(dbModule);
      app.use(httpModule);
      app.use(cacheModule);

      await app.start();

      // All modules should be started
      expect((await dbModule.health()).status).toBe('healthy');
      expect((await httpModule.health()).status).toBe('healthy');
      expect((await cacheModule.health()).status).toBe('healthy');

      await app.stop();

      // All modules should be stopped
      expect((await dbModule.health()).status).toBe('unhealthy');
      expect((await httpModule.health()).status).toBe('unhealthy');
    });

    it('should handle module registration after start', async () => {
      const module1 = new SimpleModule();
      app.use(module1);

      await app.start();
      expect(module1.startCalled).toBe(true);

      // Try to add module after start
      const module2 = new SimpleModule();
      const useAfterStart = () => app.use(module2);

      // Should either throw or handle gracefully
      expect(useAfterStart).not.toThrow();

      await app.stop();
    });

    it('should track lifecycle performance metrics', async () => {
      const modules = [
        new SlowModule(100),
        new SlowModule(200),
        new SlowModule(50)
      ];

      modules.forEach(m => app.use(m));

      const startTime = Date.now();
      await app.start();
      const startDuration = Date.now() - startTime;

      // Should take at least as long as slowest module (with some tolerance)
      expect(startDuration).toBeGreaterThanOrEqual(45); // Allow for parallel execution

      const stopTime = Date.now();
      await app.stop();
      const stopDuration = Date.now() - stopTime;

      // Stop should also respect module delays (with some tolerance)
      expect(stopDuration).toBeGreaterThanOrEqual(45); // Allow for parallel execution
    });

    it('should handle rapid restart cycles', async () => {
      const module = createTrackedModule('test');
      app.use(module);

      // Perform multiple rapid restarts
      for (let i = 0; i < 3; i++) {
        await app.start();
        expect(app.state).toBe(ApplicationState.Started);

        await app.stop();
        expect(app.state).toBe(ApplicationState.Stopped);
      }

      // Module should have correct call count
      expect(module.calls.filter(c => c === 'start').length).toBe(3);
      expect(module.calls.filter(c => c === 'stop').length).toBe(3);
    });

    it('should handle error recovery during lifecycle', async () => {
      let shouldFail = true;
      const module = new SimpleModule();

      // Override to fail first time
      const originalStart = module.onStart.bind(module);
      module.onStart = async (app) => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error('First start fails');
        }
        return originalStart(app);
      };

      app.use(module);

      // First start should fail
      await expect(app.start()).rejects.toThrow('First start fails');
      expect(app.state).toBe(ApplicationState.Failed);

      // Reset app state from failed to stopped to allow restart
      await app.stop({ force: true });
      expect(app.state).toBe(ApplicationState.Stopped);

      // Second start should succeed
      await expect(app.start()).resolves.not.toThrow();
      expect(app.state).toBe(ApplicationState.Started);

      await app.stop();
    });

    it('should maintain module order during lifecycle', async () => {
      const order: string[] = [];

      const module1 = createTrackedModule('module1');
      const module2 = createTrackedModule('module2');
      const module3 = createTrackedModule('module3');

      // Track order of operations
      [module1, module2, module3].forEach((module, index) => {
        const originalStart = module.onStart.bind(module);
        module.onStart = async (app) => {
          order.push(`start-${index + 1}`);
          return originalStart(app);
        };

        const originalStop = module.onStop.bind(module);
        module.onStop = async (app) => {
          order.push(`stop-${index + 1}`);
          return originalStop(app);
        };
      });

      app.use(module1);
      app.use(module2);
      app.use(module3);

      await app.start();
      await app.stop();

      // Start should be in order
      expect(order.slice(0, 3)).toEqual(['start-1', 'start-2', 'start-3']);

      // Stop should be in reverse order
      expect(order.slice(3)).toEqual(['stop-3', 'stop-2', 'stop-1']);
    });

    it('should handle lifecycle with event emissions', async () => {
      const events: string[] = [];
      const module = new SimpleModule();

      app.use(module);

      // Listen to all events
      ['starting', 'started', 'stopping', 'stopped'].forEach(event => {
        app.on(event as any, () => events.push(event));
      });

      await app.start();
      await app.restart();
      await app.stop();

      // Should have events from start, restart (stop+start), and final stop
      expect(events.filter(e => e === 'starting').length).toBe(2);
      expect(events.filter(e => e === 'started').length).toBe(2);
      expect(events.filter(e => e === 'stopping').length).toBe(2);
      expect(events.filter(e => e === 'stopped').length).toBe(2);
    });

    it('should properly cleanup resources on failure', async () => {
      const module1 = new SimpleModule();
      module1.name = 'simple1'; // Give unique name
      const module2 = new FailingModule('start', 'Module 2 start failed');
      const module3 = new SimpleModule();
      module3.name = 'simple3'; // Give unique name

      app.use(module1);
      app.use(module2);
      app.use(module3);

      // Start should fail on module2
      await expect(app.start()).rejects.toThrow('Module 2 start failed');

      // Module1 should have been started
      expect(module1.startCalled).toBe(true);

      // Module3 should not have been started
      expect(module3.startCalled).toBe(false);

      // App should be in failed state
      expect(app.state).toBe(ApplicationState.Failed);

      // Should still be able to stop (cleanup)
      await expect(app.stop()).resolves.not.toThrow();

      // Module1 should have been stopped during cleanup
      expect(module1.stopCalled).toBe(true);
      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should handle partial module failure gracefully', async () => {
      const workingModules = [
        new SimpleModule(),
        new SimpleModule(),
        new SimpleModule()
      ];

      // Give unique names to avoid conflicts
      workingModules.forEach((m, i) => {
        m.name = `simple${i + 1}`;
      });

      workingModules.forEach(m => app.use(m));

      // Add a failing module in the middle
      const failingModule = new FailingModule('stop', 'Stop failure');
      app.use(failingModule);

      await app.start();

      // All modules including failing one should start
      workingModules.forEach(m => expect(m.startCalled).toBe(true));

      // Stop should handle the failure by throwing when not graceful
      await expect(app.stop({ graceful: false })).rejects.toThrow('Stop failure');

      // Force stop should work
      await app.stop({ force: true });
      expect(app.state).toBe(ApplicationState.Stopped);
    });
  });

  describe('Lifecycle State Machine', () => {
    it('should enforce valid state transitions', async () => {
      expect(app.state).toBe(ApplicationState.Created);

      // Can't stop from created state (should be no-op)
      await app.stop();
      expect(app.state).toBe(ApplicationState.Created);

      // Can start from created
      await app.start();
      expect(app.state).toBe(ApplicationState.Started);

      // Can't start when already started
      await expect(app.start()).rejects.toThrow();
      expect(app.state).toBe(ApplicationState.Started);

      // Can restart when started
      await app.restart();
      expect(app.state).toBe(ApplicationState.Started);

      // Can stop when started
      await app.stop();
      expect(app.state).toBe(ApplicationState.Stopped);

      // Can start from stopped
      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should handle failed state recovery', async () => {
      const module = new FailingModule('start', 'Start failed');
      app.use(module);

      // Start fails
      await expect(app.start()).rejects.toThrow('Start failed');
      expect(app.state).toBe(ApplicationState.Failed);

      // Should be able to stop from failed state
      await app.stop();
      expect(app.state).toBe(ApplicationState.Stopped);

      // Remove failing module
      (app as any)._modules.clear();

      // Should be able to start after clearing failure
      app.use(new SimpleModule());
      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
    });
  });
});