/**
 * HTTP Transport E2E Tests
 * Tests basic RPC and advanced fluent API features
 */

import { test, expect, Page } from '@playwright/test';

test.describe('HTTP Transport - Basic RPC', () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('/');

    // Connect HTTP peer
    await page.evaluate(async () => {
      const { HttpRemotePeer } = await import('../../src/netron/transport/http/peer.js');
      const peer = new HttpRemotePeer('http://localhost:3333');
      await peer.connect();
      window.testState.httpPeer = peer;
      window.updateConnectionStatus();
    });
  });

  test.afterEach(async () => {
    await page.evaluate(async () => {
      if (window.testState.httpPeer) {
        await window.testState.httpPeer.disconnect();
        window.testState.httpPeer = null;
      }
      window.updateConnectionStatus();
    });
  });

  test('should get all users', async () => {
    const result = await page.evaluate(async () => {
      const userService = await window.testState.httpPeer.queryInterface('UserService@1.0.0');
      window.testState.userService = userService;
      return await userService.getUsers();
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('id');
    expect(result[0]).toHaveProperty('name');
    expect(result[0]).toHaveProperty('email');
  });

  test('should get user by id', async () => {
    const result = await page.evaluate(async () => {
      const userService = await window.testState.httpPeer.queryInterface('UserService@1.0.0');
      return await userService.getUser('user-1');
    });

    expect(result).toBeDefined();
    expect(result).toHaveProperty('id', 'user-1');
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('email');
  });

  test('should create user', async () => {
    const result = await page.evaluate(async () => {
      const userService = await window.testState.httpPeer.queryInterface('UserService@1.0.0');
      return await userService.createUser({
        name: 'Test User',
        email: 'test@example.com',
        age: 25
      });
    });

    expect(result).toBeDefined();
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('name', 'Test User');
    expect(result).toHaveProperty('email', 'test@example.com');
    expect(result).toHaveProperty('age', 25);
    expect(result).toHaveProperty('active', true);
  });

  test('should update user', async () => {
    const result = await page.evaluate(async () => {
      const userService = await window.testState.httpPeer.queryInterface('UserService@1.0.0');
      return await userService.updateUser('user-1', {
        name: 'Updated Name'
      });
    });

    expect(result).toBeDefined();
    expect(result).toHaveProperty('id', 'user-1');
    expect(result).toHaveProperty('name', 'Updated Name');
  });

  test('should delete user', async () => {
    const result = await page.evaluate(async () => {
      const userService = await window.testState.httpPeer.queryInterface('UserService@1.0.0');
      // First create a user
      const created = await userService.createUser({
        name: 'To Delete',
        email: 'delete@example.com',
        age: 30
      });
      // Then delete it
      return await userService.deleteUser(created.id);
    });

    expect(result).toBe(true);
  });

  test('should find users with filters', async () => {
    const result = await page.evaluate(async () => {
      const userService = await window.testState.httpPeer.queryInterface('UserService@1.0.0');
      return await userService.findUsers({ active: true, minAge: 30 });
    });

    expect(result).toBeDefined();
    expect(Array.isArray(result)).toBe(true);
    result.forEach((user: any) => {
      expect(user.active).toBe(true);
      expect(user.age).toBeGreaterThanOrEqual(30);
    });
  });

  test('should return null for non-existent user', async () => {
    const result = await page.evaluate(async () => {
      const userService = await window.testState.httpPeer.queryInterface('UserService@1.0.0');
      return await userService.getUser('non-existent-id');
    });

    expect(result).toBeNull();
  });
});

test.describe('HTTP Transport - Fluent API', () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('/');

    // Connect HTTP peer with cache and retry managers
    await page.evaluate(async () => {
      const { HttpRemotePeer } = await import('../../src/netron/transport/http/peer.js');
      const { HttpCacheManager } = await import('../../src/netron/transport/http/cache-manager.js');
      const { RetryManager } = await import('../../src/netron/transport/http/retry-manager.js');

      const peer = new HttpRemotePeer('http://localhost:3333');
      const cacheManager = new HttpCacheManager({ maxEntries: 100 });
      const retryManager = new RetryManager();

      peer.setCacheManager(cacheManager);
      peer.setRetryManager(retryManager);

      await peer.connect();

      window.testState.httpPeer = peer;
      window.testState.cacheManager = cacheManager;
      window.testState.retryManager = retryManager;
      window.updateConnectionStatus();
    });
  });

  test.afterEach(async () => {
    await page.evaluate(async () => {
      if (window.testState.httpPeer) {
        await window.testState.httpPeer.disconnect();
        window.testState.httpPeer = null;
        window.testState.cacheManager = null;
        window.testState.retryManager = null;
      }
      window.updateConnectionStatus();
    });
  });

  test('should cache responses', async () => {
    const { firstDuration, secondDuration, firstResult, secondResult } = await page.evaluate(async () => {
      const service = await window.testState.httpPeer.queryFluentInterface('UserService@1.0.0');

      const start1 = performance.now();
      const result1 = await service.cache(60000).getUsers();
      const duration1 = performance.now() - start1;

      const start2 = performance.now();
      const result2 = await service.cache(60000).getUsers();
      const duration2 = performance.now() - start2;

      return {
        firstDuration: duration1,
        secondDuration: duration2,
        firstResult: result1,
        secondResult: result2
      };
    });

    // Second call should be much faster (cached)
    expect(secondDuration).toBeLessThan(firstDuration / 2);
    expect(firstResult).toEqual(secondResult);
  });

  test('should retry failed requests', async () => {
    const { attempts, success } = await page.evaluate(async () => {
      const service = await window.testState.httpPeer.queryFluentInterface('UserService@1.0.0');

      let attemptCount = 0;
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Network error');
        }
        return originalFetch(...args);
      };

      try {
        await service.retry({ maxAttempts: 3, delay: 100 }).getUsers();
        window.fetch = originalFetch;
        return { attempts: attemptCount, success: true };
      } catch (err) {
        window.fetch = originalFetch;
        throw err;
      }
    });

    expect(attempts).toBe(3);
    expect(success).toBe(true);
  });

  test('should handle optimistic updates', async () => {
    const { optimisticValue, finalValue } = await page.evaluate(async () => {
      const service = await window.testState.httpPeer.queryFluentInterface('UserService@1.0.0');

      // First get current users (cached)
      await service.cache(60000).getUsers();

      // Optimistic update
      const optimisticUpdater = (current: any[]) => {
        return [...(current || []), { id: 'optimistic-1', name: 'Optimistic User' }];
      };

      // Create user with optimistic update
      const created = await service
        .cache(60000)
        .optimistic(optimisticUpdater)
        .createUser({ name: 'Real User', email: 'real@example.com', age: 25 });

      // Get cached value (should include optimistic update initially, then real data)
      const cached = window.testState.cacheManager.get('UserService@1.0.0:getUsers:[]');

      return {
        optimisticValue: cached,
        finalValue: created
      };
    });

    expect(finalValue).toHaveProperty('name', 'Real User');
  });

  test('should deduplicate concurrent requests', async () => {
    const { requestCount, results } = await page.evaluate(async () => {
      const service = await window.testState.httpPeer.queryFluentInterface('UserService@1.0.0');

      let fetchCount = 0;
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        fetchCount++;
        return originalFetch(...args);
      };

      // Make 5 concurrent identical requests
      const promises = Array(5).fill(null).map(() =>
        service.dedupe().getUsers()
      );

      const results = await Promise.all(promises);
      window.fetch = originalFetch;

      return { requestCount: fetchCount, results };
    });

    // Should only make 1 actual request
    expect(requestCount).toBe(1);
    // All results should be identical
    results.forEach((result: any) => {
      expect(result).toEqual(results[0]);
    });
  });

  test('should transform responses', async () => {
    const result = await page.evaluate(async () => {
      const service = await window.testState.httpPeer.queryFluentInterface('UserService@1.0.0');

      return await service
        .transform((users: any[]) => users.map(u => u.name))
        .getUsers();
    });

    expect(Array.isArray(result)).toBe(true);
    result.forEach((name: any) => {
      expect(typeof name).toBe('string');
    });
  });

  test('should validate responses', async () => {
    const validation = await page.evaluate(async () => {
      const service = await window.testState.httpPeer.queryFluentInterface('UserService@1.0.0');

      try {
        await service
          .validate((user: any) => {
            if (!user || !user.id) throw new Error('Invalid user');
          })
          .getUser('user-1');
        return { success: true };
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    expect(validation.success).toBe(true);
  });

  test('should handle timeout', async () => {
    const result = await page.evaluate(async () => {
      const service = await window.testState.httpPeer.queryFluentInterface('UserService@1.0.0');

      try {
        await service
          .timeout(100)
          .slowMethod(5000); // Method takes 5s, timeout is 100ms
        return { success: false };
      } catch (err) {
        return { success: true, error: err.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.error).toContain('timeout');
  });

  test('should cancel requests', async () => {
    const result = await page.evaluate(async () => {
      const service = await window.testState.httpPeer.queryFluentInterface('UserService@1.0.0');

      const abortController = new AbortController();

      const promise = service
        .signal(abortController.signal)
        .slowMethod(5000);

      // Cancel after 100ms
      setTimeout(() => abortController.abort(), 100);

      try {
        await promise;
        return { success: false };
      } catch (err) {
        return { success: true, error: err.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.error).toContain('abort');
  });
});

test.describe('HTTP Transport - Advanced Features', () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('/');

    await page.evaluate(async () => {
      const { HttpRemotePeer } = await import('../../src/netron/transport/http/peer.js');
      const { HttpCacheManager } = await import('../../src/netron/transport/http/cache-manager.js');
      const { RetryManager } = await import('../../src/netron/transport/http/retry-manager.js');

      const peer = new HttpRemotePeer('http://localhost:3333');
      const cacheManager = new HttpCacheManager({ maxEntries: 100 });
      const retryManager = new RetryManager();

      peer.setCacheManager(cacheManager);
      peer.setRetryManager(retryManager);

      await peer.connect();

      window.testState.httpPeer = peer;
      window.testState.cacheManager = cacheManager;
      window.updateConnectionStatus();
    });
  });

  test.afterEach(async () => {
    await page.evaluate(async () => {
      if (window.testState.httpPeer) {
        await window.testState.httpPeer.disconnect();
        window.testState.httpPeer = null;
        window.testState.cacheManager = null;
      }
      window.updateConnectionStatus();
    });
  });

  test('should invalidate cache by key', async () => {
    await page.evaluate(async () => {
      const service = await window.testState.httpPeer.queryFluentInterface('UserService@1.0.0');

      // Cache the result
      await service.cache(60000).getUsers();

      // Invalidate
      window.testState.cacheManager.invalidate('UserService@1.0.0:getUsers:[]');

      // Should not be cached
      const cached = window.testState.cacheManager.get('UserService@1.0.0:getUsers:[]');
      if (cached) throw new Error('Cache not invalidated');
    });
  });

  test('should invalidate cache by tags', async () => {
    await page.evaluate(async () => {
      const service = await window.testState.httpPeer.queryFluentInterface('UserService@1.0.0');

      // Cache with tags
      await service.cache({ ttl: 60000, tags: ['users'] }).getUsers();

      // Invalidate by tag
      window.testState.cacheManager.invalidateByTag('users');

      // Should not be cached
      const cached = window.testState.cacheManager.get('UserService@1.0.0:getUsers:[]');
      if (cached) throw new Error('Cache not invalidated by tag');
    });
  });

  test('should chain multiple options', async () => {
    const result = await page.evaluate(async () => {
      const service = await window.testState.httpPeer.queryFluentInterface('UserService@1.0.0');

      return await service
        .cache(30000)
        .retry({ maxAttempts: 3, delay: 100 })
        .transform((users: any[]) => users.filter(u => u.active))
        .timeout(5000)
        .getUsers();
    });

    expect(Array.isArray(result)).toBe(true);
    result.forEach((user: any) => {
      expect(user.active).toBe(true);
    });
  });
});
