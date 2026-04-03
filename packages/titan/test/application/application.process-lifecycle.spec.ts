/**
 * Process Lifecycle Management Tests for Titan Application
 *
 * Tests for advanced process lifecycle scenarios including:
 * - Concurrent shutdown prevention
 * - Signal handler management
 * - Process metrics during lifecycle states
 * - Cleanup handler execution
 * - Shutdown timeout handling
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Application } from '../../src/application.js';
import {
  ApplicationState,
  ApplicationEvent,
  ShutdownReason,
  ShutdownPriority,
  LifecycleState,
  IModule,
} from '../../src/types.js';

describe('Application Process Lifecycle Management', () => {
  let app: Application;

  beforeEach(() => {
    // Clear any global shutdown tasks
    if (global.__titanShutdownTasks) {
      delete global.__titanShutdownTasks;
    }
  });

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

  describe('Concurrent Shutdown Prevention', () => {
    it('should prevent multiple concurrent shutdowns', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: false,
        environment: 'test',
      });

      await app.start();

      // Start two shutdowns concurrently
      const shutdown1 = app.shutdown(ShutdownReason.Manual);
      const shutdown2 = app.shutdown(ShutdownReason.Manual);

      // Both should resolve without error
      await Promise.all([shutdown1, shutdown2]);

      // App should be stopped
      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should await existing shutdown if already in progress', async () => {
      const executionOrder: string[] = [];

      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: false,
        environment: 'test',
      });

      app.registerShutdownTask({
        id: 'slow-task',
        name: 'Slow Task',
        priority: ShutdownPriority.High,
        handler: async () => {
          executionOrder.push('slow-start');
          await new Promise((resolve) => setTimeout(resolve, 100));
          executionOrder.push('slow-end');
        },
      });

      await app.start();

      // Start shutdown
      const shutdown1 = app.shutdown(ShutdownReason.Manual);

      // Wait a bit then try second shutdown
      await new Promise((resolve) => setTimeout(resolve, 20));
      const shutdown2 = app.shutdown(ShutdownReason.Manual);

      await Promise.all([shutdown1, shutdown2]);

      // Task should only execute once
      expect(executionOrder.filter((e) => e === 'slow-start')).toHaveLength(1);
      expect(executionOrder.filter((e) => e === 'slow-end')).toHaveLength(1);
    });
  });

  describe('Process Metrics Throughout Lifecycle', () => {
    it('should track metrics before start', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      const metrics = app.getProcessMetrics();

      expect(metrics.pid).toBe(process.pid);
      expect(metrics.ppid).toBe(process.ppid);
      expect(metrics.platform).toBe(process.platform);
      expect(metrics.nodeVersion).toBe(process.version);
      expect(metrics.state).toBe(LifecycleState.Created);
      expect(metrics.shutdownTasksCount).toBeGreaterThanOrEqual(0);
      expect(metrics.cleanupHandlersCount).toBeGreaterThanOrEqual(0);
    });

    it('should update metrics during runtime', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: false,
        environment: 'test',
      });

      await app.start();

      // Wait a bit for uptime to increase
      await new Promise((resolve) => setTimeout(resolve, 50));

      const metrics = app.getProcessMetrics();

      expect(metrics.uptime).toBeGreaterThanOrEqual(50);
      expect(metrics.memoryUsage.rss).toBeGreaterThan(0);
      expect(metrics.memoryUsage.heapUsed).toBeGreaterThan(0);
      expect(metrics.memoryUsage.heapTotal).toBeGreaterThan(0);
    });

    it('should track shutdown tasks and cleanup handlers count', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: false,
        environment: 'test',
      });

      const initialMetrics = app.getProcessMetrics();
      const initialTasks = initialMetrics.shutdownTasksCount;
      const initialCleanup = initialMetrics.cleanupHandlersCount;

      // Register additional tasks and handlers
      app.registerShutdownTask({
        id: 'test-task-1',
        name: 'Test 1',
        handler: () => {},
      });

      app.registerShutdownTask({
        id: 'test-task-2',
        name: 'Test 2',
        handler: () => {},
      });

      app.registerCleanup(() => {});
      app.registerCleanupHandler(() => {}); // Test alias

      const afterMetrics = app.getProcessMetrics();

      expect(afterMetrics.shutdownTasksCount).toBe(initialTasks + 2);
      expect(afterMetrics.cleanupHandlersCount).toBe(initialCleanup + 2);
    });
  });

  describe('Shutdown Task Edge Cases', () => {
    it('should handle task with timeout', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: false,
        environment: 'test',
      });

      let taskCompleted = false;

      app.registerShutdownTask({
        id: 'timeout-task',
        name: 'Timeout Task',
        timeout: 500,
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 50));
          taskCompleted = true;
        },
      });

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      expect(taskCompleted).toBe(true);
    });

    it('should handle task timeout exceeding limit', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: false,
        environment: 'test',
        gracefulShutdownTimeout: 5000, // Long enough for the test
      });

      const events: string[] = [];

      app.on(ApplicationEvent.ShutdownTaskError, (data) => {
        events.push(`error:${data.task}`);
      });

      app.registerShutdownTask({
        id: 'slow-timeout-task',
        name: 'Slow Timeout Task',
        timeout: 50,
        handler: async () => {
          // Takes longer than timeout
          await new Promise((resolve) => setTimeout(resolve, 200));
        },
      });

      await app.start();

      // Should not throw for non-critical task
      await app.shutdown(ShutdownReason.Manual);

      expect(events).toContain('error:Slow Timeout Task');
    });

    it('should execute tasks registered with multi-parameter API', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: false,
        environment: 'test',
      });

      let taskExecuted = false;

      // Use multi-parameter API (string, handler, priority, critical)
      const taskId = app.registerShutdownTask(
        'Multi-param Task',
        async () => {
          taskExecuted = true;
        },
        ShutdownPriority.High,
        false
      );

      expect(taskId).toBeDefined();

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      expect(taskExecuted).toBe(true);
    });

    it('should assign default priority when not specified', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: false,
        environment: 'test',
      });

      const executionOrder: number[] = [];

      app.registerShutdownTask({
        id: 'no-priority',
        name: 'No Priority',
        handler: async () => {
          executionOrder.push(1);
        },
      });

      app.registerShutdownTask({
        id: 'high-priority',
        name: 'High Priority',
        priority: ShutdownPriority.High,
        handler: async () => {
          executionOrder.push(2);
        },
      });

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      // High priority should run first
      expect(executionOrder[0]).toBe(2);
    });
  });

  describe('Shutdown Events', () => {
    it('should emit all shutdown lifecycle events', async () => {
      const events: string[] = [];

      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: false,
        environment: 'test',
      });

      app.on(ApplicationEvent.ShutdownStart, () => events.push('shutdown:start'));
      app.on(ApplicationEvent.ShutdownTaskComplete, (data) => events.push(`task:complete:${data.task}`));
      app.on(ApplicationEvent.ShutdownComplete, () => events.push('shutdown:complete'));

      app.registerShutdownTask({
        id: 'event-task',
        name: 'Event Task',
        handler: async () => {},
      });

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      expect(events).toContain('shutdown:start');
      expect(events).toContain('task:complete:Event Task');
      expect(events).toContain('shutdown:complete');
    });

    it('should emit error event on task failure', async () => {
      let errorEmitted = false;

      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: false,
        environment: 'test',
      });

      app.on(ApplicationEvent.ShutdownTaskError, () => {
        errorEmitted = true;
      });

      app.registerShutdownTask({
        id: 'failing-task',
        name: 'Failing Task',
        critical: false,
        handler: async () => {
          throw new Error('Task error');
        },
      });

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      expect(errorEmitted).toBe(true);
    });
  });

  describe('Async Event Emission', () => {
    it('should handle emitAsync correctly', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      const results: number[] = [];

      app.on('test:async', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        results.push(1);
      });

      app.on('test:async', async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        results.push(2);
      });

      await app.emitAsync('test:async', { data: 'test' });

      // Both handlers should have completed
      expect(results).toContain(1);
      expect(results).toContain(2);
    });

    it('should handle errors in async event handlers', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      let errorEventReceived = false;

      app.on(ApplicationEvent.Error, () => {
        errorEventReceived = true;
      });

      app.on('test:error', async () => {
        throw new Error('Async handler error');
      });

      // Should not throw
      await app.emitAsync('test:error', {});

      expect(errorEventReceived).toBe(true);
    });

    it('should emit to wildcard listeners in emitAsync', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      const receivedEvents: string[] = [];

      app.on('*', (data, meta) => {
        if (meta && typeof meta.event === 'string') {
          receivedEvents.push(meta.event);
        }
      });

      await app.emitAsync('custom:event', { test: true });

      expect(receivedEvents).toContain('custom:event');
    });
  });

  describe('Cleanup Handler Execution', () => {
    it('should execute all cleanup handlers even if some fail', async () => {
      const executedHandlers: string[] = [];

      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: false,
        environment: 'test',
      });

      app.registerCleanup(async () => {
        executedHandlers.push('handler1');
      });

      app.registerCleanup(async () => {
        throw new Error('Handler 2 failed');
      });

      app.registerCleanup(async () => {
        executedHandlers.push('handler3');
      });

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      expect(executedHandlers).toContain('handler1');
      expect(executedHandlers).toContain('handler3');
    });
  });

  describe('Module Lifecycle During Shutdown', () => {
    it('should stop modules in reverse dependency order', async () => {
      const stopOrder: string[] = [];

      class ModuleA implements IModule {
        name = 'module-a';
        async onStop() {
          stopOrder.push('a');
        }
      }

      class ModuleB implements IModule {
        name = 'module-b';
        dependencies = ['module-a'];
        async onStop() {
          stopOrder.push('b');
        }
      }

      class ModuleC implements IModule {
        name = 'module-c';
        dependencies = ['module-b'];
        async onStop() {
          stopOrder.push('c');
        }
      }

      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: false,
        environment: 'test',
        modules: [ModuleA, ModuleB, ModuleC],
      });

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      // C should stop first (depends on B), then B (depends on A), then A
      expect(stopOrder.indexOf('c')).toBeLessThan(stopOrder.indexOf('b'));
      expect(stopOrder.indexOf('b')).toBeLessThan(stopOrder.indexOf('a'));
    });
  });

  describe('Shutdown Timeout Handling', () => {
    it('should timeout shutdown if tasks take too long', async () => {
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: false,
        environment: 'test',
        gracefulShutdownTimeout: 100,
      });

      app.registerShutdownTask({
        id: 'very-slow',
        name: 'Very Slow Task',
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        },
      });

      await app.start();

      // Should timeout
      await expect(app.shutdown(ShutdownReason.Manual)).rejects.toThrow(/timed out/i);
    });
  });

  describe('Force Shutdown', () => {
    it('should emit process exit event in test mode', async () => {
      let exitCode: number | null = null;

      // Note: disableGracefulShutdown must be false for _disableProcessExit to be set
      // based on environment: 'test'
      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: false,
        environment: 'test',
      });

      app.on(ApplicationEvent.ProcessExit, (data) => {
        exitCode = data.code;
      });

      // In test mode, forceShutdown should emit event instead of calling process.exit
      app.forceShutdown(42);

      expect(exitCode).toBe(42);
    });
  });

  describe('State Save Event', () => {
    it('should emit state save event during shutdown', async () => {
      let stateSaveEmitted = false;

      app = await Application.create({
        disableCoreModules: true,
        disableGracefulShutdown: false,
        environment: 'test',
      });

      app.on(ApplicationEvent.StateSave, () => {
        stateSaveEmitted = true;
      });

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      expect(stateSaveEmitted).toBe(true);
    });
  });
});
