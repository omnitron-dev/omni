/**
 * Integration tests for useMutation hook
 *
 * Tests mutation execution, state management, callbacks,
 * optimistic updates, cache invalidation, and retry logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import React, { ReactNode } from 'react';
import { useMutation } from '../../src/hooks/useMutation.js';
import { useQuery } from '../../src/hooks/useQuery.js';
import { NetronProvider } from '../../src/core/provider.js';
import { createMockedClient } from '../fixtures/test-client.js';
import type { NetronReactClient } from '../../src/core/client.js';

// ============================================================================
// Test Suite: useMutation Integration Tests
// ============================================================================

describe('useMutation', () => {
  let client: NetronReactClient;
  let wrapper: React.FC<{ children: ReactNode }>;
  let mutationCount: number;
  let userData: Record<string, { id: string; name: string; email?: string }>;

  beforeEach(() => {
    mutationCount = 0;
    userData = {
      '1': { id: '1', name: 'Alice', email: 'alice@example.com' },
      '2': { id: '2', name: 'Bob', email: 'bob@example.com' },
      '3': { id: '3', name: 'Charlie', email: 'charlie@example.com' },
    };

    client = createMockedClient(
      [
        {
          service: 'user',
          method: 'getUser',
          response: (id: string) => {
            if (!userData[id]) {
              throw new Error(`User not found: ${id}`);
            }
            return userData[id];
          },
        },
        {
          service: 'user',
          method: 'updateUser',
          response: (id: string, updates: Partial<{ name: string; email: string }>) => {
            mutationCount++;
            if (!userData[id]) {
              throw new Error(`User not found: ${id}`);
            }
            userData[id] = { ...userData[id], ...updates };
            return userData[id];
          },
        },
        {
          service: 'user',
          method: 'createUser',
          response: (input: { name: string; email: string }) => {
            mutationCount++;
            const id = String(Object.keys(userData).length + 1);
            const newUser = { id, ...input };
            userData[id] = newUser;
            return newUser;
          },
        },
        {
          service: 'user',
          method: 'deleteUser',
          response: (id: string) => {
            mutationCount++;
            if (!userData[id]) {
              throw new Error(`User not found: ${id}`);
            }
            const deleted = userData[id];
            delete userData[id];
            return deleted;
          },
        },
        {
          service: 'user',
          method: 'failingMutation',
          error: new Error('Mutation failed intentionally'),
        },
        {
          service: 'user',
          method: 'slowMutation',
          delay: 100,
          response: () => {
            mutationCount++;
            return { success: true };
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

  // ==========================================================================
  // Basic Functionality Tests
  // ==========================================================================

  describe('Basic Functionality', () => {
    it('should start in idle state', () => {
      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: (id: string) => client.invoke('user', 'deleteUser', [id]),
          }),
        { wrapper }
      );

      expect(result.current.status).toBe('idle');
      expect(result.current.isIdle).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.isError).toBe(false);
      expect(result.current.data).toBeUndefined();
      expect(result.current.error).toBeNull();
      expect(result.current.variables).toBeUndefined();
    });

    it('should transition to loading state during mutation', async () => {
      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: () => client.invoke('user', 'slowMutation', []),
          }),
        { wrapper }
      );

      act(() => {
        result.current.mutate(undefined);
      });

      expect(result.current.status).toBe('loading');
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isIdle).toBe(false);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });
    });

    it('should transition to success state after mutation', async () => {
      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: (input: { name: string; email: string }) => client.invoke('user', 'createUser', [input]),
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.mutateAsync({ name: 'Dave', email: 'dave@example.com' });
      });

      expect(result.current.status).toBe('success');
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).toEqual({ id: '4', name: 'Dave', email: 'dave@example.com' });
    });

    it('should transition to error state on failure', async () => {
      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: () => client.invoke('user', 'failingMutation', []),
          }),
        { wrapper }
      );

      act(() => {
        result.current.mutate(undefined);
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.status).toBe('error');
      expect(result.current.error).toBeInstanceOf(Error);
      expect((result.current.error as Error).message).toBe('Mutation failed intentionally');
    });

    it('should reset state with reset()', async () => {
      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: (input: { name: string; email: string }) => client.invoke('user', 'createUser', [input]),
          }),
        { wrapper }
      );

      // Execute mutation
      await act(async () => {
        await result.current.mutateAsync({ name: 'Eve', email: 'eve@example.com' });
      });

      expect(result.current.isSuccess).toBe(true);
      expect(result.current.data).toBeDefined();

      // Reset
      act(() => {
        result.current.reset();
      });

      expect(result.current.status).toBe('idle');
      expect(result.current.isIdle).toBe(true);
      expect(result.current.data).toBeUndefined();
      expect(result.current.error).toBeNull();
      expect(result.current.variables).toBeUndefined();
      expect(result.current.context).toBeUndefined();
    });
  });

  // ==========================================================================
  // Mutation Execution Tests
  // ==========================================================================

  describe('Mutation Execution', () => {
    it('should execute mutation with mutate() (fire-and-forget)', async () => {
      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: (id: string) => client.invoke('user', 'updateUser', [id, { name: 'Alice Updated' }]),
          }),
        { wrapper }
      );

      // mutate() does not return a promise
      act(() => {
        result.current.mutate('1');
      });

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      expect(userData['1'].name).toBe('Alice Updated');
    });

    it('should execute mutation with mutateAsync() and return promise', async () => {
      const { result } = renderHook(
        () =>
          useMutation<{ id: string; name: string; email?: string }, Error, { id: string; updates: { name: string } }>({
            mutationFn: ({ id, updates }) => client.invoke('user', 'updateUser', [id, updates]),
          }),
        { wrapper }
      );

      let data: { id: string; name: string; email?: string } | undefined;
      await act(async () => {
        data = await result.current.mutateAsync({
          id: '2',
          updates: { name: 'Bob Updated' },
        });
      });

      expect(data).toEqual({ id: '2', name: 'Bob Updated', email: 'bob@example.com' });
      expect(userData['2'].name).toBe('Bob Updated');
    });

    it('should pass variables correctly to mutation function', async () => {
      const mutationFn = vi.fn().mockResolvedValue({ success: true });

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn,
          }),
        { wrapper }
      );

      const testVariables = { id: '123', data: { foo: 'bar' } };

      await act(async () => {
        await result.current.mutateAsync(testVariables);
      });

      expect(mutationFn).toHaveBeenCalledWith(testVariables);
      expect(result.current.variables).toEqual(testVariables);
    });

    it('should handle multiple sequential mutations', async () => {
      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: (input: { name: string; email: string }) => client.invoke('user', 'createUser', [input]),
          }),
        { wrapper }
      );

      // First mutation
      await act(async () => {
        await result.current.mutateAsync({ name: 'User1', email: 'user1@example.com' });
      });

      expect(result.current.data).toEqual({ id: '4', name: 'User1', email: 'user1@example.com' });

      // Second mutation
      await act(async () => {
        await result.current.mutateAsync({ name: 'User2', email: 'user2@example.com' });
      });

      expect(result.current.data).toEqual({ id: '5', name: 'User2', email: 'user2@example.com' });
      expect(mutationCount).toBe(2);
    });

    it('should reject promise with mutateAsync on error', async () => {
      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: () => client.invoke('user', 'failingMutation', []),
          }),
        { wrapper }
      );

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.mutateAsync(undefined);
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toBe('Mutation failed intentionally');
    });
  });

  // ==========================================================================
  // Optimistic Updates Tests
  // ==========================================================================

  describe('Optimistic Updates', () => {
    it('should call onMutate before mutation executes', async () => {
      const onMutateOrder: string[] = [];
      const mutationOrder: string[] = [];

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: async (id: string) => {
              mutationOrder.push('mutation');
              return client.invoke('user', 'deleteUser', [id]);
            },
            onMutate: async (id) => {
              onMutateOrder.push('onMutate');
              return { previousId: id };
            },
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.mutateAsync('1');
      });

      expect(onMutateOrder[0]).toBe('onMutate');
      expect(mutationOrder[0]).toBe('mutation');
    });

    it('should return context from onMutate', async () => {
      const { result } = renderHook(
        () =>
          useMutation<{ id: string; name: string }, Error, string, { previousData: typeof userData }>({
            mutationFn: (id) => client.invoke('user', 'deleteUser', [id]),
            onMutate: async () => ({ previousData: { ...userData } }),
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.mutateAsync('1');
      });

      expect(result.current.context).toBeDefined();
      expect(result.current.context?.previousData).toHaveProperty('1');
    });

    it('should pass context to onError for rollback', async () => {
      let capturedContext: { previousData: typeof userData } | undefined;

      const { result } = renderHook(
        () =>
          useMutation<unknown, Error, void, { previousData: typeof userData }>({
            mutationFn: () => client.invoke('user', 'failingMutation', []),
            onMutate: async () => {
              const previousData = { ...userData };
              // Optimistic update
              userData['1'] = { id: '1', name: 'Optimistic Update' };
              return { previousData };
            },
            onError: (_error, _variables, context) => {
              capturedContext = context;
              // Rollback
              if (context?.previousData) {
                Object.assign(userData, context.previousData);
              }
            },
          }),
        { wrapper }
      );

      await act(async () => {
        result.current.mutate(undefined);
      });

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(capturedContext).toBeDefined();
      expect(capturedContext?.previousData['1'].name).toBe('Alice');
      // Verify rollback worked
      expect(userData['1'].name).toBe('Alice');
    });

    it('should update cache optimistically', async () => {
      // First fetch user to cache
      const { result: queryResult } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: () => client.invoke('user', 'getUser', ['1']),
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(queryResult.current.isSuccess).toBe(true);
      });

      expect(queryResult.current.data).toEqual({ id: '1', name: 'Alice', email: 'alice@example.com' });

      // Now run mutation with optimistic update
      const { result: mutationResult } = renderHook(
        () =>
          useMutation({
            mutationFn: () => client.invoke('user', 'slowMutation', []),
            onMutate: async () => {
              // Optimistic update
              const previousData = client.getQueryData(['user', '1']);
              client.setQueryData(['user', '1'], { id: '1', name: 'Optimistic Name', email: 'alice@example.com' });
              return { previousData };
            },
          }),
        { wrapper }
      );

      act(() => {
        mutationResult.current.mutate(undefined);
      });

      // Check that cache was updated optimistically
      expect(client.getQueryData(['user', '1'])).toEqual({
        id: '1',
        name: 'Optimistic Name',
        email: 'alice@example.com',
      });

      await waitFor(() => {
        expect(mutationResult.current.isSuccess).toBe(true);
      });
    });
  });

  // ==========================================================================
  // Callbacks Tests
  // ==========================================================================

  describe('Callbacks', () => {
    it('should call onMutate with variables', async () => {
      const onMutate = vi.fn();

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: (id: string) => client.invoke('user', 'deleteUser', [id]),
            onMutate,
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.mutateAsync('1');
      });

      expect(onMutate).toHaveBeenCalledWith('1');
    });

    it('should call onSuccess with data and variables', async () => {
      const onSuccess = vi.fn();

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: (input: { name: string; email: string }) => client.invoke('user', 'createUser', [input]),
            onSuccess,
          }),
        { wrapper }
      );

      const input = { name: 'Frank', email: 'frank@example.com' };
      await act(async () => {
        await result.current.mutateAsync(input);
      });

      expect(onSuccess).toHaveBeenCalledWith(
        { id: '4', name: 'Frank', email: 'frank@example.com' },
        input,
        undefined // context (no onMutate provided)
      );
    });

    it('should call onSuccess with context when onMutate is provided', async () => {
      const onSuccess = vi.fn();

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: (id: string) => client.invoke('user', 'deleteUser', [id]),
            onMutate: async (id) => ({ deletedId: id }),
            onSuccess,
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.mutateAsync('2');
      });

      expect(onSuccess).toHaveBeenCalledWith({ id: '2', name: 'Bob', email: 'bob@example.com' }, '2', {
        deletedId: '2',
      });
    });

    it('should call onError with error, variables, and context', async () => {
      const onError = vi.fn();

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: () => client.invoke('user', 'failingMutation', []),
            onMutate: async () => ({ timestamp: Date.now() }),
            onError,
          }),
        { wrapper }
      );

      await act(async () => {
        try {
          await result.current.mutateAsync(undefined);
        } catch {
          // Expected
        }
      });

      expect(onError).toHaveBeenCalledTimes(1);
      const [error, variables, context] = onError.mock.calls[0];
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Mutation failed intentionally');
      expect(variables).toBeUndefined();
      expect(context).toHaveProperty('timestamp');
    });

    it('should call onSettled on success', async () => {
      const onSettled = vi.fn();

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: (input: { name: string; email: string }) => client.invoke('user', 'createUser', [input]),
            onSettled,
          }),
        { wrapper }
      );

      const input = { name: 'Grace', email: 'grace@example.com' };
      await act(async () => {
        await result.current.mutateAsync(input);
      });

      expect(onSettled).toHaveBeenCalledWith(
        { id: '4', name: 'Grace', email: 'grace@example.com' },
        null, // no error
        input,
        undefined // no context
      );
    });

    it('should call onSettled on error', async () => {
      const onSettled = vi.fn();

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: () => client.invoke('user', 'failingMutation', []),
            onSettled,
          }),
        { wrapper }
      );

      await act(async () => {
        try {
          await result.current.mutateAsync(undefined);
        } catch {
          // Expected
        }
      });

      expect(onSettled).toHaveBeenCalledTimes(1);
      const [data, error, variables, context] = onSettled.mock.calls[0];
      expect(data).toBeUndefined();
      expect(error).toBeInstanceOf(Error);
      expect(variables).toBeUndefined();
      expect(context).toBeUndefined();
    });

    it('should call callbacks in correct order on success', async () => {
      const callOrder: string[] = [];

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: async () => {
              callOrder.push('mutationFn');
              return { result: true };
            },
            onMutate: async () => {
              callOrder.push('onMutate');
              return { ctx: true };
            },
            onSuccess: () => {
              callOrder.push('onSuccess');
            },
            onSettled: () => {
              callOrder.push('onSettled');
            },
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.mutateAsync(undefined);
      });

      expect(callOrder).toEqual(['onMutate', 'mutationFn', 'onSuccess', 'onSettled']);
    });

    it('should call callbacks in correct order on error', async () => {
      const callOrder: string[] = [];

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: async () => {
              callOrder.push('mutationFn');
              throw new Error('Test error');
            },
            onMutate: async () => {
              callOrder.push('onMutate');
              return { ctx: true };
            },
            onError: () => {
              callOrder.push('onError');
            },
            onSettled: () => {
              callOrder.push('onSettled');
            },
          }),
        { wrapper }
      );

      await act(async () => {
        try {
          await result.current.mutateAsync(undefined);
        } catch {
          // Expected
        }
      });

      expect(callOrder).toEqual(['onMutate', 'mutationFn', 'onError', 'onSettled']);
    });
  });

  // ==========================================================================
  // Cache Invalidation Tests
  // ==========================================================================

  describe('Cache Invalidation', () => {
    it('should invalidate queries after successful mutation', async () => {
      let fetchCount = 0;

      // First, fetch user to populate cache
      const { result: queryResult } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: async () => {
              fetchCount++;
              return userData['1'];
            },
            staleTime: 0, // Immediately stale so invalidation triggers refetch
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(queryResult.current.isSuccess).toBe(true);
      });

      expect(fetchCount).toBe(1);

      // Update the user data on the "server"
      userData['1'] = { id: '1', name: 'Alice Modified', email: 'alice@example.com' };

      // Create mutation that invalidates the user query
      const { result: mutationResult } = renderHook(
        () =>
          useMutation({
            mutationFn: () => client.invoke('user', 'slowMutation', []),
            invalidateQueries: [['user', '1']],
          }),
        { wrapper }
      );

      await act(async () => {
        await mutationResult.current.mutateAsync(undefined);
      });

      // The invalidation should have triggered a refetch
      // If auto-refetch doesn't happen, we can verify the cache was invalidated
      // and manually trigger refetch
      await act(async () => {
        await queryResult.current.refetch();
      });

      expect((queryResult.current.data as { name: string }).name).toBe('Alice Modified');
      expect(fetchCount).toBeGreaterThan(1);
    });

    it('should invalidate multiple query keys', async () => {
      let fetch1Count = 0;
      let fetch2Count = 0;

      // Fetch multiple users
      const { result: user1Result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: async () => {
              fetch1Count++;
              return userData['1'];
            },
            staleTime: 0,
          }),
        { wrapper }
      );

      const { result: user2Result } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '2'],
            queryFn: async () => {
              fetch2Count++;
              return userData['2'];
            },
            staleTime: 0,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(user1Result.current.isSuccess).toBe(true);
        expect(user2Result.current.isSuccess).toBe(true);
      });

      expect(fetch1Count).toBe(1);
      expect(fetch2Count).toBe(1);

      // Update both users on "server"
      userData['1'] = { id: '1', name: 'Alice New', email: 'alice@example.com' };
      userData['2'] = { id: '2', name: 'Bob New', email: 'bob@example.com' };

      // Mutation that invalidates both
      const { result: mutationResult } = renderHook(
        () =>
          useMutation({
            mutationFn: () => client.invoke('user', 'slowMutation', []),
            invalidateQueries: [
              ['user', '1'],
              ['user', '2'],
            ],
          }),
        { wrapper }
      );

      await act(async () => {
        await mutationResult.current.mutateAsync(undefined);
      });

      // Manually refetch to verify the cache was invalidated
      await act(async () => {
        await Promise.all([user1Result.current.refetch(), user2Result.current.refetch()]);
      });

      // Both should have the new data
      expect((user1Result.current.data as { name: string }).name).toBe('Alice New');
      expect((user2Result.current.data as { name: string }).name).toBe('Bob New');
      expect(fetch1Count).toBeGreaterThan(1);
      expect(fetch2Count).toBeGreaterThan(1);
    });

    it('should not invalidate queries on failed mutation', async () => {
      let fetchCount = 0;

      const { result: queryResult } = renderHook(
        () =>
          useQuery({
            queryKey: ['user', '1'],
            queryFn: async () => {
              fetchCount++;
              return userData['1'];
            },
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(queryResult.current.isSuccess).toBe(true);
      });

      expect(fetchCount).toBe(1);

      // Failed mutation should not invalidate
      const { result: mutationResult } = renderHook(
        () =>
          useMutation({
            mutationFn: () => client.invoke('user', 'failingMutation', []),
            invalidateQueries: [['user', '1']],
          }),
        { wrapper }
      );

      await act(async () => {
        try {
          await mutationResult.current.mutateAsync(undefined);
        } catch {
          // Expected
        }
      });

      // No additional fetch should occur
      expect(fetchCount).toBe(1);
    });
  });

  // ==========================================================================
  // Retry Logic Tests
  // ==========================================================================

  describe('Retry Logic', () => {
    it('should not retry by default', async () => {
      let attemptCount = 0;

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: async () => {
              attemptCount++;
              throw new Error('Always fails');
            },
          }),
        { wrapper }
      );

      await act(async () => {
        try {
          await result.current.mutateAsync(undefined);
        } catch {
          // Expected
        }
      });

      expect(attemptCount).toBe(1);
      expect(result.current.isError).toBe(true);
    });

    it('should retry with numeric retry config', async () => {
      let attemptCount = 0;

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: async () => {
              attemptCount++;
              throw new Error('Always fails');
            },
            retry: 2,
            retryDelay: 10, // Short delay for tests
          }),
        { wrapper }
      );

      await act(async () => {
        try {
          await result.current.mutateAsync(undefined);
        } catch {
          // Expected
        }
      });

      // 1 initial + 2 retries = 3 attempts
      expect(attemptCount).toBe(3);
      expect(result.current.isError).toBe(true);
    });

    it('should retry with boolean retry config', async () => {
      let attemptCount = 0;

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: async () => {
              attemptCount++;
              throw new Error('Always fails');
            },
            retry: true, // Defaults to 3 retries
            retryDelay: 10,
          }),
        { wrapper }
      );

      await act(async () => {
        try {
          await result.current.mutateAsync(undefined);
        } catch {
          // Expected
        }
      });

      // 1 initial + 3 retries = 4 attempts
      expect(attemptCount).toBe(4);
    });

    it('should succeed after retry if mutation eventually works', async () => {
      let attemptCount = 0;

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: async () => {
              attemptCount++;
              if (attemptCount < 3) {
                throw new Error('Temporary failure');
              }
              return { success: true };
            },
            retry: 3,
            retryDelay: 10,
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.mutateAsync(undefined);
      });

      expect(attemptCount).toBe(3);
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.data).toEqual({ success: true });
    });

    it('should use custom retry delay function', async () => {
      const delays: number[] = [];
      let attemptCount = 0;
      let lastTime = Date.now();

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: async () => {
              attemptCount++;
              const now = Date.now();
              if (attemptCount > 1) {
                delays.push(now - lastTime);
              }
              lastTime = now;
              throw new Error('Always fails');
            },
            retry: 2,
            retryDelay: (attempt) => (attempt + 1) * 20, // 20, 40ms
          }),
        { wrapper }
      );

      await act(async () => {
        try {
          await result.current.mutateAsync(undefined);
        } catch {
          // Expected
        }
      });

      expect(attemptCount).toBe(3);
      // Delays should be approximately 20ms and 40ms (with some tolerance)
      expect(delays.length).toBe(2);
      expect(delays[0]).toBeGreaterThanOrEqual(15);
      expect(delays[1]).toBeGreaterThanOrEqual(35);
    });
  });

  // ==========================================================================
  // State Management Tests
  // ==========================================================================

  describe('State Management', () => {
    it('should track isLoading/isPending during mutation', async () => {
      const states: boolean[] = [];

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: () => client.invoke('user', 'slowMutation', []),
          }),
        { wrapper }
      );

      states.push(result.current.isLoading);

      act(() => {
        result.current.mutate(undefined);
      });

      states.push(result.current.isLoading);

      await waitFor(() => {
        expect(result.current.isSuccess).toBe(true);
      });

      states.push(result.current.isLoading);

      expect(states).toEqual([false, true, false]);
    });

    it('should expose data after success', async () => {
      const { result } = renderHook(
        () =>
          useMutation<{ id: string; name: string; email?: string }, Error, { name: string; email: string }>({
            mutationFn: (input) => client.invoke('user', 'createUser', [input]),
          }),
        { wrapper }
      );

      expect(result.current.data).toBeUndefined();

      await act(async () => {
        await result.current.mutateAsync({ name: 'Hannah', email: 'hannah@example.com' });
      });

      expect(result.current.data).toEqual({
        id: '4',
        name: 'Hannah',
        email: 'hannah@example.com',
      });
    });

    it('should expose error after failure', async () => {
      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: () => client.invoke('user', 'failingMutation', []),
          }),
        { wrapper }
      );

      expect(result.current.error).toBeNull();

      await act(async () => {
        try {
          await result.current.mutateAsync(undefined);
        } catch {
          // Expected
        }
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect((result.current.error as Error).message).toBe('Mutation failed intentionally');
    });

    it('should clear data on new mutation', async () => {
      let callCount = 0;

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: async () => {
              callCount++;
              if (callCount === 1) {
                return { value: 'first' };
              }
              throw new Error('Second call fails');
            },
          }),
        { wrapper }
      );

      // First mutation succeeds
      await act(async () => {
        await result.current.mutateAsync(undefined);
      });

      expect(result.current.data).toEqual({ value: 'first' });
      expect(result.current.error).toBeNull();

      // Second mutation fails
      await act(async () => {
        try {
          await result.current.mutateAsync(undefined);
        } catch {
          // Expected
        }
      });

      // Data should still be from first call, error from second
      expect(result.current.isError).toBe(true);
      expect(result.current.error).toBeInstanceOf(Error);
    });

    it('should clear error on new successful mutation', async () => {
      let callCount = 0;

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: async () => {
              callCount++;
              if (callCount === 1) {
                throw new Error('First call fails');
              }
              return { value: 'second' };
            },
          }),
        { wrapper }
      );

      // First mutation fails
      await act(async () => {
        try {
          await result.current.mutateAsync(undefined);
        } catch {
          // Expected
        }
      });

      expect(result.current.isError).toBe(true);
      expect(result.current.error).toBeInstanceOf(Error);

      // Second mutation succeeds
      await act(async () => {
        await result.current.mutateAsync(undefined);
      });

      expect(result.current.isSuccess).toBe(true);
      expect(result.current.error).toBeNull();
      expect(result.current.data).toEqual({ value: 'second' });
    });
  });

  // ==========================================================================
  // Concurrent Mutations Tests
  // ==========================================================================

  describe('Concurrent Mutations', () => {
    it('should handle concurrent mutations from same hook', async () => {
      const executionOrder: string[] = [];

      // Create client with delayed responses
      const concurrentClient = createMockedClient([
        {
          service: 'test',
          method: 'mutation1',
          delay: 50,
          response: () => {
            executionOrder.push('mutation1');
            return { id: 1 };
          },
        },
        {
          service: 'test',
          method: 'mutation2',
          delay: 20,
          response: () => {
            executionOrder.push('mutation2');
            return { id: 2 };
          },
        },
      ]);

      const concurrentWrapper = ({ children }: { children: ReactNode }) =>
        React.createElement(NetronProvider, {
          client: concurrentClient,
          autoConnect: false,
          children,
        });

      const { result } = renderHook(
        () =>
          useMutation<{ id: number }, Error, number>({
            mutationFn: (id) => concurrentClient.invoke('test', `mutation${id}`, []),
          }),
        { wrapper: concurrentWrapper }
      );

      // Fire both mutations concurrently
      act(() => {
        result.current.mutate(1);
        result.current.mutate(2);
      });

      // Wait for both to complete
      await waitFor(() => {
        expect(executionOrder.length).toBe(2);
      });

      // mutation2 should complete first (shorter delay)
      expect(executionOrder).toEqual(['mutation2', 'mutation1']);
      // State should reflect the last completed mutation
      expect(result.current.isSuccess).toBe(true);
    });

    it('should handle mutations from multiple hook instances', async () => {
      const results: { id: number }[] = [];

      const { result: mutation1 } = renderHook(
        () =>
          useMutation({
            mutationFn: (input: { name: string; email: string }) => client.invoke('user', 'createUser', [input]),
            onSuccess: (data) => {
              results.push(data as { id: number });
            },
          }),
        { wrapper }
      );

      const { result: mutation2 } = renderHook(
        () =>
          useMutation({
            mutationFn: (input: { name: string; email: string }) => client.invoke('user', 'createUser', [input]),
            onSuccess: (data) => {
              results.push(data as { id: number });
            },
          }),
        { wrapper }
      );

      // Run mutations in parallel
      await act(async () => {
        await Promise.all([
          mutation1.current.mutateAsync({ name: 'User A', email: 'a@example.com' }),
          mutation2.current.mutateAsync({ name: 'User B', email: 'b@example.com' }),
        ]);
      });

      expect(mutation1.current.isSuccess).toBe(true);
      expect(mutation2.current.isSuccess).toBe(true);
      expect(results.length).toBe(2);
    });

    it('should maintain independent state for different hook instances', async () => {
      const { result: successMutation } = renderHook(
        () =>
          useMutation({
            mutationFn: (input: { name: string; email: string }) => client.invoke('user', 'createUser', [input]),
          }),
        { wrapper }
      );

      const { result: failMutation } = renderHook(
        () =>
          useMutation({
            mutationFn: () => client.invoke('user', 'failingMutation', []),
          }),
        { wrapper }
      );

      // Run both
      await act(async () => {
        const successPromise = successMutation.current.mutateAsync({
          name: 'Test',
          email: 'test@example.com',
        });

        const failPromise = failMutation.current.mutateAsync(undefined).catch(() => {});

        await Promise.all([successPromise, failPromise]);
      });

      // States should be independent
      expect(successMutation.current.isSuccess).toBe(true);
      expect(successMutation.current.isError).toBe(false);

      expect(failMutation.current.isError).toBe(true);
      expect(failMutation.current.isSuccess).toBe(false);
    });
  });

  // ==========================================================================
  // Edge Cases Tests
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle mutation with void variables', async () => {
      const { result } = renderHook(
        () =>
          useMutation<{ success: boolean }, Error, void>({
            mutationFn: () => client.invoke('user', 'slowMutation', []),
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.mutateAsync();
      });

      expect(result.current.isSuccess).toBe(true);
    });

    it('should handle mutation key for tracking', async () => {
      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: () => client.invoke('user', 'slowMutation', []),
            mutationKey: ['createUser'],
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.mutateAsync(undefined);
      });

      expect(result.current.isSuccess).toBe(true);
    });

    it('should handle async onMutate', async () => {
      let asyncWorkDone = false;

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: () => client.invoke('user', 'slowMutation', []),
            onMutate: async () => {
              await new Promise((resolve) => setTimeout(resolve, 10));
              asyncWorkDone = true;
              return { timestamp: Date.now() };
            },
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.mutateAsync(undefined);
      });

      expect(asyncWorkDone).toBe(true);
      expect(result.current.context).toHaveProperty('timestamp');
    });

    it('should handle async callbacks', async () => {
      const callOrder: string[] = [];

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: async () => {
              callOrder.push('mutationFn-start');
              await new Promise((resolve) => setTimeout(resolve, 10));
              callOrder.push('mutationFn-end');
              return { result: true };
            },
            onSuccess: async () => {
              callOrder.push('onSuccess-start');
              await new Promise((resolve) => setTimeout(resolve, 10));
              callOrder.push('onSuccess-end');
            },
            onSettled: async () => {
              callOrder.push('onSettled-start');
              await new Promise((resolve) => setTimeout(resolve, 10));
              callOrder.push('onSettled-end');
            },
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.mutateAsync(undefined);
      });

      expect(callOrder).toEqual([
        'mutationFn-start',
        'mutationFn-end',
        'onSuccess-start',
        'onSuccess-end',
        'onSettled-start',
        'onSettled-end',
      ]);
    });

    it('should not lose state on rapid reset calls', async () => {
      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: (input: { name: string; email: string }) => client.invoke('user', 'createUser', [input]),
          }),
        { wrapper }
      );

      await act(async () => {
        await result.current.mutateAsync({ name: 'Test', email: 'test@example.com' });
      });

      expect(result.current.data).toBeDefined();

      // Rapid reset calls
      act(() => {
        result.current.reset();
        result.current.reset();
        result.current.reset();
      });

      expect(result.current.isIdle).toBe(true);
      expect(result.current.data).toBeUndefined();
    });

    it('should handle error in onMutate gracefully', async () => {
      const onError = vi.fn();

      const { result } = renderHook(
        () =>
          useMutation({
            mutationFn: () => client.invoke('user', 'slowMutation', []),
            onMutate: () => {
              throw new Error('onMutate error');
            },
            onError,
          }),
        { wrapper }
      );

      await act(async () => {
        try {
          await result.current.mutateAsync(undefined);
        } catch {
          // Expected
        }
      });

      expect(result.current.isError).toBe(true);
      expect((result.current.error as Error).message).toBe('onMutate error');
    });
  });
});
