/**
 * Integration tests for error handling and retry logic
 *
 * Comprehensive tests covering error states, retry behavior,
 * retry conditions, error recovery, error propagation, timeouts,
 * network errors, error types, and multi-query error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { useQuery } from '../../src/hooks/useQuery.js';
import { useQueries } from '../../src/hooks/useQueries.js';
import { useMutation } from '../../src/hooks/useMutation.js';
import { NetronProvider } from '../../src/core/provider.js';
import { createMockedClient } from '../fixtures/test-client.js';
import type { NetronReactClient } from '../../src/core/client.js';

// ============================================================================
// Custom Error Classes for Testing
// ============================================================================

class NetworkError extends Error {
  constructor(message: string = 'Network error') {
    super(message);
    this.name = 'NetworkError';
  }
}

class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

class TimeoutError extends Error {
  constructor(message: string = 'Request timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

class ValidationError extends Error {
  constructor(
    message: string,
    public fields: Record<string, string>
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ============================================================================
// Test Suite: Error States
// ============================================================================

describe('Error States', () => {
  let client: NetronReactClient;
  let wrapper: React.FC<{ children: ReactNode }>;

  beforeEach(() => {
    client = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: new Error('User not found'),
        },
        {
          service: 'user',
          method: 'getUserSuccess',
          response: { id: '1', name: 'Alice' },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          cacheTime: 0,
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

  it('should set isError=true on failure', async () => {
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => client.invoke('user', 'getUser', ['1']),
          retry: 0,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });

  it('should populate error object on failure', async () => {
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => client.invoke('user', 'getUser', ['1']),
          retry: 0,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
      expect((result.current.error as Error).message).toBe('User not found');
    });
  });

  it('should set status=error on failure', async () => {
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => client.invoke('user', 'getUser', ['1']),
          retry: 0,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
  });

  it('should preserve data from previous success after failure', async () => {
    let callCount = 0;
    const mockClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          response: () => {
            callCount++;
            if (callCount === 1) {
              return { id: '1', name: 'Alice' };
            }
            throw new Error('Server error');
          },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const mockWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: mockClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => mockClient.invoke('user', 'getUser', ['1']),
          retry: 0,
        }),
      { wrapper: mockWrapper }
    );

    // First call succeeds
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.data).toEqual({ id: '1', name: 'Alice' });
    });

    // Trigger refetch (which will fail)
    await act(async () => {
      try {
        await result.current.refetch();
      } catch {
        // Expected error
      }
    });

    // Data should be preserved from previous success
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
      expect(result.current.data).toEqual({ id: '1', name: 'Alice' });
    });
  });

  it('should set errorUpdatedAt timestamp on failure', async () => {
    const beforeTime = Date.now();

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => client.invoke('user', 'getUser', ['1']),
          retry: 0,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const afterTime = Date.now();

    expect(result.current.errorUpdatedAt).toBeGreaterThanOrEqual(beforeTime);
    expect(result.current.errorUpdatedAt).toBeLessThanOrEqual(afterTime);
  });
});

// ============================================================================
// Test Suite: Retry Behavior
// ============================================================================

describe('Retry Behavior', () => {
  let client: NetronReactClient;
  let wrapper: React.FC<{ children: ReactNode }>;
  let attemptCount: number;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    attemptCount = 0;

    client = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: () => {
            attemptCount++;
            return new Error(`Attempt ${attemptCount} failed`);
          },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          cacheTime: 0,
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

  it('should retry 3 times by default (4 total attempts)', async () => {
    attemptCount = 0;

    const defaultRetryClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: () => {
            attemptCount++;
            return new Error(`Attempt ${attemptCount} failed`);
          },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          cacheTime: 0,
          retry: 3,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const defaultWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: defaultRetryClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => defaultRetryClient.invoke('user', 'getUser', ['1']),
        }),
      { wrapper: defaultWrapper }
    );

    // Advance timers to allow all retries (with exponential backoff)
    // Initial attempt + 3 retries with delays: 1000ms, 2000ms, 4000ms
    await vi.advanceTimersByTimeAsync(10000);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(attemptCount).toBe(4); // 1 initial + 3 retries
  });

  it('should not retry when retry=0', async () => {
    attemptCount = 0;

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => client.invoke('user', 'getUser', ['1']),
          retry: 0,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(attemptCount).toBe(1); // Only initial attempt, no retries
  });

  it('should retry custom number of times when retry=5', async () => {
    attemptCount = 0;

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => client.invoke('user', 'getUser', ['1']),
          retry: 5,
        }),
      { wrapper }
    );

    // Advance timers to allow all retries
    await vi.advanceTimersByTimeAsync(120000);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(attemptCount).toBe(6); // 1 initial + 5 retries
  });

  it('should apply exponential backoff to retry delays', async () => {
    attemptCount = 0;
    const attemptTimes: number[] = [];

    const timingClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: () => {
            attemptCount++;
            attemptTimes.push(Date.now());
            return new Error(`Attempt ${attemptCount} failed`);
          },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const timingWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: timingClient,
        autoConnect: false,
        children,
      });

    renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => timingClient.invoke('user', 'getUser', ['1']),
          retry: 3,
          retryDelay: (attempt) => 1000 * Math.pow(2, attempt),
        }),
      { wrapper: timingWrapper }
    );

    // Initial attempt happens immediately
    await vi.advanceTimersByTimeAsync(0);
    expect(attemptCount).toBeGreaterThanOrEqual(1);

    // First retry after 1000ms (2^0 * 1000)
    await vi.advanceTimersByTimeAsync(1000);
    expect(attemptCount).toBeGreaterThanOrEqual(2);

    // Second retry after 2000ms (2^1 * 1000)
    await vi.advanceTimersByTimeAsync(2000);
    expect(attemptCount).toBeGreaterThanOrEqual(3);

    // Third retry after 4000ms (2^2 * 1000)
    await vi.advanceTimersByTimeAsync(4000);
    expect(attemptCount).toBe(4);
  });

  it('should use retryDelay as fixed number', async () => {
    attemptCount = 0;

    const fixedDelayClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: () => {
            attemptCount++;
            return new Error(`Attempt ${attemptCount} failed`);
          },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const fixedWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: fixedDelayClient,
        autoConnect: false,
        children,
      });

    renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => fixedDelayClient.invoke('user', 'getUser', ['1']),
          retry: 2,
          retryDelay: 500, // Fixed 500ms delay
        }),
      { wrapper: fixedWrapper }
    );

    // Initial attempt
    await vi.advanceTimersByTimeAsync(0);
    expect(attemptCount).toBeGreaterThanOrEqual(1);

    // First retry after 500ms
    await vi.advanceTimersByTimeAsync(500);
    expect(attemptCount).toBeGreaterThanOrEqual(2);

    // Second retry after another 500ms
    await vi.advanceTimersByTimeAsync(500);
    expect(attemptCount).toBe(3);
  });

  it('should use retryDelay as function', async () => {
    attemptCount = 0;
    const delays: number[] = [];

    const funcDelayClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: () => {
            attemptCount++;
            return new Error(`Attempt ${attemptCount} failed`);
          },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const funcWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: funcDelayClient,
        autoConnect: false,
        children,
      });

    renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => funcDelayClient.invoke('user', 'getUser', ['1']),
          retry: 2,
          retryDelay: (attempt, error) => {
            // Custom delay: 100ms * (attempt + 1)
            const delay = 100 * (attempt + 1);
            delays.push(delay);
            return delay;
          },
        }),
      { wrapper: funcWrapper }
    );

    // Initial attempt
    await vi.advanceTimersByTimeAsync(0);

    // First retry after 100ms (attempt=0)
    await vi.advanceTimersByTimeAsync(100);

    // Second retry after 200ms (attempt=1)
    await vi.advanceTimersByTimeAsync(200);

    expect(delays).toEqual([100, 200]);
  });
});

// ============================================================================
// Test Suite: Retry Conditions
// ============================================================================

describe('Retry Conditions', () => {
  let client: NetronReactClient;
  let _wrapper: React.FC<{ children: ReactNode }>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    client = createMockedClient([], {
      defaults: {
        staleTime: 0,
        cacheTime: 0,
        retry: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    });

    _wrapper = ({ children }) =>
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

  it('should filter errors with retryCondition', async () => {
    let attemptCount = 0;

    const conditionClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: () => {
            attemptCount++;
            return new HttpError(400, 'Bad Request');
          },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const conditionWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: conditionClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => conditionClient.invoke('user', 'getUser', ['1']),
          retry: {
            attempts: 3,
            retryCondition: (error) => {
              // Only retry if it's not a 4xx error
              if (error instanceof HttpError) {
                return error.statusCode >= 500;
              }
              return true;
            },
          },
        }),
      { wrapper: conditionWrapper }
    );

    await vi.advanceTimersByTimeAsync(10000);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Should not retry because 400 is a 4xx error
    expect(attemptCount).toBe(1);
  });

  it('should retry network errors', async () => {
    let attemptCount = 0;

    const networkClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: () => {
            attemptCount++;
            return new NetworkError('Connection failed');
          },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const networkWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: networkClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => networkClient.invoke('user', 'getUser', ['1']),
          retry: {
            attempts: 2,
            retryCondition: (error) => error instanceof NetworkError,
          },
          retryDelay: 100,
        }),
      { wrapper: networkWrapper }
    );

    await vi.advanceTimersByTimeAsync(1000);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Should retry because it's a NetworkError
    expect(attemptCount).toBe(3); // 1 initial + 2 retries
  });

  it('should not retry 4xx HTTP errors', async () => {
    let attemptCount = 0;

    const httpClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: () => {
            attemptCount++;
            return new HttpError(404, 'Not Found');
          },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const httpWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: httpClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => httpClient.invoke('user', 'getUser', ['1']),
          retry: {
            attempts: 3,
            retryCondition: (error) => {
              // Don't retry 4xx client errors
              if (error instanceof HttpError && error.statusCode >= 400 && error.statusCode < 500) {
                return false;
              }
              return true;
            },
          },
        }),
      { wrapper: httpWrapper }
    );

    await vi.advanceTimersByTimeAsync(5000);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Should not retry 404 error
    expect(attemptCount).toBe(1);
  });

  it('should support custom retry logic based on attempt number', async () => {
    let attemptCount = 0;

    const customClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: () => {
            attemptCount++;
            return new Error('Server error');
          },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const customWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: customClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => customClient.invoke('user', 'getUser', ['1']),
          retry: {
            attempts: 5,
            retryCondition: (_error, attempt) =>
              // Only retry first 2 attempts
              attempt < 2,
          },
          retryDelay: 50,
        }),
      { wrapper: customWrapper }
    );

    await vi.advanceTimersByTimeAsync(1000);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Should only do 3 attempts (initial + 2 retries based on condition)
    expect(attemptCount).toBe(3);
  });
});

// ============================================================================
// Test Suite: Error Recovery
// ============================================================================

describe('Error Recovery', () => {
  let client: NetronReactClient;
  let _wrapper: React.FC<{ children: ReactNode }>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    client = createMockedClient([], {
      defaults: {
        staleTime: 0,
        cacheTime: 0,
        retry: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    });

    _wrapper = ({ children }) =>
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

  it('should clear error after successful retry', async () => {
    let attemptCount = 0;

    const recoveryClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          response: () => {
            attemptCount++;
            if (attemptCount < 3) {
              throw new Error('Temporary failure');
            }
            return { id: '1', name: 'Alice' };
          },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const recoveryWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: recoveryClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => recoveryClient.invoke('user', 'getUser', ['1']),
          retry: 3,
          retryDelay: 100,
        }),
      { wrapper: recoveryWrapper }
    );

    // Let all retries execute
    await vi.advanceTimersByTimeAsync(500);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual({ id: '1', name: 'Alice' });
    expect(attemptCount).toBe(3);
  });

  it('should recover on refetch after error', async () => {
    vi.useRealTimers();

    let shouldFail = true;

    const refetchClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          response: () => {
            if (shouldFail) {
              throw new Error('Server down');
            }
            return { id: '1', name: 'Alice' };
          },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const refetchWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: refetchClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => refetchClient.invoke('user', 'getUser', ['1']),
          retry: 0,
        }),
      { wrapper: refetchWrapper }
    );

    // Initial fetch fails
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // Fix the server
    shouldFail = false;

    // Refetch
    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.error).toBeNull();
      expect(result.current.data).toEqual({ id: '1', name: 'Alice' });
    });
  });

  it('should replace error state with new successful data', async () => {
    vi.useRealTimers();

    let callCount = 0;

    const replaceClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          response: () => {
            callCount++;
            if (callCount === 1) {
              throw new Error('First call fails');
            }
            return { id: '1', name: 'Bob', updated: true };
          },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const replaceWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: replaceClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => replaceClient.invoke('user', 'getUser', ['1']),
          retry: 0,
        }),
      { wrapper: replaceWrapper }
    );

    // First call fails
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
      expect(result.current.status).toBe('error');
    });

    // Refetch succeeds
    await act(async () => {
      await result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.status).toBe('success');
      expect(result.current.isError).toBe(false);
      expect(result.current.error).toBeNull();
      expect(result.current.data).toEqual({ id: '1', name: 'Bob', updated: true });
    });
  });
});

// ============================================================================
// Test Suite: Error Propagation
// ============================================================================

describe('Error Propagation', () => {
  let client: NetronReactClient;
  let wrapper: React.FC<{ children: ReactNode }>;

  beforeEach(() => {
    client = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: new Error('Fetch failed'),
        },
      ],
      {
        defaults: {
          staleTime: 0,
          cacheTime: 0,
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

  it('should call onError callback with the error', async () => {
    const onError = vi.fn();

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => client.invoke('user', 'getUser', ['1']),
          retry: 0,
          onError,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toBe('Fetch failed');
  });

  it('should call onSettled with error parameter', async () => {
    const onSettled = vi.fn();

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => client.invoke('user', 'getUser', ['1']),
          retry: 0,
          onSettled,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith(undefined, expect.any(Error));
    expect(onSettled.mock.calls[0][1].message).toBe('Fetch failed');
  });

  it('should catch errors thrown in queryFn', async () => {
    const throwingClient = createMockedClient([], {
      defaults: {
        staleTime: 0,
        retry: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    });

    const throwingWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: throwingClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: async () => {
            throw new Error('Sync error in queryFn');
          },
          retry: 0,
        }),
      { wrapper: throwingWrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
      expect((result.current.error as Error).message).toBe('Sync error in queryFn');
    });
  });

  it('should call both onError and onSettled for the same error', async () => {
    const onError = vi.fn();
    const onSettled = vi.fn();

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => client.invoke('user', 'getUser', ['1']),
          retry: 0,
          onError,
          onSettled,
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledTimes(1);

    // Both should receive the same error
    const errorFromOnError = onError.mock.calls[0][0];
    const errorFromOnSettled = onSettled.mock.calls[0][1];
    expect(errorFromOnError).toBe(errorFromOnSettled);
  });
});

// ============================================================================
// Test Suite: Timeout Handling
// ============================================================================

describe('Timeout Handling', () => {
  let client: NetronReactClient;
  let _wrapper: React.FC<{ children: ReactNode }>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    client = createMockedClient([], {
      defaults: {
        staleTime: 0,
        cacheTime: 0,
        retry: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    });

    _wrapper = ({ children }) =>
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

  it('should handle AbortSignal abort', async () => {
    let wasAborted = false;

    const abortClient = createMockedClient([], {
      defaults: {
        staleTime: 0,
        retry: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    });

    const abortWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: abortClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: async ({ signal }) => {
            signal.addEventListener('abort', () => {
              wasAborted = true;
            });

            // Simulate a long-running request
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(resolve, 5000);
              signal.addEventListener('abort', () => {
                clearTimeout(timeout);
                reject(new Error('Aborted'));
              });
            });

            return { id: '1', name: 'Alice' };
          },
          retry: 0,
        }),
      { wrapper: abortWrapper }
    );

    // Wait for fetch to start
    await vi.advanceTimersByTimeAsync(100);

    expect(result.current.isFetching).toBe(true);

    // Cancel the query
    act(() => {
      abortClient.cancelQueries({ queryKey: ['user', '1'] });
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(wasAborted).toBe(true);
  });

  it('should handle long-running queries with timeout', async () => {
    const slowClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          delay: 10000, // 10 second delay
          response: { id: '1', name: 'Alice' },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const slowWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: slowClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: async ({ signal }) => {
            const timeout = new Promise<never>((_, reject) => {
              const id = setTimeout(() => {
                reject(new TimeoutError('Query timed out after 2000ms'));
              }, 2000);
              signal.addEventListener('abort', () => clearTimeout(id));
            });

            const fetch = slowClient.invoke('user', 'getUser', ['1']);

            return Promise.race([fetch, timeout]);
          },
          retry: 0,
        }),
      { wrapper: slowWrapper }
    );

    // Advance past the timeout
    await vi.advanceTimersByTimeAsync(2500);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(TimeoutError);
    expect((result.current.error as Error).message).toContain('timed out');
  });

  it('should distinguish timeout errors from other errors', async () => {
    const errorClient = createMockedClient([], {
      defaults: {
        staleTime: 0,
        retry: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    });

    const errorWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: errorClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: async () => {
            throw new TimeoutError('Connection timed out');
          },
          retry: 0,
        }),
      { wrapper: errorWrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const error = result.current.error as Error;
    expect(error.name).toBe('TimeoutError');
    expect(error instanceof TimeoutError).toBe(true);
  });
});

// ============================================================================
// Test Suite: Network Error Simulation
// ============================================================================

describe('Network Error Simulation', () => {
  let client: NetronReactClient;
  let _wrapper: React.FC<{ children: ReactNode }>;

  beforeEach(() => {
    client = createMockedClient([], {
      defaults: {
        staleTime: 0,
        cacheTime: 0,
        retry: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    });

    _wrapper = ({ children }) =>
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

  it('should handle offline detection errors', async () => {
    const offlineClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: new NetworkError('Network request failed - offline'),
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const offlineWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: offlineClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => offlineClient.invoke('user', 'getUser', ['1']),
          retry: 0,
        }),
      { wrapper: offlineWrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(NetworkError);
    expect((result.current.error as Error).message).toContain('offline');
  });

  it('should handle connection refused errors', async () => {
    const refusedClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: new NetworkError('ECONNREFUSED - Connection refused'),
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const refusedWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: refusedClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => refusedClient.invoke('user', 'getUser', ['1']),
          retry: 0,
        }),
      { wrapper: refusedWrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect((result.current.error as Error).message).toContain('ECONNREFUSED');
  });

  it('should handle server errors (5xx)', async () => {
    const serverErrorClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: new HttpError(500, 'Internal Server Error'),
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const serverWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: serverErrorClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => serverErrorClient.invoke('user', 'getUser', ['1']),
          retry: 0,
        }),
      { wrapper: serverWrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const error = result.current.error as HttpError;
    expect(error.statusCode).toBe(500);
    expect(error.message).toBe('Internal Server Error');
  });

  it('should handle 502 Bad Gateway errors', async () => {
    const gatewayClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: new HttpError(502, 'Bad Gateway'),
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const gatewayWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: gatewayClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => gatewayClient.invoke('user', 'getUser', ['1']),
          retry: 0,
        }),
      { wrapper: gatewayWrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const error = result.current.error as HttpError;
    expect(error.statusCode).toBe(502);
  });

  it('should handle 503 Service Unavailable errors', async () => {
    const unavailableClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: new HttpError(503, 'Service Unavailable'),
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const unavailableWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: unavailableClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => unavailableClient.invoke('user', 'getUser', ['1']),
          retry: 0,
        }),
      { wrapper: unavailableWrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const error = result.current.error as HttpError;
    expect(error.statusCode).toBe(503);
  });
});

// ============================================================================
// Test Suite: Error Types
// ============================================================================

describe('Error Types', () => {
  let client: NetronReactClient;
  let _wrapper: React.FC<{ children: ReactNode }>;

  beforeEach(() => {
    client = createMockedClient([], {
      defaults: {
        staleTime: 0,
        cacheTime: 0,
        retry: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    });

    _wrapper = ({ children }) =>
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

  it('should handle standard Error objects', async () => {
    const standardClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: new Error('Standard error message'),
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const standardWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: standardClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => standardClient.invoke('user', 'getUser', ['1']),
          retry: 0,
        }),
      { wrapper: standardWrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe('Standard error message');
  });

  it('should handle custom error classes', async () => {
    const customClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: new ValidationError('Validation failed', { email: 'Invalid format' }),
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const customWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: customClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => customClient.invoke('user', 'getUser', ['1']),
          retry: 0,
        }),
      { wrapper: customWrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const error = result.current.error as ValidationError;
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.fields).toEqual({ email: 'Invalid format' });
  });

  it('should handle serializable errors with extra properties', async () => {
    const serializableError = new Error('Serializable error');
    (serializableError as Error & { code: string }).code = 'ERR_CUSTOM';
    (serializableError as Error & { details: unknown }).details = { foo: 'bar' };

    const serializableClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          error: serializableError,
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const serializableWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: serializableClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ['user', '1'],
          queryFn: () => serializableClient.invoke('user', 'getUser', ['1']),
          retry: 0,
        }),
      { wrapper: serializableWrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    const error = result.current.error as Error & { code: string; details: unknown };
    expect(error.code).toBe('ERR_CUSTOM');
    expect(error.details).toEqual({ foo: 'bar' });
  });

  it('should handle non-Error throws (strings)', async () => {
    const stringClient = createMockedClient([], {
      defaults: {
        staleTime: 0,
        retry: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    });

    const stringWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: stringClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQuery<unknown, string>({
          queryKey: ['user', '1'],
          queryFn: async () => {
            throw 'String error message'; // Non-Error throw
          },
          retry: 0,
        }),
      { wrapper: stringWrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBe('String error message');
  });

  it('should handle non-Error throws (objects)', async () => {
    const objectClient = createMockedClient([], {
      defaults: {
        staleTime: 0,
        retry: 0,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    });

    const objectWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: objectClient,
        autoConnect: false,
        children,
      });

    const errorObject = { type: 'custom', message: 'Object error', code: 42 };

    const { result } = renderHook(
      () =>
        useQuery<unknown, typeof errorObject>({
          queryKey: ['user', '1'],
          queryFn: async () => {
            throw errorObject;
          },
          retry: 0,
        }),
      { wrapper: objectWrapper }
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toEqual(errorObject);
  });
});

// ============================================================================
// Test Suite: Multiple Queries Error Handling (useQueries)
// ============================================================================

describe('Multiple Queries Error Handling', () => {
  let client: NetronReactClient;
  let wrapper: React.FC<{ children: ReactNode }>;

  beforeEach(() => {
    client = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          matchArgs: ['1'],
          response: { id: '1', name: 'Alice' },
        },
        {
          service: 'user',
          method: 'getUser',
          matchArgs: ['2'],
          error: new Error('User 2 not found'),
        },
        {
          service: 'user',
          method: 'getUser',
          matchArgs: ['3'],
          response: { id: '3', name: 'Charlie' },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          cacheTime: 0,
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

  it('should handle partial failures in useQueries', async () => {
    const { result } = renderHook(
      () =>
        useQueries({
          queries: [
            {
              queryKey: ['user', '1'],
              queryFn: () => client.invoke('user', 'getUser', ['1']),
              retry: 0,
            },
            {
              queryKey: ['user', '2'],
              queryFn: () => client.invoke('user', 'getUser', ['2']),
              retry: 0,
            },
            {
              queryKey: ['user', '3'],
              queryFn: () => client.invoke('user', 'getUser', ['3']),
              retry: 0,
            },
          ],
        }),
      { wrapper }
    );

    await waitFor(() => {
      const results = result.current as Array<{ isSuccess: boolean; isError: boolean }>;
      expect(results[0].isSuccess).toBe(true);
      expect(results[1].isError).toBe(true);
      expect(results[2].isSuccess).toBe(true);
    });
  });

  it('should maintain independent error states for each query', async () => {
    const { result } = renderHook(
      () =>
        useQueries({
          queries: [
            {
              queryKey: ['user', '1'],
              queryFn: () => client.invoke('user', 'getUser', ['1']),
              retry: 0,
            },
            {
              queryKey: ['user', '2'],
              queryFn: () => client.invoke('user', 'getUser', ['2']),
              retry: 0,
            },
          ],
        }),
      { wrapper }
    );

    await waitFor(() => {
      const results = result.current as Array<{
        isSuccess: boolean;
        isError: boolean;
        error: Error | null;
        data: unknown;
      }>;

      // First query succeeds
      expect(results[0].isSuccess).toBe(true);
      expect(results[0].isError).toBe(false);
      expect(results[0].error).toBeNull();
      expect(results[0].data).toEqual({ id: '1', name: 'Alice' });

      // Second query fails
      expect(results[1].isSuccess).toBe(false);
      expect(results[1].isError).toBe(true);
      expect(results[1].error).not.toBeNull();
      expect((results[1].error as Error).message).toBe('User 2 not found');
    });
  });

  it('should not affect other queries when one fails', async () => {
    const { result } = renderHook(
      () =>
        useQueries({
          queries: [
            {
              queryKey: ['user', '1'],
              queryFn: () => client.invoke('user', 'getUser', ['1']),
              retry: 0,
            },
            {
              queryKey: ['user', '2'],
              queryFn: () => client.invoke('user', 'getUser', ['2']),
              retry: 0,
            },
            {
              queryKey: ['user', '3'],
              queryFn: () => client.invoke('user', 'getUser', ['3']),
              retry: 0,
            },
          ],
        }),
      { wrapper }
    );

    await waitFor(() => {
      const results = result.current as Array<{
        isSuccess: boolean;
        isError: boolean;
        data: unknown;
      }>;

      // User 1 and 3 should succeed despite User 2 failing
      expect(results[0].data).toEqual({ id: '1', name: 'Alice' });
      expect(results[2].data).toEqual({ id: '3', name: 'Charlie' });

      // User 2 should have error
      expect(results[1].isError).toBe(true);
    });
  });

  it('should support individual retry settings for each query', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let query1Attempts = 0;
    let query2Attempts = 0;

    const retryClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          matchArgs: ['1'],
          error: () => {
            query1Attempts++;
            return new Error('User 1 error');
          },
        },
        {
          service: 'user',
          method: 'getUser',
          matchArgs: ['2'],
          error: () => {
            query2Attempts++;
            return new Error('User 2 error');
          },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const retryWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: retryClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useQueries({
          queries: [
            {
              queryKey: ['user', '1'],
              queryFn: () => retryClient.invoke('user', 'getUser', ['1']),
              retry: 2, // 3 total attempts
              retryDelay: 100,
            },
            {
              queryKey: ['user', '2'],
              queryFn: () => retryClient.invoke('user', 'getUser', ['2']),
              retry: 0, // No retries
            },
          ],
        }),
      { wrapper: retryWrapper }
    );

    // Let retries happen
    await vi.advanceTimersByTimeAsync(1000);

    await waitFor(() => {
      const results = result.current as Array<{ isError: boolean }>;
      expect(results[0].isError).toBe(true);
      expect(results[1].isError).toBe(true);
    });

    // Query 1 should have retried
    expect(query1Attempts).toBe(3);
    // Query 2 should not have retried
    expect(query2Attempts).toBe(1);

    vi.useRealTimers();
  });
});

// ============================================================================
// Test Suite: Mutation Errors
// ============================================================================

describe('Mutation Errors', () => {
  let client: NetronReactClient;
  let wrapper: React.FC<{ children: ReactNode }>;

  beforeEach(() => {
    client = createMockedClient(
      [
        {
          service: 'user',
          method: 'updateUser',
          error: new Error('Update failed'),
        },
        {
          service: 'user',
          method: 'deleteUser',
          error: new HttpError(403, 'Forbidden'),
        },
      ],
      {
        defaults: {
          staleTime: 0,
          cacheTime: 0,
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

  it('should set mutation error state on failure', async () => {
    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: (data: { id: string; name: string }) => client.invoke('user', 'updateUser', [data.id, data.name]),
        }),
      { wrapper }
    );

    await act(async () => {
      result.current.mutate({ id: '1', name: 'New Name' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
      expect(result.current.status).toBe('error');
      expect(result.current.error).toBeInstanceOf(Error);
      expect((result.current.error as Error).message).toBe('Update failed');
    });
  });

  it('should call onError with context', async () => {
    const onMutate = vi.fn().mockResolvedValue({ previousData: 'old value' });
    const onError = vi.fn();

    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: (data: { id: string }) => client.invoke('user', 'updateUser', [data.id]),
          onMutate,
          onError,
        }),
      { wrapper }
    );

    await act(async () => {
      result.current.mutate({ id: '1' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { id: '1' }, { previousData: 'old value' });
  });

  it('should support rollback on mutation error', async () => {
    let cachedValue = 'initial';

    const onMutate = vi.fn().mockImplementation(() => {
      const previousValue = cachedValue;
      cachedValue = 'optimistic';
      return { previousValue };
    });

    const onError = vi.fn().mockImplementation((_error, _variables, context) => {
      if (context?.previousValue) {
        cachedValue = context.previousValue;
      }
    });

    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: (data: { id: string }) => client.invoke('user', 'updateUser', [data.id]),
          onMutate,
          onError,
        }),
      { wrapper }
    );

    // Before mutation
    expect(cachedValue).toBe('initial');

    await act(async () => {
      result.current.mutate({ id: '1' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    // After rollback
    expect(cachedValue).toBe('initial');
    expect(onMutate).toHaveBeenCalled();
    expect(onError).toHaveBeenCalled();
  });

  it('should call onSettled with error for mutations', async () => {
    const onSettled = vi.fn();

    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: (data: { id: string }) => client.invoke('user', 'deleteUser', [data.id]),
          onSettled,
        }),
      { wrapper }
    );

    await act(async () => {
      result.current.mutate({ id: '1' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith(
      undefined, // data is undefined on error
      expect.any(HttpError), // error
      { id: '1' }, // variables
      undefined // context (not provided)
    );
  });

  it('should expose mutation variables in error state', async () => {
    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: (data: { id: string; name: string }) => client.invoke('user', 'updateUser', [data.id, data.name]),
        }),
      { wrapper }
    );

    await act(async () => {
      result.current.mutate({ id: '1', name: 'Test' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.variables).toEqual({ id: '1', name: 'Test' });
  });

  it('should reset mutation error state with reset()', async () => {
    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: (data: { id: string }) => client.invoke('user', 'updateUser', [data.id]),
        }),
      { wrapper }
    );

    await act(async () => {
      result.current.mutate({ id: '1' });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.isError).toBe(false);
    expect(result.current.isIdle).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe('idle');
  });

  it('should handle mutation retry on failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let attemptCount = 0;

    const retryClient = createMockedClient(
      [
        {
          service: 'user',
          method: 'updateUser',
          error: () => {
            attemptCount++;
            return new Error(`Attempt ${attemptCount} failed`);
          },
        },
      ],
      {
        defaults: {
          staleTime: 0,
          retry: 0,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
        },
      }
    );

    const retryWrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(NetronProvider, {
        client: retryClient,
        autoConnect: false,
        children,
      });

    const { result } = renderHook(
      () =>
        useMutation({
          mutationFn: (data: { id: string }) => retryClient.invoke('user', 'updateUser', [data.id]),
          retry: 2,
          retryDelay: 100,
        }),
      { wrapper: retryWrapper }
    );

    await act(async () => {
      result.current.mutate({ id: '1' });
    });

    await vi.advanceTimersByTimeAsync(500);

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(attemptCount).toBe(3); // 1 initial + 2 retries

    vi.useRealTimers();
  });
});
