/**
 * @fileoverview Comprehensive tests for NetronClient
 */

import { describe, it, expect, vi } from 'vitest';
import { NetronClient } from '../../src/netron/client.js';
import { HttpRemotePeer, HttpCacheManager, RetryManager } from '@omnitron-dev/netron-browser';
import type { BackendConfig, QueryOptions, MutationOptions } from '../../src/netron/types.js';

// Mock netron-browser
vi.mock('@omnitron-dev/netron-browser', () => {
  class MockHttpRemotePeer {
    private url: string;
    private cacheManager: any;
    private retryManager: any;
    private globalOptions: any = {};

    constructor(url: string) {
      this.url = url;
    }

    setCacheManager(manager: any) {
      this.cacheManager = manager;
    }

    setRetryManager(manager: any) {
      this.retryManager = manager;
    }

    setGlobalOptions(options: any) {
      this.globalOptions = options;
    }

    queryFluentInterface<T>(serviceName: string): Promise<T> {
      return Promise.resolve(this.createFluentProxy(serviceName) as T);
    }

    private createFluentProxy(serviceName: string): any {
      const methods: any = {};
      const proxy = new Proxy(methods, {
        get: (target: any, prop: string | symbol) => {
          // Don't intercept symbol properties (like Symbol.toStringTag, Symbol.iterator, etc.)
          if (typeof prop === 'symbol') {
            return undefined;
          }

          // Don't intercept 'then' to avoid being treated as a Promise/thenable
          if (prop === 'then') {
            return undefined;
          }

          // Fluent methods that return the proxy for chaining
          if (prop === 'cache') {
            return (opts: any) => proxy;
          }
          if (prop === 'retry') {
            return (opts: any) => proxy;
          }
          if (prop === 'timeout') {
            return (ms: number) => proxy;
          }
          if (prop === 'priority') {
            return (p: string) => proxy;
          }
          if (prop === 'transform') {
            return (fn: any) => proxy;
          }
          if (prop === 'validate') {
            return (fn: any) => proxy;
          }
          if (prop === 'fallback') {
            return (val: any) => proxy;
          }
          if (prop === 'metrics') {
            return (fn: any) => proxy;
          }
          if (prop === 'optimistic') {
            return (fn: any) => proxy;
          }
          if (prop === 'invalidateOn') {
            return (tags: any) => proxy;
          }

          // Return mock method for actual service methods
          return (...args: any[]) => Promise.resolve({ service: serviceName, method: prop, args });
        },
      });
      return proxy;
    }

    invalidateCache(pattern: any, type: string) {
      // Mock implementation
    }
  }

  class MockHttpCacheManager {
    constructor(private options: any) {}

    getStats() {
      return {
        entries: 0,
        size: 0,
        hits: 0,
        misses: 0,
      };
    }

    clear() {
      // Mock clear
    }
  }

  class MockRetryManager {
    constructor(private options: any) {}
  }

  return {
    HttpRemotePeer: MockHttpRemotePeer,
    HttpCacheManager: MockHttpCacheManager,
    RetryManager: MockRetryManager,
  };
});

describe('NetronClient', () => {
  describe('constructor', () => {
    it('should create instance with minimal config', () => {
      const client = new NetronClient();
      expect(client).toBeDefined();
      expect(client.getBackends()).toEqual([]);
    });

    it('should create instance with single backend URL', () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      expect(client).toBeDefined();
      expect(client.hasBackend('main')).toBe(true);
    });

    it('should create instance with multiple backends', () => {
      const config: BackendConfig = {
        backends: {
          api: 'http://api.example.com',
          auth: {
            url: 'http://auth.example.com',
            timeout: 5000,
          },
        },
        default: 'api',
      };

      const client = new NetronClient(config);
      expect(client.hasBackend('api')).toBe(true);
      expect(client.hasBackend('auth')).toBe(true);
      expect(client.getDefaultBackend()).toBe('api');
    });

    it('should use provided cache manager', () => {
      const cacheManager = new HttpCacheManager({
        maxEntries: 500,
      });

      const client = new NetronClient(undefined, cacheManager);
      expect(client).toBeDefined();
    });

    it('should use provided retry manager', () => {
      const retryManager = new RetryManager({
        attempts: 5,
      });

      const client = new NetronClient(undefined, undefined, retryManager);
      expect(client).toBeDefined();
    });

    it('should use provided backend registry', () => {
      const registry = new Map();
      const peer = new HttpRemotePeer('http://test.com');
      registry.set('custom', peer);

      const client = new NetronClient(undefined, undefined, undefined, registry);
      expect(client.hasBackend('custom')).toBe(true);
    });

    it('should respect custom default backend', () => {
      const config: BackendConfig = {
        backends: {
          api: 'http://api.example.com',
          auth: 'http://auth.example.com',
        },
      };

      const client = new NetronClient(config, undefined, undefined, undefined, 'auth');
      expect(client.getDefaultBackend()).toBe('auth');
    });

    it('should initialize with cache configuration', () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
        cache: {
          maxEntries: 2000,
          maxSizeBytes: 20000000,
          defaultMaxAge: 120000,
          debug: true,
        },
      };

      const client = new NetronClient(config);
      expect(client).toBeDefined();
    });

    it('should initialize with retry configuration', () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
        retry: {
          attempts: 5,
          backoff: 'linear',
          initialDelay: 500,
          maxDelay: 10000,
          jitter: 0.2,
        },
      };

      const client = new NetronClient(config);
      expect(client).toBeDefined();
    });
  });

  describe('backend()', () => {
    it('should return default backend when no name provided', () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      const backend = client.backend();
      expect(backend).toBeDefined();
      expect(backend).toBeInstanceOf(HttpRemotePeer);
    });

    it('should return named backend', () => {
      const config: BackendConfig = {
        backends: {
          api: 'http://api.example.com',
          auth: 'http://auth.example.com',
        },
      };

      const client = new NetronClient(config);
      const apiBackend = client.backend('api');
      const authBackend = client.backend('auth');

      expect(apiBackend).toBeDefined();
      expect(authBackend).toBeDefined();
      expect(apiBackend).not.toBe(authBackend);
    });

    it('should create all configured backends on initialization', () => {
      const config: BackendConfig = {
        backends: {
          lazy: 'http://lazy.example.com',
        },
      };

      const client = new NetronClient(config);
      // Backends are created eagerly during initialization
      expect(client.hasBackend('lazy')).toBe(true);

      const backend = client.backend('lazy');
      expect(backend).toBeDefined();
      expect(client.hasBackend('lazy')).toBe(true);
    });

    it('should throw error for unconfigured backend', () => {
      const client = new NetronClient();
      expect(() => client.backend('nonexistent')).toThrow("Backend 'nonexistent' not configured");
    });
  });

  describe('query()', () => {
    it('should execute query with minimal options', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      const result = await client.query('UserService', 'getUsers', []);

      expect(result).toBeDefined();
      expect(result.service).toBe('UserService');
      expect(result.method).toBe('getUsers');
    });

    it('should execute query with cache options', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      const options: QueryOptions = {
        cache: { maxAge: 60000, tags: ['users'] },
      };

      const result = await client.query('UserService', 'getUsers', [], options);
      expect(result).toBeDefined();
    });

    it('should execute query with retry options', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      const options: QueryOptions = {
        retry: { attempts: 3 },
      };

      const result = await client.query('UserService', 'getUsers', [], options);
      expect(result).toBeDefined();
    });

    it('should execute query with timeout', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      const options: QueryOptions = {
        timeout: 5000,
      };

      const result = await client.query('UserService', 'getUsers', [], options);
      expect(result).toBeDefined();
    });

    it('should execute query with priority', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      const options: QueryOptions = {
        priority: 'high',
      };

      const result = await client.query('UserService', 'getUsers', [], options);
      expect(result).toBeDefined();
    });

    it('should execute query with transform', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      const options: QueryOptions = {
        transform: (data: any) => ({ ...data, transformed: true }),
      };

      const result = await client.query('UserService', 'getUsers', [], options);
      expect(result).toBeDefined();
    });

    it('should execute query with validate', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      const options: QueryOptions = {
        validate: (data: any) => Array.isArray(data),
      };

      const result = await client.query('UserService', 'getUsers', [], options);
      expect(result).toBeDefined();
    });

    it('should execute query with fallback', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      const options: QueryOptions = {
        fallback: [],
      };

      const result = await client.query('UserService', 'getUsers', [], options);
      expect(result).toBeDefined();
    });

    it('should execute query with metrics callback', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const metricsFn = vi.fn();
      const client = new NetronClient(config);
      const options: QueryOptions = {
        metrics: metricsFn,
      };

      const result = await client.query('UserService', 'getUsers', [], options);
      expect(result).toBeDefined();
    });

    it('should execute query with all options combined', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      const options: QueryOptions = {
        cache: { maxAge: 60000 },
        retry: { attempts: 3 },
        timeout: 5000,
        priority: 'high',
        transform: (data: any) => data,
        validate: () => true,
        fallback: [],
        metrics: () => {},
      };

      const result = await client.query('UserService', 'getUsers', [], options);
      expect(result).toBeDefined();
    });

    it('should execute query on specific backend', async () => {
      const config: BackendConfig = {
        backends: {
          api: 'http://api.example.com',
          legacy: 'http://legacy.example.com',
        },
      };

      const client = new NetronClient(config);
      const result = await client.query('UserService', 'getUsers', [], undefined, 'legacy');

      expect(result).toBeDefined();
    });
  });

  describe('mutate()', () => {
    it('should execute mutation with minimal options', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      const result = await client.mutate('UserService', 'updateUser', [{ id: '1', name: 'John' }]);

      expect(result).toBeDefined();
      expect(result.service).toBe('UserService');
      expect(result.method).toBe('updateUser');
    });

    it('should execute mutation with optimistic update', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      const options: MutationOptions = {
        optimistic: () => ({ id: '1', name: 'John' }),
      };

      const result = await client.mutate('UserService', 'updateUser', [{ id: '1', name: 'John' }], options);
      expect(result).toBeDefined();
    });

    it('should execute mutation with cache invalidation', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      const options: MutationOptions = {
        invalidate: ['users', 'user-1'],
      };

      const result = await client.mutate('UserService', 'updateUser', [{ id: '1', name: 'John' }], options);
      expect(result).toBeDefined();
    });

    it('should execute mutation with retry options', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      const options: MutationOptions = {
        retry: { attempts: 5 },
      };

      const result = await client.mutate('UserService', 'updateUser', [{ id: '1', name: 'John' }], options);
      expect(result).toBeDefined();
    });

    it('should call onSuccess callback', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const onSuccess = vi.fn();
      const client = new NetronClient(config);
      const options: MutationOptions = {
        onSuccess,
      };

      const result = await client.mutate('UserService', 'updateUser', [{ id: '1', name: 'John' }], options);
      expect(result).toBeDefined();
      expect(onSuccess).toHaveBeenCalledWith(result);
    });

    it('should execute mutation with all options', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const onSuccess = vi.fn();
      const client = new NetronClient(config);
      const options: MutationOptions = {
        optimistic: () => ({ id: '1', name: 'John' }),
        invalidate: ['users'],
        retry: { attempts: 3 },
        onSuccess,
      };

      const result = await client.mutate('UserService', 'updateUser', [{ id: '1', name: 'John' }], options);
      expect(result).toBeDefined();
      expect(onSuccess).toHaveBeenCalled();
    });

    it('should execute mutation on specific backend', async () => {
      const config: BackendConfig = {
        backends: {
          api: 'http://api.example.com',
          auth: 'http://auth.example.com',
        },
      };

      const client = new NetronClient(config);
      const result = await client.mutate('UserService', 'updateUser', [{ id: '1', name: 'John' }], undefined, 'auth');

      expect(result).toBeDefined();
    });
  });

  describe('invalidate()', () => {
    it('should invalidate cache by string pattern', () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      expect(() => client.invalidate('users')).not.toThrow();
    });

    it('should invalidate cache by regex pattern', () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      expect(() => client.invalidate(/user-.*/)).not.toThrow();
    });

    it('should invalidate cache by tag array', () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      expect(() => client.invalidate(['users', 'posts'])).not.toThrow();
    });

    it('should invalidate specific backend cache', () => {
      const config: BackendConfig = {
        backends: {
          api: 'http://api.example.com',
          legacy: 'http://legacy.example.com',
        },
      };

      const client = new NetronClient(config);
      expect(() => client.invalidate('users', 'api')).not.toThrow();
    });

    it('should invalidate all backends when no backend specified', () => {
      const config: BackendConfig = {
        backends: {
          api: 'http://api.example.com',
          legacy: 'http://legacy.example.com',
        },
      };

      const client = new NetronClient(config);
      expect(() => client.invalidate('users')).not.toThrow();
    });
  });

  describe('getCacheStats()', () => {
    it('should return cache statistics', () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      const stats = client.getCacheStats();

      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('entries');
      expect(stats).toHaveProperty('size');
    });
  });

  describe('clearCache()', () => {
    it('should clear all caches', () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      expect(() => client.clearCache()).not.toThrow();
    });
  });

  describe('getBackends()', () => {
    it('should return empty array when no backends configured', () => {
      const client = new NetronClient();
      expect(client.getBackends()).toEqual([]);
    });

    it('should return all configured backend names', () => {
      const config: BackendConfig = {
        backends: {
          api: 'http://api.example.com',
          auth: 'http://auth.example.com',
          legacy: 'http://legacy.example.com',
        },
      };

      const client = new NetronClient(config);
      const backends = client.getBackends();

      expect(backends).toContain('api');
      expect(backends).toContain('auth');
      expect(backends).toContain('legacy');
      expect(backends).toHaveLength(3);
    });
  });

  describe('hasBackend()', () => {
    it('should return false for non-existent backend', () => {
      const client = new NetronClient();
      expect(client.hasBackend('nonexistent')).toBe(false);
    });

    it('should return true for configured backend', () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      expect(client.hasBackend('main')).toBe(true);
    });

    it('should return true for all configured backends', () => {
      const config: BackendConfig = {
        backends: {
          api: 'http://api.example.com',
          auth: 'http://auth.example.com',
        },
      };

      const client = new NetronClient(config);
      expect(client.hasBackend('api')).toBe(true);
      expect(client.hasBackend('auth')).toBe(true);
      expect(client.hasBackend('other')).toBe(false);
    });
  });

  describe('getDefaultBackend()', () => {
    it('should return "main" as default', () => {
      const client = new NetronClient();
      expect(client.getDefaultBackend()).toBe('main');
    });

    it('should return configured default', () => {
      const config: BackendConfig = {
        backends: {
          api: 'http://api.example.com',
        },
        default: 'api',
      };

      const client = new NetronClient(config);
      expect(client.getDefaultBackend()).toBe('api');
    });

    it('should allow changing default backend', () => {
      const config: BackendConfig = {
        backends: {
          api: 'http://api.example.com',
          auth: 'http://auth.example.com',
        },
      };

      const client = new NetronClient(config);
      expect(client.getDefaultBackend()).toBe('main');

      client.getDefaultBackend('api');
      expect(client.getDefaultBackend()).toBe('api');

      client.getDefaultBackend('auth');
      expect(client.getDefaultBackend()).toBe('auth');
    });
  });

  describe('edge cases', () => {
    it('should handle empty backends object', () => {
      const config: BackendConfig = {
        backends: {},
      };

      const client = new NetronClient(config);
      expect(client.getBackends()).toEqual([]);
    });

    it('should handle mixed backend configurations', () => {
      const config: BackendConfig = {
        backends: {
          simple: 'http://simple.com',
          complex: {
            url: 'http://complex.com',
            timeout: 10000,
            headers: { Authorization: 'Bearer token' },
          },
        },
      };

      const client = new NetronClient(config);
      expect(client.hasBackend('simple')).toBe(true);
      expect(client.hasBackend('complex')).toBe(true);
    });

    it('should handle query with empty args', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      const result = await client.query('UserService', 'getUsers', []);
      expect(result).toBeDefined();
    });

    it('should handle mutation with empty args', async () => {
      const config: BackendConfig = {
        baseUrl: 'http://localhost:3000',
      };

      const client = new NetronClient(config);
      const result = await client.mutate('UserService', 'resetAll', []);
      expect(result).toBeDefined();
    });
  });
});
