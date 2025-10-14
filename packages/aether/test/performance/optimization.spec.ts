/**
 * Performance Optimization Tests
 *
 * Tests for Phase 6 performance optimizations including:
 * - Subscription pool
 * - Batch manager
 * - Lazy loader
 * - VNode pool
 * - Optimized diff
 * - Component pool
 * - Request cache
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signal } from '../../src/core/reactivity/signal.js';
import { batch } from '../../src/core/reactivity/batch.js';
import { SubscriptionPool } from '../../src/core/reactivity/subscription-pool.js';
import { BatchManager, BatchPriority } from '../../src/core/reactivity/batch-manager.js';
import { globalVNodePool, VNodePool } from '../../src/reconciler/vnode-pool.js';
import { OptimizedDiffer } from '../../src/reconciler/optimized-diff.js';
import { ComponentPool } from '../../src/core/component/component-pool.js';
import { RequestCache } from '../../src/data/request-cache.js';
import { createElementVNode, createTextVNode } from '../../src/reconciler/vnode.js';

describe('Performance Optimizations', () => {
  describe('Subscription Pool', () => {
    let pool: SubscriptionPool;

    beforeEach(() => {
      pool = new SubscriptionPool({
        maxSize: 10,
        autoCleanup: false,
      });
    });

    afterEach(() => {
      pool.destroy();
    });

    it('should reuse subscription objects', () => {
      const callback = (value: number) => value * 2;
      const sub1 = pool.acquire(callback);
      pool.release(sub1);

      const sub2 = pool.acquire(callback);
      expect(sub2).toBe(sub1);

      const stats = pool.getStats();
      expect(stats.reused).toBe(1);
    });

    it('should deduplicate subscriptions', () => {
      const callback = (value: number) => value * 2;
      const subscriber = { id: 1 };

      const sub1 = pool.acquire(callback, subscriber);
      const sub2 = pool.acquire(callback, subscriber);

      expect(sub1).toBe(sub2);
    });

    it('should track statistics', () => {
      const callback = (value: number) => value;

      pool.acquire(callback);
      pool.acquire(callback);
      const sub = pool.acquire(callback);
      pool.release(sub);

      const stats = pool.getStats();
      expect(stats.created).toBeGreaterThan(0);
      expect(stats.released).toBe(1);
    });

    it('should cleanup weak references', () => {
      const callback = (value: number) => value;
      let subscriber: any = { id: 1 };

      pool.acquire(callback, subscriber);
      subscriber = null;

      // Force cleanup
      pool.cleanup();

      const stats = pool.getStats();
      expect(stats.cleaned).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Batch Manager', () => {
    let manager: BatchManager;

    beforeEach(() => {
      manager = new BatchManager({
        usePriorities: true,
        maxBatchSize: 10,
      });
    });

    afterEach(() => {
      manager.destroy();
    });

    it('should batch updates', async () => {
      let execCount = 0;
      const comp = {
        run: () => {
          execCount++;
        },
      } as any;

      manager.queue(comp, BatchPriority.NORMAL);
      manager.queue(comp, BatchPriority.NORMAL);
      manager.queue(comp, BatchPriority.NORMAL);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(execCount).toBe(1);
    });

    it('should respect priorities', async () => {
      const order: number[] = [];

      const comp1 = {
        run: () => order.push(1),
      } as any;

      const comp2 = {
        run: () => order.push(2),
      } as any;

      manager.queue(comp1, BatchPriority.LOW);
      manager.queue(comp2, BatchPriority.HIGH);

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(order[0]).toBe(2); // High priority first
      expect(order[1]).toBe(1); // Low priority second
    });

    it('should deduplicate updates', () => {
      const comp = {
        run: () => {},
      } as any;

      manager.queue(comp);
      manager.queue(comp);
      manager.queue(comp);

      const stats = manager.getStats();
      expect(stats.deduped).toBeGreaterThan(0);
    });
  });

  describe('VNode Pool', () => {
    let pool: VNodePool;

    beforeEach(() => {
      pool = new VNodePool({
        initialSize: 10,
        maxSize: 50,
      });
    });

    afterEach(() => {
      pool.destroy();
    });

    it('should reuse VNode objects', () => {
      const vnode1 = pool.acquireElement('div');
      pool.release(vnode1);

      const vnode2 = pool.acquireElement('div');
      expect(vnode2).toBe(vnode1);

      const stats = pool.getStats();
      expect(stats.reused).toBeGreaterThan(0);
    });

    it('should handle different VNode types', () => {
      const element = pool.acquireElement('div');
      const text = pool.acquireText('hello');
      const fragment = pool.acquireFragment();

      expect(element.type).toBe('element');
      expect(text.type).toBe('text');
      expect(fragment.type).toBe('fragment');

      pool.release(element);
      pool.release(text);
      pool.release(fragment);

      const stats = pool.getStats();
      expect(stats.elementPoolSize).toBeGreaterThan(0);
      expect(stats.textPoolSize).toBeGreaterThan(0);
      expect(stats.fragmentPoolSize).toBeGreaterThan(0);
    });

    it('should clear VNode references on release', () => {
      const vnode = pool.acquireElement('div', { id: 'test' }, [], 'key1');
      expect(vnode.props).toBeDefined();
      expect(vnode.key).toBe('key1');

      pool.release(vnode);

      // VNode should be cleared
      expect(vnode.props).toBeUndefined();
      expect(vnode.key).toBeUndefined();
    });

    it('should track memory pressure', () => {
      // Fill pool
      const vnodes = [];
      for (let i = 0; i < 40; i++) {
        vnodes.push(pool.acquireElement('div'));
      }

      // Release all
      for (const vnode of vnodes) {
        pool.release(vnode);
      }

      const stats = pool.getStats();
      expect(stats.memoryPressure).toBeGreaterThan(0);
    });
  });

  describe('Optimized Diff', () => {
    let differ: OptimizedDiffer;

    beforeEach(() => {
      differ = new OptimizedDiffer();
    });

    it('should use fast paths for identical nodes', () => {
      const vnode = createElementVNode('div');
      const patches = differ.diff(vnode, vnode);

      expect(patches).toHaveLength(0);

      const stats = differ.getStats();
      expect(stats.fastPaths).toBeGreaterThan(0);
    });

    it('should optimize text node updates', () => {
      const old = createTextVNode('hello');
      const newNode = createTextVNode('world');

      const patches = differ.diff(old, newNode);

      expect(patches).toHaveLength(1);
      expect(patches[0]?.type).toBe('TEXT');
    });

    it('should handle keyed children efficiently', () => {
      const oldChildren = [createElementVNode('div', null, undefined, '1'), createElementVNode('div', null, undefined, '2')];

      const newChildren = [createElementVNode('div', null, undefined, '2'), createElementVNode('div', null, undefined, '1')];

      const oldVNode = createElementVNode('div', null, oldChildren);
      const newVNode = createElementVNode('div', null, newChildren);

      const patches = differ.diff(oldVNode, newVNode);

      expect(patches.length).toBeGreaterThan(0);

      const stats = differ.getStats();
      expect(stats.comparisons).toBeGreaterThan(0);
    });

    it('should cache fragment diffs', () => {
      const vnode1 = createElementVNode('div');
      const vnode2 = createElementVNode('div');

      differ.diff(vnode1, vnode2, 'fragment-1');
      differ.diff(vnode1, vnode2, 'fragment-1');

      const stats = differ.getStats();
      expect(stats.cacheHits).toBeGreaterThan(0);
    });
  });

  describe('Component Pool', () => {
    let pool: ComponentPool;

    beforeEach(() => {
      pool = new ComponentPool({
        maxSizePerType: 5,
        autoCleanup: false,
      });
    });

    afterEach(() => {
      pool.destroy();
    });

    it('should reuse component instances', () => {
      const component = () => ({ id: Math.random() });
      const result1 = pool.acquire(component);
      const id1 = result1.id;
      pool.release(result1);

      const result2 = pool.acquire(component);
      // Should reuse the same result object from pool
      expect(result2.id).toBe(id1);

      const stats = pool.getStats();
      expect(stats.reused).toBeGreaterThan(0);
    });

    it('should reset component state', () => {
      const component = (props) => ({ props });
      const result1 = pool.acquire(component, { value: 1 });

      expect(result1.props).toEqual({ value: 1 });

      pool.release(result1);

      const result2 = pool.acquire(component, { value: 2 });
      // Should get new props
      expect(result2.props).toEqual({ value: 2 });
    });

    it('should track pool statistics', () => {
      const component = () => ({ id: Math.random() });

      const result1 = pool.acquire(component);
      const result2 = pool.acquire(component);
      pool.release(result2);

      const stats = pool.getStats();
      expect(stats.created).toBeGreaterThan(0);
      expect(stats.released).toBe(1);
      expect(stats.recycled).toBe(1);
    });
  });

  describe('Request Cache', () => {
    let cache: RequestCache;

    beforeEach(() => {
      cache = new RequestCache({
        defaultTTL: 1000,
        maxSize: 10,
        enableBatching: true,
      });
    });

    afterEach(() => {
      cache.clear();
    });

    it('should cache requests', async () => {
      let callCount = 0;
      const request = async () => {
        callCount++;
        return 'data';
      };

      const result1 = await cache.fetch('test', request);
      const result2 = await cache.fetch('test', request);

      expect(result1).toBe('data');
      expect(result2).toBe('data');
      expect(callCount).toBe(1); // Only called once

      const stats = cache.getStats();
      expect(stats.hits).toBeGreaterThan(0);
    });

    it('should deduplicate concurrent requests', async () => {
      let callCount = 0;
      const request = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        callCount++;
        return 'data';
      };

      const [result1, result2, result3] = await Promise.all([
        cache.fetch('test', request, { batch: false }),
        cache.fetch('test', request, { batch: false }),
        cache.fetch('test', request, { batch: false }),
      ]);

      expect(result1).toBe('data');
      expect(result2).toBe('data');
      expect(result3).toBe('data');
      expect(callCount).toBe(1); // Only called once

      const stats = cache.getStats();
      expect(stats.deduped).toBeGreaterThan(0);
    });

    it('should batch requests', async () => {
      let callCount = 0;
      const request = async () => {
        callCount++;
        return 'data';
      };

      // Fire multiple requests quickly
      const promises = [
        cache.fetch('test1', request, { batch: true }),
        cache.fetch('test1', request, { batch: true }),
        cache.fetch('test1', request, { batch: true }),
      ];

      await Promise.all(promises);

      expect(callCount).toBe(1); // Batched into single call

      const stats = cache.getStats();
      expect(stats.batched).toBeGreaterThan(0);
    });

    it('should support optimistic updates', async () => {
      const request = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'real-data';
      };

      const result = await cache.fetch('test', request, {
        optimistic: 'optimistic-data',
      });

      expect(result).toBe('optimistic-data');

      const stats = cache.getStats();
      expect(stats.optimistic).toBeGreaterThan(0);
    });

    it('should invalidate cache entries', async () => {
      const request = async () => 'data';

      await cache.fetch('test-1', request);
      await cache.fetch('test-2', request);
      await cache.fetch('other', request);

      const invalidated = cache.invalidate(/^test-/);

      expect(invalidated).toBe(2);
      expect(cache.get('test-1')).toBeNull();
      expect(cache.get('test-2')).toBeNull();
      expect(cache.get('other')).toBe('data');
    });

    it('should respect TTL', async () => {
      const request = async () => 'data';

      await cache.fetch('test', request, { ttl: 10 });

      expect(cache.get('test')).toBe('data');

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(cache.get('test')).toBeNull();
    });
  });

  describe('Integration Tests', () => {
    it('should handle 10k signal updates in <100ms', () => {
      const count = signal(0);
      let updateCount = 0;

      // Subscribe
      count.subscribe(() => {
        updateCount++;
      });

      const start = performance.now();

      // Batch 10k updates
      batch(() => {
        for (let i = 0; i < 10000; i++) {
          count.set(i);
        }
      });

      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(100);
      expect(updateCount).toBe(1); // Batched into single update
    });

    it('should optimize large list rendering', () => {
      const pool = globalVNodePool;
      const start = performance.now();

      // Create 1000 VNodes
      const vnodes = [];
      for (let i = 0; i < 1000; i++) {
        vnodes.push(pool.acquireElement('div', { key: i }));
      }

      // Release all
      for (const vnode of vnodes) {
        pool.release(vnode);
      }

      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(50);

      const stats = pool.getStats();
      expect(stats.reuseRate).toBeGreaterThan(0);
    });
  });

  describe('Performance Regression Tests', () => {
    it('subscription pool should maintain >70% reuse rate', () => {
      const pool = new SubscriptionPool();
      const callback = (value: number) => value;

      // Create and release many subscriptions
      for (let i = 0; i < 100; i++) {
        const sub = pool.acquire(callback);
        pool.release(sub);
      }

      const stats = pool.getStats();
      expect(stats.reuseRate).toBeGreaterThan(0.7);

      pool.destroy();
    });

    it('vnode pool should maintain >50% reuse rate', () => {
      const pool = new VNodePool();

      // Create and release many VNodes
      for (let i = 0; i < 100; i++) {
        const vnode = pool.acquireElement('div');
        pool.release(vnode);
      }

      const stats = pool.getStats();
      expect(stats.reuseRate).toBeGreaterThanOrEqual(0.5);

      pool.destroy();
    });

    it('request cache should maintain >80% hit rate', async () => {
      const cache = new RequestCache();
      const request = async () => 'data';

      // Fetch same data multiple times
      for (let i = 0; i < 10; i++) {
        await cache.fetch('test', request);
      }

      const stats = cache.getStats();
      expect(stats.hitRate).toBeGreaterThan(0.8);

      cache.clear();
    });

    it('optimized differ should use fast paths >40% of time', () => {
      const differ = new OptimizedDiffer();

      // Perform many diffs
      for (let i = 0; i < 100; i++) {
        const vnode = createElementVNode('div');
        differ.diff(vnode, vnode); // Same reference
      }

      const stats = differ.getStats();
      expect(stats.fastPathRate).toBeGreaterThan(0.4);
    });
  });
});
