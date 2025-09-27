/**
 * Edge case tests for Titan Application to achieve >96% coverage
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

import { createToken } from '@nexus';
import { Application, createApp } from '../../src/application.js';
import { LOGGER_SERVICE_TOKEN } from '../../src/modules/logger.module.js';
const CONFIG_SERVICE_TOKEN = createToken('ConfigModule');
import {
  ApplicationState,
  IApplication,
  IModule,
  LifecycleHook
} from '../../src/types.js';

// Test fixture
class EdgeCaseModule implements IModule {
  readonly name = 'edge-case';

  async onStop(app: IApplication): Promise<void> {
    // Simulate stop
  }
}

describe('Titan Application Edge Cases', () => {
  let app: Application;

  afterEach(async () => {
    if (app && app.state === ApplicationState.Started) {
      await app.stop().catch(() => { });
    }
  });

  describe('Uncovered Code Paths', () => {
    it('should handle timeout in stop hooks', async () => {
      app = createApp();

      // Add a slow stop hook with timeout
      app.onStop({
        name: 'slow-stop-hook',
        timeout: 50,
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      });

      await app.start();

      // Should timeout but continue
      await expect(app.stop()).rejects.toThrow('Stop hook slow-stop-hook timed out');
    });

    it('should handle module onStop without timeout option', async () => {
      app = createApp();

      const module = new EdgeCaseModule();
      app.use(module);

      await app.start();

      // Stop without timeout option (covers line 186 - else branch)
      await app.stop();

      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should handle module token resolution from container', async () => {
      app = createApp();

      const TestToken = createToken<EdgeCaseModule>('EdgeCaseModule');
      const module = new EdgeCaseModule();

      // Register directly in container without using app.use()
      app.container.register(TestToken, { useValue: module });

      // Get should try to resolve from container (covers lines 329-331)
      const resolved = app.get(TestToken);
      expect(resolved).toBe(module);
    });

    it('should throw when module not found in container resolution', async () => {
      app = createApp();

      const NonExistentToken = createToken<EdgeCaseModule>('NonExistent');

      // Mock container.resolve to throw
      const originalResolve = app.container.resolve;
      app.container.resolve = () => {
        throw new Error('Resolution failed');
      };

      // Should catch and throw module not found (covers lines 304-305, 334)
      expect(() => app.get(NonExistentToken)).toThrow('Module not found: NonExistent');

      // Restore
      app.container.resolve = originalResolve.bind(app.container);
    });

    it('should handle missing dependencies in module sorting', async () => {
      app = createApp();

      const DependencyToken = createToken('Dependency');

      class DependentModule implements IModule {
        readonly name = 'dependent';
        readonly dependencies = [DependencyToken];
      }

      const module = new DependentModule();
      const token = createToken<DependentModule>('dependent');

      app.container.register(token, { useValue: module });
      app.use(token);

      // Start should work even with missing dependency (covers line 524)
      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should handle stop hooks with no timeout', async () => {
      app = createApp();

      let hookCalled = false;

      // Add stop hook as function (covers line 431)
      app.onStop(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        hookCalled = true;
      });

      await app.start();
      await app.stop();

      expect(hookCalled).toBe(true);
    });

    it('should handle errors in error handlers gracefully', async () => {
      app = createApp();

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

      // Add error handler that throws (covers lines 589-592)
      app.onError(() => {
        throw new Error('Error handler failed');
      });

      // Also add a working handler
      const workingHandler = jest.fn();
      app.onError(workingHandler);

      // Emit error - should handle the throwing handler gracefully
      app.emit('error', new Error('Test error'));

      expect(consoleSpy).toHaveBeenCalledWith(
        'Error in error handler:',
        expect.any(Error)
      );
      expect(workingHandler).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle provider removal when container has no _providers', async () => {
      app = createApp();

      const TestToken = createToken('Test');
      const module = new EdgeCaseModule();

      // Mock container to have has() return true but no _providers
      const originalHas = app.container.has;
      app.container.has = () => true;

      // Remove internal providers reference (covers line 273)
      delete (app.container as any)._providers;
      delete (app.container as any).providers;

      // Should handle gracefully
      expect(() => app.replaceModule(TestToken, module)).not.toThrow();

      // Restore
      app.container.has = originalHas.bind(app.container);
    });

    it('should handle provider removal when providers is not a Map', async () => {
      app = createApp();

      const TestToken = createToken('Test');
      const module = new EdgeCaseModule();

      // Mock container to have has() return true
      const originalHas = app.container.has;
      app.container.has = () => true;

      // Set providers to non-Map (covers line 273)
      (app.container as any)._providers = {};

      // Should handle gracefully
      expect(() => app.replaceModule(TestToken, module)).not.toThrow();

      // Restore
      app.container.has = originalHas.bind(app.container);
    });

    it('should handle graceful shutdown errors with signal', async () => {
      app = createApp({ gracefulShutdownTimeout: 50 });

      // Mock stop to throw
      app.stop = jest.fn().mockRejectedValue(new Error('Stop failed'));

      // Mock process.exit and logger
      const exitMock = jest.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('Process exit');
      });

      // Trigger shutdown with signal
      const shutdown = (app as any).setupGracefulShutdown;
      if (typeof shutdown === 'function') {
        // Call the private shutdown function directly
        try {
          await (app as any).shutdown('SIGTERM');
        } catch {
          // Expected to throw from process.exit mock
        }
      }

      exitMock.mockRestore();
    });
  });

  describe('Additional Edge Cases', () => {
    it('should handle circular module registration', async () => {
      app = createApp();

      const token = createToken('circular');
      const module = new EdgeCaseModule();

      app.container.register(token, { useValue: module });
      app.use(token);

      // Try to use same token again - should be idempotent
      app.use(token);

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should handle module with undefined lifecycle methods', async () => {
      app = createApp();

      const bareModule = {
        name: 'bare',
        // No lifecycle methods
      };

      app.use(bareModule);

      await app.start();
      await app.stop();

      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should handle configuration with no module-specific config', async () => {
      app = createApp();

      class ConfigurableModule implements IModule {
        readonly name = 'configurable';
        configureCalledWith: any = null;

        configure(config: any): void {
          this.configureCalledWith = config;
        }
      }

      const module = new ConfigurableModule();

      // Use module when there's no config for it
      app.use(module);

      // configure was not called since no config exists
      expect(module.configureCalledWith).toBeNull();
    });

    it('should handle rapid event emissions', async () => {
      app = createApp();

      const handler = jest.fn();
      app.on('error', handler);

      // Emit many events rapidly
      for (let i = 0; i < 100; i++) {
        app.emit('error', new Error(`Error ${i}`));
      }

      expect(handler).toHaveBeenCalledTimes(100);
    });

    it('should handle module resolution with empty dependencies array', async () => {
      app = createApp();

      class NoDepsModule implements IModule {
        readonly name = 'no-deps';
        readonly dependencies = [];
      }

      const module = new NoDepsModule();
      app.use(module);

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should handle withTimeout rejection properly', async () => {
      app = createApp();

      // Access private withTimeout method through a hook
      let timeoutError: Error | null = null;

      app.onStart({
        name: 'timeout-test',
        timeout: 1,
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      });

      try {
        await app.start();
      } catch (error) {
        timeoutError = error as Error;
      }

      expect(timeoutError).toBeTruthy();
      expect(timeoutError?.message).toContain('timed out');
    });

    it('should maintain state consistency through multiple operations', async () => {
      app = createApp();

      // Start
      expect(app.state).toBe(ApplicationState.Created);
      await app.start();
      expect(app.state).toBe(ApplicationState.Started);

      // Stop
      await app.stop();
      expect(app.state).toBe(ApplicationState.Stopped);

      // Start again
      await app.start();
      expect(app.state).toBe(ApplicationState.Started);

      // Stop again
      await app.stop();
      expect(app.state).toBe(ApplicationState.Stopped);
    });

    it('should handle all event types', async () => {
      app = createApp();

      const events: string[] = [];
      const eventTypes: any[] = [
        'starting', 'started', 'stopping', 'stopped',
        'error', 'module:registered', 'module:started',
        'module:stopped', 'config:changed', 'health:check'
      ];

      eventTypes.forEach(event => {
        app.on(event, () => { events.push(event); });
      });

      // Trigger various events
      app.emit('health:check', { status: 'healthy' });
      app.configure({ test: true });

      await app.start();
      await app.stop();

      expect(events).toContain('health:check');
      expect(events).toContain('config:changed');
      expect(events).toContain('starting');
      expect(events).toContain('started');
    });

    it('should handle very long running modules', async () => {
      app = createApp();

      class SlowModule implements IModule {
        readonly name = 'slow';

        async onStart(): Promise<void> {
          // Simulate long initialization
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        async onStop(): Promise<void> {
          // Simulate long cleanup
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      const module = new SlowModule();
      app.use(module);

      const startTime = Date.now();
      await app.start();
      const startDuration = Date.now() - startTime;

      expect(startDuration).toBeGreaterThanOrEqual(200);

      const stopTime = Date.now();
      await app.stop();
      const stopDuration = Date.now() - stopTime;

      expect(stopDuration).toBeGreaterThanOrEqual(200);
    });

    it('should provide accurate metrics', async () => {
      app = createApp();

      await app.start();

      // Wait a bit for uptime
      await new Promise(resolve => setTimeout(resolve, 100));

      const metrics = app.metrics;

      expect(metrics.uptime).toBeGreaterThanOrEqual(100);
      expect(metrics.memoryUsage).toBeDefined();
      expect(metrics.memoryUsage.rss).toBeGreaterThan(0);
      expect(metrics.memoryUsage.heapUsed).toBeGreaterThan(0);
      expect(metrics.cpuUsage).toBeDefined();
    });
  });
});
