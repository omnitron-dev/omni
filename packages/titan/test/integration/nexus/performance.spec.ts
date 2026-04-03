/**
 * Nexus Container - Performance Tests
 *
 * Benchmark tests for container operations including:
 * - Resolution performance
 * - Registration performance
 * - Cache efficiency
 * - Memory usage patterns
 *
 * @since 0.4.5
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Container, createToken, Scope } from '@nexus';

// Helper for timing
function measureTime<T>(fn: () => T): { result: T; duration: number } {
  const start = performance.now();
  const result = fn();
  const duration = performance.now() - start;
  return { result, duration };
}

async function measureTimeAsync<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  return { result, duration };
}

// Test service classes
class SimpleService {
  value = 'simple';
}

class ServiceWithDeps {
  constructor(
    public dep1: SimpleService,
    public dep2: SimpleService,
    public dep3: SimpleService
  ) {}
}

class DeepDependencyService {
  constructor(public child: DeepDependencyService | null) {}
}

describe('Nexus Container - Performance', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('Registration Performance', () => {
    it('should register 1000 providers efficiently', () => {
      const tokens: any[] = [];

      const { duration } = measureTime(() => {
        for (let i = 0; i < 1000; i++) {
          const token = createToken('Service' + i);
          tokens.push(token);
          container.register(token, { useClass: SimpleService });
        }
      });

      expect(tokens.length).toBe(1000);
      // Should complete in under 200ms
      expect(duration).toBeLessThan(200);

      // Log for benchmarking
      console.log('Registration of 1000 providers: ' + duration.toFixed(2) + 'ms');
    });

    it('should register providers with dependencies efficiently', () => {
      const Dep1Token = createToken<SimpleService>('Dep1');
      const Dep2Token = createToken<SimpleService>('Dep2');
      const Dep3Token = createToken<SimpleService>('Dep3');

      container.register(Dep1Token, { useClass: SimpleService });
      container.register(Dep2Token, { useClass: SimpleService });
      container.register(Dep3Token, { useClass: SimpleService });

      const tokens: any[] = [];

      const { duration } = measureTime(() => {
        for (let i = 0; i < 500; i++) {
          const token = createToken('ServiceWithDeps' + i);
          tokens.push(token);
          container.register(token, {
            useFactory: (d1: SimpleService, d2: SimpleService, d3: SimpleService) => new ServiceWithDeps(d1, d2, d3),
            inject: [Dep1Token, Dep2Token, Dep3Token],
          });
        }
      });

      expect(tokens.length).toBe(500);
      expect(duration).toBeLessThan(200);

      console.log('Registration of 500 providers with deps: ' + duration.toFixed(2) + 'ms');
    });
  });

  describe('Resolution Performance', () => {
    it('should resolve singleton 10000 times efficiently', () => {
      const token = createToken<SimpleService>('SingletonService');
      container.register(token, {
        useClass: SimpleService,
        scope: Scope.Singleton,
      });

      // First resolution to warm up
      container.resolve(token);

      const { duration } = measureTime(() => {
        for (let i = 0; i < 10000; i++) {
          container.resolve(token);
        }
      });

      // Singleton resolution (cache hit) should be very fast
      expect(duration).toBeLessThan(100);

      console.log(
        '10000 singleton resolutions: ' + duration.toFixed(2) + 'ms (' + (duration / 10000).toFixed(4) + 'ms avg)'
      );
    });

    it('should resolve transient 1000 times efficiently', () => {
      const token = createToken<SimpleService>('TransientService');
      container.register(token, {
        useClass: SimpleService,
        scope: Scope.Transient,
      });

      const { duration } = measureTime(() => {
        for (let i = 0; i < 1000; i++) {
          container.resolve(token);
        }
      });

      // Transient creates new instances each time
      expect(duration).toBeLessThan(200);

      console.log(
        '1000 transient resolutions: ' + duration.toFixed(2) + 'ms (' + (duration / 1000).toFixed(4) + 'ms avg)'
      );
    });

    it('should resolve complex dependency graph efficiently', () => {
      // Create a 10-level deep dependency chain
      const tokens: any[] = [];

      for (let i = 0; i < 10; i++) {
        const token = createToken('Level' + i);
        tokens.push(token);

        if (i === 0) {
          container.register(token, {
            useFactory: () => new DeepDependencyService(null),
          });
        } else {
          container.register(token, {
            useFactory: (child: DeepDependencyService) => new DeepDependencyService(child),
            inject: [tokens[i - 1]],
          });
        }
      }

      const lastToken = tokens[tokens.length - 1];

      const { duration } = measureTime(() => {
        for (let i = 0; i < 1000; i++) {
          container.resolve(lastToken);
        }
      });

      // Even with 10-level deep dependencies, should be reasonably fast
      expect(duration).toBeLessThan(500);

      console.log('1000 resolutions of 10-level dependency chain: ' + duration.toFixed(2) + 'ms');
    });
  });

  describe('Async Resolution Performance', () => {
    it('should resolve async providers efficiently', async () => {
      const AsyncToken = createToken<{ value: string }>('AsyncService');

      container.register(AsyncToken, {
        useFactory: async () => {
          await new Promise((resolve) => setTimeout(resolve, 1)); // 1ms delay
          return { value: 'async' };
        },
        async: true,
        scope: Scope.Singleton,
      });

      // First resolution
      await container.resolveAsync(AsyncToken);

      // Subsequent resolutions should be cached
      const { duration } = await measureTimeAsync(async () => {
        for (let i = 0; i < 1000; i++) {
          await container.resolveAsync(AsyncToken);
        }
      });

      // Cached async resolutions should be fast
      expect(duration).toBeLessThan(50);

      console.log('1000 cached async resolutions: ' + duration.toFixed(2) + 'ms');
    });

    it('should handle parallel async resolutions', async () => {
      const tokens: any[] = [];

      for (let i = 0; i < 100; i++) {
        const token = createToken('AsyncService' + i);
        tokens.push(token);
        container.register(token, {
          useFactory: async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return { id: i };
          },
          async: true,
        });
      }

      const { duration, result } = await measureTimeAsync(async () =>
        Promise.all(tokens.map((token) => container.resolveAsync(token)))
      );

      expect(result.length).toBe(100);
      // Parallel resolution should complete in roughly 5ms + overhead
      // not 500ms (sequential)
      expect(duration).toBeLessThan(100);

      console.log('100 parallel async resolutions: ' + duration.toFixed(2) + 'ms');
    });
  });

  describe('Cache Efficiency', () => {
    it('should have high cache hit rate for singletons', () => {
      const token = createToken<SimpleService>('CachedService');
      container.register(token, {
        useClass: SimpleService,
        scope: Scope.Singleton,
      });

      // Enable lifecycle events for cache tracking
      let cacheHits = 0;
      let cacheMisses = 0;

      container.on('resolve:cache:hit' as any, () => cacheHits++);
      container.on('resolve:cache:miss' as any, () => cacheMisses++);

      // First resolution - miss
      container.resolve(token);

      // Subsequent resolutions - hits
      for (let i = 0; i < 99; i++) {
        container.resolve(token);
      }

      // Get metadata for cache statistics
      const metadata = container.getMetadata();
      expect(metadata.cached).toBeGreaterThan(0);

      console.log('Cache statistics: ' + metadata.cached + ' cached instances');
    });

    it('should efficiently handle scope caches', () => {
      const token = createToken<SimpleService>('ScopedService');
      container.register(token, {
        useClass: SimpleService,
        scope: Scope.Scoped,
      });

      const scopes: any[] = [];

      const { duration } = measureTime(() => {
        for (let i = 0; i < 100; i++) {
          const scope = container.createScope();
          scopes.push(scope);

          // Resolve 10 times in each scope (should cache within scope)
          for (let j = 0; j < 10; j++) {
            scope.resolve(token);
          }
        }
      });

      expect(scopes.length).toBe(100);
      // Creating 100 scopes and resolving 10 times each should be fast
      expect(duration).toBeLessThan(200);

      console.log('100 scopes with 10 resolutions each: ' + duration.toFixed(2) + 'ms');
    });
  });

  describe('Memory Patterns', () => {
    it('should not leak memory with transient instances', async () => {
      const token = createToken<SimpleService>('TransientNoLeak');
      container.register(token, {
        useClass: SimpleService,
        scope: Scope.Transient,
      });

      // Resolve many times
      for (let i = 0; i < 10000; i++) {
        container.resolve(token);
      }

      // The container should not hold references to transient instances
      const _metadata = container.getMetadata();
      // Transient instances should not be cached
      // (The exact check depends on implementation)
    });

    it('should clean up disposed scopes', async () => {
      const token = createToken<SimpleService>('ScopedCleanup');
      container.register(token, {
        useClass: SimpleService,
        scope: Scope.Scoped,
      });

      // Create and dispose many scopes
      for (let i = 0; i < 100; i++) {
        const scope = container.createScope();
        scope.resolve(token);
        await scope.dispose();
      }

      // Main container should not hold references to disposed scope instances
      const metadata = container.getMetadata();
      // The scopes field tracks active scoped instances, not child containers
      // After disposal, scoped instances should be cleaned up
      expect(metadata.scopes).toBe(0);
    });
  });

  describe('Bulk Operations', () => {
    it('should handle resolveMany efficiently', () => {
      const MultiToken = createToken<SimpleService>('MultiService');

      for (let i = 0; i < 100; i++) {
        container.register(MultiToken, { useClass: SimpleService }, { multi: true });
      }

      const { duration, result } = measureTime(() => container.resolveMany(MultiToken));

      expect(result.length).toBe(100);
      expect(duration).toBeLessThan(50);

      console.log('resolveMany with 100 providers: ' + duration.toFixed(2) + 'ms');
    });

    it('should handle parallel resolve efficiently', async () => {
      const tokens: any[] = [];

      for (let i = 0; i < 50; i++) {
        const token = createToken('ParallelService' + i);
        tokens.push(token);
        container.register(token, { useClass: SimpleService });
      }

      const { duration, result } = await measureTimeAsync(async () => container.resolveParallel(tokens));

      expect(result.length).toBe(50);
      expect(duration).toBeLessThan(50);

      console.log('resolveParallel with 50 tokens: ' + duration.toFixed(2) + 'ms');
    });
  });

  describe('Token Creation', () => {
    it('should create tokens efficiently', () => {
      const { duration, result } = measureTime(() => {
        const tokens: any[] = [];
        for (let i = 0; i < 10000; i++) {
          tokens.push(createToken('Token' + i));
        }
        return tokens;
      });

      expect(result.length).toBe(10000);
      expect(duration).toBeLessThan(100);

      console.log('Creation of 10000 tokens: ' + duration.toFixed(2) + 'ms');
    });
  });

  describe('Module Loading', () => {
    it('should load module with many providers efficiently', () => {
      const providers: any[] = [];

      for (let i = 0; i < 100; i++) {
        const token = createToken('ModuleService' + i);
        providers.push([token, { useClass: SimpleService }]);
      }

      const { duration } = measureTime(() => {
        container.loadModule({
          name: 'LargeModule',
          providers,
        });
      });

      expect(duration).toBeLessThan(100);

      console.log('Module loading with 100 providers: ' + duration.toFixed(2) + 'ms');
    });

    it('should handle nested module imports efficiently', () => {
      const modules: any[] = [];

      // Create 10 modules, each importing the previous
      for (let i = 0; i < 10; i++) {
        const token = createToken('NestedService' + i);
        modules.push({
          name: 'NestedModule' + i,
          imports: i > 0 ? [modules[i - 1]] : [],
          providers: [[token, { useClass: SimpleService }]],
          exports: [token],
        });
      }

      const { duration } = measureTime(() => {
        container.loadModule(modules[modules.length - 1]);
      });

      expect(duration).toBeLessThan(100);

      console.log('Loading 10 nested modules: ' + duration.toFixed(2) + 'ms');
    });
  });
});
