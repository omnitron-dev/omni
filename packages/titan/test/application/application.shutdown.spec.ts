/**
 * Application shutdown and process lifecycle tests
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

import { Application } from '../../src/application.js';
import { ShutdownReason, ShutdownPriority } from '../../src/types.js';

describe('Application Shutdown and Process Lifecycle', () => {
  let app: Application;

  beforeEach(() => {
    // Clear any global shutdown tasks
    if (global.__titanShutdownTasks) {
      delete global.__titanShutdownTasks;
    }
  });

  afterEach(async () => {
    if (app) {
      await app.stop();
    }
  });

  describe('Shutdown Tasks', () => {
    it('should register and execute shutdown tasks', async () => {
      const taskExecuted = jest.fn();

      app = await Application.create({
        disableGracefulShutdown: false,
        environment: 'test' // Ensure process.exit is disabled
      });

      app.registerShutdownTask({
        name: 'Test Task',
        priority: ShutdownPriority.Normal,
        handler: async (reason) => {
          taskExecuted(reason);
        }
      });

      await app.shutdown(ShutdownReason.Manual);

      expect(taskExecuted).toHaveBeenCalledWith(ShutdownReason.Manual);
    });

    it('should execute shutdown tasks in priority order', async () => {
      const executionOrder: string[] = [];

      app = await Application.create({
        disableGracefulShutdown: false,
        environment: 'test'
      });

      app.registerShutdownTask({
        name: 'Low Priority',
        priority: ShutdownPriority.Low,
        handler: async () => {
          executionOrder.push('low');
        }
      });

      app.registerShutdownTask({
        name: 'High Priority',
        priority: ShutdownPriority.High,
        handler: async () => {
          executionOrder.push('high');
        }
      });

      app.registerShutdownTask({
        name: 'First Priority',
        priority: ShutdownPriority.First,
        handler: async () => {
          executionOrder.push('first');
        }
      });

      await app.shutdown(ShutdownReason.Manual);
      expect(executionOrder).toEqual(['first', 'high', 'low']);
    });

    it('should handle critical shutdown task failures', async () => {
      app = await Application.create({
        disableGracefulShutdown: false,
        environment: 'test'
      });

      app.registerShutdownTask({
        name: 'Critical Task',
        priority: ShutdownPriority.High,
        critical: true,
        handler: async () => {
          throw new Error('Critical task failed');
        }
      });

      await expect(app.shutdown(ShutdownReason.Manual)).rejects.toThrow('Critical shutdown task failed');
    });

    it('should continue with non-critical task failures', async () => {
      const secondTaskExecuted = jest.fn();

      app = await Application.create({
        disableGracefulShutdown: false,
        environment: 'test'
      });

      app.registerShutdownTask({
        name: 'Failing Task',
        priority: ShutdownPriority.High,
        critical: false,
        handler: async () => {
          throw new Error('Non-critical task failed');
        }
      });

      app.registerShutdownTask({
        name: 'Second Task',
        priority: ShutdownPriority.Low,
        handler: async () => {
          secondTaskExecuted();
        }
      });

      await app.shutdown(ShutdownReason.Manual);

      expect(secondTaskExecuted).toHaveBeenCalled();
    });

    it('should unregister shutdown tasks', async () => {
      const taskExecuted = jest.fn();

      app = await Application.create({
        disableGracefulShutdown: false,
        environment: 'test'
      });

      app.registerShutdownTask({
        id: 'test-task',
        name: 'Test Task',
        handler: taskExecuted
      });

      app.unregisterShutdownTask('test-task');

      await app.shutdown(ShutdownReason.Manual);

      expect(taskExecuted).not.toHaveBeenCalled();
    });
  });

  describe('Cleanup Handlers', () => {
    it('should register and execute cleanup handlers', async () => {
      const cleanupExecuted = jest.fn();

      app = await Application.create({
        disableGracefulShutdown: false,
        environment: 'test'
      });

      app.registerCleanup(cleanupExecuted);

      await app.shutdown(ShutdownReason.Manual);

      expect(cleanupExecuted).toHaveBeenCalled();
    });

    it('should handle cleanup handler errors gracefully', async () => {
      const secondCleanupExecuted = jest.fn();

      app = await Application.create({
        disableGracefulShutdown: false,
        environment: 'test'
      });

      app.registerCleanup(async () => {
        throw new Error('Cleanup failed');
      });

      app.registerCleanup(secondCleanupExecuted);

      await app.shutdown(ShutdownReason.Manual);

      expect(secondCleanupExecuted).toHaveBeenCalled();
    });
  });

  describe('Process Metrics', () => {
    it('should provide process metrics', async () => {
      app = await Application.create({
        disableGracefulShutdown: false,
        environment: 'test'
      });

      await app.start();

      const metrics = app.getProcessMetrics();

      expect(metrics).toHaveProperty('uptime');
      expect(metrics).toHaveProperty('memoryUsage');
      expect(metrics).toHaveProperty('cpuUsage');
      expect(metrics).toHaveProperty('pid');
      expect(metrics).toHaveProperty('ppid');
      expect(metrics).toHaveProperty('platform');
      expect(metrics).toHaveProperty('nodeVersion');
      expect(metrics).toHaveProperty('state');
      expect(metrics).toHaveProperty('shutdownTasksCount');
      expect(metrics).toHaveProperty('cleanupHandlersCount');

      expect(metrics.pid).toBe(process.pid);
      expect(metrics.platform).toBe(process.platform);
      expect(metrics.nodeVersion).toBe(process.version);
    });
  });

  describe('Force Shutdown', () => {
    it('should support force shutdown', async () => {
      const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process.exit called');
      });

      app = await Application.create({
        disableGracefulShutdown: false,
        // Don't set environment to 'test' to allow process.exit
        environment: 'production',
        // Explicitly enable process exit for this test
        disableProcessExit: false
      });

      // Manually override the _disableProcessExit flag to ensure process.exit is called
      (app as any)._disableProcessExit = false;

      expect(() => app.forceShutdown(1)).toThrow('Process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });
  });

  describe('Shutdown Events', () => {
    it('should emit shutdown lifecycle events', async () => {
      const events: string[] = [];

      app = await Application.create({
        disableGracefulShutdown: false,
        environment: 'test'
      });

      app.on('shutdown:start', () => events.push('shutdown:start'));
      app.on('shutdown:complete', () => events.push('shutdown:complete'));
      app.on('shutdown:task:complete', () => events.push('shutdown:task:complete'));

      app.registerShutdownTask({
        name: 'Test Task',
        handler: async () => { }
      });

      await app.shutdown(ShutdownReason.Manual);

      expect(events).toContain('shutdown:start');
      expect(events).toContain('shutdown:task:complete');
      expect(events).toContain('shutdown:complete');
    });
  });

  describe('Global Shutdown Tasks', () => {
    it('should register global shutdown tasks on start', async () => {
      const globalTaskExecuted = jest.fn();

      // Set up global tasks before creating app
      global.__titanShutdownTasks = [{
        name: 'Global Task',
        handler: globalTaskExecuted
      }];

      app = await Application.create({
        disableGracefulShutdown: false,
        environment: 'test'
      });

      await app.start();

      await app.shutdown(ShutdownReason.Manual);

      expect(globalTaskExecuted).toHaveBeenCalled();
      expect(global.__titanShutdownTasks).toBeUndefined();
    });
  });
});
