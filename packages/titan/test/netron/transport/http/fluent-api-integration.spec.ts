/**
 * Integration Tests for Fluent API (Phase 1)
 * Tests the complete integration of FluentInterface, ConfigurableProxy, and QueryBuilder
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpRemotePeer } from '../../../../src/netron/transport/http/peer.js';
import { FluentInterface } from '../../../../src/netron/transport/http/fluent-interface.js';
import { HttpCacheManager } from '../../../../src/netron/transport/http/cache-manager.js';
import { RetryManager } from '../../../../src/netron/transport/http/retry-manager.js';
import { HttpTransportClient } from '../../../../src/netron/transport/http/client.js';
import type { INetron } from '../../../../src/netron/types.js';

interface IUserService {
  getUser(id: string): Promise<{ id: string; name: string; email: string }>;
  getUsers(filters?: { status?: string }): Promise<Array<{ id: string; name: string }>>;
  createUser(data: { name: string; email: string }): Promise<{ id: string; name: string; email: string }>;
  updateUser(id: string, data: { name?: string }): Promise<{ id: string; name: string }>;
}

describe('Fluent API Integration', () => {
  let peer: HttpRemotePeer;
  let mockNetron: INetron;
  let cacheManager: HttpCacheManager;
  let retryManager: RetryManager;

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

    // Create managers
    cacheManager = new HttpCacheManager({ maxEntries: 100 });
    retryManager = new RetryManager();

    // Create peer
    peer = new HttpRemotePeer(
      mockConnection as any,
      mockNetron,
      'http://localhost:3000'
    );

    // Mock queryInterfaceRemote to return definition
    jest.spyOn(peer as any, 'queryInterfaceRemote').mockResolvedValue({
      id: 'user-service-def',
      meta: {
        name: 'UserService@1.0.0',
        version: '1.0.0',
        methods: {
          getUser: { name: 'getUser' },
          getUsers: { name: 'getUsers' },
          createUser: { name: 'createUser' },
          updateUser: { name: 'updateUser' }
        }
      }
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('queryFluentInterface', () => {
    it('should create FluentInterface instance', async () => {
      const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');

      expect(service).toBeInstanceOf(FluentInterface);
    });

    it('should create FluentInterface with peer managers', async () => {
      // Set managers on peer
      peer.setCacheManager(cacheManager);
      peer.setRetryManager(retryManager);

      const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');

      expect(service).toBeInstanceOf(FluentInterface);
    });

    it('should query remote interface', async () => {
      const queryInterfaceSpy = jest.spyOn(peer as any, 'queryInterfaceRemote');

      await peer.queryFluentInterface<IUserService>('UserService@1.0.0');

      expect(queryInterfaceSpy).toHaveBeenCalledWith('UserService@1.0.0');
    });
  });

  describe('Natural Method Calls', () => {
    it('should support natural method call syntax', async () => {
      const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');

      // Mock transport invoke
      const mockTransport = (service as any).transport || new HttpTransportClient('http://localhost:3000');
      jest.spyOn(mockTransport, 'invoke').mockResolvedValue({ id: '123', name: 'John', email: 'john@example.com' });

      // This should work with natural syntax (but will need ConfigurableProxy to intercept)
      const proxy = service.cache(60000).retry(3);

      expect(proxy).toBeDefined();
    });

    it('should support configuration chaining', async () => {
      const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');

      // Chain multiple configurations
      const configured = service
        .cache({ maxAge: 60000, tags: ['users'] })
        .retry({ attempts: 3, backoff: 'exponential' })
        .timeout(5000)
        .priority('high');

      expect(configured).toBeDefined();
    });

    it('should execute method with accumulated options', async () => {
      // Mock getOrCreateHttpClient to return a mockable transport
      const mockTransport = new HttpTransportClient('http://localhost:3000');
      jest.spyOn(peer as any, 'getOrCreateHttpClient').mockReturnValue(mockTransport);

      const invokeSpy = jest.spyOn(mockTransport, 'invoke').mockResolvedValue({
        id: '123',
        name: 'John',
        email: 'john@example.com'
      });

      const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0') as any;

      // Execute with configuration
      const user = await service.cache(60000).retry(3).getUser('123');

      expect(user).toEqual({ id: '123', name: 'John', email: 'john@example.com' });
      expect(invokeSpy).toHaveBeenCalled();
    });
  });

  describe('Backward Compatibility', () => {
    it('should support call().execute() API', async () => {
      const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');

      const transport = new HttpTransportClient('http://localhost:3000');
      (service as any).transport = transport;

      jest.spyOn(transport, 'invoke').mockResolvedValue({ id: '123', name: 'John', email: 'john@example.com' });

      // Old API should still work
      const user = await service.call('getUser', '123').cache(60000).execute();

      expect(user).toEqual({ id: '123', name: 'John', email: 'john@example.com' });
    });

    it('should support direct api proxy', async () => {
      const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');

      const transport = new HttpTransportClient('http://localhost:3000');
      (service as any).transport = transport;

      jest.spyOn(transport, 'invoke').mockResolvedValue({ id: '123', name: 'John', email: 'john@example.com' });

      // Direct API call (no configuration)
      const user = await service.api.getUser('123');

      expect(user).toEqual({ id: '123', name: 'John', email: 'john@example.com' });
    });
  });

  describe('Cache Integration', () => {
    it('should cache results with fluent API', async () => {
      const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0') as any;

      const transport = new HttpTransportClient('http://localhost:3000');
      (service as any).transport = transport;

      let callCount = 0;
      jest.spyOn(transport, 'invoke').mockImplementation(async () => {
        callCount++;
        return { id: '123', name: 'John', email: 'john@example.com' };
      });

      // First call - should hit transport
      await service.cache(60000).getUser('123');

      // Second call with same cache - should hit cache
      await service.cache(60000).getUser('123');

      // Transport should only be called once (second call from cache)
      expect(callCount).toBe(1);
    });

    it('should support cache invalidation', async () => {
      const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');

      const invalidateSpy = jest.spyOn(cacheManager, 'invalidate');

      service.invalidate('users*');

      expect(invalidateSpy).toHaveBeenCalledWith('users*');
    });

    it('should support cache clearing', async () => {
      const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0');

      const clearSpy = jest.spyOn(cacheManager, 'clear');

      service.clearCache();

      expect(clearSpy).toHaveBeenCalled();
    });
  });

  describe('Retry Integration', () => {
    it('should retry failed requests', async () => {
      const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0') as any;

      const transport = new HttpTransportClient('http://localhost:3000');
      (service as any).transport = transport;

      let attempts = 0;
      jest.spyOn(transport, 'invoke').mockImplementation(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Network error');
        }
        return { id: '123', name: 'John', email: 'john@example.com' };
      });

      // Should retry and eventually succeed
      const user = await service.retry(5).getUser('123');

      expect(user).toEqual({ id: '123', name: 'John', email: 'john@example.com' });
      expect(attempts).toBe(3);
    });
  });

  describe('Transform and Validate', () => {
    it('should transform response data', async () => {
      const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0') as any;

      const transport = new HttpTransportClient('http://localhost:3000');
      (service as any).transport = transport;

      jest.spyOn(transport, 'invoke').mockResolvedValue([
        { id: '1', name: 'John' },
        { id: '2', name: 'Jane' }
      ]);

      // Transform to just names
      const names = await service
        .transform((users: any[]) => users.map(u => u.name))
        .getUsers();

      expect(names).toEqual(['John', 'Jane']);
    });

    it('should validate response data', async () => {
      const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0') as any;

      const transport = new HttpTransportClient('http://localhost:3000');
      (service as any).transport = transport;

      jest.spyOn(transport, 'invoke').mockResolvedValue([]);

      // Validate that result is an array
      const users = await service
        .validate((data: any) => Array.isArray(data))
        .getUsers();

      expect(users).toEqual([]);
    });

    it('should use fallback on error', async () => {
      const service = await peer.queryFluentInterface<IUserService>('UserService@1.0.0') as any;

      const transport = new HttpTransportClient('http://localhost:3000');
      (service as any).transport = transport;

      jest.spyOn(transport, 'invoke').mockRejectedValue(new Error('Network error'));

      // Should return fallback on error
      const users = await service.fallback([]).getUsers();

      expect(users).toEqual([]);
    });
  });

  describe('queryInterface (Standard RPC API)', () => {
    it('should create HttpInterface instance', async () => {
      const service = await peer.queryInterface<IUserService>('UserService@1.0.0');

      expect(service).toBeDefined();
      expect(typeof service.getUser).toBe('function');
    });

    it('should work with direct RPC calls', async () => {
      // Mock getOrCreateHttpClient to return a mockable transport
      const mockTransport = new HttpTransportClient('http://localhost:3000');
      jest.spyOn(peer as any, 'getOrCreateHttpClient').mockReturnValue(mockTransport);

      jest.spyOn(mockTransport, 'invoke').mockResolvedValue({ id: '123', name: 'John', email: 'john@example.com' });

      const service = await peer.queryInterface<IUserService>('UserService@1.0.0');
      const user = await service.getUser('123');

      expect(user).toEqual({ id: '123', name: 'John', email: 'john@example.com' });
    });
  });
});
