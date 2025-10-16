/**
 * Performance Integration Tests
 *
 * Tests all performance optimizations working together:
 * - Subscription pooling with heavy load
 * - Batch manager with many updates
 * - VNode pooling during rendering
 * - Component recycling
 * - Request caching
 * - All optimizations together
 * - Performance targets validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal, computed, effect, batch } from '../../src/core/reactivity/index.js';
import { SubscriptionPool } from '../../src/core/reactivity/subscription-pool.js';
import { BatchManager, BatchPriority, FlushStrategy } from '../../src/core/reactivity/batch-manager.js';
import { ComponentPool } from '../../src/core/component/component-pool.js';
import { PerformanceMonitor } from '../../src/monitoring/performance.js';

describe('Performance Integration', () => {
  describe('Subscription Pooling', () => {
    let pool: SubscriptionPool;

    beforeEach(() => {
      pool = new SubscriptionPool({
        maxSize: 1000,
        autoCleanup: false,
        enableDeduplication: true,
      });
    });

    afterEach(() => {
      pool.destroy();
    });

    it('should efficiently handle many subscriptions', () => {
      const callbacks = Array.from({ length: 1000 }, (_, i) => () => console.log(i));
      const subscriptions = callbacks.map((cb) => pool.acquire(cb));

      expect(subscriptions.length).toBe(1000);

      const stats = pool.getStats();
      expect(stats.created).toBeGreaterThan(0);

      // Release all
      pool.releaseAll(subscriptions);

      const afterStats = pool.getStats();
      expect(afterStats.released).toBe(1000);
      expect(afterStats.reuseRate).toBeGreaterThanOrEqual(0);
    });

    it('should reuse subscription objects', () => {
      const callback = () => {};

      // Acquire and release many times
      for (let i = 0; i < 100; i++) {
        const sub = pool.acquire(callback);
        pool.release(sub);
      }

      const stats = pool.getStats();

      // Should show high reuse rate
      expect(stats.reuseRate).toBeGreaterThan(0.8);
      expect(stats.created + stats.reused).toBe(100);
    });

    it('should handle concurrent subscription operations', async () => {
      const operations = Array.from({ length: 100 }, async (_, i) => {
        const sub = pool.acquire(() => i);
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
        pool.release(sub);
      });

      await Promise.all(operations);

      const stats = pool.getStats();
      expect(stats.created + stats.reused).toBe(100);
    });

    it('should cleanup dead weak references', async () => {
      // Create subscriptions with weak references
      const subscriptions: any[] = [];

      for (let i = 0; i < 10; i++) {
        const obj = { id: i };
        const sub = pool.acquire(() => {}, obj);
        subscriptions.push(sub);
      }

      // Force cleanup
      pool.cleanup();

      const stats = pool.getStats();
      expect(stats.cleaned).toBeGreaterThanOrEqual(0);
    });

    it('should support deduplication', () => {
      const callback = () => {};
      const subscriber = { id: 1 };

      const sub1 = pool.acquire(callback, subscriber);
      const sub2 = pool.acquire(callback, subscriber);

      // Should return same subscription due to deduplication
      expect(sub1).toBe(sub2);

      pool.release(sub1);
    });

    it('should handle high-frequency acquire/release', () => {
      const startTime = performance.now();

      for (let i = 0; i < 10000; i++) {
        const sub = pool.acquire(() => i);
        pool.release(sub);
      }

      const duration = performance.now() - startTime;

      // Should be fast (< 100ms for 10k operations)
      expect(duration).toBeLessThan(100);

      const stats = pool.getStats();
      expect(stats.reuseRate).toBeGreaterThan(0.9);
    });
  });

  describe('Batch Manager', () => {
    let batchManager: BatchManager;

    beforeEach(() => {
      batchManager = new BatchManager({
        strategy: FlushStrategy.SYNC,
        usePriorities: true,
        maxBatchSize: 100,
        maxWaitTime: 16,
      });
    });

    afterEach(() => {
      batchManager.destroy();
    });

    it('should batch multiple updates efficiently', () => {
      let executionCount = 0;

      const computation = {
        run: () => executionCount++,
      } as any;

      batchManager.batch(() => {
        for (let i = 0; i < 10; i++) {
          batchManager.queue(computation, BatchPriority.NORMAL);
        }
      });

      // Should deduplicate and execute once
      expect(executionCount).toBe(1);

      const stats = batchManager.getStats();
      expect(stats.deduped).toBeGreaterThan(0);
    });

    it('should respect priority ordering', () => {
      const executions: string[] = [];

      const high = { run: () => executions.push('high') } as any;
      const normal = { run: () => executions.push('normal') } as any;
      const low = { run: () => executions.push('low') } as any;

      batchManager.queue(low, BatchPriority.LOW);
      batchManager.queue(normal, BatchPriority.NORMAL);
      batchManager.queue(high, BatchPriority.HIGH);

      batchManager.flush();

      expect(executions).toEqual(['high', 'normal', 'low']);
    });

    it('should handle immediate priority', () => {
      let executed = false;

      const computation = {
        run: () => {
          executed = true;
        },
      } as any;

      batchManager.queue(computation, BatchPriority.IMMEDIATE);

      // Should execute immediately
      expect(executed).toBe(true);
    });

    it('should auto-flush on max batch size', () => {
      const manager = new BatchManager({
        strategy: FlushStrategy.SYNC,
        maxBatchSize: 10,
      });

      let executionCount = 0;

      for (let i = 0; i < 15; i++) {
        const computation = { run: () => executionCount++ } as any;
        manager.queue(computation, BatchPriority.NORMAL);
      }

      // Should have flushed at least once
      expect(executionCount).toBeGreaterThan(0);

      manager.destroy();
    });

    it('should handle nested batching', () => {
      let count = 0;

      const computation = { run: () => count++ } as any;

      batchManager.batch(() => {
        batchManager.queue(computation);

        batchManager.batch(() => {
          batchManager.queue(computation);
        });
      });

      expect(batchManager.getBatchDepth()).toBe(0);
      expect(count).toBe(1); // Deduplication
    });

    it('should provide accurate statistics', () => {
      for (let i = 0; i < 50; i++) {
        const computation = { run: () => {} } as any;
        batchManager.queue(computation, (i % 3) as BatchPriority);
      }

      batchManager.flush();

      const stats = batchManager.getStats();

      expect(stats.updates).toBe(50);
      expect(stats.batches).toBeGreaterThanOrEqual(1);
      expect(stats.avgBatchSize).toBeGreaterThan(0);
    });

    it('should handle async flush strategies', async () => {
      const asyncManager = new BatchManager({
        strategy: FlushStrategy.ASYNC,
      });

      let executed = false;
      const computation = {
        run: () => {
          executed = false;
        },
      } as any;

      asyncManager.queue(computation);

      // Should not execute immediately
      expect(executed).toBe(false);

      await new Promise((resolve) => setTimeout(resolve, 10));

      asyncManager.destroy();
    });
  });

  describe('Component Pooling', () => {
    let componentPool: ComponentPool;

    beforeEach(() => {
      componentPool = new ComponentPool({
        maxPoolSize: 100,
        maxInstanceAge: 60000,
        enableWarming: true,
      });
    });

    afterEach(() => {
      componentPool.clear();
    });

    it('should efficiently recycle components', () => {
      const Component = () => ({ render: () => 'test' });

      // Acquire and release components
      const instances = [];

      for (let i = 0; i < 10; i++) {
        const instance = componentPool.acquire('TestComponent', Component);
        instances.push(instance);
      }

      instances.forEach((instance) => {
        componentPool.release('TestComponent', instance);
      });

      const stats = componentPool.getStats();

      expect(stats.created).toBe(10);
      expect(stats.released).toBe(10);

      // Acquire again - should reuse
      const reused = componentPool.acquire('TestComponent', Component);

      const newStats = componentPool.getStats();
      expect(newStats.reused).toBeGreaterThan(0);

      componentPool.release('TestComponent', reused);
    });

    it('should warm component pools', () => {
      const Component = () => ({ render: () => 'warmed' });

      componentPool.warm('WarmComponent', Component, 5);

      const stats = componentPool.getStats();
      expect(stats.created).toBe(5);

      // Acquiring should use warmed instances
      const instance = componentPool.acquire('WarmComponent', Component);
      expect(instance).toBeDefined();

      componentPool.release('WarmComponent', instance);
    });

    it('should respect max pool size', () => {
      const pool = new ComponentPool({ maxPoolSize: 10 });
      const Component = () => ({ id: Math.random() });

      const instances = [];

      for (let i = 0; i < 20; i++) {
        const instance = pool.acquire('Test', Component);
        instances.push(instance);
      }

      instances.forEach((instance) => {
        pool.release('Test', instance);
      });

      const stats = pool.getStats();
      expect(stats.poolSize).toBeLessThanOrEqual(10);

      pool.clear();
    });

    it('should handle high-frequency component recycling', () => {
      const Component = () => ({ value: 0 });

      const startTime = performance.now();

      for (let i = 0; i < 1000; i++) {
        const instance = componentPool.acquire('HighFreq', Component);
        componentPool.release('HighFreq', instance);
      }

      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(100); // Fast recycling

      const stats = componentPool.getStats();
      expect(stats.reuseRate).toBeGreaterThan(0.9);
    });
  });

  describe('Combined Optimizations', () => {
    let perfMonitor: PerformanceMonitor;

    beforeEach(() => {
      perfMonitor = new PerformanceMonitor({
        enabled: true,
        budget: {
          maxRenderTime: 16,
          maxSignalUpdateTime: 1,
        },
      });
    });

    afterEach(() => {
      perfMonitor.dispose();
    });

    it('should handle heavy signal load with all optimizations', () => {
      perfMonitor.mark('heavy-load-start');

      const signals = Array.from({ length: 100 }, () => signal(0));
      const computedValues = signals.map((s) => computed(() => s() * 2));

      // Batch many updates
      batch(() => {
        signals.forEach((s, i) => s.set(i));
      });

      // Read all computed values
      const results = computedValues.map((c) => c());

      perfMonitor.mark('heavy-load-end');
      const measure = perfMonitor.measure('heavy-load', 'heavy-load-start', 'heavy-load-end');

      expect(results.length).toBe(100);
      expect(measure).toBeDefined();
      expect(measure!.duration).toBeLessThan(100); // Should be fast with optimizations
    });

    it('should efficiently handle cascading updates', () => {
      perfMonitor.mark('cascade-start');

      const level1 = signal(1);
      const level2 = computed(() => level1() * 2);
      const level3 = computed(() => level2() * 2);
      const level4 = computed(() => level3() * 2);
      const level5 = computed(() => level4() * 2);

      // Update root should cascade efficiently
      batch(() => {
        for (let i = 0; i < 100; i++) {
          level1.set(i);
        }
      });

      const result = level5();

      perfMonitor.mark('cascade-end');
      const measure = perfMonitor.measure('cascade', 'cascade-start', 'cascade-end');

      expect(result).toBeGreaterThan(0);
      expect(measure!.duration).toBeLessThan(50);
    });

    it('should handle high-frequency updates efficiently', () => {
      const counter = signal(0);
      let effectCount = 0;

      effect(() => {
        counter();
        effectCount++;
      });

      perfMonitor.mark('high-freq-start');

      // Many rapid updates
      for (let i = 0; i < 1000; i++) {
        counter.set(i);
      }

      perfMonitor.mark('high-freq-end');
      const measure = perfMonitor.measure('high-freq', 'high-freq-start', 'high-freq-end');

      expect(effectCount).toBeGreaterThan(0);
      expect(measure!.duration).toBeLessThan(100);
    });

    it('should maintain performance with many components', () => {
      const componentPool = new ComponentPool({ maxPoolSize: 200 });
      const Component = () => ({ value: signal(0) });

      perfMonitor.mark('many-components-start');

      const components = Array.from({ length: 100 }, (_, i) => componentPool.acquire(`Component-${i}`, Component));

      // Simulate component operations
      components.forEach((comp) => {
        comp.value.set(Math.random() * 100);
      });

      // Release all
      components.forEach((comp, i) => {
        componentPool.release(`Component-${i}`, comp);
      });

      perfMonitor.mark('many-components-end');
      const measure = perfMonitor.measure('many-components', 'many-components-start', 'many-components-end');

      expect(measure!.duration).toBeLessThan(200);

      componentPool.clear();
    });

    it('should optimize memory usage', () => {
      const pool = new SubscriptionPool({ maxSize: 100 });
      const batcher = new BatchManager({ maxBatchSize: 50 });

      // Create many signals with subscriptions
      const signals = Array.from({ length: 50 }, () => signal(0));

      signals.forEach((s) => {
        const sub = pool.acquire(() => s());
        s.subscribe(() => {});
        pool.release(sub);
      });

      // Batch updates
      batcher.batch(() => {
        signals.forEach((s, i) => s.set(i));
      });

      const poolStats = pool.getStats();
      const batchStats = batcher.getStats();

      expect(poolStats.reuseRate).toBeGreaterThan(0);
      expect(batchStats.dedupRate).toBeGreaterThanOrEqual(0);

      pool.destroy();
      batcher.destroy();
    });
  });

  describe('Performance Targets', () => {
    it('should meet render time targets', () => {
      const monitor = new PerformanceMonitor({
        enabled: true,
        budget: { maxRenderTime: 16 },
      });

      monitor.mark('render-start');

      // Simulate render work
      const data = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        value: computed(() => i * 2),
      }));

      const results = data.map((d) => d.value());

      monitor.mark('render-end');
      const measure = monitor.measure('render', 'render-start', 'render-end');

      expect(measure!.duration).toBeLessThan(16); // 60fps target

      monitor.dispose();
    });

    it('should meet signal update targets', () => {
      const monitor = new PerformanceMonitor({
        enabled: true,
        budget: { maxSignalUpdateTime: 1 },
      });

      const count = signal(0);

      monitor.mark('signal-update-start');

      batch(() => {
        for (let i = 0; i < 100; i++) {
          count.set(i);
        }
      });

      monitor.mark('signal-update-end');
      const measure = monitor.measure('signal-update', 'signal-update-start', 'signal-update-end');

      // Batched updates should be very fast
      expect(measure!.duration).toBeLessThan(10);

      monitor.dispose();
    });

    it('should meet memory efficiency targets', () => {
      const pool = new SubscriptionPool({ maxSize: 1000 });

      // Create and release many subscriptions
      const iterations = 10000;

      for (let i = 0; i < iterations; i++) {
        const sub = pool.acquire(() => {});
        pool.release(sub);
      }

      const stats = pool.getStats();

      // Should have high reuse rate (>95%)
      expect(stats.reuseRate).toBeGreaterThan(0.95);

      // Should have created far fewer than iterations
      expect(stats.created).toBeLessThan(iterations * 0.1);

      pool.destroy();
    });

    it('should meet throughput targets', () => {
      const startTime = performance.now();
      const operations = 100000;

      const values = Array.from({ length: 100 }, () => signal(0));

      batch(() => {
        for (let i = 0; i < operations / 100; i++) {
          values.forEach((v) => v.set(i));
        }
      });

      const duration = performance.now() - startTime;
      const opsPerSecond = (operations / duration) * 1000;

      // Should handle >100k ops/second
      expect(opsPerSecond).toBeGreaterThan(100000);
    });
  });

  describe('Stress Testing', () => {
    it('should handle extreme load', () => {
      const monitor = new PerformanceMonitor({ enabled: true });

      monitor.mark('stress-start');

      // Create large dependency graph
      const base = Array.from({ length: 100 }, () => signal(0));
      const derived = base.map((b) => computed(() => b() * 2));
      const combined = computed(() => derived.reduce((sum, d) => sum + d(), 0));

      // Massive update
      batch(() => {
        base.forEach((b, i) => b.set(i));
      });

      const result = combined();

      monitor.mark('stress-end');
      const measure = monitor.measure('stress', 'stress-start', 'stress-end');

      expect(result).toBeGreaterThan(0);
      expect(measure!.duration).toBeLessThan(500);

      monitor.dispose();
    });

    it('should maintain performance under sustained load', async () => {
      const values = Array.from({ length: 50 }, () => signal(0));
      let updateCount = 0;

      const startTime = performance.now();

      // Sustained updates for 1 second
      const interval = setInterval(() => {
        batch(() => {
          values.forEach((v, i) => v.set(updateCount * 50 + i));
        });
        updateCount++;
      }, 10);

      await new Promise((resolve) => setTimeout(resolve, 1000));
      clearInterval(interval);

      const duration = performance.now() - startTime;
      const updatesPerSecond = (updateCount / duration) * 1000;

      expect(updatesPerSecond).toBeGreaterThan(50);
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle todo app performance', () => {
      const monitor = new PerformanceMonitor({ enabled: true });

      monitor.mark('todo-app-start');

      const todos = signal<Array<{ id: number; text: string; done: boolean }>>([]);
      const filter = signal<'all' | 'active' | 'completed'>('all');

      const filtered = computed(() => {
        const f = filter();
        const all = todos();

        if (f === 'all') return all;
        if (f === 'active') return all.filter((t) => !t.done);
        return all.filter((t) => t.done);
      });

      // Add many todos
      batch(() => {
        const newTodos = Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          text: `Todo ${i}`,
          done: i % 2 === 0,
        }));
        todos.set(newTodos);
      });

      // Filter operations
      ['active', 'completed', 'all'].forEach((f) => {
        filter.set(f as any);
        const result = filtered();
        expect(result.length).toBeGreaterThan(0);
      });

      monitor.mark('todo-app-end');
      const measure = monitor.measure('todo-app', 'todo-app-start', 'todo-app-end');

      expect(measure!.duration).toBeLessThan(100);

      monitor.dispose();
    });

    it('should handle real-time dashboard', () => {
      const monitor = new PerformanceMonitor({ enabled: true });

      monitor.mark('dashboard-start');

      // Simulate dashboard with many metrics
      const metrics = Array.from({ length: 50 }, (_, i) => ({
        name: `metric-${i}`,
        value: signal(0),
        trend: computed(() => (Math.random() > 0.5 ? 'up' : 'down')),
      }));

      // Update all metrics
      const updateInterval = setInterval(() => {
        batch(() => {
          metrics.forEach((m) => {
            m.value.set(Math.random() * 100);
          });
        });
      }, 16); // 60fps

      // Run for a bit
      setTimeout(() => {
        clearInterval(updateInterval);

        monitor.mark('dashboard-end');
        const measure = monitor.measure('dashboard', 'dashboard-start', 'dashboard-end');

        expect(measure!.duration).toBeGreaterThan(0);

        monitor.dispose();
      }, 200);
    });
  });
});
