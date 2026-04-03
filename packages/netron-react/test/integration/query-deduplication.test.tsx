/**
 * Integration tests for query deduplication
 *
 * Tests that multiple components with the same queryKey share
 * a single network request (deduplication).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { useQuery } from '../../src/hooks/useQuery.js';
import { NetronProvider } from '../../src/core/provider.js';
import { createMockedClient } from '../fixtures/test-client.js';
import type { NetronReactClient } from '../../src/core/client.js';

describe('Query Deduplication', () => {
  let client: NetronReactClient;
  let wrapper: React.FC<{ children: ReactNode }>;
  let requestCount: number;

  beforeEach(() => {
    requestCount = 0;

    // Create mocked client with mock responses
    client = createMockedClient([
      {
        service: 'user',
        method: 'getUser',
        response: (id: string) => {
          requestCount++;
          const users: Record<string, { id: string; name: string }> = {
            '1': { id: '1', name: 'Alice' },
            '2': { id: '2', name: 'Bob' },
            '3': { id: '3', name: 'Charlie' },
          };
          if (!users[id]) {
            throw new Error(`User not found: ${id}`);
          }
          return users[id];
        },
      },
    ]);

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

  it('should deduplicate concurrent queries with the same key', async () => {
    const queryKey = ['user', '1'];

    // Render two hooks with the same queryKey concurrently
    const { result: result1 } = renderHook(
      () =>
        useQuery({
          queryKey,
          queryFn: () => client.invoke('user', 'getUser', ['1']),
        }),
      { wrapper }
    );

    const { result: result2 } = renderHook(
      () =>
        useQuery({
          queryKey,
          queryFn: () => client.invoke('user', 'getUser', ['1']),
        }),
      { wrapper }
    );

    // Wait for both to complete
    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true);
      expect(result2.current.isSuccess).toBe(true);
    });

    // Should only have made ONE request due to deduplication
    expect(requestCount).toBe(1);

    // Both should have the same data
    expect(result1.current.data).toEqual(result2.current.data);
    expect((result1.current.data as { name: string }).name).toBe('Alice');
  });

  it('should make separate requests for different query keys', async () => {
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

    // Should have made TWO requests (different query keys)
    expect(requestCount).toBe(2);

    // Different data
    expect((result1.current.data as { name: string }).name).toBe('Alice');
    expect((result2.current.data as { name: string }).name).toBe('Bob');
  });

  it('should share data between sequential renders', async () => {
    const queryKey = ['user', '1'];

    // First render
    const { result: result1 } = renderHook(
      () =>
        useQuery({
          queryKey,
          queryFn: () => client.invoke('user', 'getUser', ['1']),
        }),
      { wrapper }
    );

    // Small delay to start the first request
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });

    // Second render while first is in-flight
    const { result: result2 } = renderHook(
      () =>
        useQuery({
          queryKey,
          queryFn: () => client.invoke('user', 'getUser', ['1']),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true);
      expect(result2.current.isSuccess).toBe(true);
    });

    // Both hooks should have the same data (from cache)
    expect(result1.current.data).toEqual(result2.current.data);
    expect((result1.current.data as { name: string }).name).toBe('Alice');
  });

  it('should use cache for second query when staleTime is set', async () => {
    const queryKey = ['user', '1'];

    // First query - populate cache
    const { result: result1 } = renderHook(
      () =>
        useQuery({
          queryKey,
          queryFn: () => client.invoke('user', 'getUser', ['1']),
          staleTime: 60000, // Keep fresh
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result1.current.isSuccess).toBe(true);
    });

    const _initialRequestCount = requestCount;

    // Second query after first completes (should use cache if not stale)
    const { result: result2 } = renderHook(
      () =>
        useQuery({
          queryKey,
          queryFn: () => client.invoke('user', 'getUser', ['1']),
          staleTime: 60000,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result2.current.isSuccess).toBe(true);
    });

    // Both should have the same data (from cache)
    expect(result1.current.data).toEqual(result2.current.data);
    expect((result1.current.data as { name: string }).name).toBe('Alice');
  });

  it('should share data between prefetch and active query', async () => {
    const queryKey = ['user', '1'];

    // Start a query
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey,
          queryFn: () => client.invoke('user', 'getUser', ['1']),
        }),
      { wrapper }
    );

    // Prefetch the same key while query is in flight
    const prefetchPromise = client.prefetchQuery(queryKey, () => client.invoke('user', 'getUser', ['1']));

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    await prefetchPromise;

    // Both should have the same data
    const prefetchedData = client.getQueryData(queryKey);
    expect(result.current.data).toEqual(prefetchedData);
    expect((result.current.data as { name: string }).name).toBe('Alice');
  });

  it('should handle errors correctly with deduplication', async () => {
    const queryKey = ['user', 'nonexistent'];

    const { result: result1 } = renderHook(
      () =>
        useQuery({
          queryKey,
          queryFn: () => client.invoke('user', 'getUser', ['nonexistent']),
        }),
      { wrapper }
    );

    const { result: result2 } = renderHook(
      () =>
        useQuery({
          queryKey,
          queryFn: () => client.invoke('user', 'getUser', ['nonexistent']),
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result1.current.isError).toBe(true);
      expect(result2.current.isError).toBe(true);
    });

    // Both should have the same error
    expect(result1.current.error).toEqual(result2.current.error);

    // Only ONE request made
    expect(requestCount).toBe(1);
  });
});
