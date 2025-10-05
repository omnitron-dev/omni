/**
 * Comprehensive tests for OptimisticUpdateManager
 * Tests optimistic updates, rollbacks, retries, caching, and statistics
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  OptimisticUpdateManager,
  type CacheProvider
} from '../../../../src/netron/transport/http/optimistic-update-manager.js';

describe('OptimisticUpdateManager', () => {
  let manager: OptimisticUpdateManager;
  let mockCache: CacheProvider;

  // Helper to create a mock cache
  const createMockCache = (): CacheProvider => {
    const storage = new Map<string, any>();
    return {
      get: jest.fn((key: string) => storage.get(key)) as any,
      set: jest.fn((key: string, value: any) => storage.set(key, value)) as any,
      delete: jest.fn((key: string) => storage.delete(key)) as any
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCache = createMockCache();
  });

  afterEach(async () => {
    if (manager) {
      await manager.destroy();
    }
  });

  describe('Constructor', () => {
    it('should create manager without cache', () => {
      manager = new OptimisticUpdateManager();
      expect(manager).toBeInstanceOf(OptimisticUpdateManager);

      const stats = manager.getStatistics();
      expect(stats.totalUpdates).toBe(0);
    });

    it('should create manager with cache provider', () => {
      manager = new OptimisticUpdateManager(mockCache);
      expect(manager).toBeInstanceOf(OptimisticUpdateManager);
    });

    it('should create manager with default options', () => {
      manager = new OptimisticUpdateManager(undefined, {
        timeout: 5000,
        retry: false,
        maxRetries: 5
      });
      expect(manager).toBeInstanceOf(OptimisticUpdateManager);
    });
  });

  describe('mutate() - Basic Mutations', () => {
    beforeEach(() => {
      manager = new OptimisticUpdateManager(mockCache);
    });

    it('should perform successful mutation', async () => {
      const mutator = jest.fn().mockResolvedValue({ value: 'final' });

      const result = await manager.mutate(
        'test-key',
        mutator,
        () => ({ value: 'optimistic' })
      );

      expect(result).toEqual({ value: 'final' });
      expect(mutator).toHaveBeenCalled();
    });

    it('should apply optimistic update immediately', async () => {
      const mutator = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ value: 'final' }), 50))
      );

      const promise = manager.mutate(
        'test-key',
        mutator,
        () => ({ value: 'optimistic' })
      );

      // Check optimistic value is available immediately
      const optimisticValue = manager.get('test-key');
      expect(optimisticValue).toEqual({ value: 'optimistic' });

      const result = await promise;
      expect(result).toEqual({ value: 'final' });
    });

    it('should mutate without optimistic update function', async () => {
      const mutator = jest.fn().mockResolvedValue({ value: 'result' });

      const result = await manager.mutate('test-key', mutator);

      expect(result).toEqual({ value: 'result' });
    });

    it('should update external cache on commit', async () => {
      const mutator = jest.fn().mockResolvedValue({ value: 'final' });

      await manager.mutate('test-key', mutator, () => ({ value: 'optimistic' }));

      expect(mockCache.set).toHaveBeenCalledWith('test-key', { value: 'final' });
    });

    it('should emit update-started event', async () => {
      const mutator = jest.fn().mockResolvedValue('result');

      const startedPromise = new Promise<void>((resolve) => {
        manager.on('update-started', (data: any) => {
          expect(data.key).toBe('test-key');
          expect(data.updateId).toBeDefined();
          expect(data.optimisticValue).toBeDefined();
          resolve();
        });
      });

      manager.mutate('test-key', mutator, () => 'optimistic');

      await startedPromise;
    });

    it('should emit update-committed event', async () => {
      const mutator = jest.fn().mockResolvedValue('result');

      const committedPromise = new Promise<void>((resolve) => {
        manager.on('update-committed', (data: any) => {
          expect(data.key).toBe('test-key');
          expect(data.value).toBe('result');
          expect(data.duration).toBeGreaterThanOrEqual(0);
          resolve();
        });
      });

      await manager.mutate('test-key', mutator, () => 'optimistic');

      await committedPromise;
    });
  });

  describe('Error Handling and Rollback', () => {
    beforeEach(() => {
      manager = new OptimisticUpdateManager(mockCache, {
        retry: false  // Disable retry for simpler error testing
      });
    });

    it('should rollback on mutation failure', async () => {
      // Set initial value
      mockCache.set('test-key', { value: 'original' });

      const mutator = jest.fn().mockRejectedValue(new Error('Mutation failed'));

      await expect(
        manager.mutate('test-key', mutator, () => ({ value: 'optimistic' }))
      ).rejects.toThrow('Mutation failed');

      // Should rollback to original
      const value = manager.get('test-key');
      expect(value).toEqual({ value: 'original' });
    });

    it('should emit rollback event on failure', async () => {
      const mutator = jest.fn().mockRejectedValue(new Error('Failed'));

      const rollbackPromise = new Promise<void>((resolve) => {
        manager.on('optimistic-rollback', (data: any) => {
          expect(data.key).toBe('test-key');
          resolve();
        });
      });

      manager.mutate('test-key', mutator, () => 'optimistic').catch(() => {});

      await rollbackPromise;
    });

    it('should keep optimistic value on error if keepOnError is true', async () => {
      const mutator = jest.fn().mockRejectedValue(new Error('Failed'));

      await expect(
        manager.mutate(
          'test-key',
          mutator,
          () => ({ value: 'optimistic' }),
          { keepOnError: true }
        )
      ).rejects.toThrow();

      const value = manager.get('test-key');
      expect(value).toEqual({ value: 'optimistic' });
    });

    it('should call custom rollback handler', async () => {
      const onRollback = jest.fn();
      const mutator = jest.fn().mockRejectedValue(new Error('Failed'));

      await expect(
        manager.mutate(
          'test-key',
          mutator,
          () => 'optimistic',
          { onRollback }
        )
      ).rejects.toThrow();

      expect(onRollback).toHaveBeenCalledWith(
        'test-key',
        undefined,
        expect.any(Error)
      );
    });
  });

  describe('Retry Logic', () => {
    beforeEach(() => {
      manager = new OptimisticUpdateManager(mockCache, {
        retry: true,
        maxRetries: 2,
        retryDelay: 10  // Short delay for tests
      });
    });

    it('should retry failed mutations', async () => {
      const mutator = jest.fn()
        .mockRejectedValueOnce(new Error('First fail'))
        .mockRejectedValueOnce(new Error('Second fail'))
        .mockResolvedValueOnce('success');

      const result = await manager.mutate('test-key', mutator);

      expect(result).toBe('success');
      expect(mutator).toHaveBeenCalledTimes(3); // 1 original + 2 retries
    });

    it('should fail after max retries', async () => {
      const mutator = jest.fn().mockRejectedValue(new Error('Persistent failure'));

      await expect(
        manager.mutate('test-key', mutator, () => 'optimistic')
      ).rejects.toThrow('Persistent failure');

      expect(mutator).toHaveBeenCalledTimes(3); // 1 original + 2 retries
    });

    it('should succeed after retry', async () => {
      const mutator = jest.fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValueOnce('success');

      const result = await manager.mutate('test-key', mutator);

      expect(result).toBe('success');
      expect(mutator).toHaveBeenCalledTimes(2); // 1 original + 1 retry
    });
  });

  describe('Timeout Handling', () => {
    beforeEach(() => {
      manager = new OptimisticUpdateManager(mockCache, {
        timeout: 50,  // Short timeout for testing
        retry: false
      });
    });

    it('should timeout long-running mutations', async () => {
      const mutator = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('late'), 200))
      );

      await expect(
        manager.mutate('test-key', mutator, () => 'optimistic')
      ).rejects.toThrow('Mutation timeout');
    });

    it('should use custom timeout from options', async () => {
      const mutator = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('result'), 100))
      );

      await expect(
        manager.mutate('test-key', mutator, undefined, { timeout: 50 })
      ).rejects.toThrow('Mutation timeout');
    });
  });

  describe('Pending Updates Tracking', () => {
    beforeEach(() => {
      manager = new OptimisticUpdateManager(mockCache);
    });

    it('should track pending updates', async () => {
      const mutator = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('done'), 50))
      );

      const promise = manager.mutate('test-key', mutator);

      // Check pending updates while mutation is in progress
      expect(manager.hasPendingUpdates('test-key')).toBe(true);

      const pending = manager.getPendingUpdates('test-key');
      expect(pending.length).toBe(1);
      expect(pending[0].key).toBe('test-key');
      expect(pending[0].status).toBe('pending');

      await promise;

      // No pending updates after completion
      expect(manager.hasPendingUpdates('test-key')).toBe(false);
    });

    it('should get all pending updates', async () => {
      const mutator = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('done'), 50))
      );

      manager.mutate('key-1', mutator);
      manager.mutate('key-2', mutator);

      const allPending = manager.getPendingUpdates();
      expect(allPending.length).toBe(2);
    });

    it('should handle multiple pending updates for same key', async () => {
      const mutator = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('done'), 50))
      );

      manager.mutate('test-key', mutator);
      manager.mutate('test-key', mutator);

      const pending = manager.getPendingUpdates('test-key');
      expect(pending.length).toBe(2);
    });
  });

  describe('Cancel Operations', () => {
    beforeEach(() => {
      manager = new OptimisticUpdateManager(mockCache);
    });

    it('should cancel pending update', async () => {
      const mutator = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('done'), 100))
      );

      manager.mutate('test-key', mutator, () => 'optimistic').catch(() => {});

      // Get the update ID
      const pending = manager.getPendingUpdates('test-key');
      expect(pending.length).toBe(1);
      const updateId = pending[0].id;

      // Cancel the update
      await manager.cancel(updateId);

      expect(manager.hasPendingUpdates('test-key')).toBe(false);
      expect(manager.getPendingUpdates('test-key').length).toBe(0);
    });

    it('should emit update-cancelled event', async () => {
      const mutator = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('done'), 100))
      );

      manager.mutate('test-key', mutator, () => 'optimistic').catch(() => {});

      const pending = manager.getPendingUpdates('test-key');
      const updateId = pending[0].id;

      const cancelledPromise = new Promise<void>((resolve) => {
        manager.on('update-cancelled', (data: any) => {
          expect(data.updateId).toBe(updateId);
          expect(data.key).toBe('test-key');
          resolve();
        });
      });

      await manager.cancel(updateId);

      await cancelledPromise;
    });

    it('should cancel all pending updates', async () => {
      const mutator = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('done'), 100))
      );

      manager.mutate('key-1', mutator).catch(() => {});
      manager.mutate('key-2', mutator).catch(() => {});

      expect(manager.getPendingUpdates().length).toBe(2);

      await manager.cancelAll();

      expect(manager.getPendingUpdates().length).toBe(0);
    });

    it('should not error when cancelling non-existent update', async () => {
      await expect(manager.cancel('non-existent-id')).resolves.not.toThrow();
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      manager = new OptimisticUpdateManager(mockCache, { retry: false });
    });

    it('should track mutation statistics', async () => {
      const mutator1 = jest.fn().mockResolvedValue('result1');
      const mutator2 = jest.fn().mockResolvedValue('result2');
      const mutator3 = jest.fn().mockRejectedValue(new Error('Failed'));

      await manager.mutate('key-1', mutator1);
      await manager.mutate('key-2', mutator2);
      await manager.mutate('key-3', mutator3).catch(() => {});

      const stats = manager.getStatistics();

      expect(stats.totalUpdates).toBe(3);
      expect(stats.committedUpdates).toBe(2);
      expect(stats.rolledBackUpdates).toBe(1);
      expect(stats.averageCommitTime).toBeGreaterThanOrEqual(0);
      expect(stats.failureRate).toBeCloseTo(1 / 3);
    });

    it('should reset statistics', async () => {
      const mutator = jest.fn().mockResolvedValue('result');

      await manager.mutate('test-key', mutator);

      manager.resetStatistics();

      const stats = manager.getStatistics();
      expect(stats.totalUpdates).toBe(0);
      expect(stats.committedUpdates).toBe(0);
      expect(stats.rolledBackUpdates).toBe(0);
    });

    it('should track average commit time', async () => {
      const mutator1 = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('done'), 10))
      );
      const mutator2 = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('done'), 20))
      );

      await manager.mutate('key-1', mutator1);
      await manager.mutate('key-2', mutator2);

      const stats = manager.getStatistics();
      expect(stats.averageCommitTime).toBeGreaterThan(0);
    });
  });

  describe('Cache Integration', () => {
    beforeEach(() => {
      manager = new OptimisticUpdateManager(mockCache);
    });

    it('should read from cache', () => {
      mockCache.set('test-key', { value: 'cached' });

      const value = manager.get('test-key');
      expect(value).toEqual({ value: 'cached' });
      expect(mockCache.get).toHaveBeenCalledWith('test-key');
    });

    it('should prefer optimistic value over cache', async () => {
      mockCache.set('test-key', { value: 'cached' });

      const mutator = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ value: 'final' }), 50))
      );

      manager.mutate('test-key', mutator, () => ({ value: 'optimistic' }));

      // Should return optimistic value while mutation is pending
      const value = manager.get('test-key');
      expect(value).toEqual({ value: 'optimistic' });
    });

    it('should update cache on successful mutation', async () => {
      const mutator = jest.fn().mockResolvedValue({ value: 'final' });

      await manager.mutate('test-key', mutator);

      expect(mockCache.set).toHaveBeenCalledWith('test-key', { value: 'final' });
    });

    it('should remove from cache on rollback to undefined', async () => {
      const mutator = jest.fn().mockRejectedValue(new Error('Failed'));

      await manager.mutate(
        'test-key',
        mutator,
        () => ({ value: 'optimistic' })
      ).catch(() => {});

      expect(mockCache.delete).toHaveBeenCalledWith('test-key');
    });
  });

  describe('Cache Management', () => {
    beforeEach(() => {
      manager = new OptimisticUpdateManager(mockCache);
    });

    it('should clear optimistic cache', async () => {
      const mutator = jest.fn().mockResolvedValue('result');

      await manager.mutate('test-key', mutator, () => 'optimistic');

      const clearedPromise = new Promise<void>((resolve) => {
        manager.on('cache-cleared', () => {
          resolve();
        });
      });

      manager.clearOptimisticCache();

      await clearedPromise;
    });
  });

  describe('Cleanup', () => {
    it('should destroy manager and clean up', async () => {
      manager = new OptimisticUpdateManager(mockCache);

      const mutator = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('done'), 100))
      );

      manager.mutate('test-key', mutator).catch(() => {});

      await manager.destroy();

      // All pending updates should be cancelled
      expect(manager.getPendingUpdates().length).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      manager = new OptimisticUpdateManager(mockCache);
    });

    it('should handle mutation with undefined result', async () => {
      const mutator = jest.fn().mockResolvedValue(undefined);

      const result = await manager.mutate('test-key', mutator);

      expect(result).toBeUndefined();
    });

    it('should handle optimistic update returning same value', async () => {
      mockCache.set('test-key', { value: 'original' });

      const mutator = jest.fn().mockResolvedValue({ value: 'original' });

      await manager.mutate(
        'test-key',
        mutator,
        (current) => current
      );

      expect(mockCache.set).toHaveBeenCalledWith('test-key', { value: 'original' });
    });

    it('should handle multiple mutations for different keys concurrently', async () => {
      const mutator1 = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('result1'), 30))
      );
      const mutator2 = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('result2'), 20))
      );
      const mutator3 = jest.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve('result3'), 10))
      );

      const [result1, result2, result3] = await Promise.all([
        manager.mutate('key-1', mutator1),
        manager.mutate('key-2', mutator2),
        manager.mutate('key-3', mutator3)
      ]);

      expect(result1).toBe('result1');
      expect(result2).toBe('result2');
      expect(result3).toBe('result3');

      const stats = manager.getStatistics();
      expect(stats.committedUpdates).toBe(3);
    });
  });
});
