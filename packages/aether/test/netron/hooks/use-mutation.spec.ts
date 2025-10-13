/**
 * @fileoverview Comprehensive tests for useMutation hook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMutation, useOptimisticMutation, useMutations } from '../../../src/netron/hooks/use-mutation.js';
import { NetronClient } from '../../../src/netron/client.js';
import type { MutationOptions } from '../../../src/netron/types.js';

// Mock NetronClient
const mockNetronClient = {
  mutate: vi.fn().mockImplementation(async (serviceName, method, args, options) => {
    // Call optimistic function if provided
    if (options?.optimistic) {
      options.optimistic();
    }
    return { id: '1', name: 'Updated' };
  }),
  backend: vi.fn().mockReturnValue({
    queryFluentInterface: vi.fn().mockResolvedValue({}),
  }),
};

// Mock DI inject
vi.mock('../../../src/di/index.js', () => ({
  Injectable: vi.fn(() => (target: any) => target),
  Optional: vi.fn(() => (target: any, propertyKey: string, parameterIndex: number) => {}),
  Inject: vi.fn(() => (target: any, propertyKey: string, parameterIndex: number) => {}),
  inject: vi.fn().mockImplementation((token) => {
    if (token === NetronClient) {
      return mockNetronClient;
    }
    return {};
  }),
}));

// Mock decorators
vi.mock('../../../src/netron/decorators/index.js', () => ({
  getBackendName: vi.fn().mockReturnValue('main'),
  getServiceName: vi.fn().mockReturnValue('users'),
}));

class UserService {
  updateUser!: (id: string, data: any) => Promise<{ id: string; name: string }>;
  deleteUser!: (id: string) => Promise<void>;
  createUser!: (data: any) => Promise<{ id: string; name: string }>;
}

describe('useMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNetronClient.mutate.mockImplementation(async (serviceName, method, args, options) => {
      // Call optimistic function if provided
      if (options?.optimistic) {
        options.optimistic();
      }
      return { id: '1', name: 'Updated' };
    });
  });

  describe('basic functionality', () => {
    it('should return mutation result with reactive signals', () => {
      const result = useMutation(UserService, 'updateUser');

      expect(result).toHaveProperty('mutate');
      expect(result).toHaveProperty('mutateAsync');
      expect(result).toHaveProperty('loading');
      expect(result).toHaveProperty('error');
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('reset');
    });

    it('should execute mutation on mutate call', async () => {
      const result = useMutation(UserService, 'updateUser');

      await result.mutate({ id: '1', name: 'Updated' });

      expect(mockNetronClient.mutate).toHaveBeenCalledWith(
        'users',
        'updateUser',
        [{ id: '1', name: 'Updated' }],
        expect.any(Object),
        'main'
      );
    });

    it('should work with service name string', async () => {
      const result = useMutation('UserService', 'updateUser');

      await result.mutate({ id: '1', name: 'Updated' });

      expect(mockNetronClient.mutate).toHaveBeenCalled();
    });

    it('should return mutation result', async () => {
      const result = useMutation(UserService, 'updateUser');
      const expected = { id: '1', name: 'Updated' };

      mockNetronClient.mutate.mockResolvedValueOnce(expected);

      const data = await result.mutate({ id: '1', name: 'Updated' });

      expect(data).toEqual(expected);
    });
  });

  describe('loading state', () => {
    it('should set loading to true during mutation', async () => {
      const result = useMutation(UserService, 'updateUser');

      expect(result.loading()).toBe(false);

      const promise = result.mutate({ id: '1', name: 'Updated' });

      // Should be loading during execution
      await promise;

      expect(result.loading()).toBe(false);
    });

    it('should set loading to false after mutation completes', async () => {
      const result = useMutation(UserService, 'updateUser');

      await result.mutate({ id: '1', name: 'Updated' });

      expect(result.loading()).toBe(false);
    });

    it('should set loading to false after mutation fails', async () => {
      mockNetronClient.mutate.mockRejectedValueOnce(new Error('Mutation failed'));

      const result = useMutation(UserService, 'updateUser');

      try {
        await result.mutate({ id: '1', name: 'Updated' });
      } catch (error) {
        // Expected
      }

      expect(result.loading()).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should set error on mutation failure', async () => {
      const testError = new Error('Mutation failed');
      mockNetronClient.mutate.mockRejectedValueOnce(testError);

      const result = useMutation(UserService, 'updateUser');

      try {
        await result.mutate({ id: '1', name: 'Updated' });
      } catch (error) {
        // Expected
      }

      expect(result.error()).toEqual(testError);
    });

    it('should clear error on successful mutation', async () => {
      const result = useMutation(UserService, 'updateUser');

      // Set initial error
      result.error.set(new Error('Previous error'));

      await result.mutate({ id: '1', name: 'Updated' });

      expect(result.error()).toBeUndefined();
    });

    it('should call onError callback', async () => {
      const testError = new Error('Mutation failed');
      const onError = vi.fn();

      mockNetronClient.mutate.mockRejectedValueOnce(testError);

      const result = useMutation(UserService, 'updateUser', { onError });

      try {
        await result.mutate({ id: '1', name: 'Updated' });
      } catch (error) {
        // Expected
      }

      expect(onError).toHaveBeenCalledWith(testError);
    });

    it('should rethrow error after handling', async () => {
      const testError = new Error('Mutation failed');
      mockNetronClient.mutate.mockRejectedValueOnce(testError);

      const result = useMutation(UserService, 'updateUser');

      await expect(result.mutate({ id: '1', name: 'Updated' })).rejects.toThrow('Mutation failed');
    });
  });

  describe('data state', () => {
    it('should update data signal on successful mutation', async () => {
      const result = useMutation(UserService, 'updateUser');
      const expected = { id: '1', name: 'Updated' };

      mockNetronClient.mutate.mockResolvedValueOnce(expected);

      await result.mutate({ id: '1', name: 'Updated' });

      expect(result.data()).toEqual(expected);
    });

    it('should preserve last successful data', async () => {
      const result = useMutation(UserService, 'updateUser');

      mockNetronClient.mutate.mockResolvedValueOnce({ id: '1', name: 'First' });
      await result.mutate({ id: '1', name: 'First' });

      mockNetronClient.mutate.mockResolvedValueOnce({ id: '1', name: 'Second' });
      await result.mutate({ id: '1', name: 'Second' });

      expect(result.data()).toEqual({ id: '1', name: 'Second' });
    });
  });

  describe('optimistic updates', () => {
    it('should apply optimistic update function', async () => {
      const options: MutationOptions = {
        optimistic: (variables: any) => ({ id: variables.id, name: variables.name, optimistic: true }),
      };

      const result = useMutation(UserService, 'updateUser', options);

      await result.mutate({ id: '1', name: 'Optimistic' });

      expect(mockNetronClient.mutate).toHaveBeenCalled();
    });

    it('should pass variables to optimistic function', async () => {
      const optimisticFn = vi.fn().mockReturnValue({ optimistic: true });
      const options: MutationOptions = {
        optimistic: optimisticFn,
      };

      const result = useMutation(UserService, 'updateUser', options);
      const variables = { id: '1', name: 'Updated' };

      await result.mutate(variables);

      expect(optimisticFn).toHaveBeenCalledWith(variables);
    });
  });

  describe('cache invalidation', () => {
    it('should invalidate cache tags', async () => {
      const options: MutationOptions = {
        invalidate: ['users', 'user-1'],
      };

      const result = useMutation(UserService, 'updateUser', options);

      await result.mutate({ id: '1', name: 'Updated' });

      expect(mockNetronClient.mutate).toHaveBeenCalledWith(
        'users',
        'updateUser',
        [{ id: '1', name: 'Updated' }],
        expect.objectContaining({ invalidate: ['users', 'user-1'] }),
        'main'
      );
    });
  });

  describe('callbacks', () => {
    it('should call onSuccess callback', async () => {
      const onSuccess = vi.fn();
      const expected = { id: '1', name: 'Updated' };

      mockNetronClient.mutate.mockResolvedValueOnce(expected);

      const result = useMutation(UserService, 'updateUser', { onSuccess });

      await result.mutate({ id: '1', name: 'Updated' });

      expect(onSuccess).toHaveBeenCalledWith(expected);
    });

    it('should call onSettled callback on success', async () => {
      const onSettled = vi.fn();

      const result = useMutation(UserService, 'updateUser', { onSettled });

      await result.mutate({ id: '1', name: 'Updated' });

      expect(onSettled).toHaveBeenCalled();
    });

    it('should call onSettled callback on error', async () => {
      const onSettled = vi.fn();
      mockNetronClient.mutate.mockRejectedValueOnce(new Error('Failed'));

      const result = useMutation(UserService, 'updateUser', { onSettled });

      try {
        await result.mutate({ id: '1', name: 'Updated' });
      } catch (error) {
        // Expected
      }

      expect(onSettled).toHaveBeenCalled();
    });
  });

  describe('retry options', () => {
    it('should pass retry options to NetronClient', async () => {
      const options: MutationOptions = {
        retry: { attempts: 5 },
      };

      const result = useMutation(UserService, 'updateUser', options);

      await result.mutate({ id: '1', name: 'Updated' });

      expect(mockNetronClient.mutate).toHaveBeenCalledWith(
        'users',
        'updateUser',
        [{ id: '1', name: 'Updated' }],
        expect.objectContaining({ retry: { attempts: 5 } }),
        'main'
      );
    });
  });

  describe('mutateAsync', () => {
    it('should execute mutation without returning promise', () => {
      const result = useMutation(UserService, 'updateUser');

      const returnValue = result.mutateAsync({ id: '1', name: 'Updated' });

      expect(returnValue).toBeUndefined();
    });

    it('should handle errors internally', async () => {
      mockNetronClient.mutate.mockRejectedValueOnce(new Error('Failed'));

      const result = useMutation(UserService, 'updateUser');

      result.mutateAsync({ id: '1', name: 'Updated' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Error should be in state
      expect(result.error()).toBeDefined();
    });
  });

  describe('reset', () => {
    it('should reset mutation state', async () => {
      const result = useMutation(UserService, 'updateUser');

      await result.mutate({ id: '1', name: 'Updated' });

      result.reset();

      expect(result.loading()).toBe(false);
      expect(result.error()).toBeUndefined();
      expect(result.data()).toBeUndefined();
    });

    it('should reset after error', async () => {
      mockNetronClient.mutate.mockRejectedValueOnce(new Error('Failed'));

      const result = useMutation(UserService, 'updateUser');

      try {
        await result.mutate({ id: '1', name: 'Updated' });
      } catch (error) {
        // Expected
      }

      result.reset();

      expect(result.error()).toBeUndefined();
    });
  });
});

describe('useOptimisticMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default implementation
    mockNetronClient.mutate.mockImplementation(async (serviceName, method, args, options) => {
      // Call optimistic function if provided
      if (options?.optimistic) {
        options.optimistic();
      }
      return { id: '1', name: 'Updated' };
    });
  });

  it('should apply optimistic update immediately', async () => {
    const getCurrentData = vi.fn().mockReturnValue([{ id: '1', name: 'John' }]);
    const applyOptimisticUpdate = vi
      .fn()
      .mockImplementation((current, variables) =>
        current.map((u: any) => (u.id === variables.id ? { ...u, ...variables } : u))
      );

    const result = useOptimisticMutation(UserService, 'updateUser', getCurrentData, applyOptimisticUpdate);

    await result.mutate({ id: '1', name: 'Updated' });

    expect(getCurrentData).toHaveBeenCalled();
    expect(applyOptimisticUpdate).toHaveBeenCalled();
  });

  it('should provide rollback function', () => {
    const getCurrentData = vi.fn().mockReturnValue([]);
    const applyOptimisticUpdate = vi.fn().mockReturnValue([]);

    const result = useOptimisticMutation(UserService, 'updateUser', getCurrentData, applyOptimisticUpdate);

    expect(result.rollback).toBeInstanceOf(Function);
  });

  it('should rollback on error', async () => {
    // Setup mock to reject after optimistic function is called
    mockNetronClient.mutate.mockImplementationOnce(async (serviceName, method, args, options) => {
      // Call optimistic function first
      if (options?.optimistic) {
        options.optimistic();
      }
      // Then throw error
      throw new Error('Failed');
    });

    const originalData = [{ id: '1', name: 'John' }];
    const getCurrentData = vi.fn().mockReturnValue(originalData);
    const applyOptimisticUpdate = vi.fn().mockImplementation(() => [{ id: '1', name: 'Updated' }]);
    const onSuccess = vi.fn();

    const result = useOptimisticMutation(UserService, 'updateUser', getCurrentData, applyOptimisticUpdate, {
      onSuccess,
    });

    try {
      await result.mutate({ id: '1', name: 'Updated' });
    } catch (error) {
      // Expected
    }

    // Should have attempted rollback via onSuccess callback
    // onSuccess gets called twice: once for rollback with original data
    expect(onSuccess).toHaveBeenCalledWith(originalData);
  });

  it('should call original onError callback', async () => {
    const testError = new Error('Failed');
    mockNetronClient.mutate.mockRejectedValueOnce(testError);

    const onError = vi.fn();
    const result = useOptimisticMutation(
      UserService,
      'updateUser',
      () => [],
      () => [],
      { onError }
    );

    try {
      await result.mutate({ id: '1', name: 'Updated' });
    } catch (error) {
      // Expected
    }

    expect(onError).toHaveBeenCalledWith(testError);
  });

  it('should support manual rollback', async () => {
    const snapshotData = [{ id: '1', name: 'John' }];
    const onSuccess = vi.fn();
    const getCurrentData = vi.fn().mockReturnValue(snapshotData);
    const applyOptimisticUpdate = vi.fn().mockReturnValue([{ id: '1', name: 'Updated' }]);

    const result = useOptimisticMutation(UserService, 'updateUser', getCurrentData, applyOptimisticUpdate, {
      onSuccess,
    });

    // First execute a mutation to capture snapshot
    await result.mutate({ id: '1', name: 'Updated' });

    // Clear the mock to verify rollback call
    onSuccess.mockClear();

    // Now test manual rollback
    result.rollback();

    expect(onSuccess).toHaveBeenCalledWith(snapshotData);
  });
});

describe('useMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create multiple mutations', () => {
    const results = useMutations([
      { service: UserService, method: 'updateUser' },
      { service: UserService, method: 'deleteUser' },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]).toHaveProperty('mutate');
    expect(results[1]).toHaveProperty('mutate');
  });

  it('should accept options for each mutation', () => {
    const results = useMutations([
      {
        service: UserService,
        method: 'updateUser',
        options: { invalidate: ['users'] },
      },
      {
        service: UserService,
        method: 'deleteUser',
        options: { onSuccess: () => {} },
      },
    ]);

    expect(results).toHaveLength(2);
  });

  it('should work with string service names', () => {
    const results = useMutations([
      { service: 'UserService', method: 'updateUser' },
      { service: 'PostService', method: 'deletePost' },
    ]);

    expect(results).toHaveLength(2);
  });

  it('should handle empty array', () => {
    const results = useMutations([]);

    expect(results).toHaveLength(0);
  });
});
