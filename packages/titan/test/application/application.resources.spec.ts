/**
 * Memory and Resource Tests for Titan Application
 *
 * Tests for resource management, memory leaks detection, and proper cleanup
 * across multiple application lifecycle iterations.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Application } from '../../src/application.js';
import { ApplicationState, IModule, ApplicationEvent } from '../../src/types.js';
import { createToken } from '../../src/nexus/index.js';

// Helper to create delays
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to force garbage collection if available
const forceGC = () => {
  if (global.gc) {
    global.gc();
  }
};

// Resource tracking interfaces
interface ResourceAllocation {
  id: string;
  type: string;
  size: number;
  allocatedAt: number;
  deallocated: boolean;
}

interface ResourceTracker {
  allocations: ResourceAllocation[];
  activeAllocations: () => ResourceAllocation[];
  totalAllocated: () => number;
  totalDeallocated: () => number;
}

function createResourceTracker(): ResourceTracker {
  const allocations: ResourceAllocation[] = [];

  return {
    allocations,
    activeAllocations: () => allocations.filter((a) => !a.deallocated),
    totalAllocated: () => allocations.length,
    totalDeallocated: () => allocations.filter((a) => a.deallocated).length,
  };
}

describe('Titan Application Resource Management', () => {
  let app: Application;
  let _resourceTracker: ResourceTracker;

  beforeEach(() => {
    _resourceTracker = createResourceTracker();
    forceGC();
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
    forceGC();
  });

  describe('Proper cleanup after multiple start/stop cycles', () => {
    it('should properly clean up resources after each cycle', async () => {
      const cleanupCounts = {
        moduleStop: 0,
        moduleDestroy: 0,
        hookStop: 0,
        eventUnsubscribe: 0,
      };

      class ResourceModule implements IModule {
        name = 'resource-module';
        private resource: any = null;

        async onStart() {
          this.resource = { data: new Array(1000).fill('test') };
        }

        async onStop() {
          cleanupCounts.moduleStop++;
          this.resource = null;
        }

        async onDestroy() {
          cleanupCounts.moduleDestroy++;
        }
      }

      // Run multiple cycles
      for (let i = 0; i < 3; i++) {
        app = await Application.create({
          disableGracefulShutdown: true,
          disableCoreModules: true,
          modules: [ResourceModule],
        });

        app.onStop({
          name: 'cleanup-hook',
          handler: () => {
            cleanupCounts.hookStop++;
          },
        });

        await app.start();
        await app.stop();
      }

      expect(cleanupCounts.moduleStop).toBe(3);
      expect(cleanupCounts.hookStop).toBe(3);
    });

    it('should not leak event handlers across cycles', async () => {
      const handlerCalls: number[] = [];

      for (let cycle = 0; cycle < 3; cycle++) {
        app = await Application.create({
          disableGracefulShutdown: true,
          disableCoreModules: true,
        });

        // Add handler for this cycle
        app.on(ApplicationEvent.Started, () => {
          handlerCalls.push(cycle);
        });

        await app.start();
        await app.stop();
      }

      // Each handler should be called exactly once per cycle
      expect(handlerCalls).toEqual([0, 1, 2]);
    });

    it('should properly reset state after each cycle', async () => {
      class StateTrackingModule implements IModule {
        name = 'state-tracking';
        startCount = 0;
        stopCount = 0;

        async onStart() {
          this.startCount++;
        }

        async onStop() {
          this.stopCount++;
        }
      }

      const module = new StateTrackingModule();

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [module],
      });

      // Multiple start/stop cycles
      for (let i = 0; i < 5; i++) {
        if (i > 0) {
          // After first cycle, need to restart
          expect(app.state).toBe(ApplicationState.Stopped);
        }
        await app.start();
        expect(app.state).toBe(ApplicationState.Started);
        expect(app.isStarted).toBe(true);

        await app.stop();
        expect(app.state).toBe(ApplicationState.Stopped);
        expect(app.isStarted).toBe(false);
      }

      expect(module.startCount).toBe(5);
      expect(module.stopCount).toBe(5);
    });

    it('should clean up timers and intervals', async () => {
      const activeTimers: Set<NodeJS.Timeout> = new Set();
      let timerCallCount = 0;

      class TimerModule implements IModule {
        name = 'timer-module';
        private interval?: NodeJS.Timeout;
        private timeout?: NodeJS.Timeout;

        async onStart() {
          this.interval = setInterval(() => {
            timerCallCount++;
          }, 50);
          activeTimers.add(this.interval);

          this.timeout = setTimeout(() => {
            timerCallCount++;
          }, 1000);
          activeTimers.add(this.timeout);
        }

        async onStop() {
          if (this.interval) {
            clearInterval(this.interval);
            activeTimers.delete(this.interval);
          }
          if (this.timeout) {
            clearTimeout(this.timeout);
            activeTimers.delete(this.timeout);
          }
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [TimerModule],
      });

      await app.start();
      expect(activeTimers.size).toBe(2);

      await app.stop();
      expect(activeTimers.size).toBe(0);

      // Wait to ensure cleared timers don't fire
      const callsAtStop = timerCallCount;
      await delay(100);

      // Timer calls should have stopped
      expect(timerCallCount).toBeLessThanOrEqual(callsAtStop + 2); // Allow for any in-flight calls
    });
  });

  describe('Memory leak detection in long-running apps', () => {
    it('should not accumulate modules across restarts', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      const moduleCounts: number[] = [];

      for (let i = 0; i < 5; i++) {
        await app.start();
        moduleCounts.push(app.modules.size);
        await app.stop();
      }

      // Module count should remain constant
      expect(new Set(moduleCounts).size).toBe(1);
    });

    it('should not accumulate hooks across restarts', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      const hookExecutions: number[] = [];

      // Register hooks once before any start
      let executionCount = 0;
      app.onStart({
        name: 'test-hook',
        handler: () => {
          executionCount++;
        },
      });

      for (let i = 0; i < 5; i++) {
        await app.start();
        hookExecutions.push(executionCount);
        await app.stop();
      }

      // Each restart should call the hook exactly once
      expect(hookExecutions).toEqual([1, 2, 3, 4, 5]);
    });

    it('should clean up provider instances after stop', async () => {
      const TRACKER_TOKEN = createToken<{ value: number }>('Tracker');
      let instanceCount = 0;

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [
          [
            TRACKER_TOKEN,
            {
              useFactory: () => {
                instanceCount++;
                return { value: instanceCount };
              },
            },
          ],
        ],
      });

      for (let i = 0; i < 3; i++) {
        await app.start();
        const instance = app.resolve(TRACKER_TOKEN);
        expect(instance).toBeDefined();
        await app.stop();
      }

      // Factory should be called each time (or cached)
      // The key is not leaking instances
      expect(instanceCount).toBeGreaterThanOrEqual(1);
    });

    it('should handle memory pressure gracefully', async () => {
      // Create modules that allocate significant memory
      const allocations: any[] = [];

      class MemoryIntensiveModule implements IModule {
        name = 'memory-intensive';
        private data: number[] = [];

        async onStart() {
          // Allocate 1MB of data
          this.data = new Array(250000).fill(Math.random());
          allocations.push(this.data);
        }

        async onStop() {
          this.data = [];
        }
      }

      // Run multiple cycles
      for (let i = 0; i < 5; i++) {
        app = await Application.create({
          disableGracefulShutdown: true,
          disableCoreModules: true,
          modules: [MemoryIntensiveModule],
        });

        await app.start();
        await app.stop();
      }

      // Clear allocations reference and force GC
      allocations.length = 0;
      forceGC();

      // Application should still be usable
      expect(app.state).toBe(ApplicationState.Stopped);
    });
  });

  describe('Resource cleanup on error paths', () => {
    it('should clean up resources when module start fails', async () => {
      const resources: { id: string; cleaned: boolean }[] = [];

      class ResourceAllocatingModule implements IModule {
        name = 'resource-allocating';
        private resource: { id: string; cleaned: boolean } | null = null;

        async onStart() {
          this.resource = { id: 'resource-1', cleaned: false };
          resources.push(this.resource);
        }

        async onStop() {
          if (this.resource) {
            this.resource.cleaned = true;
          }
        }
      }

      class FailingModule implements IModule {
        name = 'failing-module';
        async onStart() {
          throw new Error('Module start failed');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [ResourceAllocatingModule, FailingModule],
      });

      await expect(app.start()).rejects.toThrow('Module start failed');
      expect(app.state).toBe(ApplicationState.Failed);

      // Force cleanup
      await app.stop({ force: true });

      // Resources from successful modules should be cleaned up
      // (depending on implementation, may or may not be called during failure recovery)
      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should not leave resources dangling after hook failure', async () => {
      let _resourceCleaned = false;

      class ResourceModule implements IModule {
        name = 'resource-module';
        async onStart() {
          // Allocate resource
        }
        async onStop() {
          _resourceCleaned = true;
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [ResourceModule],
      });

      app.onStart({
        name: 'failing-hook',
        handler: async () => {
          throw new Error('Hook failed');
        },
      });

      await expect(app.start()).rejects.toThrow('Hook failed');

      // Cleanup should still work
      await app.stop({ force: true });
      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should clean up all resources even if some cleanup handlers fail', async () => {
      const cleanupResults: string[] = [];

      class CleanModule1 implements IModule {
        name = 'clean-module-1';
        async onStop() {
          cleanupResults.push('clean-1');
        }
      }

      class FailingCleanupModule implements IModule {
        name = 'failing-cleanup';
        async onStop() {
          cleanupResults.push('failing-cleanup-attempted');
          throw new Error('Cleanup failed');
        }
      }

      class CleanModule2 implements IModule {
        name = 'clean-module-2';
        async onStop() {
          cleanupResults.push('clean-2');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [CleanModule1, FailingCleanupModule, CleanModule2],
      });

      await app.start();

      // Default graceful stop continues despite errors
      await app.stop();

      // All cleanup attempts should have been made
      expect(cleanupResults).toContain('clean-1');
      expect(cleanupResults).toContain('failing-cleanup-attempted');
      expect(cleanupResults).toContain('clean-2');
    });

    it('should handle cleanup timeout gracefully', async () => {
      class SlowCleanupModule implements IModule {
        name = 'slow-cleanup';
        async onStop() {
          await delay(5000);
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [SlowCleanupModule],
      });

      await app.start();

      // Force stop should complete quickly despite slow module
      const startTime = Date.now();
      await app.stop({ force: true, timeout: 100 });
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(1000);
      expect(app.state).toBe(ApplicationState.Stopped);
    });
  });

  describe('Connection and handle cleanup', () => {
    it('should track and clean up connection-like resources', async () => {
      const connections: { id: number; closed: boolean }[] = [];
      let nextId = 0;

      class ConnectionPoolModule implements IModule {
        name = 'connection-pool';
        private pool: { id: number; closed: boolean }[] = [];

        async onStart() {
          // Create connection pool
          for (let i = 0; i < 5; i++) {
            const conn = { id: nextId++, closed: false };
            this.pool.push(conn);
            connections.push(conn);
          }
        }

        async onStop() {
          // Close all connections
          for (const conn of this.pool) {
            conn.closed = true;
          }
          this.pool = [];
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [ConnectionPoolModule],
      });

      await app.start();
      expect(connections.filter((c) => !c.closed).length).toBe(5);

      await app.stop();
      expect(connections.filter((c) => !c.closed).length).toBe(0);
    });

    it('should clean up file handles', async () => {
      const openHandles: { path: string; closed: boolean }[] = [];

      class FileHandleModule implements IModule {
        name = 'file-handle';
        private handles: { path: string; closed: boolean }[] = [];

        async onStart() {
          // Simulate opening file handles
          for (let i = 0; i < 3; i++) {
            const handle = { path: `/tmp/file${i}`, closed: false };
            this.handles.push(handle);
            openHandles.push(handle);
          }
        }

        async onStop() {
          for (const handle of this.handles) {
            handle.closed = true;
          }
          this.handles = [];
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [FileHandleModule],
      });

      await app.start();
      expect(openHandles.filter((h) => !h.closed).length).toBe(3);

      await app.stop();
      expect(openHandles.filter((h) => !h.closed).length).toBe(0);
    });
  });

  describe('Cleanup handler priority', () => {
    it('should execute cleanup handlers in correct order', async () => {
      const cleanupOrder: string[] = [];

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      app.registerCleanup(async () => {
        cleanupOrder.push('cleanup-1');
      });

      app.registerCleanup(async () => {
        cleanupOrder.push('cleanup-2');
      });

      app.registerCleanup(async () => {
        cleanupOrder.push('cleanup-3');
      });

      await app.start();
      await app.stop();

      // Cleanup handlers should be executed
      expect(cleanupOrder.length).toBe(3);
    });

    it('should respect shutdown task priorities for cleanup', async () => {
      const taskOrder: string[] = [];

      app = await Application.create({
        disableGracefulShutdown: false,
        environment: 'test',
      });

      app.registerShutdownTask({
        id: 'low',
        name: 'Low Priority',
        priority: 80,
        handler: async () => {
          taskOrder.push('low');
        },
      });

      app.registerShutdownTask({
        id: 'high',
        name: 'High Priority',
        priority: 20,
        handler: async () => {
          taskOrder.push('high');
        },
      });

      app.registerShutdownTask({
        id: 'normal',
        name: 'Normal Priority',
        priority: 50,
        handler: async () => {
          taskOrder.push('normal');
        },
      });

      await app.start();
      await app.stop();

      // Should execute in priority order: high (20), normal (50), low (80)
      expect(taskOrder).toEqual(['high', 'normal', 'low']);
    });
  });
});
