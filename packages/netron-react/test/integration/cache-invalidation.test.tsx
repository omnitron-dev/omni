/**
 * Integration tests for cache invalidation
 *
 * Tests cache invalidation, stale-while-revalidate,
 * and cache management behaviors.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { useQuery } from '../../src/hooks/useQuery.js';
import { NetronProvider } from '../../src/core/provider.js';
import { createMockedClient } from '../fixtures/test-client.js';
import type { NetronReactClient } from '../../src/core/client.js';

describe('Cache Invalidation', () => {
  let client: NetronReactClient;
  let wrapper: React.FC<{ children: ReactNode }>;
  let requestCount: number;
  let userData: Record<string, { id: string; name: string }>;

  beforeEach(() => {
    requestCount = 0;
    userData = {
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
            if (!userData[id]) {
              throw new Error(`User not found: ${id}`);
            }
            return userData[id];
          },
        },
        {
          service: 'user',
          method: 'updateUser',
          response: (id: string, updates: Partial<{ name: string }>) => {
            if (!userData[id]) {
              throw new Error(`User not found: ${id}`);
            }
            userData[id] = { ...userData[id], ...updates };
            return userData[id];
          },
        },
      ],
      {
        defaults: {
          staleTime: 0,
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
    vi.useRealTimers();
    client.clear();
    vi.clearAllMocks();
  });

  it('should invalidate specific query', async () => {
    const queryKey = ['user', '1'];

    // First fetch
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

    expect(requestCount).toBe(1);

    // Invalidate the query
    await act(async () => {
      await client.invalidateQueries({ queryKey });
    });

    // Query should be marked as invalidated
    const queryState = client.getQueryState(queryKey);
    expect(queryState?.state.isInvalidated).toBe(true);

    // Manual refetch should work
    await act(async () => {
      await result.current.refetch();
    });

    expect(requestCount).toBe(2);
  });

  it('should invalidate queries matching predicate', async () => {
    // Fetch two users
    const { result: result1 } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => client.invoke('user', 'getUser', ['1']),
        }),
      { wrapper }
    );

    const { result: result2 } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '2'],
          queryFn: () => client.invoke('user', 'getUser', ['2']),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true);
      expect(result2.current.isSuccess).toBe(true);
    });

    expect(requestCount).toBe(2);

    // Invalidate all user queries
    await act(async () => {
      await client.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey as [string, string];
          return key[0] === 'user';
        },
      });
    });

    // Both queries should be marked as invalidated
    expect(client.getQueryState(['user', '1'])?.state.isInvalidated).toBe(true);
    expect(client.getQueryState(['user', '2'])?.state.isInvalidated).toBe(true);

    // Manual refetch will update the data
    await act(async () => {
      await Promise.all([result1.current.refetch(), result2.current.refetch()]);
    });

    expect(requestCount).toBe(4);
  });

  it('should support stale-while-revalidate pattern', async () => {
    const queryKey = ['user', '1'];

    // First fetch
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey,
          queryFn: () => client.invoke('user', 'getUser', ['1']),
          staleTime: 0, // Immediately stale
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const initialData = result.current.data;
    expect(requestCount).toBe(1);

    // Update user on server
    userData['1'] = { id: '1', name: 'Alice Updated' };

    // Refetch
    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect((result.current.data as { name: string }).name).toBe('Alice Updated');
    });

    expect(requestCount).toBe(2);
    expect(result.current.data).not.toEqual(initialData);
  });

  it('should clear cache with client.clear()', async () => {
    // Fetch some data
    await client.prefetchQuery(['user', '1'], () => client.invoke('user', 'getUser', ['1']));

    await client.prefetchQuery(['user', '2'], () => client.invoke('user', 'getUser', ['2']));

    expect(client.getQueryData(['user', '1'])).toBeDefined();
    expect(client.getQueryData(['user', '2'])).toBeDefined();

    // Clear cache
    client.clear();

    expect(client.getQueryData(['user', '1'])).toBeUndefined();
    expect(client.getQueryData(['user', '2'])).toBeUndefined();
  });

  it('should remove specific queries', async () => {
    // Fetch some data
    await client.prefetchQuery(['user', '1'], () => client.invoke('user', 'getUser', ['1']));

    await client.prefetchQuery(['user', '2'], () => client.invoke('user', 'getUser', ['2']));

    // Remove only user 1
    client.removeQueries({ queryKey: ['user', '1'] });

    expect(client.getQueryData(['user', '1'])).toBeUndefined();
    expect(client.getQueryData(['user', '2'])).toBeDefined();
  });

  it('should cancel in-flight queries', async () => {
    const queryKey = ['echo', 'slow'];
    let fetchAborted = false;

    // Add a slow mock
    const slowClient = createMockedClient([
      {
        service: 'echo',
        method: 'slow',
        response: async () => {
          // This will be cancelled before completing
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return { slow: true };
        },
      },
    ]);

    const slowWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: slowClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey,
          queryFn: async ({ signal }) => {
            signal.addEventListener('abort', () => {
              fetchAborted = true;
            });
            // Slow request
            await new Promise((resolve) => setTimeout(resolve, 1000));
            return { slow: true };
          },
        }),
      { wrapper: slowWrapper }
    );

    // Wait for fetch to start
    await waitFor(() => {
      expect(result.current.isFetching).toBe(true);
    });

    // Cancel queries
    slowClient.cancelQueries({ queryKey });

    // The abort handler should have been called
    await waitFor(() => {
      expect(fetchAborted).toBe(true);
    });
  });

  it('should handle optimistic updates via setQueryData', async () => {
    const queryKey = ['user', '1'];

    // Initial fetch
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey,
          queryFn: () => client.invoke('user', 'getUser', ['1']),
          staleTime: 60000,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect((result.current.data as { name: string }).name).toBe('Alice');

    // Optimistic update
    act(() => {
      client.setQueryData(queryKey, { id: '1', name: 'Alice (Optimistic)' });
    });

    // Data should update immediately
    expect((result.current.data as { name: string }).name).toBe('Alice (Optimistic)');

    // No additional network request
    expect(requestCount).toBe(1);
  });

  it('should handle updater function in setQueryData', async () => {
    const queryKey = ['user', '1'];

    // Initial fetch
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey,
          queryFn: () => client.invoke('user', 'getUser', ['1']),
          staleTime: 60000,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    // Update with function
    act(() => {
      client.setQueryData<{ id: string; name: string }>(queryKey, (prev) => ({
        ...prev!,
        name: prev?.name + ' (Updated)',
      }));
    });

    expect((result.current.data as { name: string }).name).toBe('Alice (Updated)');
  });
});
