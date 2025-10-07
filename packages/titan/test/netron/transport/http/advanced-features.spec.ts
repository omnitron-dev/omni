/**
 * Advanced Features Tests for Fluent API (Phase 3)
 * Tests background refetch, deduplication, cancellation, and optimistic updates
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpRemotePeer } from '../../../../src/netron/transport/http/peer.js';
import { QueryBuilder } from '../../../../src/netron/transport/http/query-builder.js';
import { HttpTransportClient } from '../../../../src/netron/transport/http/client.js';
import { HttpCacheManager } from '../../../../src/netron/transport/http/cache-manager.js';
import { RetryManager } from '../../../../src/netron/transport/http/retry-manager.js';
import type { INetron } from '../../../../src/netron/types.js';

interface IUserService {
  getUser(id: string): Promise<{ id: string; name: string; version: number }>;
  getUsers(): Promise<Array<{ id: string; name: string }>>;
  updateUser(id: string, data: { name: string }): Promise<{ id: string; name: string; version: number }>;
}

describe('Advanced Features Tests - Phase 3', () => {
  let peer: HttpRemotePeer;
  let mockNetron: INetron;
  let cacheManager: HttpCacheManager;
  let retryManager: RetryManager;
  let mockTransport: HttpTransportClient;

  beforeEach(() => {
    // Create mock Netron
    mockNetron = {
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        child: jest.fn().mockReturnThis()
      }
    } as any;

    // Create mock connection
    const mockConnection = {
      on: jest.fn(),
      off: jest.fn(),
      send: jest.fn(),
      close: jest.fn()
    };

    cacheManager = new HttpCacheManager({ maxEntries: 100 });
    retryManager = new RetryManager();

    // Create peer
    peer = new HttpRemotePeer(
      mockConnection as any,
      mockNetron,
      'http://localhost:3000'
    );

    // Mock queryInterfaceRemote
    jest.spyOn(peer as any, 'queryInterfaceRemote').mockResolvedValue({
      id: 'user-service-def',
      meta: {
        name: 'UserService@1.0.0',
        version: '1.0.0',
        methods: {
          getUser: { name: 'getUser' },
          getUsers: { name: 'getUsers' },
          updateUser: { name: 'updateUser' }
        }
      }
    });

    // Create and mock transport
    mockTransport = new HttpTransportClient('http://localhost:3000');
    jest.spyOn(peer as any, 'getOrCreateHttpClient').mockReturnValue(mockTransport);

    // Default mock for transport.invoke
    jest.spyOn(mockTransport, 'invoke').mockResolvedValue({
      id: '123',
      name: 'Default',
      version: 1
    });
  });

  afterEach(() => {
    // Cleanup background refetch intervals
    QueryBuilder.stopAllBackgroundRefetch();
  });

  describe('Background Refetch', () => {
    it('should setup background refetch interval', async () => {
      let callCount = 0;
      jest.spyOn(transport, 'invoke').mockImplementation(async () => {
        callCount++;
        return { id: '123', name: `User${callCount}`, version: callCount };
      });

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // Initial call with background refetch enabled
      const proxy = service.cache(10000).background(100) as any;
      const user1 = await proxy.getUser('123');

      expect(user1.name).toBe('User1');
      expect(callCount).toBe(1);
      expect(QueryBuilder.getActiveBackgroundRefetchCount()).toBe(1);

      // Wait for background refetch to trigger
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(callCount).toBeGreaterThan(1);
    });

    it('should update cache silently during background refetch', async () => {
      let version = 1;
      jest.spyOn(transport, 'invoke').mockImplementation(async () => {
        return { id: '123', name: 'John', version: version++ };
      });

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // Initial call
      const proxy = service.cache(10000).background(100) as any;
      const user1 = await proxy.getUser('123');
      expect(user1.version).toBe(1);

      // Wait for background refetch
      await new Promise(resolve => setTimeout(resolve, 150));

      // Get from cache - should have updated version
      const proxy2 = service.cache(10000) as any;
      const user2 = await proxy2.getUser('123');
      expect(user2.version).toBeGreaterThan(1);
    });

    it('should not throw errors during background refetch failures', async () => {
      let callCount = 0;
      jest.spyOn(transport, 'invoke').mockImplementation(async () => {
        callCount++;
        if (callCount > 1) {
          throw new Error('Background refetch error');
        }
        return { id: '123', name: 'John', version: 1 };
      });

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const proxy = service.cache(10000).background(100) as any;
      const user = await proxy.getUser('123');
      expect(user).toBeDefined();

      // Wait for background refetch (which will fail silently)
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should not crash
      expect(callCount).toBeGreaterThan(1);
    });

    it('should apply transform during background refetch', async () => {
      let callCount = 0;
      jest.spyOn(transport, 'invoke').mockImplementation(async () => {
        callCount++;
        return { id: '123', name: 'John', version: callCount };
      });

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const transform = (data: any) => ({
        ...data,
        transformed: true
      });

      const proxy = service
        .cache(10000)
        .background(100)
        .transform(transform) as any;

      const user1 = await proxy.getUser('123');
      expect(user1.transformed).toBe(true);

      // Wait for background refetch
      await new Promise(resolve => setTimeout(resolve, 150));

      // Cache should have transformed data
      const proxy2 = service.cache(10000).transform(transform) as any;
      const user2 = await proxy2.getUser('123');
      expect(user2.transformed).toBe(true);
      expect(user2.version).toBeGreaterThan(1);
    });

    it('should clear existing interval when setting up new background refetch', async () => {
      jest.spyOn(transport, 'invoke').mockResolvedValue({
        id: '123',
        name: 'John',
        version: 1
      });

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // First background refetch
      const proxy1 = service.cache(10000).background(100) as any;
      await proxy1.getUser('123');
      expect(QueryBuilder.getActiveBackgroundRefetchCount()).toBe(1);

      // Second background refetch with same cache key
      const proxy2 = service.cache(10000).background(200) as any;
      await proxy2.getUser('123');

      // Should still have only 1 interval (old one cleared)
      expect(QueryBuilder.getActiveBackgroundRefetchCount()).toBe(1);
    });

    it('should stop all background refetch intervals', async () => {
      jest.spyOn(transport, 'invoke').mockResolvedValue({
        id: '123',
        name: 'John',
        version: 1
      });

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // Create multiple background refetch
      const proxy1 = service.cache(10000).background(100) as any;
      const proxy2 = service.cache(20000).background(200) as any;

      await proxy1.getUser('123');
      await proxy2.getUsers();

      expect(QueryBuilder.getActiveBackgroundRefetchCount()).toBe(2);

      // Stop all
      QueryBuilder.stopAllBackgroundRefetch();

      expect(QueryBuilder.getActiveBackgroundRefetchCount()).toBe(0);
    });
  });

  describe('Enhanced Deduplication', () => {
    it('should deduplicate concurrent identical requests', async () => {
      let callCount = 0;
      jest.spyOn(transport, 'invoke').mockImplementation(async () => {
        callCount++;
        // Simulate slow request
        await new Promise(resolve => setTimeout(resolve, 50));
        return { id: '123', name: 'John', version: 1 };
      });

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // Fire 5 concurrent requests
      const promises = Array.from({ length: 5 }, () => {
        const proxy = service.cache(10000) as any;
        return proxy.getUser('123');
      });

      const results = await Promise.all(promises);

      // Should only make 1 actual call due to deduplication
      expect(callCount).toBe(1);
      expect(results).toHaveLength(5);
      expect(results.every(r => r.id === '123')).toBe(true);
    });

    it('should deduplicate using custom dedupe key', async () => {
      let callCount = 0;
      jest.spyOn(transport, 'invoke').mockImplementation(async () => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
        return { id: '123', name: 'John', version: 1 };
      });

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // Use custom dedupe key
      const promises = Array.from({ length: 5 }, (_, i) => {
        const proxy = service.dedupe('custom-user-key') as any;
        return proxy.getUser(`user-${i}`); // Different IDs but same dedupe key
      });

      const results = await Promise.all(promises);

      // Should deduplicate despite different inputs
      expect(callCount).toBe(1);
      expect(results).toHaveLength(5);
    });

    it('should not deduplicate different requests', async () => {
      let callCount = 0;
      jest.spyOn(transport, 'invoke').mockImplementation(async (service, method, args) => {
        callCount++;
        const id = args[0];
        return { id, name: `User${id}`, version: 1 };
      });

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // Fire concurrent requests with different IDs
      const promises = [
        (service.cache(10000) as any).getUser('1'),
        (service.cache(10000) as any).getUser('2'),
        (service.cache(10000) as any).getUser('3')
      ];

      const results = await Promise.all(promises);

      // Should make 3 separate calls
      expect(callCount).toBe(3);
      expect(results[0].id).toBe('1');
      expect(results[1].id).toBe('2');
      expect(results[2].id).toBe('3');
    });

    it('should deduplicate sequential identical requests within flight window', async () => {
      let callCount = 0;
      jest.spyOn(transport, 'invoke').mockImplementation(async () => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 100));
        return { id: '123', name: 'John', version: 1 };
      });

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // Start first request
      const proxy1 = service.cache(10000) as any;
      const promise1 = proxy1.getUser('123');

      // Start second request while first is still in flight
      await new Promise(resolve => setTimeout(resolve, 20));
      const proxy2 = service.cache(10000) as any;
      const promise2 = proxy2.getUser('123');

      await Promise.all([promise1, promise2]);

      // Should deduplicate
      expect(callCount).toBe(1);
    });
  });

  describe('Query Cancellation', () => {
    it('should cancel query using abort controller', async () => {
      jest.spyOn(transport, 'invoke').mockImplementation(async () => {
        // Simulate slow request
        await new Promise(resolve => setTimeout(resolve, 1000));
        return { id: '123', name: 'John', version: 1 };
      });

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const builder = service.call('getUser', '123');

      // Start query
      const promise = builder.execute();

      // Cancel immediately
      builder.cancel();

      // Should throw cancellation error
      await expect(promise).rejects.toThrow('Query cancelled');
    });

    it('should handle cancellation of already completed query', async () => {
      jest.spyOn(transport, 'invoke').mockResolvedValue({
        id: '123',
        name: 'John',
        version: 1
      });

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const builder = service.call('getUser', '123');
      const result = await builder.execute();

      expect(result).toBeDefined();

      // Cancel after completion (should be no-op)
      expect(() => builder.cancel()).not.toThrow();
    });

    it('should cancel retry attempts', async () => {
      let callCount = 0;
      jest.spyOn(transport, 'invoke').mockImplementation(async () => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 100));
        throw new Error('Request failed');
      });

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const builder = service.call('getUser', '123').retry(5);

      const promise = builder.execute();

      // Cancel during retries
      await new Promise(resolve => setTimeout(resolve, 50));
      builder.cancel();

      await expect(promise).rejects.toThrow();

      // Should not complete all 5 retry attempts
      expect(callCount).toBeLessThan(5);
    });
  });

  describe('Optimistic Updates', () => {
    it('should apply optimistic update to cache immediately', async () => {
      jest.spyOn(transport, 'invoke').mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return { id: '123', name: 'Updated Name', version: 2 };
      });

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // First, cache the user
      const proxy1 = service.cache(10000) as any;
      await proxy1.getUser('123');

      // Set initial cached value
      const cacheKey = 'UserService@1.0.0.getUser:"123"';
      cacheManager.set(cacheKey, { id: '123', name: 'John', version: 1 }, { maxAge: 10000 });

      // Update with optimistic update
      const proxy2 = service
        .cache(10000)
        .optimistic((current: any) => ({
          ...(current || {}),
          id: '123',
          name: 'Optimistic Name',
          version: (current?.version || 0) + 1
        })) as any;

      const updatePromise = proxy2.updateUser('123', { name: 'Updated Name' });

      // Cache should immediately have optimistic value
      const cachedValue = cacheManager.getRaw(cacheKey);
      expect(cachedValue).toBeDefined();
      expect((cachedValue as any).name).toBe('Optimistic Name');

      // Wait for actual update
      await updatePromise;
    });

    it('should rollback optimistic update on error', async () => {
      jest.spyOn(transport, 'invoke').mockRejectedValue(new Error('Update failed'));

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // Set initial cached value
      const cacheKey = 'UserService@1.0.0.updateUser:"123"';
      cacheManager.set(cacheKey, { id: '123', name: 'John', version: 1 }, { maxAge: 10000 });

      // Try update with optimistic update
      const proxy = service
        .cache(10000)
        .optimistic((current: any) => ({
          ...(current || {}),
          id: '123',
          name: 'Optimistic Name',
          version: (current?.version || 0) + 1
        })) as any;

      await expect(proxy.updateUser('123', { name: 'Updated Name' })).rejects.toThrow();

      // Cache should be invalidated (rolled back)
      const cachedValue = cacheManager.getRaw(cacheKey);
      expect(cachedValue).toBeUndefined();
    });

    it('should work with fallback on error', async () => {
      jest.spyOn(transport, 'invoke').mockRejectedValue(new Error('Update failed'));

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const fallbackValue = { id: '123', name: 'Fallback', version: 0 };

      const proxy = service
        .cache(10000)
        .optimistic((current: any) => ({
          ...(current || {}),
          name: 'Optimistic',
          version: 1
        }))
        .fallback(fallbackValue) as any;

      const result = await proxy.updateUser('123', { name: 'Updated' });

      // Should use fallback instead of throwing
      expect(result).toEqual(fallbackValue);
    });

    it('should apply optimistic update without cache manager gracefully', async () => {
      jest.spyOn(transport, 'invoke').mockResolvedValue({
        id: '123',
        name: 'Updated',
        version: 2
      });

      // Create service without cache manager
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        undefined, // No cache manager
        retryManager
      );

      const proxy = service
        .optimistic((current: any) => ({
          ...(current || {}),
          name: 'Optimistic',
          version: 1
        })) as any;

      // Should not throw even without cache manager
      const result = await proxy.updateUser('123', { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });
  });

  describe('Combined Advanced Features', () => {
    it('should work with cache + optimistic + background refetch', async () => {
      let version = 1;
      jest.spyOn(transport, 'invoke').mockImplementation(async () => {
        return { id: '123', name: 'John', version: version++ };
      });

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // Initial cached value
      const cacheKey = 'UserService@1.0.0.getUser:"123"';
      cacheManager.set(cacheKey, { id: '123', name: 'John', version: 0 }, { maxAge: 10000 });

      // Use all features together
      const proxy = service
        .cache(10000)
        .background(100)
        .optimistic((current: any) => ({
          ...(current || {}),
          id: '123',
          name: 'Optimistic',
          version: (current?.version || 0) + 100
        })) as any;

      const user1 = await proxy.getUser('123');
      expect(user1.version).toBe(1);

      // Wait for background refetch
      await new Promise(resolve => setTimeout(resolve, 150));

      // Version should have incremented from background refetch
      const proxy2 = service.cache(10000) as any;
      const user2 = await proxy2.getUser('123');
      expect(user2.version).toBeGreaterThan(1);
    });

    it('should deduplicate + retry together', async () => {
      let callCount = 0;
      let failCount = 0;

      jest.spyOn(transport, 'invoke').mockImplementation(async () => {
        callCount++;
        failCount++;

        if (failCount <= 2) {
          throw new Error('Temporary failure');
        }

        await new Promise(resolve => setTimeout(resolve, 50));
        return { id: '123', name: 'John', version: 1 };
      });

      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // Multiple concurrent requests with retry
      const promises = Array.from({ length: 3 }, () => {
        const proxy = service.retry(5).cache(10000) as any;
        return proxy.getUser('123');
      });

      const results = await Promise.all(promises);

      // Should deduplicate + retry
      expect(results).toHaveLength(3);
      expect(callCount).toBeGreaterThanOrEqual(3); // At least 3 attempts (initial + 2 failures)
      expect(callCount).toBeLessThan(15); // But not 15 (3 concurrent * 5 retries)
    });
  });
});
