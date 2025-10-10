/**
 * Tests for ConfigurableProxy (Phase 1)
 * Tests the configurable proxy that accumulates options and intercepts method calls
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  ConfigurableProxy,
  HttpCacheManager,
  RetryManager
} from '../../../../src/netron/transport/http/fluent-interface/index.js';
import { HttpTransportClient } from '../../../../src/netron/transport/http/client.js';

interface ITestService {
  getUser(id: string): Promise<{ id: string; name: string }>;
  getUsers(filters?: { status?: string }): Promise<Array<{ id: string; name: string }>>;
  createUser(data: { name: string }): Promise<{ id: string; name: string }>;
}

describe('ConfigurableProxy', () => {
  let transport: HttpTransportClient;
  let serviceName: string;
  let cacheManager: HttpCacheManager;
  let retryManager: RetryManager;

  beforeEach(() => {
    transport = new HttpTransportClient('http://localhost:3000');
    serviceName = 'TestService@1.0.0';

    cacheManager = new HttpCacheManager({ maxEntries: 100 });
    retryManager = new RetryManager();
  });

  describe('Configuration Chaining', () => {
    it('should chain cache configuration', () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      );

      const chained = proxy.cache(60000);
      expect(chained).toBeInstanceOf(ConfigurableProxy);
    });

    it('should chain retry configuration', () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      );

      const chained = proxy.retry(3);
      expect(chained).toBeInstanceOf(ConfigurableProxy);
    });

    it('should chain multiple configurations', () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      );

      const chained = proxy.cache(60000).retry(3).timeout(5000);
      expect(chained).toBeInstanceOf(ConfigurableProxy);
    });

    it('should chain all available configuration methods', () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      );

      const chained = proxy
        .cache({ maxAge: 60000 })
        .retry({ attempts: 3 })
        .dedupe('test-key')
        .timeout(5000)
        .priority('high')
        .transform((data: any) => data)
        .validate((data: any) => true)
        .fallback(null)
        .optimistic((current: any) => current)
        .invalidateOn(['tag1'])
        .background(60000)
        .metrics(() => {});

      expect(chained).toBeInstanceOf(ConfigurableProxy);
    });
  });

  describe('Option Accumulation', () => {
    it('should accumulate cache option', () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      );

      proxy.cache(60000);
      // Options should be accumulated internally
      expect((proxy as any).accumulatedOptions.cache).toEqual({ maxAge: 60000 });
    });

    it('should accumulate retry option', () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      );

      proxy.retry(3);
      expect((proxy as any).accumulatedOptions.retry).toEqual({ attempts: 3 });
    });

    it('should accumulate multiple options', () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      );

      proxy.cache(60000).retry(3).timeout(5000);

      const options = (proxy as any).accumulatedOptions;
      expect(options.cache).toEqual({ maxAge: 60000 });
      expect(options.retry).toEqual({ attempts: 3 });
      expect(options.timeout).toBe(5000);
    });

    it('should handle initial options', () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager,
        { cache: { maxAge: 30000 } }
      );

      expect((proxy as any).accumulatedOptions.cache).toEqual({ maxAge: 30000 });
    });
  });

  describe('Method Call Interception', () => {
    it('should intercept method calls via Proxy', () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      ) as any;

      // Mock transport.invoke to avoid actual HTTP call
      const invokeSpy = jest.spyOn(transport, 'invoke').mockResolvedValue({ id: '123', name: 'Test' });

      // Call method through proxy
      const promise = proxy.getUser('123');

      expect(promise).toBeInstanceOf(Promise);
      expect(invokeSpy).toHaveBeenCalled();
    });

    it('should pass arguments to method call', async () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      ) as any;

      const invokeSpy = jest.spyOn(transport, 'invoke').mockResolvedValue({ id: '123', name: 'Test' });

      await proxy.getUser('user-123');

      expect(invokeSpy).toHaveBeenCalledWith(
        'TestService@1.0.0',
        'getUser',
        ['user-123'],
        expect.any(Object)
      );
    });

    it('should handle methods with multiple arguments', async () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      ) as any;

      const invokeSpy = jest.spyOn(transport, 'invoke').mockResolvedValue([]);

      await proxy.getUsers({ status: 'active' });

      expect(invokeSpy).toHaveBeenCalledWith(
        'TestService@1.0.0',
        'getUsers',
        [{ status: 'active' }],
        expect.any(Object)
      );
    });

    it('should handle methods with no arguments', async () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      ) as any;

      const invokeSpy = jest.spyOn(transport, 'invoke').mockResolvedValue([]);

      await proxy.getUsers();

      expect(invokeSpy).toHaveBeenCalled();
    });
  });

  describe('Configuration Application', () => {
    it('should apply accumulated cache option to request', async () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      ) as any;

      const getSpy = jest.spyOn(cacheManager, 'get').mockResolvedValue({ id: '123', name: 'Test' });

      proxy.cache(60000);
      await proxy.getUser('123');

      expect(getSpy).toHaveBeenCalled();
    });

    it('should apply accumulated retry option to request', async () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      ) as any;

      const executeSpy = jest.spyOn(retryManager, 'execute').mockResolvedValue({ id: '123', name: 'Test' });

      proxy.retry(3);
      await proxy.getUser('123');

      expect(executeSpy).toHaveBeenCalled();
    });

    it('should apply multiple accumulated options to request', async () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      ) as any;

      const getSpy = jest.spyOn(cacheManager, 'get').mockResolvedValue({ id: '123', name: 'Test' });

      proxy.cache(60000).retry(3).timeout(5000);
      await proxy.getUser('123');

      expect(getSpy).toHaveBeenCalled();
    });
  });

  describe('Type Safety', () => {
    it('should provide type-safe method access', () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      ) as any;

      // TypeScript should know about getUser, getUsers, createUser
      expect(typeof proxy.getUser).toBe('function');
      expect(typeof proxy.getUsers).toBe('function');
      expect(typeof proxy.createUser).toBe('function');
    });

    it('should return Promise for method calls', () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      ) as any;

      jest.spyOn(transport, 'invoke').mockResolvedValue({ id: '123', name: 'Test' });

      const result = proxy.getUser('123');
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('Edge Cases', () => {
    it('should handle symbol properties gracefully', () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      ) as any;

      const sym = Symbol('test');
      expect(() => proxy[sym]).not.toThrow();
    });

    it('should handle toString calls', () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      ) as any;

      expect(() => proxy.toString()).not.toThrow();
    });

    it('should create proxy without cache manager', () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        undefined,
        retryManager
      );

      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should create proxy without retry manager', () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        undefined
      );

      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });
  });

  describe('Transform and Validate', () => {
    it('should apply transform function', async () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      ) as any;

      jest.spyOn(transport, 'invoke').mockResolvedValue([
        { id: '1', name: 'User 1' },
        { id: '2', name: 'User 2' }
      ]);

      proxy.transform((users: any[]) => users.map(u => u.name));
      const result = await proxy.getUsers();

      expect(result).toEqual(['User 1', 'User 2']);
    });

    it('should apply validate function', async () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      ) as any;

      jest.spyOn(transport, 'invoke').mockResolvedValue([]);

      proxy.validate((data: any) => Array.isArray(data));
      const result = await proxy.getUsers();

      expect(result).toEqual([]);
    });

    it('should use fallback on validation failure', async () => {
      const proxy = new ConfigurableProxy<ITestService>(
        transport,
        serviceName,
        cacheManager,
        retryManager
      ) as any;

      jest.spyOn(transport, 'invoke').mockResolvedValue('invalid');

      proxy.validate((data: any) => Array.isArray(data)).fallback([]);
      const result = await proxy.getUsers();

      expect(result).toEqual([]);
    });
  });
});
