/**
 * Integration tests for QueryCache lifecycle and garbage collection
 *
 * Tests cache entry lifecycle, garbage collection, observer management,
 * staleness computation, SSR hydration, cache statistics, and query filtering.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { useQuery } from '../../src/hooks/useQuery.js';
import { NetronProvider } from '../../src/core/provider.js';
import { QueryCache } from '../../src/cache/query-cache.js';
import { createMockedClient } from '../fixtures/test-client.js';
import type { NetronReactClient } from '../../src/core/client.js';

// ============================================================================
// Test Setup
// ============================================================================

describe('QueryCache Lifecycle and Garbage Collection', () => {
  let client: NetronReactClient;
  let queryCache: QueryCache;
  let wrapper: React.FC<{ children: ReactNode }>;
  let _requestCount: number;

  beforeEach(() => {
    _requestCount = 0;

    // Create client for basic tests (GC enabled by default but we avoid fake timers here)
    client = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          response: (id: string) => {
            _requestCount++;
            return { id, name: `User ${id}` };
          },
        },
        {
          service: 'user',
          method: 'getUsers',
          response: () => {
            _requestCount++;
            return [
              { id: '1', name: 'Alice' },
              { id: '2', name: 'Bob' },
            ];
          },
        },
        {
          service: 'post',
          method: 'getPost',
          response: (id: string) => {
            _requestCount++;
            return { id, title: `Post ${id}` };
          },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          cacheTime: 5 * 60 * 1000, // 5 minutes
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    queryCache = client.getQueryCache();

    wrapper = ({ children }) =>
      React.createElement(NetronProvider, {
        client,
        autoConnect: false,
        children,
      });
  });

  afterEach(() => {
    vi.useRealTimers();
    client.clear();
    vi.clearAllMocks();
  });

  // ==========================================================================
  // 1. Cache Entry Lifecycle
  // ==========================================================================

  describe('Cache Entry Lifecycle', () => {
    it('should create entry on first query', async () => {
      const queryKey = ['user', '1'];

      // Initially no entry
      expect(queryCache.get(queryKey)).toBeUndefined();

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => client.invoke('user', 'getUser', ['1']),
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // Entry should now exist
      expect(queryCache.get(queryKey)).toEqual({ id: '1', name: 'User 1' });
    });

    it('should update entry on refetch', async () => {
      const queryKey = ['user', '1'];
      let callCount = 0;

      const dynamicClient = createMockedClient([
        {
          service: 'user',
          method: 'getUser',
          response: () => {
            callCount++;
            return { id: '1', name: `User 1 v${callCount}` };
          },
        },
      ]);

      const dynamicWrapper = ({ children }: { children: ReactNode }) =>
        React.createElement(NetronProvider, {
          client: dynamicClient,
          autoConnect: false,
          children,
        });

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => dynamicClient.invoke('user', 'getUser', ['1']),
          }),
        { wrapper: dynamicWrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual({ id: '1', name: 'User 1 v1' });

      // Refetch
      await act(async () => {
        await result.current.refetch();
      });

      await waitFor(() => {
        expect((result.current.data as { name: string }).name).toBe('User 1 v2');
      });

      // Cache should have updated data
      expect(dynamicClient.getQueryCache().get(queryKey)).toEqual({
        id: '1',
        name: 'User 1 v2',
      });
    });

    it('should remove entry on explicit remove()', async () => {
      const queryKey = ['user', '1'];

      // Prefetch to populate cache
      await client.prefetchQuery(queryKey, () => client.invoke('user', 'getUser', ['1']));

      await waitFor(() => {
        expect(queryCache.get(queryKey)).toBeDefined();
      });

      // Remove
      queryCache.remove(queryKey);

      expect(queryCache.get(queryKey)).toBeUndefined();
    });

    it('should remove all entries on cache.clear()', async () => {
      // Prefetch multiple queries
      await client.prefetchQuery(['user', '1'], () => client.invoke('user', 'getUser', ['1']));
      await client.prefetchQuery(['user', '2'], () => client.invoke('user', 'getUser', ['2']));
      await client.prefetchQuery(['post', '1'], () => client.invoke('post', 'getPost', ['1']));

      await waitFor(() => {
        expect(queryCache.get(['user', '1'])).toBeDefined();
        expect(queryCache.get(['user', '2'])).toBeDefined();
        expect(queryCache.get(['post', '1'])).toBeDefined();
      });

      // Clear all
      queryCache.clear();

      expect(queryCache.get(['user', '1'])).toBeUndefined();
      expect(queryCache.get(['user', '2'])).toBeUndefined();
      expect(queryCache.get(['post', '1'])).toBeUndefined();
    });
  });

  // ==========================================================================
  // 2. Garbage Collection
  // ==========================================================================

  describe('Garbage Collection', () => {
    it('should schedule GC when observers unsubscribe', async () => {
      vi.useFakeTimers();

      // Create a cache with short cache time for testing
      const testCache = new QueryCache({
        defaultCacheTime: 1000, // 1 second
        gcEnabled: true,
        gcInterval: 10000000, // Large interval to avoid periodic GC
      });

      const queryKey = ['test', '1'];

      // Subscribe (adds observer)
      const unsubscribe = testCache.subscribe(queryKey, () => {});

      // Set data
      testCache.set(queryKey, { value: 'test' });

      expect(testCache.get(queryKey)).toBeDefined();

      // Unsubscribe triggers GC scheduling
      unsubscribe();

      // Entry should still exist immediately
      expect(testCache.get(queryKey)).toBeDefined();

      // After cache time, GC should remove it
      await vi.advanceTimersByTimeAsync(1100);

      expect(testCache.get(queryKey)).toBeUndefined();

      testCache.destroy();
    });

    it('should cancel GC when new observer subscribes', async () => {
      vi.useFakeTimers();

      const testCache = new QueryCache({
        defaultCacheTime: 1000,
        gcEnabled: true,
        gcInterval: 10000000, // Large interval
      });

      const queryKey = ['test', '1'];

      // First observer
      const unsubscribe1 = testCache.subscribe(queryKey, () => {});
      testCache.set(queryKey, { value: 'test' });

      // Unsubscribe - GC scheduled
      unsubscribe1();

      // Wait halfway through cache time
      await vi.advanceTimersByTimeAsync(500);

      // New observer subscribes - should cancel GC
      const unsubscribe2 = testCache.subscribe(queryKey, () => {});

      // Wait past original cache time
      await vi.advanceTimersByTimeAsync(600);

      // Entry should still exist because new observer cancelled GC
      expect(testCache.get(queryKey)).toBeDefined();

      unsubscribe2();
      testCache.destroy();
    });

    it('should remove entry after cacheTime expires', async () => {
      vi.useFakeTimers();

      const testCache = new QueryCache({
        defaultCacheTime: 2000, // 2 seconds
        gcEnabled: true,
        gcInterval: 10000000, // Large interval
      });

      const queryKey = ['test', '1'];

      // Add data without observers
      testCache.set(queryKey, { value: 'test' });

      expect(testCache.get(queryKey)).toBeDefined();

      // Subscribe/unsubscribe to trigger GC scheduling
      const unsub = testCache.subscribe(queryKey, () => {});
      unsub();

      await vi.advanceTimersByTimeAsync(2100);

      expect(testCache.get(queryKey)).toBeUndefined();

      testCache.destroy();
    });

    it('should respect maxEntries limit', () => {
      const testCache = new QueryCache({
        maxEntries: 3,
        gcEnabled: false, // Disable GC for this test
      });

      // Add entries
      testCache.set(['entry', '1'], { value: 1 });
      testCache.set(['entry', '2'], { value: 2 });
      testCache.set(['entry', '3'], { value: 3 });

      // All should exist
      expect(testCache.get(['entry', '1'])).toBeDefined();
      expect(testCache.get(['entry', '2'])).toBeDefined();
      expect(testCache.get(['entry', '3'])).toBeDefined();

      // Add 4th entry - should trigger eviction
      testCache.set(['entry', '4'], { value: 4 });

      // Oldest entry should be removed (entry 1)
      expect(testCache.get(['entry', '1'])).toBeUndefined();
      expect(testCache.get(['entry', '2'])).toBeDefined();
      expect(testCache.get(['entry', '3'])).toBeDefined();
      expect(testCache.get(['entry', '4'])).toBeDefined();

      testCache.destroy();
    });

    it('should remove oldest entries first (LRU behavior)', async () => {
      const testCache = new QueryCache({
        maxEntries: 3,
        gcEnabled: false,
      });

      // Add entries in order with small delays to ensure different timestamps
      testCache.set(['a'], { value: 'a' });
      await new Promise((r) => setTimeout(r, 10));

      testCache.set(['b'], { value: 'b' });
      await new Promise((r) => setTimeout(r, 10));

      testCache.set(['c'], { value: 'c' });
      await new Promise((r) => setTimeout(r, 10));

      // Update 'a' to make it newest
      testCache.set(['a'], { value: 'a-updated' });
      await new Promise((r) => setTimeout(r, 10));

      // Add new entry - should evict 'b' (now oldest)
      testCache.set(['d'], { value: 'd' });

      // 'b' should be evicted as it's now the oldest
      expect(testCache.get(['a'])).toBeDefined();
      expect(testCache.get(['b'])).toBeUndefined();
      expect(testCache.get(['c'])).toBeDefined();
      expect(testCache.get(['d'])).toBeDefined();

      testCache.destroy();
    });

    it('should not evict entries with active observers', () => {
      const testCache = new QueryCache({
        maxEntries: 2,
        gcEnabled: false,
      });

      // Entry with observer
      const unsubscribe = testCache.subscribe(['protected'], () => {});
      testCache.set(['protected'], { value: 'protected' });

      // Entry without observer
      testCache.set(['unprotected'], { value: 'unprotected' });

      // Add third entry - should evict 'unprotected', not 'protected'
      testCache.set(['new'], { value: 'new' });

      expect(testCache.get(['protected'])).toBeDefined();
      expect(testCache.get(['unprotected'])).toBeUndefined();
      expect(testCache.get(['new'])).toBeDefined();

      unsubscribe();
      testCache.destroy();
    });
  });

  // ==========================================================================
  // 3. Observer Management
  // ==========================================================================

  describe('Observer Management', () => {
    it('should add observer on useQuery mount', async () => {
      const queryKey = ['user', '1'];

      const statsBefore = queryCache.getStats();
      expect(statsBefore.observerCount).toBe(0);

      const { result, unmount } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => client.invoke('user', 'getUser', ['1']),
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const statsAfter = queryCache.getStats();
      expect(statsAfter.observerCount).toBe(1);

      unmount();
    });

    it('should remove observer on useQuery unmount', async () => {
      const queryKey = ['user', '1'];

      const { result, unmount } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => client.invoke('user', 'getUser', ['1']),
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(queryCache.getStats().observerCount).toBe(1);

      // Unmount
      unmount();

      // Observer should be removed (after React cleanup)
      await waitFor(() => {
        expect(queryCache.getStats().observerCount).toBe(0);
      });
    });

    it('should support multiple observers for same query', async () => {
      const queryKey = ['user', '1'];

      // First hook
      const { result: result1, unmount: unmount1 } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => client.invoke('user', 'getUser', ['1']),
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result1.current.isSuccess).toBe(true);
      });

      // Second hook with same query key
      const { result: result2, unmount: unmount2 } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => client.invoke('user', 'getUser', ['1']),
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result2.current.isSuccess).toBe(true);
      });

      // Should have 2 observers
      expect(queryCache.getStats().observerCount).toBe(2);

      // Both should have same data (single fetch due to deduplication)
      expect(result1.current.data).toEqual(result2.current.data);

      unmount1();
      unmount2();
    });

    it('should notify observers on data change', () => {
      const queryKey = ['user', '1'];
      const observer = vi.fn();

      // Subscribe directly to cache
      const unsubscribe = queryCache.subscribe(queryKey, observer);

      // Set data
      queryCache.set(queryKey, { id: '1', name: 'Alice' });

      expect(observer).toHaveBeenCalledTimes(1);

      // Update data
      queryCache.set(queryKey, { id: '1', name: 'Alice Updated' });

      expect(observer).toHaveBeenCalledTimes(2);

      unsubscribe();
    });

    it('should handle observer errors gracefully', () => {
      const queryKey = ['test'];
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Subscribe with throwing observer
      const badObserver = vi.fn(() => {
        throw new Error('Observer error');
      });
      const goodObserver = vi.fn();

      queryCache.subscribe(queryKey, badObserver);
      queryCache.subscribe(queryKey, goodObserver);

      // Set data - should not throw
      queryCache.set(queryKey, { value: 'test' });

      // Good observer should still be called
      expect(goodObserver).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  // ==========================================================================
  // 4. Staleness
  // ==========================================================================

  describe('Staleness', () => {
    it('should compute isStale correctly', async () => {
      vi.useFakeTimers();

      const testCache = new QueryCache({ gcEnabled: false });
      const queryKey = ['user', '1'];

      // Set data
      testCache.set(queryKey, { id: '1', name: 'Alice' });

      // With staleTime=0, should be immediately stale
      expect(testCache.isStale(queryKey, 0)).toBe(true);

      // With staleTime=60000, should not be stale yet
      expect(testCache.isStale(queryKey, 60000)).toBe(false);

      // Advance time past staleTime
      await vi.advanceTimersByTimeAsync(61000);

      expect(testCache.isStale(queryKey, 60000)).toBe(true);

      testCache.destroy();
    });

    it('should mark invalidated entries as stale', () => {
      const testCache = new QueryCache({ gcEnabled: false });
      const queryKey = ['user', '1'];

      testCache.set(queryKey, { id: '1', name: 'Alice' });

      // Should not be stale with long staleTime
      expect(testCache.isStale(queryKey, 60000)).toBe(false);

      // Invalidate
      testCache.invalidate(queryKey);

      // Should be stale regardless of staleTime
      expect(testCache.isStale(queryKey, 60000)).toBe(true);
      expect(testCache.isStale(queryKey, Infinity)).toBe(true);

      testCache.destroy();
    });

    it('should always be stale with staleTime=0', () => {
      const testCache = new QueryCache({ gcEnabled: false });
      const queryKey = ['user', '1'];

      testCache.set(queryKey, { id: '1', name: 'Alice' });

      // Immediately stale
      expect(testCache.isStale(queryKey, 0)).toBe(true);

      testCache.destroy();
    });

    it('should never be stale with staleTime=Infinity when not invalidated', () => {
      const testCache = new QueryCache({ gcEnabled: false });
      const queryKey = ['user', '1'];

      testCache.set(queryKey, { id: '1', name: 'Alice' });

      expect(testCache.isStale(queryKey, Infinity)).toBe(false);

      testCache.destroy();
    });

    it('should return true for non-existent query', () => {
      expect(queryCache.isStale(['nonexistent'], 60000)).toBe(true);
    });
  });

  // ==========================================================================
  // 5. SSR Hydration
  // ==========================================================================

  describe('SSR Hydration', () => {
    it('should dehydrate cache state correctly', () => {
      const testCache = new QueryCache({ gcEnabled: false });

      // Populate cache with various states
      testCache.set(['user', '1'], { id: '1', name: 'Alice' });
      testCache.set(['user', '2'], { id: '2', name: 'Bob' });
      testCache.setError(['user', '3'], new Error('Not found'));

      const dehydrated = testCache.dehydrate();

      // Should only include successful queries
      expect(dehydrated).toHaveLength(2);
      expect(dehydrated.map((q) => q.queryKey)).toEqual([
        ['user', '1'],
        ['user', '2'],
      ]);

      testCache.destroy();
    });

    it('should restore cache state via hydrate()', () => {
      const testCache = new QueryCache({ gcEnabled: false });

      const dehydratedState = [
        {
          queryKey: ['user', '1'] as const,
          queryHash: '["user","1"]',
          state: {
            data: { id: '1', name: 'Alice' },
            error: null,
            status: 'success' as const,
            dataUpdatedAt: Date.now(),
            errorUpdatedAt: 0,
            isInvalidated: false,
          },
        },
        {
          queryKey: ['user', '2'] as const,
          queryHash: '["user","2"]',
          state: {
            data: { id: '2', name: 'Bob' },
            error: null,
            status: 'success' as const,
            dataUpdatedAt: Date.now(),
            errorUpdatedAt: 0,
            isInvalidated: false,
          },
        },
      ];

      testCache.hydrate(dehydratedState);

      expect(testCache.get(['user', '1'])).toEqual({ id: '1', name: 'Alice' });
      expect(testCache.get(['user', '2'])).toEqual({ id: '2', name: 'Bob' });

      testCache.destroy();
    });

    it('should use hydrated data in queries', async () => {
      // Hydrate with pre-existing data
      const hydratedClient = createMockedClient(
        [
          {
            service: 'user',
            method: 'getUser',
            response: () => ({ id: '1', name: 'Server Data' }),
          },
        ],
        {
          defaults: {
            staleTime: 60000, // Not stale
            cacheTime: 300000,
            retry: 0,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
          },
        }
      );

      // Hydrate cache before rendering
      hydratedClient.getQueryCache().hydrate([
        {
          queryKey: ['user', '1'] as const,
          queryHash: '["user","1"]',
          state: {
            data: { id: '1', name: 'Hydrated Data' },
            error: null,
            status: 'success' as const,
            dataUpdatedAt: Date.now(),
            errorUpdatedAt: 0,
            isInvalidated: false,
          },
        },
      ]);

      const hydratedWrapper = ({ children }: { children: ReactNode }) =>
        React.createElement(NetronProvider, {
          client: hydratedClient,
          autoConnect: false,
          children,
        });

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: () => hydratedClient.invoke('user', 'getUser', ['1']),
            staleTime: 60000,
          }),
        { wrapper: hydratedWrapper }
      );

      // Should use hydrated data immediately
      await waitFor(() => {
        expect(result.current.data).toEqual({ id: '1', name: 'Hydrated Data' });
        expect(result.current.isSuccess).toBe(true);
      });
    });

    it('should only dehydrate successful queries', () => {
      const testCache = new QueryCache({ gcEnabled: false });

      // Add queries with different statuses
      testCache.set(['success'], { value: 'success' });
      testCache.setError(['error'], new Error('Failed'));

      const dehydrated = testCache.dehydrate();

      // Only success query should be dehydrated
      expect(dehydrated).toHaveLength(1);
      expect(dehydrated[0].queryKey).toEqual(['success']);

      testCache.destroy();
    });

    it('should not overwrite existing data during hydration', () => {
      const testCache = new QueryCache({ gcEnabled: false });

      // Set existing data
      testCache.set(['user', '1'], { id: '1', name: 'Existing' });

      // Try to hydrate with different data
      testCache.hydrate([
        {
          queryKey: ['user', '1'] as const,
          queryHash: '["user","1"]',
          state: {
            data: { id: '1', name: 'Hydrated' },
            error: null,
            status: 'success' as const,
            dataUpdatedAt: Date.now(),
            errorUpdatedAt: 0,
            isInvalidated: false,
          },
        },
      ]);

      // Existing data should be preserved
      expect(testCache.get(['user', '1'])).toEqual({ id: '1', name: 'Existing' });

      testCache.destroy();
    });
  });

  // ==========================================================================
  // 6. Cache Statistics
  // ==========================================================================

  describe('Cache Statistics', () => {
    it('should return correct stats via getStats()', () => {
      const stats = queryCache.getStats();

      expect(stats).toHaveProperty('size', 0);
      expect(stats).toHaveProperty('observerCount', 0);
      expect(stats).toHaveProperty('fetchingCount', 0);
    });

    it('should track size correctly', () => {
      const testCache = new QueryCache({ gcEnabled: false });

      expect(testCache.getStats().size).toBe(0);

      testCache.set(['a'], { value: 'a' });
      expect(testCache.getStats().size).toBe(1);

      testCache.set(['b'], { value: 'b' });
      expect(testCache.getStats().size).toBe(2);

      testCache.remove(['a']);
      expect(testCache.getStats().size).toBe(1);

      testCache.clear();
      expect(testCache.getStats().size).toBe(0);

      testCache.destroy();
    });

    it('should track observerCount accurately', () => {
      const testCache = new QueryCache({ gcEnabled: false });

      expect(testCache.getStats().observerCount).toBe(0);

      const unsub1 = testCache.subscribe(['a'], () => {});
      expect(testCache.getStats().observerCount).toBe(1);

      const unsub2 = testCache.subscribe(['a'], () => {});
      expect(testCache.getStats().observerCount).toBe(2);

      const unsub3 = testCache.subscribe(['b'], () => {});
      expect(testCache.getStats().observerCount).toBe(3);

      unsub1();
      expect(testCache.getStats().observerCount).toBe(2);

      unsub2();
      unsub3();
      expect(testCache.getStats().observerCount).toBe(0);

      testCache.destroy();
    });

    it('should track fetchingCount accurately', () => {
      const testCache = new QueryCache({ gcEnabled: false });

      expect(testCache.getStats().fetchingCount).toBe(0);

      // Start fetch (need to have a query first)
      testCache.set(['a'], { value: 'a' });
      testCache.set(['b'], { value: 'b' });

      testCache.startFetch(['a']);
      expect(testCache.getStats().fetchingCount).toBe(1);

      testCache.startFetch(['b']);
      expect(testCache.getStats().fetchingCount).toBe(2);

      // End fetch
      testCache.endFetch(['a']);
      expect(testCache.getStats().fetchingCount).toBe(1);

      testCache.endFetch(['b']);
      expect(testCache.getStats().fetchingCount).toBe(0);

      testCache.destroy();
    });

    it('should update stats when using getOrCreateFetch', async () => {
      const testCache = new QueryCache({ gcEnabled: false });

      expect(testCache.getStats().fetchingCount).toBe(0);

      const fetchPromise = testCache.getOrCreateFetch(['test'], async () => ({ value: 'test' }));

      expect(testCache.getStats().fetchingCount).toBe(1);

      await fetchPromise;

      expect(testCache.getStats().fetchingCount).toBe(0);

      testCache.destroy();
    });
  });

  // ==========================================================================
  // 7. Query Filtering
  // ==========================================================================

  describe('Query Filtering', () => {
    let testCache: QueryCache;

    beforeEach(() => {
      testCache = new QueryCache({ gcEnabled: false });

      // Populate cache with various queries
      testCache.set(['user', '1'], { id: '1', name: 'Alice' });
      testCache.set(['user', '2'], { id: '2', name: 'Bob' });
      testCache.set(['post', '1'], { id: '1', title: 'Post 1' });
      testCache.set(['post', '2'], { id: '2', title: 'Post 2' });
      testCache.setError(['user', '3'], new Error('Not found'));
    });

    afterEach(() => {
      testCache.destroy();
    });

    it('should filter by queryKey prefix (partial matching)', () => {
      const userQueries = testCache.findAll({ queryKey: ['user'] });

      expect(userQueries).toHaveLength(3); // includes error state
      expect(userQueries.every((q) => q.queryKey[0] === 'user')).toBe(true);
    });

    it('should filter by exact queryKey match', () => {
      const exactMatch = testCache.findAll({
        queryKey: ['user', '1'],
        exact: true,
      });

      expect(exactMatch).toHaveLength(1);
      expect(exactMatch[0].queryKey).toEqual(['user', '1']);
    });

    it('should filter by predicate', () => {
      const queries = testCache.findAll({
        predicate: (query) => {
          const data = query.state.data as { name?: string } | undefined;
          return data?.name?.startsWith('A') ?? false;
        },
      });

      expect(queries).toHaveLength(1);
      expect((queries[0].state.data as { name: string }).name).toBe('Alice');
    });

    it('should filter by status', () => {
      const successQueries = testCache.findAll({ status: 'success' });
      const errorQueries = testCache.findAll({ status: 'error' });

      expect(successQueries).toHaveLength(4);
      expect(errorQueries).toHaveLength(1);
    });

    it('should combine multiple filters', () => {
      const filteredQueries = testCache.findAll({
        queryKey: ['user'],
        status: 'success',
      });

      expect(filteredQueries).toHaveLength(2);
      expect(filteredQueries.every((q) => q.state.status === 'success')).toBe(true);
    });

    it('should return all queries with no filters', () => {
      const allQueries = testCache.findAll();

      expect(allQueries).toHaveLength(5);
    });

    it('should return empty array when no matches', () => {
      const noMatches = testCache.findAll({
        queryKey: ['nonexistent'],
      });

      expect(noMatches).toHaveLength(0);
    });
  });

  // ==========================================================================
  // 8. Cache Time vs Stale Time
  // ==========================================================================

  describe('Cache Time vs Stale Time', () => {
    it('should show stale data while refetching', async () => {
      let fetchCount = 0;

      const slowClient = createMockedClient([
        {
          service: 'user',
          method: 'getUser',
          delay: 100,
          response: () => {
            fetchCount++;
            return { id: '1', name: `User v${fetchCount}` };
          },
        },
      ]);

      const slowWrapper = ({ children }: { children: ReactNode }) =>
        React.createElement(NetronProvider, {
          client: slowClient,
          autoConnect: false,
          children,
        });

      // First fetch
      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: () => slowClient.invoke('user', 'getUser', ['1']),
            staleTime: 0, // Immediately stale
          }),
        { wrapper: slowWrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual({ id: '1', name: 'User v1' });

      // Trigger refetch
      act(() => {
        void result.current.refetch();
      });

      // During refetch, should show stale data
      expect(result.current.data).toEqual({ id: '1', name: 'User v1' });
      expect(result.current.isFetching).toBe(true);

      // Wait for refetch to complete
      await waitFor(() => {
        expect((result.current.data as { name: string }).name).toBe('User v2');
      });
    });

    it('should keep entry in cache during cacheTime even when stale', async () => {
      vi.useFakeTimers();

      const testCache = new QueryCache({
        defaultCacheTime: 5000, // 5 seconds
        gcEnabled: true,
        gcInterval: 10000000, // Large interval
      });

      const queryKey = ['test'];

      // Add data
      testCache.set(queryKey, { value: 'test' });

      // Subscribe then unsubscribe to trigger GC scheduling
      const unsub = testCache.subscribe(queryKey, () => {});
      unsub();

      // Data is stale immediately (staleTime=0), but should remain for cacheTime
      expect(testCache.isStale(queryKey, 0)).toBe(true);
      expect(testCache.get(queryKey)).toBeDefined();

      // Advance time within cacheTime
      await vi.advanceTimersByTimeAsync(3000);
      expect(testCache.get(queryKey)).toBeDefined();

      // Advance past cacheTime
      await vi.advanceTimersByTimeAsync(3000);
      expect(testCache.get(queryKey)).toBeUndefined();

      testCache.destroy();
    });

    it('should handle independent timing mechanisms', async () => {
      vi.useFakeTimers();

      const testCache = new QueryCache({
        defaultCacheTime: 10000, // 10 seconds
        gcEnabled: true,
        gcInterval: 10000000, // Large interval
      });

      const queryKey = ['test'];

      // Add data
      testCache.set(queryKey, { value: 'test' });

      // After 3 seconds: stale with staleTime=2000, but still in cache
      await vi.advanceTimersByTimeAsync(3000);
      expect(testCache.isStale(queryKey, 2000)).toBe(true);
      expect(testCache.get(queryKey)).toBeDefined();

      // After 8 seconds: still stale, still in cache
      await vi.advanceTimersByTimeAsync(5000);
      expect(testCache.isStale(queryKey, 2000)).toBe(true);
      expect(testCache.get(queryKey)).toBeDefined();

      // Need to trigger GC by unsubscribing
      const unsub = testCache.subscribe(queryKey, () => {});
      unsub();

      await vi.advanceTimersByTimeAsync(11000);
      expect(testCache.get(queryKey)).toBeUndefined();

      testCache.destroy();
    });
  });

  // ==========================================================================
  // Additional Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle concurrent fetches with deduplication', async () => {
      let fetchCount = 0;

      const testCache = new QueryCache({ gcEnabled: false });
      const queryKey = ['concurrent'];

      // Start multiple concurrent fetches
      const promise1 = testCache.getOrCreateFetch(queryKey, async () => {
        fetchCount++;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { value: 'result' };
      });

      const promise2 = testCache.getOrCreateFetch(queryKey, async () => {
        fetchCount++;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { value: 'result2' };
      });

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // Should only fetch once
      expect(fetchCount).toBe(1);
      expect(result1).toEqual(result2);

      testCache.destroy();
    });

    it('should handle fetch errors correctly', async () => {
      const testCache = new QueryCache({ gcEnabled: false });
      const queryKey = ['error-test'];

      const fetchPromise = testCache.getOrCreateFetch(queryKey, async () => {
        throw new Error('Fetch failed');
      });

      await expect(fetchPromise).rejects.toThrow('Fetch failed');

      // Cache should have error state
      const query = testCache.getQuery(queryKey);
      expect(query?.state.status).toBe('error');
      expect(query?.state.error).toBeInstanceOf(Error);

      testCache.destroy();
    });

    it('should properly abort cancelled fetches', async () => {
      const testCache = new QueryCache({ gcEnabled: false });
      const queryKey = ['abort-test'];
      let wasAborted = false;

      // Start a long-running fetch
      const fetchPromise = testCache.getOrCreateFetch(queryKey, async (signal) => {
        signal.addEventListener('abort', () => {
          wasAborted = true;
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return { value: 'result' };
      });

      // Cancel before completion
      testCache.cancelAll({ queryKey });

      // Wait a bit for abort to propagate
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(wasAborted).toBe(true);

      // Clean up - the promise will reject due to abort
      try {
        await fetchPromise;
      } catch {
        // Expected
      }

      testCache.destroy();
    });

    it('should handle destroy() cleanup properly', () => {
      const testCache = new QueryCache({
        gcEnabled: true,
        gcInterval: 1000,
      });

      // Add some data
      testCache.set(['test'], { value: 'test' });
      testCache.subscribe(['test'], () => {});

      // Destroy should not throw
      expect(() => testCache.destroy()).not.toThrow();

      // Cache should be empty
      expect(testCache.getStats().size).toBe(0);
    });

    it('should handle complex query keys with objects', () => {
      const testCache = new QueryCache({ gcEnabled: false });
      const complexKey = ['users', { filters: { status: 'active' }, page: 1 }];

      testCache.set(complexKey, { users: [] });

      expect(testCache.get(complexKey)).toEqual({ users: [] });

      // Different object reference but same content should work
      const sameKey = ['users', { filters: { status: 'active' }, page: 1 }];
      expect(testCache.get(sameKey)).toEqual({ users: [] });

      testCache.destroy();
    });

    it('should handle object key order normalization', () => {
      const testCache = new QueryCache({ gcEnabled: false });

      // Keys with different property order should hash the same
      const key1 = ['query', { a: 1, b: 2 }];
      const key2 = ['query', { b: 2, a: 1 }];

      testCache.set(key1, { value: 'test' });

      // Should retrieve with differently ordered object
      expect(testCache.get(key2)).toEqual({ value: 'test' });

      testCache.destroy();
    });
  });
});
