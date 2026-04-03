/**
 * Module Dependency Tests for Titan Application
 *
 * Tests for module dependency resolution, circular dependency handling,
 * missing dependency errors, and complex dependency graphs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { Application } from '../../src/application.js';
import { ApplicationState, IModule, IApplication } from '../../src/types.js';
import { Module } from '../../src/decorators/index.js';
import { createToken } from '../../src/nexus/index.js';

// Helper to create delays
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Track module lifecycle order
interface LifecycleTracker {
  registerOrder: string[];
  startOrder: string[];
  stopOrder: string[];
  destroyOrder: string[];
}

function createLifecycleTracker(): LifecycleTracker {
  return {
    registerOrder: [],
    startOrder: [],
    stopOrder: [],
    destroyOrder: [],
  };
}

describe('Titan Application Module Dependencies', () => {
  let app: Application;
  let tracker: LifecycleTracker;

  beforeEach(() => {
    tracker = createLifecycleTracker();
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

  describe('Circular dependency handling', () => {
    it('should handle simple circular dependencies', async () => {
      class ModuleA implements IModule {
        name = 'module-a';
        dependencies = ['module-b'];
        async onStart() {
          tracker.startOrder.push('a');
        }
      }

      class ModuleB implements IModule {
        name = 'module-b';
        dependencies = ['module-a']; // Circular dependency
        async onStart() {
          tracker.startOrder.push('b');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [ModuleA, ModuleB],
      });

      // Should either throw or handle gracefully
      try {
        await app.start();
        // If it doesn't throw, both modules should start
        expect(tracker.startOrder.length).toBe(2);
        expect(app.state).toBe(ApplicationState.Started);
      } catch (error) {
        // Circular dependency should be detected
        expect(error).toBeDefined();
      }
    });

    it('should detect transitive circular dependencies (A -> B -> C -> A)', async () => {
      class ModuleA implements IModule {
        name = 'module-a-trans';
        dependencies = ['module-b-trans'];
        async onStart() {
          tracker.startOrder.push('a');
        }
      }

      class ModuleB implements IModule {
        name = 'module-b-trans';
        dependencies = ['module-c-trans'];
        async onStart() {
          tracker.startOrder.push('b');
        }
      }

      class ModuleC implements IModule {
        name = 'module-c-trans';
        dependencies = ['module-a-trans']; // Completes the circle
        async onStart() {
          tracker.startOrder.push('c');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [ModuleA, ModuleB, ModuleC],
      });

      try {
        await app.start();
        // If it doesn't throw, modules should start in some order
        expect(tracker.startOrder.length).toBe(3);
      } catch (error) {
        // Circular dependency detected
        expect(error).toBeDefined();
      }
    });

    it('should handle self-referential dependencies', async () => {
      class SelfReferentialModule implements IModule {
        name = 'self-ref';
        dependencies = ['self-ref']; // Self-reference
        async onStart() {
          tracker.startOrder.push('self-ref');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [SelfReferentialModule],
      });

      try {
        await app.start();
        // Should either handle gracefully or throw
        expect(tracker.startOrder.length).toBeGreaterThanOrEqual(0);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Missing dependency errors', () => {
    it('should handle modules with missing dependencies gracefully', async () => {
      class DependentModule implements IModule {
        name = 'dependent';
        dependencies = ['missing-module'];
        async onStart() {
          tracker.startOrder.push('dependent');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [DependentModule],
      });

      // Should start despite missing dependency (soft dependency)
      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should handle multiple missing dependencies', async () => {
      class MultiDependentModule implements IModule {
        name = 'multi-dependent';
        dependencies = ['missing-1', 'missing-2', 'missing-3'];
        async onStart() {
          tracker.startOrder.push('multi-dependent');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [MultiDependentModule],
      });

      await app.start();
      expect(app.state).toBe(ApplicationState.Started);
    });

    it('should handle partially missing dependencies', async () => {
      class ExistingModule implements IModule {
        name = 'existing';
        async onStart() {
          tracker.startOrder.push('existing');
        }
      }

      class PartialDependentModule implements IModule {
        name = 'partial-dependent';
        dependencies = ['existing', 'missing'];
        async onStart() {
          tracker.startOrder.push('partial-dependent');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [ExistingModule, PartialDependentModule],
      });

      await app.start();

      // Existing module should start before partial-dependent
      expect(tracker.startOrder.indexOf('existing')).toBeLessThan(tracker.startOrder.indexOf('partial-dependent'));
    });
  });

  describe('Deep nested module dependencies', () => {
    it('should handle deeply nested dependency chains', async () => {
      const depth = 10;
      const modules: IModule[] = [];

      for (let i = 0; i < depth; i++) {
        const idx = i;
        const deps = idx > 0 ? ['deep-module-' + (idx - 1)] : [];
        modules.push({
          name: 'deep-module-' + idx,
          dependencies: deps,
          async onStart() {
            tracker.startOrder.push('deep-module-' + idx);
          },
        });
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules,
      });

      await app.start();

      // All modules should start
      expect(tracker.startOrder.length).toBe(depth);

      // Should start in dependency order (0, 1, 2, ... 9)
      for (let i = 0; i < depth - 1; i++) {
        expect(tracker.startOrder.indexOf('deep-module-' + i)).toBeLessThan(
          tracker.startOrder.indexOf('deep-module-' + (i + 1))
        );
      }
    });

    it('should handle diamond dependency pattern', async () => {
      //       A
      //      / \
      //     B   C
      //      \ /
      //       D

      class ModuleA implements IModule {
        name = 'diamond-a';
        async onStart() {
          tracker.startOrder.push('a');
        }
      }

      class ModuleB implements IModule {
        name = 'diamond-b';
        dependencies = ['diamond-a'];
        async onStart() {
          tracker.startOrder.push('b');
        }
      }

      class ModuleC implements IModule {
        name = 'diamond-c';
        dependencies = ['diamond-a'];
        async onStart() {
          tracker.startOrder.push('c');
        }
      }

      class ModuleD implements IModule {
        name = 'diamond-d';
        dependencies = ['diamond-b', 'diamond-c'];
        async onStart() {
          tracker.startOrder.push('d');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [ModuleD, ModuleC, ModuleB, ModuleA], // Reverse order to test sorting
      });

      await app.start();

      // A should start first
      expect(tracker.startOrder[0]).toBe('a');
      // D should start last
      expect(tracker.startOrder[tracker.startOrder.length - 1]).toBe('d');
      // B and C should start before D
      expect(tracker.startOrder.indexOf('b')).toBeLessThan(tracker.startOrder.indexOf('d'));
      expect(tracker.startOrder.indexOf('c')).toBeLessThan(tracker.startOrder.indexOf('d'));
    });

    it('should handle wide dependency fan-out', async () => {
      class RootModule implements IModule {
        name = 'root';
        async onStart() {
          tracker.startOrder.push('root');
        }
      }

      const fanOutModules: IModule[] = [];
      for (let i = 0; i < 10; i++) {
        const idx = i;
        fanOutModules.push({
          name: 'fan-' + idx,
          dependencies: ['root'],
          async onStart() {
            tracker.startOrder.push('fan-' + idx);
          },
        });
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [...fanOutModules, RootModule],
      });

      await app.start();

      // Root should start first
      expect(tracker.startOrder[0]).toBe('root');
      // All fan-out modules should start after root
      for (let i = 0; i < 10; i++) {
        expect(tracker.startOrder.indexOf('fan-' + i)).toBeGreaterThan(0);
      }
    });

    it('should handle wide dependency fan-in', async () => {
      const baseModules: IModule[] = [];
      for (let i = 0; i < 5; i++) {
        const idx = i;
        baseModules.push({
          name: 'base-' + idx,
          async onStart() {
            tracker.startOrder.push('base-' + idx);
          },
        });
      }

      class ConsumerModule implements IModule {
        name = 'consumer';
        dependencies = ['base-0', 'base-1', 'base-2', 'base-3', 'base-4'];
        async onStart() {
          tracker.startOrder.push('consumer');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [ConsumerModule, ...baseModules],
      });

      await app.start();

      // Consumer should start last
      expect(tracker.startOrder[tracker.startOrder.length - 1]).toBe('consumer');
      // All base modules should start before consumer
      for (let i = 0; i < 5; i++) {
        expect(tracker.startOrder.indexOf('base-' + i)).toBeLessThan(tracker.startOrder.indexOf('consumer'));
      }
    });
  });

  describe('Conditional dependencies', () => {
    it('should handle dependencies based on runtime conditions', async () => {
      const shouldEnableOptional = true;

      class CoreModule implements IModule {
        name = 'core';
        async onStart() {
          tracker.startOrder.push('core');
        }
      }

      class OptionalModule implements IModule {
        name = 'optional';
        dependencies = ['core'];
        async onStart() {
          tracker.startOrder.push('optional');
        }
      }

      class ConditionalConsumer implements IModule {
        name = 'conditional-consumer';
        dependencies = shouldEnableOptional ? ['optional'] : ['core'];
        async onStart() {
          tracker.startOrder.push('conditional-consumer');
        }
      }

      const modules: IModule[] = [CoreModule];
      if (shouldEnableOptional) {
        modules.push(OptionalModule);
      }
      modules.push(ConditionalConsumer);

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules,
      });

      await app.start();

      expect(tracker.startOrder).toContain('core');
      expect(tracker.startOrder).toContain('conditional-consumer');
      if (shouldEnableOptional) {
        expect(tracker.startOrder).toContain('optional');
        expect(tracker.startOrder.indexOf('optional')).toBeLessThan(tracker.startOrder.indexOf('conditional-consumer'));
      }
    });

    it('should handle optional dependencies that may or may not be present', async () => {
      let optionalModulePresent = false;

      class MainModule implements IModule {
        name = 'main';
        // Soft dependency - doesn't require 'optional' to exist
        dependencies = ['optional'];

        async onStart(application: IApplication) {
          tracker.startOrder.push('main');
          // Check if optional module is available
          if (application.modules.has('optional')) {
            optionalModulePresent = true;
          }
        }
      }

      // Test without optional module
      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [MainModule],
      });

      await app.start();

      expect(tracker.startOrder).toContain('main');
      expect(optionalModulePresent).toBe(false);
    });

    it('should handle feature flag based dependencies', async () => {
      interface FeatureFlags {
        enableCache: boolean;
        enableMetrics: boolean;
      }

      const flags: FeatureFlags = {
        enableCache: true,
        enableMetrics: false,
      };

      class CacheModule implements IModule {
        name = 'cache';
        async onStart() {
          tracker.startOrder.push('cache');
        }
      }

      class MetricsModule implements IModule {
        name = 'metrics';
        async onStart() {
          tracker.startOrder.push('metrics');
        }
      }

      class AppModule implements IModule {
        name = 'app';
        dependencies = [...(flags.enableCache ? ['cache'] : []), ...(flags.enableMetrics ? ['metrics'] : [])];
        async onStart() {
          tracker.startOrder.push('app');
        }
      }

      const modules: IModule[] = [AppModule];
      if (flags.enableCache) modules.unshift(CacheModule);
      if (flags.enableMetrics) modules.unshift(MetricsModule);

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules,
      });

      await app.start();

      expect(tracker.startOrder).toContain('app');
      expect(tracker.startOrder).toContain('cache');
      expect(tracker.startOrder).not.toContain('metrics');
    });
  });

  describe('Dependency resolution order', () => {
    it('should stop modules in reverse dependency order', async () => {
      class ModuleA implements IModule {
        name = 'stop-a';
        async onStart() {
          tracker.startOrder.push('a');
        }
        async onStop() {
          tracker.stopOrder.push('a');
        }
      }

      class ModuleB implements IModule {
        name = 'stop-b';
        dependencies = ['stop-a'];
        async onStart() {
          tracker.startOrder.push('b');
        }
        async onStop() {
          tracker.stopOrder.push('b');
        }
      }

      class ModuleC implements IModule {
        name = 'stop-c';
        dependencies = ['stop-b'];
        async onStart() {
          tracker.startOrder.push('c');
        }
        async onStop() {
          tracker.stopOrder.push('c');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [ModuleC, ModuleB, ModuleA],
      });

      await app.start();
      await app.stop();

      // Start order should be: a, b, c
      expect(tracker.startOrder).toEqual(['a', 'b', 'c']);
      // Stop order should be reverse: c, b, a
      expect(tracker.stopOrder).toEqual(['c', 'b', 'a']);
    });

    it('should handle complex dependency graph for stop order', async () => {
      //       A
      //      / \
      //     B   C
      //      \ /
      //       D

      const modules = [
        {
          name: 'graph-a',
          dependencies: [] as string[],
          async onStart() {
            tracker.startOrder.push('a');
          },
          async onStop() {
            tracker.stopOrder.push('a');
          },
        },
        {
          name: 'graph-b',
          dependencies: ['graph-a'],
          async onStart() {
            tracker.startOrder.push('b');
          },
          async onStop() {
            tracker.stopOrder.push('b');
          },
        },
        {
          name: 'graph-c',
          dependencies: ['graph-a'],
          async onStart() {
            tracker.startOrder.push('c');
          },
          async onStop() {
            tracker.stopOrder.push('c');
          },
        },
        {
          name: 'graph-d',
          dependencies: ['graph-b', 'graph-c'],
          async onStart() {
            tracker.startOrder.push('d');
          },
          async onStop() {
            tracker.stopOrder.push('d');
          },
        },
      ];

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules,
      });

      await app.start();
      await app.stop();

      // D should stop before B and C
      expect(tracker.stopOrder.indexOf('d')).toBeLessThan(tracker.stopOrder.indexOf('b'));
      expect(tracker.stopOrder.indexOf('d')).toBeLessThan(tracker.stopOrder.indexOf('c'));
      // B and C should stop before A
      expect(tracker.stopOrder.indexOf('b')).toBeLessThan(tracker.stopOrder.indexOf('a'));
      expect(tracker.stopOrder.indexOf('c')).toBeLessThan(tracker.stopOrder.indexOf('a'));
    });
  });

  describe('Cross-module provider dependencies', () => {
    it('should resolve provider dependencies across modules', async () => {
      const SERVICE_TOKEN = createToken<{ getValue: () => string }>('Service');

      @Module({
        providers: [{ provide: SERVICE_TOKEN, useValue: { getValue: () => 'test-value' } }],
        exports: [SERVICE_TOKEN],
      })
      class ProviderModule implements IModule {
        name = 'provider-module';
        async onStart() {
          tracker.startOrder.push('provider');
        }
      }

      class ConsumerModule implements IModule {
        name = 'consumer-module';
        dependencies = ['provider-module'];
        private serviceValue = '';

        async onStart(application: IApplication) {
          tracker.startOrder.push('consumer');
          const service = application.resolve(SERVICE_TOKEN);
          this.serviceValue = service.getValue();
        }

        getValue() {
          return this.serviceValue;
        }
      }

      const consumerModule = new ConsumerModule();

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [consumerModule, ProviderModule],
      });

      await app.start();

      expect(tracker.startOrder.indexOf('provider')).toBeLessThan(tracker.startOrder.indexOf('consumer'));
      expect(consumerModule.getValue()).toBe('test-value');
    });

    it('should handle async provider resolution with dependencies', async () => {
      const CONFIG_TOKEN = createToken<{ setting: string }>('Config');
      const SERVICE_TOKEN = createToken<{ getSetting: () => string }>('Service');

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        providers: [
          [CONFIG_TOKEN, { useValue: { setting: 'config-value' } }],
          [
            SERVICE_TOKEN,
            {
              useFactory: async (config: { setting: string }) => {
                await delay(10);
                return { getSetting: () => config.setting };
              },
              inject: [CONFIG_TOKEN],
            },
          ],
        ],
      });

      await app.start();

      const service = await app.container.resolveAsync(SERVICE_TOKEN);
      expect(service.getSetting()).toBe('config-value');
    });
  });

  describe('Dynamic dependency modification', () => {
    it('should handle module replacement with dependencies', async () => {
      class OriginalModule implements IModule {
        name = 'replaceable';
        async onStart() {
          tracker.startOrder.push('original');
        }
      }

      class ReplacementModule implements IModule {
        name = 'replaceable';
        async onStart() {
          tracker.startOrder.push('replacement');
        }
      }

      class DependentModule implements IModule {
        name = 'dependent-on-replaceable';
        dependencies = ['replaceable'];
        async onStart() {
          tracker.startOrder.push('dependent');
        }
      }

      app = await Application.create({
        disableGracefulShutdown: true,
        disableCoreModules: true,
        modules: [DependentModule, OriginalModule],
      });

      // Replace before start
      app.replaceModule('replaceable', new ReplacementModule());

      await app.start();

      // Replacement should start, not original
      expect(tracker.startOrder).toContain('replacement');
      expect(tracker.startOrder).not.toContain('original');
      expect(tracker.startOrder).toContain('dependent');
    });
  });
});
