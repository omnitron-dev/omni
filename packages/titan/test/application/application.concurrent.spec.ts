/**
 * Concurrent Operations Tests for Titan Application
 *
 * Tests for race conditions, concurrent lifecycle operations, and thread safety
 * in application state transitions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Application } from '../../src/application.js';
import { ApplicationState, IModule, IApplication, ApplicationEvent } from '../../src/types.js';

// Helper to create delays
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Tracks concurrent operation events
interface ConcurrencyTracker {
  startCount: number;
  stopCount: number;
  registerCount: number;
  errors: Error[];
  stateTransitions: ApplicationState[];
  events: string[];
}

function createTracker(): ConcurrencyTracker {
  return {
    startCount: 0,
    stopCount: 0,
    registerCount: 0,
    errors: [],
    stateTransitions: [],
    events: [],
  };
}

describe('Titan Application Concurrent Operations', () => {
  let app: Application;
  let tracker: ConcurrencyTracker;

  beforeEach(() => {
    tracker = createTracker();
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

  describe('Multiple start() calls simultaneously', () => {
    it('should handle multiple concurrent start calls correctly', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      // Call start multiple times concurrently
      const results = await Promise.allSettled([app.start(), app.start(), app.start()]);

      // First should succeed, others should either succeed (same promise) or fail
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);

      // Application should be in Started state
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should return the same promise for concurrent start calls during Starting state', async () => {
      class SlowStartModule implements IModule {
        name = 'slow-start';
        async onStart() {
          await delay(100);
          tracker.startCount++;
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [SlowStartModule],
      });

      // Start multiple times concurrently
      const [p1, p2, p3] = [app.start(), app.start(), app.start()];

      await Promise.allSettled([p1, p2, p3]);

      // Module should only be started once
      expect(tracker.startCount).toBe(1);
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should reject second start call if first is already complete', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      // First start completes
      await app.start();
      expect(app.state).toBe(ApplicationState.Started);

      // Second start should reject
      await expect(app.start()).rejects.toThrow('already started');
    });

    it('should handle rapid start/stop/start sequence', async () => {
      class TrackedModule implements IModule {
        name = 'tracked';
        async onStart() {
          tracker.startCount++;
        }
        async onStop() {
          tracker.stopCount++;
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [TrackedModule],
      });

      // Rapid sequence
      await app.start();
      await app.stop();
      await app.start();
      await app.stop();
      await app.start();

      expect(tracker.startCount).toBe(3);
      expect(tracker.stopCount).toBe(2);
      expect(app.state).toBe(ApplicationState.Started);
    });
  });

  describe('start() while stop() is in progress', () => {
    it('should wait for stop to complete before starting', async () => {
      class SlowStopModule implements IModule {
        name = 'slow-stop';
        async onStart() {
          tracker.events.push('start');
        }
        async onStop() {
          tracker.events.push('stop-begin');
          await delay(100);
          tracker.events.push('stop-end');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [SlowStopModule],
      });

      await app.start();

      // Start stop and immediately try to start again
      const stopPromise = app.stop();
      const startPromise = app.start();

      await Promise.all([stopPromise, startPromise]);

      // Should have proper order: start, stop-begin, stop-end, start again
      expect(tracker.events).toContain('start');
      expect(tracker.events).toContain('stop-begin');
      expect(tracker.events).toContain('stop-end');
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should handle concurrent stop calls correctly', async () => {
      class SlowStopModule implements IModule {
        name = 'slow-stop';
        async onStop() {
          await delay(50);
          tracker.stopCount++;
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [SlowStopModule],
      });

      await app.start();

      // Multiple concurrent stop calls
      const results = await Promise.allSettled([app.stop(), app.stop(), app.stop()]);

      // All should resolve (same promise returned)
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled.length).toBe(3);

      // Module should only be stopped once
      expect(tracker.stopCount).toBe(1);
      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should handle stop during slow module start', async () => {
      let _startCompleted = false;
      let _stopCompleted = false;

      class VerySlowStartModule implements IModule {
        name = 'very-slow-start';
        async onStart() {
          await delay(200);
          _startCompleted = true;
        }
        async onStop() {
          _stopCompleted = true;
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [VerySlowStartModule],
      });

      // Start the slow module
      const startPromise = app.start();

      // Wait a bit then try to stop
      await delay(50);
      const stopPromise = app.stop();

      // Wait for both to complete
      await Promise.allSettled([startPromise, stopPromise]);

      // Application should end in a valid state
      expect([ApplicationState.Started, ApplicationState.Stopped]).toContain(app.state);
    });
  });

  describe('Multiple modules registering simultaneously', () => {
    it('should handle concurrent module registration', async () => {
      const modules: IModule[] = [];
      for (let i = 0; i < 10; i++) {
        modules.push({
          name: `module-${i}`,
          async onRegister() {
            tracker.registerCount++;
            await delay(Math.random() * 10);
          },
          async onStart() {
            tracker.startCount++;
          },
        });
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules,
      });

      await app.start();

      // All modules should be registered and started
      expect(tracker.registerCount).toBe(10);
      expect(tracker.startCount).toBe(10);
    });

    it('should maintain module registration order despite async operations', async () => {
      const registrationOrder: string[] = [];
      const startOrder: string[] = [];

      const modules: IModule[] = [];
      for (let i = 0; i < 5; i++) {
        modules.push({
          name: `ordered-module-${i}`,
          async onRegister() {
            // Add random delay to simulate async work
            await delay(Math.random() * 20);
            registrationOrder.push(`ordered-module-${i}`);
          },
          async onStart() {
            // Add random delay to simulate async work
            await delay(Math.random() * 20);
            startOrder.push(`ordered-module-${i}`);
          },
        });
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules,
      });

      await app.start();

      // Order should be preserved due to sequential execution
      expect(registrationOrder).toEqual([
        'ordered-module-0',
        'ordered-module-1',
        'ordered-module-2',
        'ordered-module-3',
        'ordered-module-4',
      ]);
      expect(startOrder).toEqual([
        'ordered-module-0',
        'ordered-module-1',
        'ordered-module-2',
        'ordered-module-3',
        'ordered-module-4',
      ]);
    });

    it('should handle late module registration during start', async () => {
      let _lateModuleRegistered = false;

      class EarlyModule implements IModule {
        name = 'early-module';
        async onStart(application: IApplication) {
          // Try to register a module during start
          // This should work as modules can be added dynamically
          (application as Application).use({
            name: 'late-module',
            async onStart() {
              _lateModuleRegistered = true;
            },
          });
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [EarlyModule],
      });

      await app.start();

      // The late module might or might not be started depending on implementation
      // The key is that it shouldn't crash
      expect(app.state).toBe(ApplicationState.Started);
    });
  });

  describe('Race conditions in event handling', () => {
    it('should handle events emitted during concurrent operations', async () => {
      const events: string[] = [];

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      // Register event handlers
      app.on(ApplicationEvent.Starting, () => events.push('starting'));
      app.on(ApplicationEvent.Started, () => events.push('started'));
      app.on(ApplicationEvent.Stopping, () => events.push('stopping'));
      app.on(ApplicationEvent.Stopped, () => events.push('stopped'));

      // Run concurrent operations
      await app.start();
      await app.stop();

      // Events should be in correct order
      expect(events.indexOf('starting')).toBeLessThan(events.indexOf('started'));
      expect(events.indexOf('stopping')).toBeLessThan(events.indexOf('stopped'));
    });

    it('should not lose events during rapid state transitions', async () => {
      const moduleEvents: string[] = [];

      class EventTrackerModule implements IModule {
        name = 'event-tracker';
        async onStart(application: IApplication) {
          application.on(ApplicationEvent.Started, () => moduleEvents.push('started'));
          application.on(ApplicationEvent.Stopping, () => moduleEvents.push('stopping'));
          application.on(ApplicationEvent.Stopped, () => moduleEvents.push('stopped'));
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [EventTrackerModule],
      });

      await app.start();

      // Events registered during onStart should receive events
      await app.stop();

      expect(moduleEvents).toContain('stopping');
      expect(moduleEvents).toContain('stopped');
    });

    it('should handle concurrent event emissions from multiple modules', async () => {
      const receivedEvents: string[] = [];

      const modules: IModule[] = [];
      for (let i = 0; i < 5; i++) {
        modules.push({
          name: `event-module-${i}`,
          async onStart(application: IApplication) {
            application.emit('custom' as any, { moduleId: i });
          },
        });
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules,
      });

      app.on('custom' as any, (data: { moduleId: number }) => {
        receivedEvents.push(`module-${data.moduleId}`);
      });

      await app.start();

      // All custom events should be received
      expect(receivedEvents.length).toBe(5);
    });

    it('should handle event handler errors without affecting other handlers', async () => {
      const handlerResults: string[] = [];

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      // First handler throws
      app.on(ApplicationEvent.Started, () => {
        throw new Error('Handler error');
      });

      // Second handler should still run
      app.on(ApplicationEvent.Started, () => {
        handlerResults.push('second-handler');
      });

      // Third handler should also run
      app.on(ApplicationEvent.Started, () => {
        handlerResults.push('third-handler');
      });

      await app.start();

      // Other handlers should have run
      expect(handlerResults).toContain('second-handler');
      expect(handlerResults).toContain('third-handler');
    });
  });

  describe('State consistency under concurrent access', () => {
    it('should maintain consistent state during rapid transitions', async () => {
      const observedStates: ApplicationState[] = [];

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      // Capture state changes
      const captureState = () => observedStates.push(app.state);

      app.on(ApplicationEvent.Starting, captureState);
      app.on(ApplicationEvent.Started, captureState);
      app.on(ApplicationEvent.Stopping, captureState);
      app.on(ApplicationEvent.Stopped, captureState);

      // Perform rapid transitions
      await app.start();
      await app.restart();
      await app.stop();

      // State should progress logically
      for (let i = 1; i < observedStates.length; i++) {
        const prev = observedStates[i - 1];
        const curr = observedStates[i];

        // Define valid transitions
        const validTransitions: Record<ApplicationState, ApplicationState[]> = {
          [ApplicationState.Created]: [ApplicationState.Starting],
          [ApplicationState.Starting]: [ApplicationState.Started, ApplicationState.Failed],
          [ApplicationState.Started]: [ApplicationState.Stopping],
          [ApplicationState.Stopping]: [ApplicationState.Stopped, ApplicationState.Failed],
          [ApplicationState.Stopped]: [ApplicationState.Starting],
          [ApplicationState.Failed]: [ApplicationState.Stopped, ApplicationState.Starting],
        };

        // Allow transition or same state (for events during transition)
        if (prev !== undefined && curr !== undefined) {
          const allowedNextStates = validTransitions[prev] || [];
          // State could be same if capturing during a transition
          expect([prev, ...allowedNextStates]).toContain(curr);
        }
      }
    });

    it('should not have race conditions when checking isStarted', async () => {
      class StateCheckerModule implements IModule {
        name = 'state-checker';
        async onStart() {
          // During start, isStarted should be false
          tracker.events.push(`during-start:${app.isStarted}`);
        }
        async onStop() {
          // During stop, isStarted should be true or transitioning
          tracker.events.push(`during-stop:${app.isStarted}`);
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [StateCheckerModule],
      });

      await app.start();
      tracker.events.push(`after-start:${app.isStarted}`);

      await app.stop();
      tracker.events.push(`after-stop:${app.isStarted}`);

      // Verify state consistency
      expect(tracker.events).toContain('after-start:true');
      expect(tracker.events).toContain('after-stop:false');
    });
  });

  describe('Concurrent hook execution', () => {
    it('should execute start hooks sequentially', async () => {
      const hookOrder: number[] = [];

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      // Register multiple hooks with different delays
      for (let i = 0; i < 5; i++) {
        app.onStart({
          name: `hook-${i}`,
          handler: async () => {
            await delay(30 - i * 5); // Decreasing delays
            hookOrder.push(i);
          },
        });
      }

      await app.start();

      // Hooks should execute in registration order, not completion order
      expect(hookOrder).toEqual([0, 1, 2, 3, 4]);
    });

    it('should handle concurrent hook registration during startup', async () => {
      const executedHooks: string[] = [];

      class HookRegisteringModule implements IModule {
        name = 'hook-registering';
        async onStart(application: IApplication) {
          (application as Application).onStart({
            name: 'dynamic-hook',
            handler: async () => {
              executedHooks.push('dynamic-hook');
            },
          });
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [HookRegisteringModule],
      });

      await app.start();

      // Dynamic hook may or may not execute depending on when it was registered
      // The important thing is it shouldn't crash
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should handle multiple concurrent restarts correctly', async () => {
      let restartCount = 0;

      class CountingModule implements IModule {
        name = 'counting';
        async onStart() {
          restartCount++;
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [CountingModule],
      });

      await app.start();
      const initialCount = restartCount;

      // Multiple concurrent restart attempts
      const results = await Promise.allSettled([app.restart(), app.restart(), app.restart()]);

      // At least one restart should succeed
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThanOrEqual(1);

      // The application should be in a valid state
      expect(app.state).toBe(ApplicationState.Started);

      // At least one more start should have occurred
      expect(restartCount).toBeGreaterThan(initialCount);
    });
  });
});
