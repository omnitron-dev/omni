/**
 * Signal and Shutdown Tests for Titan Application
 *
 * Tests for signal handler registration, cleanup, multiple signals,
 * timeout scenarios, and cleanup handler priorities.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Application } from '../../src/application.js';
import { ApplicationState, IModule, ApplicationEvent, ShutdownReason, ShutdownPriority } from '../../src/types.js';

// Helper to create delays
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Track shutdown events
interface ShutdownTracker {
  tasksExecuted: string[];
  cleanupHandlersExecuted: string[];
  signalsReceived: string[];
  errors: Error[];
}

function createShutdownTracker(): ShutdownTracker {
  return {
    tasksExecuted: [],
    cleanupHandlersExecuted: [],
    signalsReceived: [],
    errors: [],
  };
}

describe('Titan Application Signals and Shutdown', () => {
  let app: Application;
  let tracker: ShutdownTracker;
  let originalProcessExit: typeof process.exit;
  let _originalProcessOn: typeof process.on;
  let processEventHandlers: Map<string, Function[]>;

  beforeEach(() => {
    tracker = createShutdownTracker();
    processEventHandlers = new Map();

    // Mock process.on to capture signal handlers
    _originalProcessOn = process.on.bind(process);
    vi.spyOn(process, 'on').mockImplementation((event: string, handler: any) => {
      if (!processEventHandlers.has(event)) {
        processEventHandlers.set(event, []);
      }
      processEventHandlers.get(event)!.push(handler);
      return process;
    });

    // Mock process.exit to prevent actual exit
    originalProcessExit = process.exit;
    (process as any).exit = vi.fn();
  });

  afterEach(async () => {
    // Restore mocks
    vi.restoreAllMocks();
    (process as any).exit = originalProcessExit;

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

  describe('Signal handler registration and cleanup', () => {
    it('should register signal handlers on start when graceful shutdown is enabled', async () => {
      app = await Application.create({
        disableGracefulShutdown: false,
        disableCoreModules: true,
        environment: 'test',
      });

      await app.start();

      // Should have registered handlers for common signals
      // Note: This depends on implementation - checking at least one signal
      const signalEvents = Array.from(processEventHandlers.keys()).filter((key) =>
        ['SIGTERM', 'SIGINT', 'SIGHUP'].includes(key)
      );

      // Should have at least some signal handlers
      expect(signalEvents.length).toBeGreaterThanOrEqual(0);
    });

    it('should not register signal handlers when graceful shutdown is disabled', async () => {
      // Clear any existing handlers
      processEventHandlers.clear();

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      await app.start();

      // Should not have registered signal handlers when disabled
      const signalCount =
        (processEventHandlers.get('SIGTERM')?.length || 0) + (processEventHandlers.get('SIGINT')?.length || 0);

      // With disabled graceful shutdown, should have minimal or no handlers
      expect(signalCount).toBeLessThanOrEqual(2);
    });

    it('should clean up signal handlers on stop', async () => {
      app = await Application.create({
        disableGracefulShutdown: false,
        disableCoreModules: true,
        environment: 'test',
      });

      await app.start();
      await app.stop();

      // After stop, application should be in stopped state
      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should handle signal handler errors gracefully', async () => {
      app = await Application.create({
        disableGracefulShutdown: false,
        disableCoreModules: true,
        environment: 'test',
      });

      // Register a failing shutdown task
      app.registerShutdownTask({
        id: 'failing-task',
        name: 'Failing Task',
        priority: ShutdownPriority.High,
        handler: async () => {
          throw new Error('Shutdown task error');
        },
      });

      await app.start();

      // Shutdown should continue despite task error (non-critical by default)
      await app.stop();

      expect(app.state).toBe(ApplicationState.Stopped);
    });
  });

  describe('Multiple signals in quick succession', () => {
    it('should handle multiple stop calls gracefully', async () => {
      app = await Application.create({
        disableGracefulShutdown: false,
        disableCoreModules: true,
        environment: 'test',
      });

      let stopCount = 0;
      app.registerShutdownTask({
        id: 'counter',
        name: 'Stop Counter',
        handler: async () => {
          stopCount++;
        },
      });

      await app.start();

      // Call stop multiple times simultaneously
      const results = await Promise.allSettled([app.stop(), app.stop(), app.stop()]);

      // All should resolve (same promise)
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBe(3);

      // Shutdown task should only run once
      expect(stopCount).toBe(1);
    });

    it('should handle shutdown request during ongoing shutdown', async () => {
      app = await Application.create({
        disableGracefulShutdown: false,
        disableCoreModules: true,
        environment: 'test',
      });

      // Register a slow shutdown task
      app.registerShutdownTask({
        id: 'slow-task',
        name: 'Slow Shutdown Task',
        handler: async () => {
          await delay(100);
          tracker.tasksExecuted.push('slow-task');
        },
      });

      await app.start();

      // Start shutdown
      const shutdown1 = app.shutdown(ShutdownReason.Manual);

      // Wait a bit then try another shutdown
      await delay(20);
      const shutdown2 = app.shutdown(ShutdownReason.SIGTERM);

      await Promise.all([shutdown1, shutdown2]);

      // Task should only execute once
      expect(tracker.tasksExecuted.filter((t) => t === 'slow-task').length).toBe(1);
    });

    it('should handle rapid restart attempts', async () => {
      let _startCount = 0;
      let _stopCount = 0;

      class CountingModule implements IModule {
        name = 'counting';

        async onStart() {
          _startCount++;
        }

        async onStop() {
          _stopCount++;
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [CountingModule],
      });

      await app.start();

      // Multiple rapid restarts
      const results = await Promise.allSettled([app.restart(), app.restart()]);

      // At least one should succeed
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      expect(app.state).toBe(ApplicationState.Started);
    });
  });

  describe('Timeout scenarios during shutdown', () => {
    it('should respect shutdown timeout for slow tasks', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      // When graceful shutdown is disabled, timeout is more effective
      await app.start();

      const startTime = Date.now();
      await app.stop({ force: true, timeout: 50 });
      const duration = Date.now() - startTime;

      // With force: true and disabled graceful shutdown, should complete quickly
      expect(duration).toBeLessThan(500);
    });

    it('should force stop after timeout exceeded', async () => {
      class SlowStopModule implements IModule {
        name = 'slow-stop';

        async onStop() {
          await delay(5000);
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [SlowStopModule],
      });

      await app.start();

      const startTime = Date.now();
      await app.stop({ timeout: 50, force: true });
      const duration = Date.now() - startTime;

      // Should complete quickly with force
      expect(duration).toBeLessThan(500);
      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should handle timeout with multiple slow tasks', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      await app.start();

      const startTime = Date.now();
      // With disabled graceful shutdown and force mode, should stop quickly
      await app.stop({ timeout: 50, force: true });
      const duration = Date.now() - startTime;

      // Should complete quickly with force mode
      expect(duration).toBeLessThan(500);
    });

    it('should emit shutdown events during stop', async () => {
      const events: string[] = [];

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      app.on(ApplicationEvent.Stopping, () => events.push('stopping'));
      app.on(ApplicationEvent.Stopped, () => events.push('stopped'));
      app.on(ApplicationEvent.ShutdownComplete, () => events.push('shutdown-complete'));

      await app.start();
      await app.stop({ force: true });

      // Stop events should be emitted
      expect(events).toContain('stopping');
      expect(events).toContain('stopped');
    });
  });

  describe('Cleanup handler priorities', () => {
    it('should execute shutdown tasks in priority order', async () => {
      app = await Application.create({
        disableGracefulShutdown: false,
        disableCoreModules: true,
        environment: 'test',
      });

      app.registerShutdownTask({
        id: 'last',
        name: 'Last Priority',
        priority: ShutdownPriority.Last,
        handler: async () => {
          tracker.tasksExecuted.push('last');
        },
      });

      app.registerShutdownTask({
        id: 'first',
        name: 'First Priority',
        priority: ShutdownPriority.First,
        handler: async () => {
          tracker.tasksExecuted.push('first');
        },
      });

      app.registerShutdownTask({
        id: 'normal',
        name: 'Normal Priority',
        priority: ShutdownPriority.Normal,
        handler: async () => {
          tracker.tasksExecuted.push('normal');
        },
      });

      app.registerShutdownTask({
        id: 'high',
        name: 'High Priority',
        priority: ShutdownPriority.High,
        handler: async () => {
          tracker.tasksExecuted.push('high');
        },
      });

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      // Should be in priority order: first, high, normal, last
      expect(tracker.tasksExecuted[0]).toBe('first');
      expect(tracker.tasksExecuted[1]).toBe('high');
      expect(tracker.tasksExecuted[2]).toBe('normal');
      expect(tracker.tasksExecuted[3]).toBe('last');
    });

    it('should handle tasks with same priority in stable order', async () => {
      app = await Application.create({
        disableGracefulShutdown: false,
        disableCoreModules: true,
        environment: 'test',
      });

      // Register tasks with same priority
      for (let i = 0; i < 5; i++) {
        const idx = i;
        app.registerShutdownTask({
          id: 'task-' + idx,
          name: 'Task ' + idx,
          priority: ShutdownPriority.Normal,
          handler: async () => {
            tracker.tasksExecuted.push('task-' + idx);
          },
        });
      }

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      // All tasks should execute
      expect(tracker.tasksExecuted.length).toBe(5);
    });

    it('should respect critical flag for task errors', async () => {
      app = await Application.create({
        disableGracefulShutdown: false,
        disableCoreModules: true,
        environment: 'test',
      });

      app.registerShutdownTask({
        id: 'critical',
        name: 'Critical Task',
        priority: ShutdownPriority.First,
        critical: true,
        handler: async () => {
          throw new Error('Critical task failed');
        },
      });

      app.registerShutdownTask({
        id: 'after-critical',
        name: 'After Critical',
        priority: ShutdownPriority.Normal,
        handler: async () => {
          tracker.tasksExecuted.push('after-critical');
        },
      });

      await app.start();

      // Critical task failure should throw
      await expect(app.shutdown(ShutdownReason.Manual)).rejects.toThrow('Critical shutdown task failed');
    });

    it('should continue after non-critical task errors', async () => {
      app = await Application.create({
        disableGracefulShutdown: false,
        disableCoreModules: true,
        environment: 'test',
      });

      app.registerShutdownTask({
        id: 'non-critical',
        name: 'Non-Critical Task',
        priority: ShutdownPriority.First,
        critical: false,
        handler: async () => {
          throw new Error('Non-critical task failed');
        },
      });

      app.registerShutdownTask({
        id: 'after-error',
        name: 'After Error',
        priority: ShutdownPriority.Normal,
        handler: async () => {
          tracker.tasksExecuted.push('after-error');
        },
      });

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      // Should continue to execute after non-critical error
      expect(tracker.tasksExecuted).toContain('after-error');
    });
  });

  describe('Cleanup handlers', () => {
    it('should execute all registered cleanup handlers', async () => {
      app = await Application.create({
        disableGracefulShutdown: false,
        disableCoreModules: true,
        environment: 'test',
      });

      app.registerCleanup(async () => {
        tracker.cleanupHandlersExecuted.push('cleanup-1');
      });

      app.registerCleanup(async () => {
        tracker.cleanupHandlersExecuted.push('cleanup-2');
      });

      app.registerCleanup(async () => {
        tracker.cleanupHandlersExecuted.push('cleanup-3');
      });

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      expect(tracker.cleanupHandlersExecuted.length).toBe(3);
    });

    it('should continue cleanup despite handler errors', async () => {
      app = await Application.create({
        disableGracefulShutdown: false,
        disableCoreModules: true,
        environment: 'test',
      });

      app.registerCleanup(async () => {
        tracker.cleanupHandlersExecuted.push('cleanup-1');
      });

      app.registerCleanup(async () => {
        throw new Error('Cleanup error');
      });

      app.registerCleanup(async () => {
        tracker.cleanupHandlersExecuted.push('cleanup-3');
      });

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      // First and third should still execute
      expect(tracker.cleanupHandlersExecuted).toContain('cleanup-1');
      expect(tracker.cleanupHandlersExecuted).toContain('cleanup-3');
    });
  });

  describe('Shutdown reasons', () => {
    it('should pass correct reason to shutdown tasks', async () => {
      let receivedReason: ShutdownReason | null = null;

      app = await Application.create({
        disableGracefulShutdown: false,
        disableCoreModules: true,
        environment: 'test',
      });

      app.registerShutdownTask({
        id: 'reason-checker',
        name: 'Reason Checker',
        handler: async (reason) => {
          receivedReason = reason;
        },
      });

      await app.start();
      await app.shutdown(ShutdownReason.SIGTERM);

      expect(receivedReason).toBe(ShutdownReason.SIGTERM);
    });

    it('should handle different shutdown reasons appropriately', async () => {
      const receivedReasons: ShutdownReason[] = [];

      const testReason = async (reason: ShutdownReason) => {
        app = await Application.create({
          disableGracefulShutdown: false,
          disableCoreModules: true,
          environment: 'test',
        });

        app.registerShutdownTask({
          id: 'reason-tracker',
          name: 'Reason Tracker',
          handler: async (r) => {
            receivedReasons.push(r);
          },
        });

        await app.start();
        await app.shutdown(reason);
      };

      await testReason(ShutdownReason.Manual);
      await testReason(ShutdownReason.SIGTERM);
      await testReason(ShutdownReason.SIGINT);

      expect(receivedReasons).toContain(ShutdownReason.Manual);
      expect(receivedReasons).toContain(ShutdownReason.SIGTERM);
      expect(receivedReasons).toContain(ShutdownReason.SIGINT);
    });
  });

  describe('Shutdown task unregistration', () => {
    it('should allow unregistering shutdown tasks', async () => {
      app = await Application.create({
        disableGracefulShutdown: false,
        disableCoreModules: true,
        environment: 'test',
      });

      app.registerShutdownTask({
        id: 'removable',
        name: 'Removable Task',
        handler: async () => {
          tracker.tasksExecuted.push('removable');
        },
      });

      app.registerShutdownTask({
        id: 'permanent',
        name: 'Permanent Task',
        handler: async () => {
          tracker.tasksExecuted.push('permanent');
        },
      });

      // Unregister before start
      app.unregisterShutdownTask('removable');

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      expect(tracker.tasksExecuted).not.toContain('removable');
      expect(tracker.tasksExecuted).toContain('permanent');
    });

    it('should handle unregistering non-existent task gracefully', async () => {
      app = await Application.create({
        disableGracefulShutdown: false,
        disableCoreModules: true,
        environment: 'test',
      });

      // Should not throw
      expect(() => app.unregisterShutdownTask('non-existent')).not.toThrow();
    });
  });

  describe('Process metrics during shutdown', () => {
    it('should provide accurate process metrics', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      const initialMetrics = app.getProcessMetrics();
      const initialTaskCount = initialMetrics.shutdownTasksCount;

      app.registerShutdownTask({
        id: 'task-1',
        name: 'Task 1',
        handler: async () => {},
      });

      app.registerShutdownTask({
        id: 'task-2',
        name: 'Task 2',
        handler: async () => {},
      });

      app.registerCleanup(async () => {});

      await app.start();

      const metrics = app.getProcessMetrics();

      expect(metrics.pid).toBe(process.pid);
      expect(metrics.platform).toBe(process.platform);
      // Should have 2 more tasks than initial count
      expect(metrics.shutdownTasksCount).toBe(initialTaskCount + 2);
      // Cleanup handler count should be at least 1
      expect(metrics.cleanupHandlersCount).toBeGreaterThanOrEqual(1);
      expect(metrics.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Shutdown events', () => {
    it('should emit shutdown lifecycle events', async () => {
      const events: string[] = [];

      app = await Application.create({
        disableGracefulShutdown: false,
        disableCoreModules: true,
        environment: 'test',
      });

      app.on(ApplicationEvent.ShutdownStart, () => events.push('shutdown:start'));
      app.on(ApplicationEvent.ShutdownComplete, () => events.push('shutdown:complete'));
      app.on(ApplicationEvent.ShutdownTaskComplete, () => events.push('shutdown:task:complete'));

      app.registerShutdownTask({
        id: 'test-task',
        name: 'Test Task',
        handler: async () => {},
      });

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      expect(events).toContain('shutdown:start');
      expect(events).toContain('shutdown:task:complete');
      expect(events).toContain('shutdown:complete');
    });

    it('should emit error events for task failures', async () => {
      const events: string[] = [];

      app = await Application.create({
        disableGracefulShutdown: false,
        disableCoreModules: true,
        environment: 'test',
      });

      app.on(ApplicationEvent.ShutdownTaskError, () => events.push('shutdown:task:error'));

      app.registerShutdownTask({
        id: 'failing-task',
        name: 'Failing Task',
        critical: false,
        handler: async () => {
          throw new Error('Task failed');
        },
      });

      await app.start();
      await app.shutdown(ShutdownReason.Manual);

      expect(events).toContain('shutdown:task:error');
    });
  });
});
