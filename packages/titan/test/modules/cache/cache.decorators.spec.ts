/**
 * Cache Decorators Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'reflect-metadata';
import {
  Cacheable,
  CacheInvalidate,
  CachePut,
  CacheKey,
  getCacheMetadata,
  hasCacheDecorator,
} from '../../../src/modules/cache/cache.decorators.js';
import { CacheService } from '../../../src/modules/cache/cache.service.js';
import type { ICacheService } from '../../../src/modules/cache/cache.types.js';

describe('Cache Decorators', () => {
  let cacheService: ICacheService;

  beforeEach(() => {
    cacheService = new CacheService({
      maxSize: 100,
      defaultTtl: 60,
      enableStats: true,
    });
  });

  afterEach(async () => {
    await cacheService.dispose();
  });

  describe('@Cacheable', () => {
    it('should cache method result', async () => {
      class UserService {
        cacheService = cacheService;
        callCount = 0;

        @Cacheable({ keyPrefix: 'user', ttl: 60 })
        async getUser(id: string): Promise<{ id: string; name: string }> {
          this.callCount++;
          return { id, name: `User ${id}` };
        }
      }

      const service = new UserService();

      // First call - should execute method
      const result1 = await service.getUser('123');
      expect(result1).toEqual({ id: '123', name: 'User 123' });
      expect(service.callCount).toBe(1);

      // Second call - should return cached
      const result2 = await service.getUser('123');
      expect(result2).toEqual({ id: '123', name: 'User 123' });
      expect(service.callCount).toBe(1);
    });

    it('should cache with different keys for different arguments', async () => {
      class UserService {
        cacheService = cacheService;
        callCount = 0;

        @Cacheable({ keyPrefix: 'user' })
        async getUser(id: string): Promise<{ id: string }> {
          this.callCount++;
          return { id };
        }
      }

      const service = new UserService();

      await service.getUser('1');
      await service.getUser('2');
      expect(service.callCount).toBe(2);

      await service.getUser('1');
      await service.getUser('2');
      expect(service.callCount).toBe(2);
    });

    it('should use custom key generator', async () => {
      class UserService {
        cacheService = cacheService;

        @Cacheable({
          keyPrefix: 'user',
          keyGenerator: (id: string) => `custom:${id}`,
        })
        async getUser(id: string): Promise<{ id: string }> {
          return { id };
        }
      }

      const service = new UserService();
      await service.getUser('123');

      const cache = cacheService.getCache();
      const hasKey = await cache.has('custom:123');
      expect(hasKey).toBe(true);
    });

    it('should not cache when condition is false', async () => {
      class UserService {
        cacheService = cacheService;
        callCount = 0;

        @Cacheable({
          keyPrefix: 'user',
          condition: (id: string) => id !== 'skip',
        })
        async getUser(id: string): Promise<{ id: string }> {
          this.callCount++;
          return { id };
        }
      }

      const service = new UserService();

      await service.getUser('skip');
      await service.getUser('skip');
      expect(service.callCount).toBe(2);

      await service.getUser('cache');
      await service.getUser('cache');
      expect(service.callCount).toBe(3);
    });

    it('should not cache when unless returns true', async () => {
      class UserService {
        cacheService = cacheService;
        callCount = 0;

        @Cacheable({
          keyPrefix: 'user',
          unless: (result: { skip: boolean }) => result.skip,
        })
        async getUser(id: string): Promise<{ id: string; skip: boolean }> {
          this.callCount++;
          return { id, skip: id === 'skip' };
        }
      }

      const service = new UserService();

      await service.getUser('skip');
      await service.getUser('skip');
      expect(service.callCount).toBe(2);
    });

    it('should not cache null/undefined results', async () => {
      class UserService {
        cacheService = cacheService;
        callCount = 0;

        @Cacheable({ keyPrefix: 'user' })
        async getUser(_id: string): Promise<null> {
          this.callCount++;
          return null;
        }
      }

      const service = new UserService();

      await service.getUser('123');
      await service.getUser('123');
      expect(service.callCount).toBe(2);
    });

    it('should execute method when no cacheService is available', async () => {
      class UserService {
        callCount = 0;

        @Cacheable({ keyPrefix: 'user' })
        async getUser(id: string): Promise<{ id: string }> {
          this.callCount++;
          return { id };
        }
      }

      const service = new UserService();

      await service.getUser('123');
      await service.getUser('123');
      expect(service.callCount).toBe(2);
    });

    it('should support tags', async () => {
      class UserService {
        cacheService = cacheService;

        @Cacheable({ keyPrefix: 'user', tags: ['users', 'entities'] })
        async getUser(id: string): Promise<{ id: string }> {
          return { id };
        }
      }

      const service = new UserService();
      await service.getUser('123');

      const cache = cacheService.getCache();
      const invalidated = await cache.invalidateByTags(['users']);
      expect(invalidated).toBe(1);
    });
  });

  describe('@CacheInvalidate', () => {
    it('should invalidate cache after method execution', async () => {
      class UserService {
        cacheService = cacheService;

        @Cacheable({ keyPrefix: 'user' })
        async getUser(id: string): Promise<{ id: string }> {
          return { id };
        }

        @CacheInvalidate({ keyPattern: 'user:.*:123' })
        async updateUser(id: string): Promise<void> {
          // Update logic
        }
      }

      const service = new UserService();

      // Cache the user
      await service.getUser('123');
      const cache = cacheService.getCache();

      // Verify cached
      const beforeInvalidate = await cache.has('user:getUser:123');
      expect(beforeInvalidate).toBe(true);

      // Invalidate
      await service.updateUser('123');

      // Verify invalidated
      const afterInvalidate = await cache.has('user:getUser:123');
      expect(afterInvalidate).toBe(false);
    });

    it('should invalidate by tags', async () => {
      class UserService {
        cacheService = cacheService;

        @CacheInvalidate({ tags: ['users'] })
        async clearUsers(): Promise<void> {}
      }

      const cache = cacheService.getCache();
      await cache.set('user:1', { id: '1' }, { tags: ['users'] });
      await cache.set('user:2', { id: '2' }, { tags: ['users'] });

      const service = new UserService();
      await service.clearUsers();

      expect(await cache.has('user:1')).toBe(false);
      expect(await cache.has('user:2')).toBe(false);
    });

    it('should invalidate all entries when allEntries is true', async () => {
      class CacheManager {
        cacheService = cacheService;

        @CacheInvalidate({ allEntries: true })
        async clearAll(): Promise<void> {}
      }

      const cache = cacheService.getCache();
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');

      const manager = new CacheManager();
      await manager.clearAll();

      expect(await cache.size()).toBe(0);
    });

    it('should substitute arguments in key pattern', async () => {
      class UserService {
        cacheService = cacheService;

        @CacheInvalidate({ keyPattern: 'user:{0}' })
        async deleteUser(id: string): Promise<void> {}
      }

      const cache = cacheService.getCache();
      await cache.set('user:123', { id: '123' });

      const service = new UserService();
      await service.deleteUser('123');

      expect(await cache.has('user:123')).toBe(false);
    });
  });

  describe('@CachePut', () => {
    it('should always execute method and update cache', async () => {
      let counter = 0;

      class UserService {
        cacheService = cacheService;

        @CachePut({ keyPrefix: 'user', key: 'user:{0}' })
        async updateUser(id: string): Promise<{ id: string; version: number }> {
          counter++;
          return { id, version: counter };
        }
      }

      const service = new UserService();

      const result1 = await service.updateUser('123');
      expect(result1.version).toBe(1);

      const result2 = await service.updateUser('123');
      expect(result2.version).toBe(2);
      expect(counter).toBe(2);

      // Verify cache has latest value
      const cache = cacheService.getCache();
      const cached = await cache.get('user:123');
      expect(cached).toEqual({ id: '123', version: 2 });
    });
  });

  describe('@CacheKey', () => {
    it('should use only marked parameters for cache key', async () => {
      class UserService {
        cacheService = cacheService;
        callCount = 0;

        @Cacheable({ keyPrefix: 'user' })
        async getUser(@CacheKey() id: string, _options?: { verbose: boolean }): Promise<{ id: string }> {
          this.callCount++;
          return { id };
        }
      }

      const service = new UserService();

      await service.getUser('123', { verbose: true });
      await service.getUser('123', { verbose: false });

      // Should use same cache key regardless of options
      expect(service.callCount).toBe(1);
    });
  });

  describe('getCacheMetadata', () => {
    it('should return metadata for decorated methods', () => {
      class TestService {
        @Cacheable({ keyPrefix: 'test', ttl: 60 })
        async testMethod(): Promise<void> {}
      }

      const service = new TestService();
      const metadata = getCacheMetadata(service, 'testMethod');

      expect(metadata).toBeDefined();
      expect(metadata!.type).toBe('cacheable');
      expect((metadata!.options as { keyPrefix: string }).keyPrefix).toBe('test');
    });

    it('should return undefined for non-decorated methods', () => {
      class TestService {
        async normalMethod(): Promise<void> {}
      }

      const service = new TestService();
      const metadata = getCacheMetadata(service, 'normalMethod');

      expect(metadata).toBeUndefined();
    });
  });

  describe('hasCacheDecorator', () => {
    it('should return true for decorated methods', () => {
      class TestService {
        @Cacheable({ keyPrefix: 'test' })
        async decoratedMethod(): Promise<void> {}
      }

      const service = new TestService();
      expect(hasCacheDecorator(service, 'decoratedMethod')).toBe(true);
    });

    it('should return false for non-decorated methods', () => {
      class TestService {
        async normalMethod(): Promise<void> {}
      }

      const service = new TestService();
      expect(hasCacheDecorator(service, 'normalMethod')).toBe(false);
    });
  });
});
