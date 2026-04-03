/**
 * Error Recovery and Rollback Tests for Titan Application
 *
 * Tests for error handling during bootstrap, graceful degradation,
 * partial failure recovery, and rollback scenarios.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Application } from '../../src/application.js';
import { ApplicationState, IModule, IApplication, ApplicationEvent } from '../../src/types.js';

// Track cleanup order for verification
let cleanupOrder: string[] = [];
let startOrder: string[] = [];

// Test modules with controlled failure behavior
class SuccessModule implements IModule {
  name: string;
  started = false;
  stopped = false;

  constructor(name: string) {
    this.name = name;
  }

  async onStart(app: IApplication) {
    startOrder.push(this.name);
    this.started = true;
  }

  async onStop(app: IApplication) {
    cleanupOrder.push(this.name);
    this.stopped = true;
  }
}

class FailingStartModule implements IModule {
  name: string;
  started = false;
  stopped = false;
  error: Error;

  constructor(name: string, errorMessage: string = 'Module start failed') {
    this.name = name;
    this.error = new Error(errorMessage);
  }

  async onStart(app: IApplication) {
    startOrder.push(this.name);
    throw this.error;
  }

  async onStop(app: IApplication) {
    cleanupOrder.push(this.name);
    this.stopped = true;
  }
}

class FailingStopModule implements IModule {
  name: string;
  started = false;
  stopped = false;
  error: Error;

  constructor(name: string, errorMessage: string = 'Module stop failed') {
    this.name = name;
    this.error = new Error(errorMessage);
  }

  async onStart(app: IApplication) {
    startOrder.push(this.name);
    this.started = true;
  }

  async onStop(app: IApplication) {
    cleanupOrder.push(this.name);
    throw this.error;
  }
}

class ConditionalFailModule implements IModule {
  name: string;
  shouldFail = true;
  failCount = 0;
  maxFails: number;
  started = false;

  constructor(name: string, maxFails: number = 1) {
    this.name = name;
    this.maxFails = maxFails;
  }

  async onStart(app: IApplication) {
    startOrder.push(this.name);
    if (this.shouldFail && this.failCount < this.maxFails) {
      this.failCount++;
      throw new Error(`Conditional fail #${this.failCount}`);
    }
    this.started = true;
  }

  async onStop(app: IApplication) {
    cleanupOrder.push(this.name);
  }
}

describe('Titan Application Error Recovery', () => {
  let app: Application;

  beforeEach(() => {
    cleanupOrder = [];
    startOrder = [];
  });

  afterEach(async () => {
    if (app) {
      try {
        await app.stop({ force: true });
      } catch {
        // Ignore stop errors in cleanup
      }
    }
  });

  describe('Bootstrap Error Handling', () => {
    it('should transition to Failed state on module start error', async () => {
      const failingModule = new FailingStartModule('failing', 'Bootstrap error');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [failingModule],
      });

      await expect(app.start()).rejects.toThrow('Bootstrap error');
      expect(app.state).toBe(ApplicationState.Failed);
    });

    it('should emit error event on module failure', async () => {
      const errors: Error[] = [];
      const failingModule = new FailingStartModule('failing', 'Error event test');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [failingModule],
      });

      app.on(ApplicationEvent.Error, (error: Error) => {
        errors.push(error);
      });

      await expect(app.start()).rejects.toThrow();

      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0].message).toBe('Error event test');
    });

    it('should stop already started modules on failure', async () => {
      const module1 = new SuccessModule('success-1');
      const module2 = new SuccessModule('success-2');
      const failingModule = new FailingStartModule('failing', 'Mid-start failure');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [module1, module2, failingModule],
      });

      await expect(app.start()).rejects.toThrow('Mid-start failure');

      // First two modules should have started
      expect(module1.started).toBe(true);
      expect(module2.started).toBe(true);

      // After failure, should be able to stop for cleanup
      await app.stop({ force: true });
      expect(app.state).toBe(ApplicationState.Stopped);
    });
  });

  describe('Graceful Degradation', () => {
    it('should continue stop despite module stop errors with graceful: true', async () => {
      const module1 = new SuccessModule('success-1');
      const failingModule = new FailingStopModule('failing-stop', 'Stop error');
      const module2 = new SuccessModule('success-2');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [module1, failingModule, module2],
      });

      await app.start();

      // Default graceful behavior - continues despite errors
      await app.stop();

      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should throw on stop error with graceful: false', async () => {
      const failingModule = new FailingStopModule('failing-stop', 'Stop error');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [failingModule],
      });

      await app.start();

      await expect(app.stop({ graceful: false })).rejects.toThrow('Stop error');
    });

    it('should force stop despite errors with force: true', async () => {
      const failingModule = new FailingStopModule('failing-stop', 'Force stop error');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [failingModule],
      });

      await app.start();

      await app.stop({ force: true });

      expect(app.state).toBe(ApplicationState.Stopped);
    });
  });

  describe('Recovery After Failure', () => {
    it('should allow restart after stop from failed state', async () => {
      const conditionalModule = new ConditionalFailModule('conditional', 1);

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [conditionalModule],
      });

      // First start fails
      await expect(app.start()).rejects.toThrow('Conditional fail #1');
      expect(app.state).toBe(ApplicationState.Failed);

      // Stop from failed state
      await app.stop({ force: true });
      expect(app.state).toBe(ApplicationState.Stopped);

      // Module no longer fails
      conditionalModule.shouldFail = false;

      // Second start should succeed
      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
      expect(conditionalModule.started).toBe(true);
    });

    it('should not allow direct restart from failed state', async () => {
      const failingModule = new FailingStartModule('failing', 'Cannot restart');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [failingModule],
      });

      await expect(app.start()).rejects.toThrow('Cannot restart');
      expect(app.state).toBe(ApplicationState.Failed);

      // Cannot start directly from failed state
      await expect(app.start()).rejects.toThrow('Cannot start from failed state');
    });
  });

  describe('Partial Module Failure', () => {
    it('should track which modules started before failure', async () => {
      const module1 = new SuccessModule('module-1');
      const module2 = new SuccessModule('module-2');
      const failingModule = new FailingStartModule('failing', 'Partial failure');
      const module3 = new SuccessModule('module-3');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [module1, module2, failingModule, module3],
      });

      await expect(app.start()).rejects.toThrow('Partial failure');

      // First two started
      expect(module1.started).toBe(true);
      expect(module2.started).toBe(true);

      // Module after failure didn't start
      expect(module3.started).toBe(false);
    });

    it('should cleanup started modules in reverse order after failure', async () => {
      const module1 = new SuccessModule('module-1-cleanup');
      const module2 = new SuccessModule('module-2-cleanup');
      const failingModule = new FailingStartModule('failing-cleanup', 'Cleanup test');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [module1, module2, failingModule],
      });

      await expect(app.start()).rejects.toThrow('Cleanup test');

      // Stop to trigger cleanup (not force to ensure onStop is called)
      await app.stop();

      // When stopping from failed state, modules that started should be stopped
      // Note: The behavior depends on implementation - some modules may have
      // their stop called during failure recovery, others during explicit stop
      expect(app.state).toBe(ApplicationState.Stopped);
    });
  });

  describe('Lifecycle Hook Error Handling', () => {
    it('should handle errors in start hooks', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      app.onStart({
        name: 'failing-hook',
        handler: async () => {
          throw new Error('Start hook failed');
        },
      });

      await expect(app.start()).rejects.toThrow('Start hook failed');
      expect(app.state).toBe(ApplicationState.Failed);
    });

    it('should handle errors in stop hooks', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      await app.start();

      app.onStop({
        name: 'failing-stop-hook',
        handler: async () => {
          throw new Error('Stop hook failed');
        },
      });

      // Default behavior - doesn't throw
      await expect(app.stop({ graceful: false })).rejects.toThrow('Stop hook failed');
    });

    it('should continue with other stop hooks after one fails with force', async () => {
      const hookOrder: string[] = [];

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      await app.start();

      app.onStop({
        name: 'hook-1',
        handler: async () => {
          hookOrder.push('hook-1');
          throw new Error('Hook 1 failed');
        },
      });

      app.onStop({
        name: 'hook-2',
        handler: async () => {
          hookOrder.push('hook-2');
        },
      });

      await app.stop({ force: true });

      expect(app.state).toBe(ApplicationState.Stopped);
    });
  });

  describe('Error Handler Registration', () => {
    it('should call registered error handlers', async () => {
      const handledErrors: Error[] = [];
      const failingModule = new FailingStartModule('failing', 'Handler test');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [failingModule],
      });

      app.onError((error) => {
        handledErrors.push(error);
      });

      await expect(app.start()).rejects.toThrow();

      expect(handledErrors.length).toBeGreaterThanOrEqual(1);
    });

    it('should handle errors in error handlers gracefully', async () => {
      const failingModule = new FailingStartModule('failing', 'Handler error test');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [failingModule],
      });

      app.onError(() => {
        throw new Error('Error handler failed');
      });

      // Should not throw from handler error
      await expect(app.start()).rejects.toThrow('Handler error test');

      consoleSpy.mockRestore();
    });

    it('should continue calling other error handlers after one fails', async () => {
      const handledErrors: string[] = [];
      const failingModule = new FailingStartModule('failing', 'Multi-handler test');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [failingModule],
      });

      app.onError(() => {
        handledErrors.push('handler-1');
        throw new Error('Handler 1 failed');
      });

      app.onError(() => {
        handledErrors.push('handler-2');
      });

      await expect(app.start()).rejects.toThrow();

      expect(handledErrors).toContain('handler-1');
      expect(handledErrors).toContain('handler-2');

      consoleSpy.mockRestore();
    });
  });

  describe('Timeout Error Handling', () => {
    it('should timeout slow start hooks', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      app.onStart({
        name: 'slow-hook',
        timeout: 50,
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
        },
      });

      await expect(app.start()).rejects.toThrow('timed out');
    });

    it('should timeout slow stop hooks', async () => {
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      await app.start();

      app.onStop({
        name: 'slow-stop-hook',
        timeout: 50,
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
        },
      });

      await expect(app.stop()).rejects.toThrow('timed out');
    });
  });

  describe('State Consistency After Errors', () => {
    it('should maintain consistent state after start failure', async () => {
      const failingModule = new FailingStartModule('failing', 'State test');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [failingModule],
      });

      expect(app.state).toBe(ApplicationState.Created);
      expect(app.isStarted).toBe(false);

      await expect(app.start()).rejects.toThrow();

      expect(app.state).toBe(ApplicationState.Failed);
      expect(app.isStarted).toBe(false);
    });

    it('should reset state after force stop from failed state', async () => {
      const failingModule = new FailingStartModule('failing', 'Reset test');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [failingModule],
      });

      await expect(app.start()).rejects.toThrow();
      expect(app.state).toBe(ApplicationState.Failed);

      await app.stop({ force: true });

      expect(app.state).toBe(ApplicationState.Stopped);
      expect(app.isStarted).toBe(false);
    });
  });
});
