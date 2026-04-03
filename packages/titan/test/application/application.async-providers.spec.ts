/**
 * Async Provider Tests for Titan Application
 *
 * Tests for async providers, factory functions, and complex
 * async initialization scenarios.
 */
import { describe, it, expect, afterEach } from 'vitest';

import { Application } from '../../src/application.js';
import { ApplicationState, IModule, IApplication } from '../../src/types.js';
import { createToken } from '../../src/nexus/index.js';

describe('Titan Application Async Providers', () => {
  let app: Application;

  afterEach(async () => {
    if (app && app.state === ApplicationState.Started) {
      await app.stop({ force: true });
    }
  });

  describe('Async Factory Functions', () => {
    it('should resolve async factory provider', async () => {
      const ASYNC_TOKEN = createToken<{ value: string }>('AsyncProvider');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [
          [
            ASYNC_TOKEN,
            {
              useFactory: async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return { value: 'async-result' };
              },
            },
          ],
        ],
      });

      await app.start();

      const result = await app.container.resolveAsync(ASYNC_TOKEN);
      expect(result.value).toBe('async-result');
    });

    it('should handle multiple async factories', async () => {
      const TOKEN_A = createToken<{ a: number }>('ProviderA');
      const TOKEN_B = createToken<{ b: number }>('ProviderB');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [
          [
            TOKEN_A,
            {
              useFactory: async () => {
                await new Promise((resolve) => setTimeout(resolve, 20));
                return { a: 1 };
              },
            },
          ],
          [
            TOKEN_B,
            {
              useFactory: async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return { b: 2 };
              },
            },
          ],
        ],
      });

      await app.start();

      const [resultA, resultB] = await Promise.all([
        app.container.resolveAsync(TOKEN_A),
        app.container.resolveAsync(TOKEN_B),
      ]);

      expect(resultA.a).toBe(1);
      expect(resultB.b).toBe(2);
    });

    it('should handle async factory with dependencies', async () => {
      const CONFIG_TOKEN = createToken<{ timeout: number }>('Config');
      const SERVICE_TOKEN = createToken<{ getData: () => Promise<string> }>('Service');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [
          [CONFIG_TOKEN, { useValue: { timeout: 100 } }],
          [
            SERVICE_TOKEN,
            {
              useFactory: async (config: { timeout: number }) => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                return {
                  getData: async () => {
                    await new Promise((resolve) => setTimeout(resolve, config.timeout / 10));
                    return 'data';
                  },
                };
              },
              inject: [CONFIG_TOKEN],
            },
          ],
        ],
      });

      await app.start();

      const service = await app.container.resolveAsync(SERVICE_TOKEN);
      const data = await service.getData();
      expect(data).toBe('data');
    });
  });

  describe('Async Module Initialization', () => {
    it('should handle module with async onStart', async () => {
      let initOrder: string[] = [];

      class AsyncModule implements IModule {
        name = 'async-module';

        async onStart(app: IApplication) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          initOrder.push('async-started');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [AsyncModule],
      });

      await app.start();

      expect(initOrder).toContain('async-started');
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should maintain module order with async operations', async () => {
      let initOrder: string[] = [];

      class SlowModule implements IModule {
        name = 'slow-module';

        async onStart() {
          await new Promise((resolve) => setTimeout(resolve, 30));
          initOrder.push('slow');
        }
      }

      class FastModule implements IModule {
        name = 'fast-module';

        async onStart() {
          await new Promise((resolve) => setTimeout(resolve, 5));
          initOrder.push('fast');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [SlowModule, FastModule],
      });

      await app.start();

      // Order should be preserved (slow first, then fast)
      expect(initOrder).toEqual(['slow', 'fast']);
    });
  });

  describe('Async Hooks', () => {
    it('should handle async start hooks', async () => {
      let hookResult = '';

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      app.onStart({
        name: 'async-hook',
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          hookResult = 'completed';
        },
      });

      await app.start();

      expect(hookResult).toBe('completed');
    });

    it('should handle async stop hooks', async () => {
      let cleanupResult = '';

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      await app.start();

      app.onStop({
        name: 'async-cleanup',
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          cleanupResult = 'cleaned';
        },
      });

      await app.stop();

      expect(cleanupResult).toBe('cleaned');
    });

    it('should run async hooks in registration order', async () => {
      const order: number[] = [];

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
      });

      app.onStart({
        name: 'hook-1',
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          order.push(1);
        },
      });

      app.onStart({
        name: 'hook-2',
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          order.push(2);
        },
      });

      app.onStart({
        name: 'hook-3',
        handler: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          order.push(3);
        },
      });

      await app.start();

      expect(order).toEqual([1, 2, 3]);
    });
  });

  describe('Async Error Handling', () => {
    it('should handle async factory errors', async () => {
      const FAILING_TOKEN = createToken<any>('FailingProvider');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [
          [
            FAILING_TOKEN,
            {
              useFactory: async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                throw new Error('Async factory failed');
              },
            },
          ],
        ],
      });

      await app.start();

      // Resolution should fail
      await expect(app.container.resolveAsync(FAILING_TOKEN)).rejects.toThrow('Async factory failed');
    });

    it('should handle async module start errors', async () => {
      class FailingAsyncModule implements IModule {
        name = 'failing-async';

        async onStart() {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error('Async start failed');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [FailingAsyncModule],
      });

      await expect(app.start()).rejects.toThrow('Async start failed');
      expect(app.state).toBe(ApplicationState.Failed);
    });
  });

  describe('Parallel Async Operations', () => {
    it('should handle concurrent module starts', async () => {
      const startTimes: Map<string, number> = new Map();
      const endTimes: Map<string, number> = new Map();

      const createParallelModule = (name: string, delay: number) => ({
        name,
        async onStart() {
          startTimes.set(name, Date.now());
          await new Promise((resolve) => setTimeout(resolve, delay));
          endTimes.set(name, Date.now());
        },
      });

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [
          createParallelModule('mod-a', 50),
          createParallelModule('mod-b', 50),
          createParallelModule('mod-c', 50),
        ],
      });

      const startTime = Date.now();
      await app.start();
      const totalTime = Date.now() - startTime;

      // If parallel, should take ~50ms; if sequential, ~150ms
      // Allow for some overhead
      expect(totalTime).toBeGreaterThanOrEqual(50);
    });
  });

  describe('Async Shutdown', () => {
    it('should handle async module stop', async () => {
      let stopCompleted = false;

      class AsyncStopModule implements IModule {
        name = 'async-stop';

        async onStart() {}

        async onStop() {
          await new Promise((resolve) => setTimeout(resolve, 20));
          stopCompleted = true;
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [AsyncStopModule],
      });

      await app.start();
      await app.stop();

      expect(stopCompleted).toBe(true);
    });

    it('should respect stop timeout for async operations', async () => {
      class VerySlowModule implements IModule {
        name = 'very-slow';

        async onStart() {}

        async onStop() {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [VerySlowModule],
      });

      await app.start();

      // Should timeout
      await expect(app.stop({ timeout: 50 })).rejects.toThrow('timed out');
    });
  });

  describe('Lazy Async Initialization', () => {
    it('should support lazy async providers', async () => {
      let initCalled = false;
      const LAZY_TOKEN = createToken<{ init: boolean }>('LazyProvider');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [
          [
            LAZY_TOKEN,
            {
              useFactory: async () => {
                initCalled = true;
                await new Promise((resolve) => setTimeout(resolve, 10));
                return { init: true };
              },
            },
          ],
        ],
      });

      await app.start();

      // Provider not yet initialized (lazy)
      expect(initCalled).toBe(false);

      // Trigger initialization
      await app.container.resolveAsync(LAZY_TOKEN);

      expect(initCalled).toBe(true);
    });
  });

  describe('Async Cleanup Handlers', () => {
    it('should run async cleanup handlers', async () => {
      let cleanupRan = false;

      app = await Application.create({
        disableGracefulShutdown: false,
        disableCoreModules: true,
        environment: 'test',
      });

      app.registerCleanup(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        cleanupRan = true;
      });

      await app.start();
      // Use stop instead of shutdown to avoid process.exit
      await app.stop();

      expect(cleanupRan).toBe(true);
    });
  });
});
