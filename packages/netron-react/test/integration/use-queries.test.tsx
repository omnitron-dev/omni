/**
 * Integration tests for useQueries hook
 *
 * Tests parallel query execution and combined state management.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { useQueries } from '../../src/hooks/useQueries.js';
import { NetronProvider } from '../../src/core/provider.js';
import { createMockedClient } from '../fixtures/test-client.js';
import type { NetronReactClient } from '../../src/core/client.js';

describe('useQueries Hook', () => {
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
          staleTime: 60000,
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

  it('should fetch multiple queries in parallel', async () => {
    const { result } = renderHook(
      () =>
        useQueries({
          queries: [
            {
              queryKey: ['user', '1'],
              queryFn: () => client.invoke('user', 'getUser', ['1']),
            },
            {
              queryKey: ['user', '2'],
              queryFn: () => client.invoke('user', 'getUser', ['2']),
            },
            {
              queryKey: ['user', '3'],
              queryFn: () => client.invoke('user', 'getUser', ['3']),
            },
          ],
        }),
      { wrapper }
    );

    // All should start loading
    expect(result.current[0].isLoading).toBe(true);
    expect(result.current[1].isLoading).toBe(true);
    expect(result.current[2].isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current[0].isSuccess).toBe(true);
      expect(result.current[1].isSuccess).toBe(true);
      expect(result.current[2].isSuccess).toBe(true);
    });

    // All 3 requests made
    expect(requestCount).toBe(3);

    // Data should be correct
    expect((result.current[0].data as { name: string }).name).toBe('Alice');
    expect((result.current[1].data as { name: string }).name).toBe('Bob');
    expect((result.current[2].data as { name: string }).name).toBe('Charlie');
  });

  it('should use combine function to transform results', async () => {
    const { result } = renderHook(
      () =>
        useQueries({
          queries: [
            {
              queryKey: ['user', '1'],
              queryFn: () => client.invoke<{ id: string; name: string }>('user', 'getUser', ['1']),
            },
            {
              queryKey: ['user', '2'],
              queryFn: () => client.invoke<{ id: string; name: string }>('user', 'getUser', ['2']),
            },
          ],
          combine: (results) => ({
            users: results.map((r) => r.data).filter(Boolean) as { id: string; name: string }[],
            isLoading: results.some((r) => r.isLoading),
            isError: results.some((r) => r.isError),
            allSuccess: results.every((r) => r.isSuccess),
          }),
        }),
      { wrapper }
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.users.length).toBe(0);

    await waitFor(() => {
      expect(result.current.allSuccess).toBe(true);
    });

    expect(result.current.users.length).toBe(2);
    expect(result.current.users[0].name).toBe('Alice');
    expect(result.current.users[1].name).toBe('Bob');
  });

  it('should handle partial failures', async () => {
    const { result } = renderHook(
      () =>
        useQueries({
          queries: [
            {
              queryKey: ['user', '1'],
              queryFn: () => client.invoke('user', 'getUser', ['1']),
            },
            {
              queryKey: ['user', 'nonexistent'],
              queryFn: () => client.invoke('user', 'getUser', ['nonexistent']),
            },
          ],
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current[0].isSuccess).toBe(true);
      expect(result.current[1].isError).toBe(true);
    });

    expect((result.current[0].data as { name: string }).name).toBe('Alice');
    expect(result.current[1].error).toBeDefined();
  });

  it('should support enabled flag on individual queries', async () => {
    const { result } = renderHook(
      () =>
        useQueries({
          queries: [
            {
              queryKey: ['user', '1'],
              queryFn: () => client.invoke('user', 'getUser', ['1']),
              enabled: true,
            },
            {
              queryKey: ['user', '2'],
              queryFn: () => client.invoke('user', 'getUser', ['2']),
              enabled: false, // Disabled
            },
          ],
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current[0].isSuccess).toBe(true);
    });

    // Only 1 request made (second is disabled)
    expect(requestCount).toBe(1);

    // First has data, second is idle
    expect(result.current[0].data).toBeDefined();
    expect(result.current[1].status).toBe('idle');
  });

  it('should share data with concurrent queries using same key', async () => {
    const { result } = renderHook(
      () =>
        useQueries({
          queries: [
            {
              queryKey: ['user', '1'],
              queryFn: () => client.invoke('user', 'getUser', ['1']),
            },
            {
              queryKey: ['user', '1'], // Same key as first!
              queryFn: () => client.invoke('user', 'getUser', ['1']),
            },
          ],
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current[0].isSuccess).toBe(true);
      expect(result.current[1].isSuccess).toBe(true);
    });

    // Both have same data from cache
    expect(result.current[0].data).toEqual(result.current[1].data);
    expect((result.current[0].data as { name: string }).name).toBe('Alice');
  });

  it('should refetch all queries', async () => {
    const { result } = renderHook(
      () =>
        useQueries({
          queries: [
            {
              queryKey: ['user', '1'],
              queryFn: () => client.invoke('user', 'getUser', ['1']),
            },
            {
              queryKey: ['user', '2'],
              queryFn: () => client.invoke('user', 'getUser', ['2']),
            },
          ],
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current[0].isSuccess).toBe(true);
      expect(result.current[1].isSuccess).toBe(true);
    });

    expect(requestCount).toBe(2);

    // Refetch all
    await Promise.all([result.current[0].refetch(), result.current[1].refetch()]);

    await waitFor(() => {
      expect(requestCount).toBe(4);
    });
  });

  it('should work with variable number of queries', async () => {
    // Test that queries can be dynamically created based on state
    const { result } = renderHook(
      () =>
        useQueries({
          queries: ['1', '2', '3'].map((id) => ({
            queryKey: ['user', id],
            queryFn: () => client.invoke('user', 'getUser', [id]),
          })),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.every((r) => r.isSuccess)).toBe(true);
    });

    // All 3 queries should succeed
    expect(result.current.length).toBe(3);
    expect((result.current[0].data as { name: string }).name).toBe('Alice');
    expect((result.current[1].data as { name: string }).name).toBe('Bob');
    expect((result.current[2].data as { name: string }).name).toBe('Charlie');
  });
});
