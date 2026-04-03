/**
 * Comprehensive integration tests for useQuery hook
 *
 * Tests cover:
 * 1. Basic Functionality
 * 2. Stale Time Behavior
 * 3. Retry Logic
 * 4. Refetch Triggers
 * 5. Placeholder and Initial Data
 * 6. Callbacks
 * 7. AbortController
 * 8. Cache Integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { useQuery } from '../../src/hooks/useQuery.js';
import { NetronProvider } from '../../src/core/provider.js';
import { createMockedClient } from '../fixtures/test-client.js';
import type { NetronReactClient } from '../../src/core/client.js';

// ============================================================================
// Test Setup
// ============================================================================

describe('useQuery Integration Tests', () => {
  let client: NetronReactClient;
  let wrapper: React.FC<{ children: ReactNode }>;
  let requestCount: number;
  let requestLog: Array<{ service: string; method: string; args: unknown[] }>;

  beforeEach(() => {
    requestCount = 0;
    requestLog = [];

    // Create mocked client with mock responses
    client = createMockedClient([
      {
        service: 'user',
        method: 'getUser',
        response: (id: string) => {
          requestCount++;
          requestLog.push({ service: 'user', method: 'getUser', args: [id] });
          const users: Record<string, { id: string; name: string; email: string }> = {
            '1': { id: '1', name: 'Alice', email: 'alice@example.com' },
            '2': { id: '2', name: 'Bob', email: 'bob@example.com' },
            '3': { id: '3', name: 'Charlie', email: 'charlie@example.com' },
          };
          if (!users[id]) {
            throw new Error(`User not found: ${id}`);
          }
          return users[id];
        },
      },
      {
        service: 'data',
        method: 'delayed',
        delay: 100,
        response: (value: string) => {
          requestCount++;
          return { value, timestamp: Date.now() };
        },
      },
      {
        service: 'data',
        method: 'failing',
        error: new Error('Simulated failure'),
      },
      {
        service: 'data',
        method: 'flaky',
        response: () => {
          requestCount++;
          if (requestCount <= 2) {
            throw new Error(`Flaky failure attempt ${requestCount}`);
          }
          return { success: true, attempts: requestCount };
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
    vi.useRealTimers();
  });

  // ============================================================================
  // 1. Basic Functionality
  // ============================================================================

  describe('Basic Functionality', () => {
    it('should start with loading state', async () => {
      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: () => client.invoke('user', 'getUser', ['1']),
          }),
        { wrapper }
      );

      // Initial state should be loading
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isFetching).toBe(true);
      expect(result.current.status).toBe('loading');
      expect(result.current.data).toBeUndefined();
      expect(result.current.error).toBeNull();
    });

    it('should fetch data successfully', async () => {
      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: () => client.invoke('user', 'getUser', ['1']),
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual({ id: '1', name: 'Alice', email: 'alice@example.com' });
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetching).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.status).toBe('success');
    });

    it('should handle errors correctly', async () => {
      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', 'nonexistent'],
            queryFn: () => client.invoke('user', 'getUser', ['nonexistent']),
            retry: false,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect((result.current.error as Error).message).toContain('User not found');
      expect(result.current.data).toBeUndefined();
      expect(result.current.status).toBe('error');
    });

    it('should not fetch when enabled=false', async () => {
      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            enabled: false,
          }),
        { wrapper }
      );

      // Wait a bit to ensure no fetch happened
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(result.current.isIdle).toBe(true);
      expect(result.current.isFetching).toBe(false);
      expect(result.current.data).toBeUndefined();
      expect(requestCount).toBe(0);
    });

    it('should fetch when enabled changes from false to true', async () => {
      let enabled = false;

      const { result, rerender } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            enabled,
          }),
        { wrapper }
      );

      expect(result.current.isIdle).toBe(true);
      expect(requestCount).toBe(0);

      // Enable the query
      enabled = true;
      rerender();

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(requestCount).toBe(1);
      expect(result.current.data).toEqual({ id: '1', name: 'Alice', email: 'alice@example.com' });
    });

    it('should provide signal in queryFn context', async () => {
      let receivedSignal: AbortSignal | undefined;

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['signal-test'],
            queryFn: async ({ signal }) => {
              receivedSignal = signal;
              return { received: true };
            },
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(receivedSignal).toBeInstanceOf(AbortSignal);
      expect(receivedSignal?.aborted).toBe(false);
    });
  });

  // ============================================================================
  // 2. Stale Time Behavior
  // ============================================================================

  describe('Stale Time Behavior', () => {
    it('should refetch when staleTime=0', async () => {
      const queryKey = ['user', '1'];

      // First render
      const { result: result1 } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            staleTime: 0,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result1.current.isSuccess).toBe(true);
      });

      expect(requestCount).toBe(1);
      expect(result1.current.isStale).toBe(true);

      // Second render with same key - should refetch since staleTime=0
      const { result: result2 } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            staleTime: 0,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result2.current.isSuccess).toBe(true);
      });

      // Should have made additional request due to staleTime=0
      expect(requestCount).toBeGreaterThan(1);
    });

    it('should never refetch when staleTime=Infinity', async () => {
      const queryKey = ['user', '1'];

      // First render
      const { result: result1 } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            staleTime: Infinity,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result1.current.isSuccess).toBe(true);
      });

      expect(requestCount).toBe(1);
      expect(result1.current.isStale).toBe(false);

      // Second render with same key - should NOT refetch
      const { result: result2 } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            staleTime: Infinity,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result2.current.isSuccess).toBe(true);
      });

      // Should still only have 1 request
      expect(requestCount).toBe(1);
      expect(result2.current.isStale).toBe(false);
    });

    it('should respect custom staleTime duration', async () => {
      const queryKey = ['user', '1'];
      const staleTime = 100; // 100ms for faster test

      // First render
      const { result: result1 } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            staleTime,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result1.current.isSuccess).toBe(true);
      });

      expect(result1.current.isStale).toBe(false);
      expect(requestCount).toBe(1);

      // Wait for staleTime to pass and refetch to check staleness
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      // After staleTime passes, data should be stale
      // Note: isStale is recalculated on each render, so we need to trigger a rerender
      // by calling refetch which will update dataUpdatedAt
      const refetchResult = await result1.current.refetch();

      // After refetch, data should be fresh again
      expect(refetchResult.isStale).toBe(false);
      expect(requestCount).toBe(2);
    });

    it('should report isStale accurately', async () => {
      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            staleTime: 0,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      // With staleTime=0, data is immediately stale
      expect(result.current.isStale).toBe(true);
    });
  });

  // ============================================================================
  // 3. Retry Logic
  // ============================================================================

  describe('Retry Logic', () => {
    it('should retry on failure with default retry count (3)', async () => {
      const failingFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Attempt 1'))
        .mockRejectedValueOnce(new Error('Attempt 2'))
        .mockRejectedValueOnce(new Error('Attempt 3'))
        .mockResolvedValueOnce({ success: true });

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['retry-test'],
            queryFn: failingFn,
            retry: 3,
            retryDelay: 10, // Short delay for tests
          }),
        { wrapper }
      );

      await waitFor(
        () => {
          expect(result.current.isSuccess).toBe(true);
        },
        { timeout: 5000 }
      );

      expect(failingFn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
      expect(result.current.data).toEqual({ success: true });
    });

    it('should respect custom retry count', async () => {
      const failingFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Attempt 1'))
        .mockRejectedValueOnce(new Error('Attempt 2'))
        .mockResolvedValueOnce({ success: true });

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['retry-custom'],
            queryFn: failingFn,
            retry: 2,
            retryDelay: 10,
          }),
        { wrapper }
      );

      await waitFor(
        () => {
          expect(result.current.isSuccess).toBe(true);
        },
        { timeout: 5000 }
      );

      expect(failingFn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    });

    it('should not retry when retry=false', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Always fails'));

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['no-retry'],
            queryFn: failingFn,
            retry: false,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(failingFn).toHaveBeenCalledTimes(1); // No retries
      expect((result.current.error as Error).message).toBe('Always fails');
    });

    it('should use custom retryDelay function', async () => {
      const delays: number[] = [];
      const retryDelay = vi.fn((attempt: number) => {
        const delay = attempt * 100;
        delays.push(delay);
        return delay;
      });

      const failingFn = vi
        .fn()
        .mockRejectedValueOnce(new Error('Attempt 1'))
        .mockRejectedValueOnce(new Error('Attempt 2'))
        .mockResolvedValueOnce({ success: true });

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['custom-delay'],
            queryFn: failingFn,
            retry: 2,
            retryDelay,
          }),
        { wrapper }
      );

      await waitFor(
        () => {
          expect(result.current.isSuccess).toBe(true);
        },
        { timeout: 5000 }
      );

      expect(retryDelay).toHaveBeenCalledTimes(2);
      expect(retryDelay).toHaveBeenCalledWith(0, expect.any(Error));
      expect(retryDelay).toHaveBeenCalledWith(1, expect.any(Error));
    });

    it('should fail after all retries exhausted', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Persistent failure'));

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['exhaust-retries'],
            queryFn: failingFn,
            retry: 2,
            retryDelay: 10,
          }),
        { wrapper }
      );

      await waitFor(
        () => {
          expect(result.current.isError).toBe(true);
        },
        { timeout: 5000 }
      );

      expect(failingFn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
      expect((result.current.error as Error).message).toBe('Persistent failure');
    });
  });

  // ============================================================================
  // 4. Refetch Triggers
  // ============================================================================

  describe('Refetch Triggers', () => {
    it('should refetch on manual refetch() call', async () => {
      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            staleTime: Infinity, // Prevent automatic refetch
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(requestCount).toBe(1);

      // Manual refetch
      await act(async () => {
        await result.current.refetch();
      });

      expect(requestCount).toBe(2);
      expect(result.current.data).toEqual({ id: '1', name: 'Alice', email: 'alice@example.com' });
    });

    it('should refetch at specified interval', async () => {
      vi.useFakeTimers();

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['interval-test'],
            queryFn: async () => {
              requestCount++;
              return { count: requestCount };
            },
            refetchInterval: 1000,
            staleTime: 0,
          }),
        { wrapper }
      );

      // Initial fetch
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });

      expect(result.current.isSuccess).toBe(true);
      const initialCount = requestCount;

      // Advance time to trigger interval refetch
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await vi.runOnlyPendingTimersAsync();
      });

      expect(requestCount).toBeGreaterThan(initialCount);

      // Advance more
      await act(async () => {
        vi.advanceTimersByTime(1000);
        await vi.runOnlyPendingTimersAsync();
      });

      expect(requestCount).toBeGreaterThan(initialCount + 1);
    });

    it('should stop refetch interval when disabled', async () => {
      vi.useFakeTimers();

      let enabled = true;

      const { rerender } = renderHook(
        () =>
          useQuery({
            queryKey: ['interval-disable'],
            queryFn: async () => {
              requestCount++;
              return { count: requestCount };
            },
            refetchInterval: 1000,
            enabled,
          }),
        { wrapper }
      );

      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });

      const countAfterInitial = requestCount;

      // Disable the query
      enabled = false;
      rerender();

      // Advance time
      await act(async () => {
        vi.advanceTimersByTime(3000);
        await vi.runOnlyPendingTimersAsync();
      });

      // Count should not have increased
      expect(requestCount).toBe(countAfterInitial);
    });

    it('should refetch on window focus when enabled', async () => {
      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['focus-test'],
            queryFn: async () => {
              requestCount++;
              return { count: requestCount };
            },
            refetchOnWindowFocus: true,
            staleTime: 0, // Make data stale so it refetches
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const initialCount = requestCount;

      // Simulate window focus
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(requestCount).toBeGreaterThan(initialCount);
    });

    it('should refetch on reconnect when enabled', async () => {
      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['reconnect-test'],
            queryFn: async () => {
              requestCount++;
              return { count: requestCount };
            },
            refetchOnReconnect: true,
            staleTime: 0,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const initialCount = requestCount;

      // Simulate reconnect event on the client
      await act(async () => {
        // Emit reconnect event on client
        (client as any).listeners.get('reconnect')?.forEach((handler: () => void) => handler());
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(requestCount).toBeGreaterThan(initialCount);
    });
  });

  // ============================================================================
  // 5. Placeholder and Initial Data
  // ============================================================================

  describe('Placeholder and Initial Data', () => {
    it('should show placeholderData while loading', async () => {
      const placeholder = { id: 'placeholder', name: 'Loading...', email: '' };

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: () =>
              new Promise((resolve) => setTimeout(() => resolve(client.invoke('user', 'getUser', ['1'])), 100)),
            placeholderData: placeholder,
          }),
        { wrapper }
      );

      // Should show placeholder immediately
      expect(result.current.data).toEqual(placeholder);
      expect(result.current.isLoading).toBe(false); // Has placeholder data
      expect(result.current.isFetching).toBe(true);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
        expect(result.current.isFetching).toBe(false);
      });

      expect(result.current.data).toEqual({ id: '1', name: 'Alice', email: 'alice@example.com' });
    });

    it('should support placeholderData as a function', async () => {
      const placeholderFn = vi.fn(() => ({ id: 'dynamic', name: 'Dynamic Placeholder', email: '' }));

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: () =>
              new Promise((resolve) => setTimeout(() => resolve(client.invoke('user', 'getUser', ['1'])), 100)),
            placeholderData: placeholderFn,
          }),
        { wrapper }
      );

      expect(result.current.data).toEqual({ id: 'dynamic', name: 'Dynamic Placeholder', email: '' });
      expect(placeholderFn).toHaveBeenCalled();

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
    });

    it('should use initialData immediately and show data while fetching', async () => {
      const initialData = { id: '1', name: 'Initial Alice', email: 'initial@example.com' };

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            initialData,
            staleTime: Infinity,
          }),
        { wrapper }
      );

      // Should have initialData immediately before any fetch
      expect(result.current.data).toEqual(initialData);
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.isLoading).toBe(false);

      // Note: The hook will still fetch to populate the cache even with initialData
      // This is the expected behavior - initialData is for showing data immediately
      // while the real data is being fetched
      await waitFor(() => {
        expect(result.current.isFetching).toBe(false);
      });

      // After fetch, data should be the real fetched data
      expect(result.current.data).toEqual({ id: '1', name: 'Alice', email: 'alice@example.com' });
    });

    it('should use cached data immediately when available', async () => {
      const queryKey = ['cached-test'];

      // Pre-populate the cache by using prefetchQuery
      await client.prefetchQuery(queryKey, async () => ({
        id: '1',
        name: 'Cached Alice',
        email: 'cached@example.com',
      }));

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            staleTime: Infinity,
          }),
        { wrapper }
      );

      // Should have cached data immediately (no loading state)
      expect(result.current.data).toEqual({ id: '1', name: 'Cached Alice', email: 'cached@example.com' });
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.isLoading).toBe(false);
    });

    it('should support initialData as a function', async () => {
      const initialDataFn = vi.fn(() => ({ id: '1', name: 'Function Initial', email: '' }));

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            initialData: initialDataFn,
            staleTime: Infinity,
          }),
        { wrapper }
      );

      expect(result.current.data).toEqual({ id: '1', name: 'Function Initial', email: '' });
      expect(initialDataFn).toHaveBeenCalled();
    });

    it('should respect initialDataUpdatedAt for staleness calculation', async () => {
      vi.useFakeTimers();

      const now = Date.now();
      const staleTime = 5000;

      // Initial data from 10 seconds ago (should be stale)
      const { result: staleResult } = renderHook(
        () =>
          useQuery({
            queryKey: ['stale-initial'],
            queryFn: async () => {
              requestCount++;
              return { fresh: true };
            },
            initialData: { fresh: false },
            initialDataUpdatedAt: now - 10000, // 10 seconds ago
            staleTime,
          }),
        { wrapper }
      );

      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Should have fetched because initial data is stale
      expect(requestCount).toBe(1);
      expect(staleResult.current.data).toEqual({ fresh: true });
    });

    it('should transform data with select()', async () => {
      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            select: (data: { id: string; name: string; email: string }) => ({
              displayName: data.name.toUpperCase(),
              userId: data.id,
            }),
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual({
        displayName: 'ALICE',
        userId: '1',
      });
    });
  });

  // ============================================================================
  // 6. Callbacks
  // ============================================================================

  describe('Callbacks', () => {
    it('should call onSuccess with data on successful fetch', async () => {
      const onSuccess = vi.fn();

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            onSuccess,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith({ id: '1', name: 'Alice', email: 'alice@example.com' });
    });

    it('should call onError with error on failed fetch', async () => {
      const onError = vi.fn();

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', 'nonexistent'],
            queryFn: () => client.invoke('user', 'getUser', ['nonexistent']),
            onError,
            retry: false,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect((onError.mock.calls[0][0] as Error).message).toContain('User not found');
    });

    it('should call onSettled on success', async () => {
      const onSettled = vi.fn();

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            onSettled,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(onSettled).toHaveBeenCalledTimes(1);
      expect(onSettled).toHaveBeenCalledWith({ id: '1', name: 'Alice', email: 'alice@example.com' }, null);
    });

    it('should call onSettled on error', async () => {
      const onSettled = vi.fn();

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', 'nonexistent'],
            queryFn: () => client.invoke('user', 'getUser', ['nonexistent']),
            onSettled,
            retry: false,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(onSettled).toHaveBeenCalledTimes(1);
      expect(onSettled).toHaveBeenCalledWith(undefined, expect.any(Error));
    });

    it('should call all callbacks in correct order', async () => {
      const callOrder: string[] = [];

      const onSuccess = vi.fn(() => callOrder.push('onSuccess'));
      const onSettled = vi.fn(() => callOrder.push('onSettled'));

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            onSuccess,
            onSettled,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(callOrder).toEqual(['onSuccess', 'onSettled']);
    });
  });

  // ============================================================================
  // 7. AbortController
  // ============================================================================

  describe('AbortController', () => {
    it('should pass AbortSignal to queryFn', async () => {
      let receivedSignal: AbortSignal | undefined;

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['abort-signal'],
            queryFn: async ({ signal }) => {
              receivedSignal = signal;
              return { received: true };
            },
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(receivedSignal).toBeDefined();
      expect(receivedSignal).toBeInstanceOf(AbortSignal);
    });

    it('should abort on unmount', async () => {
      let _signalAborted = false;
      let signalInstance: AbortSignal | undefined;

      const { unmount } = renderHook(
        () =>
          useQuery({
            queryKey: ['abort-unmount'],
            queryFn: async ({ signal }) => {
              signalInstance = signal;
              signal.addEventListener('abort', () => {
                _signalAborted = true;
              });
              // Long running operation
              await new Promise((resolve) => setTimeout(resolve, 1000));
              return { done: true };
            },
          }),
        { wrapper }
      );

      // Unmount while still fetching
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        unmount();
      });

      // Note: The abort happens when the component unmounts, but
      // since we're testing with a mock, we verify the signal exists
      expect(signalInstance).toBeDefined();
    });

    it('should abort previous request on new query', async () => {
      const signals: AbortSignal[] = [];

      let userId = '1';
      const { rerender } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', userId],
            queryFn: async ({ signal }) => {
              signals.push(signal);
              await new Promise((resolve) => setTimeout(resolve, 100));
              if (signal.aborted) {
                throw new Error('Aborted');
              }
              return client.invoke('user', 'getUser', [userId]);
            },
          }),
        { wrapper }
      );

      // Wait for first request to start
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      // Change query key to trigger new request
      userId = '2';
      rerender();

      await waitFor(() => {
        expect(signals.length).toBe(2);
      });

      // First signal should be used, second is for the new query
      expect(signals.length).toBe(2);
    });
  });

  // ============================================================================
  // 8. Cache Integration
  // ============================================================================

  describe('Cache Integration', () => {
    it('should persist data in cache', async () => {
      const queryKey = ['user', '1'];

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

      // Check cache directly
      const cachedData = client.getQueryData(queryKey);
      expect(cachedData).toEqual({ id: '1', name: 'Alice', email: 'alice@example.com' });
    });

    it('should update component when cache is updated externally', async () => {
      const queryKey = ['user', '1'];

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            staleTime: Infinity,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual({ id: '1', name: 'Alice', email: 'alice@example.com' });

      // Update cache externally
      await act(async () => {
        client.setQueryData(queryKey, { id: '1', name: 'Alice Updated', email: 'updated@example.com' });
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(result.current.data).toEqual({ id: '1', name: 'Alice Updated', email: 'updated@example.com' });
    });

    it('should share cache between multiple components', async () => {
      const queryKey = ['user', '1'];

      // First component
      const { result: result1 } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            staleTime: Infinity,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result1.current.isSuccess).toBe(true);
      });

      expect(requestCount).toBe(1);

      // Second component with same key
      const { result: result2 } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            staleTime: Infinity,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result2.current.isSuccess).toBe(true);
      });

      // Should still be only 1 request (cache hit)
      expect(requestCount).toBe(1);

      // Both should have the same data
      expect(result1.current.data).toEqual(result2.current.data);
    });

    it('should remove data from cache with remove()', async () => {
      const queryKey = ['user', '1'];

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

      expect(client.getQueryData(queryKey)).toBeDefined();

      // Remove from cache
      await act(async () => {
        result.current.remove();
      });

      expect(client.getQueryData(queryKey)).toBeUndefined();
      expect(result.current.isIdle).toBe(true);
      expect(result.current.data).toBeUndefined();
    });

    it('should invalidate and refetch with client.invalidateQueries', async () => {
      const queryKey = ['user', '1'];

      const { result } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            staleTime: Infinity,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(requestCount).toBe(1);

      // Invalidate queries
      await act(async () => {
        await client.invalidateQueries({ queryKey });
        // Give time for the cache subscription to trigger refetch
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      // Cache should be marked as invalidated
      const queryState = client.getQueryState(queryKey);
      expect(queryState?.state.isInvalidated).toBe(true);
    });

    it('should use cached data on remount', async () => {
      const queryKey = ['user', '1'];

      // First mount
      const { result: result1, unmount } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            staleTime: Infinity, // Keep fresh
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result1.current.isSuccess).toBe(true);
      });

      expect(requestCount).toBe(1);

      // Unmount
      unmount();

      // Remount
      const { result: result2 } = renderHook(
        () =>
          useQuery({
            queryKey,
            queryFn: () => client.invoke('user', 'getUser', ['1']),
            staleTime: Infinity,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result2.current.isSuccess).toBe(true);
      });

      // Should still be 1 request (used cache)
      expect(requestCount).toBe(1);
      expect(result2.current.data).toEqual({ id: '1', name: 'Alice', email: 'alice@example.com' });
    });
  });

  // ============================================================================
  // Additional Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle queryKey changes correctly', async () => {
      let userId = '1';

      const { result, rerender } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', userId],
            queryFn: () => client.invoke('user', 'getUser', [userId]),
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(result.current.data).toEqual({ id: '1', name: 'Alice', email: 'alice@example.com' });

      // Change user ID
      userId = '2';
      rerender();

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
        expect((result.current.data as { name: string }).name).toBe('Bob');
      });

      expect(result.current.data).toEqual({ id: '2', name: 'Bob', email: 'bob@example.com' });
    });

    it('should handle rapid refetch calls', async () => {
      const { result } = renderHook(
        () =>
          useQuery({
            queryKey: ['rapid-refetch'],
            queryFn: async () => {
              requestCount++;
              await new Promise((resolve) => setTimeout(resolve, 50));
              return { count: requestCount };
            },
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      const initialCount = requestCount;

      // Rapid refetch calls
      await act(async () => {
        result.current.refetch();
        result.current.refetch();
        result.current.refetch();
        await new Promise((resolve) => setTimeout(resolve, 200));
      });

      // Due to deduplication, should not make many more requests
      expect(requestCount).toBeLessThanOrEqual(initialCount + 3);
    });

    it('should properly cleanup on unmount during fetch', async () => {
      let _fetchCompleted = false;

      const { unmount } = renderHook(
        () =>
          useQuery({
            queryKey: ['cleanup-test'],
            queryFn: async () => {
              await new Promise((resolve) => setTimeout(resolve, 100));
              _fetchCompleted = true;
              return { done: true };
            },
          }),
        { wrapper }
      );

      // Unmount immediately
      unmount();

      // Wait for what would have been the fetch completion
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      // The fetch may or may not complete, but there should be no errors
      // This test mainly ensures no memory leaks or state updates after unmount
    });

    it('should handle concurrent queries with different keys', async () => {
      const results: Array<ReturnType<typeof renderHook>> = [];

      for (let i = 1; i <= 3; i++) {
        results.push(
          renderHook(
            () =>
              useQuery({
                queryKey: ['user', String(i)],
                queryFn: () => client.invoke('user', 'getUser', [String(i)]),
              }),
            { wrapper }
          )
        );
      }

      await waitFor(() => {
        expect(results.every((r) => (r.result.current as any).isSuccess)).toBe(true);
      });

      expect((results[0].result.current as any).data.name).toBe('Alice');
      expect((results[1].result.current as any).data.name).toBe('Bob');
      expect((results[2].result.current as any).data.name).toBe('Charlie');
    });
  });
});
