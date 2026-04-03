/**
 * Nexus Container - Async Resolution Race Condition Tests
 *
 * Tests for async resolution with concurrent access, race conditions,
 * and edge cases involving AsyncLocalStorage context isolation.
 *
 * @since 0.4.5
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Container, createToken, Scope } from '@nexus';

// Tokens for testing
const AsyncServiceToken = createToken<AsyncService>('AsyncService');
const _SlowServiceToken = createToken<SlowService>('SlowService');
const RaceServiceToken = createToken<RaceService>('RaceService');
const CounterToken = createToken<Counter>('Counter');
const DependentToken = createToken<DependentService>('DependentService');

// Test service classes
class AsyncService {
  public id: number;
  public createdAt: number;

  constructor() {
    this.id = Math.random();
    this.createdAt = Date.now();
  }

  async initialize(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  getValue(): string {
    return `async-value-${this.id}`;
  }
}

class SlowService {
  public id: number;
  public initTime: number = 0;

  constructor() {
    this.id = Math.random();
  }

  async onInit(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50));
    this.initTime = Date.now();
  }

  getStatus(): string {
    return this.initTime > 0 ? 'initialized' : 'pending';
  }
}

class RaceService {
  public instanceId: number;
  private static counter = 0;

  constructor() {
    RaceService.counter++;
    this.instanceId = RaceService.counter;
  }

  static reset(): void {
    RaceService.counter = 0;
  }
}

class Counter {
  private value = 0;

  increment(): number {
    return ++this.value;
  }

  getValue(): number {
    return this.value;
  }
}

class DependentService {
  constructor(public counter: Counter) {}

  getCounterValue(): number {
    return this.counter.getValue();
  }
}

describe('Nexus Container - Async Resolution Race Conditions', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
    RaceService.reset();
  });

  afterEach(async () => {
    await container.dispose();
  });

  describe('Concurrent Async Resolution', () => {
    it('should return same singleton instance when resolved concurrently', async () => {
      container.register(RaceServiceToken, {
        useFactory: async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return new RaceService();
        },
        scope: Scope.Singleton,
        async: true,
      });

      // Start 10 concurrent resolutions
      const promises = Array.from({ length: 10 }, () => container.resolveAsync(RaceServiceToken));

      const results = await Promise.all(promises);

      // All should be the same instance
      const firstInstanceId = results[0]!.instanceId;
      results.forEach((service) => {
        expect(service.instanceId).toBe(firstInstanceId);
      });

      // Only one instance should have been created
      expect(RaceService.counter).toBe(1);
    });

    it('should create separate instances for transient scope under concurrent resolution', async () => {
      container.register(RaceServiceToken, {
        useFactory: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return new RaceService();
        },
        scope: Scope.Transient,
        async: true,
      });

      // Start 5 concurrent resolutions
      const promises = Array.from({ length: 5 }, () => container.resolveAsync(RaceServiceToken));

      const results = await Promise.all(promises);

      // All should be different instances
      const instanceIds = new Set(results.map((r) => r.instanceId));
      expect(instanceIds.size).toBe(5);
    });

    it('should properly isolate context in nested async resolutions', async () => {
      container.register(CounterToken, {
        useClass: Counter,
        scope: Scope.Singleton,
      });

      container.register(DependentToken, {
        useFactory: async (counter: Counter) => {
          // Simulate some async work
          await new Promise((resolve) => setTimeout(resolve, 5));
          counter.increment();
          return new DependentService(counter);
        },
        inject: [CounterToken],
        scope: Scope.Transient,
        async: true,
      });

      // Resolve multiple times concurrently
      const promises = Array.from({ length: 5 }, () => container.resolveAsync(DependentToken));

      await Promise.all(promises);

      // Counter should have been incremented 5 times
      const counter = container.resolve(CounterToken);
      expect(counter.getValue()).toBe(5);
    });
  });

  describe('Async Resolution with Dependencies', () => {
    it('should resolve async dependencies in correct order', async () => {
      const order: string[] = [];

      const FirstToken = createToken<{ name: string }>('First');
      const SecondToken = createToken<{ name: string; first: any }>('Second');
      const ThirdToken = createToken<{ name: string; second: any }>('Third');

      container.register(FirstToken, {
        useFactory: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          order.push('first');
          return { name: 'first' };
        },
        async: true,
        scope: Scope.Singleton,
      });

      container.register(SecondToken, {
        useFactory: async (first: any) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          order.push('second');
          return { name: 'second', first };
        },
        inject: [FirstToken],
        async: true,
        scope: Scope.Singleton,
      });

      container.register(ThirdToken, {
        useFactory: async (second: any) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          order.push('third');
          return { name: 'third', second };
        },
        inject: [SecondToken],
        async: true,
        scope: Scope.Singleton,
      });

      const result = await container.resolveAsync(ThirdToken);

      expect(order).toEqual(['first', 'second', 'third']);
      expect(result.name).toBe('third');
      expect(result.second.name).toBe('second');
      expect(result.second.first.name).toBe('first');
    });

    it('should handle mixed sync and async dependencies', async () => {
      const SyncToken = createToken<{ type: string }>('SyncDep');
      const AsyncToken = createToken<{ type: string }>('AsyncDep');
      const MixedToken = createToken<{ sync: any; async: any }>('Mixed');

      container.register(SyncToken, {
        useValue: { type: 'sync' },
      });

      container.register(AsyncToken, {
        useFactory: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { type: 'async' };
        },
        async: true,
        scope: Scope.Singleton,
      });

      container.register(MixedToken, {
        useFactory: async (sync: any, asyncDep: any) => ({ sync, async: asyncDep }),
        inject: [SyncToken, AsyncToken],
        async: true,
        scope: Scope.Singleton,
      });

      const result = await container.resolveAsync(MixedToken);

      expect(result.sync.type).toBe('sync');
      expect(result.async.type).toBe('async');
    });
  });

  describe('Error Handling in Async Resolution', () => {
    it('should propagate errors from async factory', async () => {
      const ErrorToken = createToken<any>('ErrorService');

      container.register(ErrorToken, {
        useFactory: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error('Factory failed');
        },
        async: true,
      });

      await expect(container.resolveAsync(ErrorToken)).rejects.toThrow('Factory failed');
    });

    it('should not cache failed async resolutions', async () => {
      const FailThenSucceedToken = createToken<{ attempt: number }>('FailThenSucceed');
      let attempts = 0;

      container.register(FailThenSucceedToken, {
        useFactory: async () => {
          attempts++;
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (attempts === 1) {
            throw new Error('First attempt fails');
          }
          return { attempt: attempts };
        },
        async: true,
        scope: Scope.Singleton,
      });

      // First attempt should fail
      await expect(container.resolveAsync(FailThenSucceedToken)).rejects.toThrow('First attempt fails');

      // Second attempt should succeed
      const result = await container.resolveAsync(FailThenSucceedToken);
      expect(result.attempt).toBe(2);
    });

    it('should handle timeout errors gracefully', async () => {
      const TimeoutToken = createToken<any>('TimeoutService');

      container.register(TimeoutToken, {
        useFactory: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return { value: 'completed' };
        },
        async: true,
        timeout: 50, // 50ms timeout
      });

      await expect(container.resolveAsync(TimeoutToken)).rejects.toThrow();
    });
  });

  describe('Parallel Resolution', () => {
    it('should resolve multiple tokens in parallel', async () => {
      const TokenA = createToken<{ name: string }>('A');
      const TokenB = createToken<{ name: string }>('B');
      const TokenC = createToken<{ name: string }>('C');

      const startTime = Date.now();

      container.register(TokenA, {
        useFactory: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { name: 'A' };
        },
        async: true,
      });

      container.register(TokenB, {
        useFactory: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { name: 'B' };
        },
        async: true,
      });

      container.register(TokenC, {
        useFactory: async () => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return { name: 'C' };
        },
        async: true,
      });

      const [a, b, c] = await container.resolveParallel([TokenA, TokenB, TokenC]);

      const elapsed = Date.now() - startTime;

      expect(a.name).toBe('A');
      expect(b.name).toBe('B');
      expect(c.name).toBe('C');

      // Should complete in ~30ms (parallel) not ~90ms (sequential)
      expect(elapsed).toBeLessThan(80);
    });

    it('should handle partial failures in resolveParallelSettled', async () => {
      const SuccessToken = createToken<{ value: string }>('Success');
      const FailToken = createToken<{ value: string }>('Fail');

      container.register(SuccessToken, {
        useFactory: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return { value: 'success' };
        },
        async: true,
      });

      container.register(FailToken, {
        useFactory: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error('Intentional failure');
        },
        async: true,
      });

      const results = await container.resolveParallelSettled([SuccessToken, FailToken]);

      expect(results[0]!.status).toBe('fulfilled');
      expect((results[0] as any).value.value).toBe('success');
      expect(results[1]!.status).toBe('rejected');
      expect((results[1] as any).reason.message).toContain('Intentional failure');
    });
  });

  describe('Scoped Container Async Resolution', () => {
    it('should isolate async resolutions between scopes', async () => {
      let instanceCount = 0;

      container.register(AsyncServiceToken, {
        useFactory: async () => {
          instanceCount++;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return new AsyncService();
        },
        async: true,
        scope: Scope.Scoped,
      });

      const scope1 = container.createScope();
      const scope2 = container.createScope();

      const [service1, service2] = await Promise.all([
        scope1.resolveAsync(AsyncServiceToken),
        scope2.resolveAsync(AsyncServiceToken),
      ]);

      // Different scopes should get different instances
      expect(service1.id).not.toBe(service2.id);
      expect(instanceCount).toBe(2);

      // Same scope should get same instance
      const service1Again = await scope1.resolveAsync(AsyncServiceToken);
      expect(service1Again.id).toBe(service1.id);
      expect(instanceCount).toBe(2); // No new instance created
    });
  });
});
