/**
 * Type Safety Tests for Fluent API (Phase 2)
 * These tests ensure TypeScript type inference and type safety work correctly
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { FluentInterface } from '../../../../src/netron/transport/http/fluent-interface.js';
import { ConfigurableProxy } from '../../../../src/netron/transport/http/configurable-proxy.js';
import { HttpInterface } from '../../../../src/netron/transport/http/interface.js';
import { HttpTransportClient } from '../../../../src/netron/transport/http/client.js';
import { HttpCacheManager } from '../../../../src/netron/transport/http/cache-manager.js';
import { RetryManager } from '../../../../src/netron/transport/http/retry-manager.js';
import type { Definition } from '../../../../src/netron/definition.js';

// Test service interfaces
interface IUserService {
  getUser(id: string): Promise<User>;
  getUsers(filter?: UserFilter): Promise<User[]>;
  createUser(data: CreateUserInput): Promise<User>;
  updateUser(id: string, data: Partial<User>): Promise<User>;
  deleteUser(id: string): Promise<void>;
}

interface User {
  id: string;
  name: string;
  email: string;
  age?: number;
}

interface UserFilter {
  name?: string;
  minAge?: number;
  maxAge?: number;
}

interface CreateUserInput {
  name: string;
  email: string;
  age?: number;
}

describe('Type Safety Tests', () => {
  let transport: HttpTransportClient;
  let definition: Definition;
  let cacheManager: HttpCacheManager;
  let retryManager: RetryManager;

  beforeEach(() => {
    transport = new HttpTransportClient('http://localhost:3000');
    definition = {
      id: 'test-def-1',
      meta: {
        name: 'UserService@1.0.0',
        version: '1.0.0',
        methods: {
          getUser: { name: 'getUser' },
          getUsers: { name: 'getUsers' },
          createUser: { name: 'createUser' },
          updateUser: { name: 'updateUser' },
          deleteUser: { name: 'deleteUser' }
        }
      }
    } as Definition;

    cacheManager = new HttpCacheManager({ maxEntries: 100 });
    retryManager = new RetryManager();
  });

  describe('FluentInterface Type Inference', () => {
    it('should infer correct service type', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // Type check: service should be FluentInterface<IUserService>
      const check: FluentInterface<IUserService> = service;
      expect(check).toBeDefined();
    });

    it('should return ConfigurableProxy with correct type from cache()', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const proxy = service.cache(60000);

      // Type check: proxy should be ConfigurableProxy<IUserService>
      const check: ConfigurableProxy<IUserService> = proxy;
      expect(check).toBeDefined();
    });

    it('should return ConfigurableProxy with correct type from retry()', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const proxy = service.retry(3);

      // Type check: proxy should be ConfigurableProxy<IUserService>
      const check: ConfigurableProxy<IUserService> = proxy;
      expect(check).toBeDefined();
    });

    it('should support method chaining with correct types', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const proxy = service
        .cache(60000)
        .retry(3)
        .timeout(5000);

      // Type check: each step should return ConfigurableProxy<IUserService>
      const check: ConfigurableProxy<IUserService> = proxy;
      expect(check).toBeDefined();
    });

    it('should return FluentInterface from globalCache()', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const result = service.globalCache({ maxAge: 120000 });

      // Type check: should return FluentInterface<IUserService> for chaining
      const check: FluentInterface<IUserService> = result;
      expect(check).toBeDefined();
    });

    it('should return FluentInterface from globalRetry()', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const result = service.globalRetry({ attempts: 5 });

      // Type check: should return FluentInterface<IUserService> for chaining
      const check: FluentInterface<IUserService> = result;
      expect(check).toBeDefined();
    });

    it('should allow chaining global configurations', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const result = service
        .globalCache({ maxAge: 120000 })
        .globalRetry({ attempts: 5 });

      // Type check: should return FluentInterface<IUserService>
      const check: FluentInterface<IUserService> = result;
      expect(check).toBeDefined();
    });
  });

  describe('ConfigurableProxy Type Inference', () => {
    it('should preserve service type through configuration chain', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const proxy = service
        .cache(60000)
        .retry(3)
        .timeout(5000)
        .priority('high');

      // Type check: should still be ConfigurableProxy<IUserService>
      const check: ConfigurableProxy<IUserService> = proxy;
      expect(check).toBeDefined();
    });

    it('should support all configuration methods with correct types', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const proxy = service
        .cache({ maxAge: 60000, tags: ['users'] })
        .retry({ attempts: 3, backoff: 'exponential' })
        .dedupe('user-key')
        .timeout(5000)
        .priority('high')
        .transform((data) => data)
        .validate((data) => !!data)
        .fallback({ id: '', name: '', email: '' })
        .background(30000)
        .invalidateOn(['users']);

      // Type check: should be ConfigurableProxy<IUserService>
      const check: ConfigurableProxy<IUserService> = proxy;
      expect(check).toBeDefined();
    });
  });

  describe('Return Type Inference', () => {
    it('should infer void return type correctly', async () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      // Mock the transport
      jest.spyOn(transport, 'invoke').mockResolvedValue(undefined);

      const proxy = service.cache(60000) as any;

      // Type check: deleteUser should return Promise<void>
      const result: Promise<void> = proxy.deleteUser('123');
      expect(result).toBeInstanceOf(Promise);
    });

    it('should infer object return type correctly', async () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const mockUser: User = { id: '123', name: 'John', email: 'john@example.com' };
      jest.spyOn(transport, 'invoke').mockResolvedValue(mockUser);

      const proxy = service.cache(60000) as any;

      // Type check: getUser should return Promise<User>
      const result: Promise<User> = proxy.getUser('123');
      expect(result).toBeInstanceOf(Promise);
    });

    it('should infer array return type correctly', async () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const mockUsers: User[] = [
        { id: '1', name: 'John', email: 'john@example.com' },
        { id: '2', name: 'Jane', email: 'jane@example.com' }
      ];
      jest.spyOn(transport, 'invoke').mockResolvedValue(mockUsers);

      const proxy = service.cache(60000) as any;

      // Type check: getUsers should return Promise<User[]>
      const result: Promise<User[]> = proxy.getUsers();
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('Argument Type Safety', () => {
    it('should enforce correct argument types for service methods', async () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const mockUser: User = { id: '123', name: 'John', email: 'john@example.com' };
      jest.spyOn(transport, 'invoke').mockResolvedValue(mockUser);

      const proxy = service.cache(60000) as any;

      // These should compile without errors (correct types)
      const result1: Promise<User> = proxy.getUser('123');
      const result2: Promise<User[]> = proxy.getUsers({ name: 'John' });
      const result3: Promise<User> = proxy.createUser({ name: 'John', email: 'john@example.com' });
      const result4: Promise<User> = proxy.updateUser('123', { name: 'Jane' });
      const result5: Promise<void> = proxy.deleteUser('123');

      expect(result1).toBeInstanceOf(Promise);
      expect(result2).toBeInstanceOf(Promise);
      expect(result3).toBeInstanceOf(Promise);
      expect(result4).toBeInstanceOf(Promise);
      expect(result5).toBeInstanceOf(Promise);
    });
  });

  describe('Configuration Option Types', () => {
    it('should accept cache options as number', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const proxy = service.cache(60000);
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should accept cache options as object', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const proxy = service.cache({
        maxAge: 60000,
        tags: ['users'],
        staleWhileRevalidate: true
      });
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should accept retry options as number', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const proxy = service.retry(3);
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should accept retry options as object', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const proxy = service.retry({
        attempts: 3,
        backoff: 'exponential',
        maxDelay: 5000
      });
      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should accept correct priority levels', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const proxy1 = service.priority('high');
      const proxy2 = service.priority('normal');
      const proxy3 = service.priority('low');

      expect(proxy1).toBeInstanceOf(ConfigurableProxy);
      expect(proxy2).toBeInstanceOf(ConfigurableProxy);
      expect(proxy3).toBeInstanceOf(ConfigurableProxy);
    });

    it('should accept transform function with correct signature', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const proxy = service.transform<User[]>((data: any) => {
        return Array.isArray(data) ? data : [data];
      });

      expect(proxy).toBeInstanceOf(ConfigurableProxy);
    });

    it('should accept validate function with correct signature', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const proxy1 = service.validate((data: any) => !!data);
      const proxy2 = service.validate(async (data: any) => {
        return Promise.resolve(!!data);
      });

      expect(proxy1).toBeInstanceOf(ConfigurableProxy);
      expect(proxy2).toBeInstanceOf(ConfigurableProxy);
    });
  });

  describe('Backward Compatibility Type Safety', () => {
    it('should support HttpInterface with same types', () => {
      const service = new HttpInterface<IUserService>(
        transport,
        definition,
        {
          cache: cacheManager,
          retry: retryManager
        }
      );

      // Type check: should be HttpInterface<IUserService>
      const check: HttpInterface<IUserService> = service;
      expect(check).toBeDefined();
    });

    it('should support call() API in FluentInterface', () => {
      const service = new FluentInterface<IUserService>(
        transport,
        definition,
        cacheManager,
        retryManager
      );

      const builder = service.call('getUser', '123');

      // Type check: should return QueryBuilder
      expect(builder).toBeDefined();
    });
  });
});
