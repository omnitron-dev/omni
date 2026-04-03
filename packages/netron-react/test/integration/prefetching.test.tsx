/**
 * Integration tests for query prefetching
 *
 * Tests that prefetching works correctly with the cache
 * and deduplication mechanisms.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { useQuery } from '../../src/hooks/useQuery.js';
import { NetronProvider } from '../../src/core/provider.js';
import { createMockedClient } from '../fixtures/test-client.js';
import type { NetronReactClient } from '../../src/core/client.js';

describe('Query Prefetching', () => {
  let client: NetronReactClient;
  let wrapper: React.FC<{ children: ReactNode }>;
  let requestCount: number;

  beforeEach(() => {
    requestCount = 0;

    const users: Record<string, { id: string; name: string }> = {
      '1': { id: '1', name: 'Alice' },
      '2': { id: '2', name: 'Bob' },
      '3': { id: '3', name: 'Charlie' },
    };

    client = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          response: (id: string) => {
            requestCount++;
            if (!users[id]) {
              throw new Error(`User not found: ${id}`);
            }
            return users[id];
          },
        },
      ],
      {
        defaults: {
          staleTime: 60000, // 1 minute stale time
          cacheTime: 300000,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    wrapper = ({ children }) =>
      React.createElement(NetronProvider, {
        client,
        autoConnect: false,
        children,
      });
  });

  afterEach(() => {
    client.clear();
    vi.clearAllMocks();
  });

  it('should prefetch data before component renders', async () => {
    const queryKey = ['user', '1'];

    // Prefetch with staleTime to keep data fresh
    await client.prefetchQuery(queryKey, () => client.invoke('user', 'getUser', ['1']), { staleTime: 60000 });

    expect(requestCount).toBe(1);

    // Now render hook - should use cached data
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey,
          queryFn: () => client.invoke('user', 'getUser', ['1']),
          staleTime: 60000,
        }),
      { wrapper }
    );

    // Should immediately have data from prefetch
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Hook uses the prefetched data
    expect((result.current.data as { name: string }).name).toBe('Alice');
  });

  it('should skip prefetch if data is fresh', async () => {
    const queryKey = ['user', '1'];

    // First prefetch
    await client.prefetchQuery(queryKey, () => client.invoke('user', 'getUser', ['1']), { staleTime: 60000 });

    expect(requestCount).toBe(1);

    // Second prefetch for same key - should be skipped (data is fresh)
    await client.prefetchQuery(queryKey, () => client.invoke('user', 'getUser', ['1']), { staleTime: 60000 });

    // Still only ONE request
    expect(requestCount).toBe(1);
  });

  it('should refetch stale data on prefetch', async () => {
    const queryKey = ['user', '1'];

    // First prefetch with 0 stale time
    await client.prefetchQuery(queryKey, () => client.invoke('user', 'getUser', ['1']), { staleTime: 0 });

    expect(requestCount).toBe(1);

    // Second prefetch - should refetch (data is stale)
    await client.prefetchQuery(queryKey, () => client.invoke('user', 'getUser', ['1']), { staleTime: 0 });

    // TWO requests (data was stale)
    expect(requestCount).toBe(2);
  });

  it('should prefetch multiple queries in parallel', async () => {
    const promises = [
      client.prefetchQuery(['user', '1'], () => client.invoke('user', 'getUser', ['1'])),
      client.prefetchQuery(['user', '2'], () => client.invoke('user', 'getUser', ['2'])),
      client.prefetchQuery(['user', '3'], () => client.invoke('user', 'getUser', ['3'])),
    ];

    await Promise.all(promises);

    // 3 different requests
    expect(requestCount).toBe(3);

    // Verify all are cached
    expect(client.getQueryData(['user', '1'])).toBeDefined();
    expect(client.getQueryData(['user', '2'])).toBeDefined();
    expect(client.getQueryData(['user', '3'])).toBeDefined();
  });

  it('should handle prefetch errors silently', async () => {
    const queryKey = ['user', 'nonexistent'];

    // Prefetch with invalid ID (will throw)
    await client.prefetchQuery(queryKey, () => client.invoke('user', 'getUser', ['nonexistent']));

    // Should complete without throwing
    expect(requestCount).toBe(1);

    // Cache should not have data (error)
    expect(client.getQueryData(queryKey)).toBeUndefined();
  });

  it('should have data in cache after prefetch', async () => {
    const queryKey = ['prefetch-cache-test'];

    // Prefetch to populate cache
    await client.prefetchQuery(queryKey, async () => ({ id: '1', name: 'Prefetched User' }));

    // Verify data is in cache
    const cachedData = client.getQueryData(queryKey);
    expect(cachedData).toEqual({ id: '1', name: 'Prefetched User' });

    // Render hook with same key
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey,
          queryFn: async () => ({ id: '1', name: 'Fetched User' }),
          staleTime: 60000,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Hook should have data (either prefetched or fetched)
    expect(result.current.data).toBeDefined();
    expect((result.current.data as { id: string }).id).toBe('1');
  });

  it('should deduplicate concurrent prefetch calls', async () => {
    const queryKey = ['user', '1'];

    // Start multiple prefetches concurrently
    const promises = [
      client.prefetchQuery(queryKey, () => client.invoke('user', 'getUser', ['1'])),
      client.prefetchQuery(queryKey, () => client.invoke('user', 'getUser', ['1'])),
      client.prefetchQuery(queryKey, () => client.invoke('user', 'getUser', ['1'])),
    ];

    await Promise.all(promises);

    // Only ONE request due to deduplication
    expect(requestCount).toBe(1);
  });

  it('should work with setQueryData', async () => {
    const queryKey = ['user', 'manual'];

    // Manually set data (like optimistic update)
    client.setQueryData(queryKey, { id: 'manual', name: 'Manual User' });

    // Render hook - should use manual data immediately
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey,
          queryFn: () => client.invoke('user', 'getUser', ['manual']),
          staleTime: 60000,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // The hook shows the manually set data
    // Note: Depending on staleTime behavior, the hook may or may not trigger a fetch
    expect((result.current.data as { name: string }).name).toBe('Manual User');
  });
});
