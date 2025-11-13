/**
 * Comprehensive HTTP Peer Tests
 *
 * This test suite provides comprehensive coverage for peer.ts including:
 * - Connection initialization and lifecycle
 * - Method invocation with various input types
 * - Request/response interceptors
 * - Cache manager integration
 * - Retry manager integration
 * - Tracing context (traceId, spanId, userId, tenantId)
 * - Error handling and mapping
 * - Timeout handling
 * - FluentInterface vs standard HttpInterface
 * - Service discovery (lazy loading)
 * - Definition cache invalidation
 * - Not supported operations (subscribe, set, get, expose)
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpRemotePeer } from '../../../../src/netron/transport/http/peer.js';
import { HttpConnection } from '../../../../src/netron/transport/http/connection.js';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { TitanError, ErrorCode } from '../../../../src/errors/index.js';
import { HttpCacheManager, RetryManager } from '../../../../src/netron/transport/http/fluent-interface/index.js';

describe('HttpRemotePeer - Comprehensive Coverage', () => {
  let server: HttpServer;
  let connection: HttpConnection;
  let peer: HttpRemotePeer;
  const testPort = 5000 + Math.floor(Math.random() * 500);
  const baseUrl = `http://localhost:${testPort}`;

  // Mock Netron instance
  const mockNetron = {
    logger: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      child: jest.fn(function (this: any) {
        return this;
      }),
    },
  };

  beforeEach(async () => {
    // Create and start server
    server = new HttpServer({ port: testPort, host: 'localhost' });

    const mockPeer = {
      stubs: new Map(),
      logger: mockNetron.logger,
    };

    // Add test service
    const testStub = {
      definition: {
        meta: {
          name: 'TestService',
          version: '1.0.0',
          methods: {
            echo: { name: 'echo' },
            add: { name: 'add' },
            error: { name: 'error' },
            slow: { name: 'slow' },
          },
        },
      },
      instance: {},
      call: jest.fn(async (method, args) => {
        if (method === 'echo') {
          return { echo: args[0] };
        }
        if (method === 'add') {
          return { result: args[0].a + args[0].b };
        }
        if (method === 'error') {
          throw new TitanError({
            code: ErrorCode.INTERNAL_ERROR,
            message: 'Test error',
          });
        }
        if (method === 'slow') {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          return { result: 'done' };
        }
        throw new Error('Method not found');
      }),
    };

    mockPeer.stubs.set('test-stub', testStub);
    server.setPeer(mockPeer as any);
    await server.listen();

    // Create connection and peer
    connection = new HttpConnection(baseUrl);
    peer = new HttpRemotePeer(connection, mockNetron as any, baseUrl);
    await peer.init(true);
  });

  afterEach(async () => {
    if (peer) {
      await peer.close();
    }
    if (connection) {
      await connection.close();
    }
    if (server) {
      await server.close();
    }
  });

  describe('Initialization', () => {
    it('should initialize with base URL', () => {
      expect(peer).toBeDefined();
      expect(peer.id).toContain('http-direct');
    });

    it('should generate deterministic ID from URL', () => {
      const peer2 = new HttpRemotePeer(connection, mockNetron as any, baseUrl);
      expect(peer2.id).toBe(peer.id);
    });

    it('should strip trailing slash from base URL', () => {
      const peer2 = new HttpRemotePeer(connection, mockNetron as any, `${baseUrl}/`);
      expect((peer2 as any).baseUrl).toBe(baseUrl);
    });

    it('should set default options', () => {
      const options = (peer as any).defaultOptions;
      expect(options.timeout).toBeDefined();
      expect(options.headers).toBeDefined();
    });
  });

  describe('Method Invocation', () => {
    it('should invoke remote method successfully', async () => {
      const result = await peer.call('TestService', 'echo', [{ message: 'hello' }]);

      expect(result).toEqual({ echo: { message: 'hello' } });
    });

    it('should handle method with multiple arguments', async () => {
      const result = await peer.call('TestService', 'add', [{ a: 5, b: 3 }]);

      expect(result).toEqual({ result: 8 });
    });

    it('should handle method errors', async () => {
      await expect(peer.call('TestService', 'error', [{}])).rejects.toThrow('Test error');
    });

    it('should handle non-existent service', async () => {
      await expect(peer.call('NonExistent', 'test', [{}])).rejects.toThrow();
    });

    it('should handle non-existent method', async () => {
      await expect(peer.call('TestService', 'nonExistent', [{}])).rejects.toThrow();
    });

    it('should handle timeout', async () => {
      // Set very short timeout
      (peer as any).defaultOptions.timeout = 100;

      await expect(peer.call('TestService', 'slow', [{}])).rejects.toThrow('timeout');
    });
  });

  describe('Request Interceptors', () => {
    it('should apply request interceptor', async () => {
      const interceptor = jest.fn((req) => {
        req.context = { userId: 'test-user' };
        return req;
      });

      peer.addRequestInterceptor(interceptor);

      await peer.call('TestService', 'echo', [{ test: 'data' }]);

      expect(interceptor).toHaveBeenCalled();
      const interceptedReq = interceptor.mock.calls[0][0];
      expect(interceptedReq.context.userId).toBe('test-user');
    });

    it('should support async request interceptors', async () => {
      const interceptor = jest.fn(async (req) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        req.context = { processed: true };
        return req;
      });

      peer.addRequestInterceptor(interceptor);

      await peer.call('TestService', 'echo', [{}]);

      expect(interceptor).toHaveBeenCalled();
    });

    it('should support multiple request interceptors', async () => {
      const interceptor1 = jest.fn((req) => {
        req.context = { step: 1 };
        return req;
      });

      const interceptor2 = jest.fn((req) => {
        req.context = { ...req.context, step: 2 };
        return req;
      });

      peer.addRequestInterceptor(interceptor1);
      peer.addRequestInterceptor(interceptor2);

      await peer.call('TestService', 'echo', [{}]);

      expect(interceptor1).toHaveBeenCalled();
      expect(interceptor2).toHaveBeenCalled();
    });
  });

  describe('Response Interceptors', () => {
    it('should apply response interceptor', async () => {
      const interceptor = jest.fn((res) => {
        res.data = { intercepted: true, original: res.data };
        return res;
      });

      peer.addResponseInterceptor(interceptor);

      const result = await peer.call('TestService', 'echo', [{ test: 'data' }]);

      expect(interceptor).toHaveBeenCalled();
      expect(result.intercepted).toBe(true);
    });

    it('should support async response interceptors', async () => {
      const interceptor = jest.fn(async (res) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        res.data = { async: true, data: res.data };
        return res;
      });

      peer.addResponseInterceptor(interceptor);

      const result = await peer.call('TestService', 'echo', [{}]);

      expect(interceptor).toHaveBeenCalled();
      expect(result.async).toBe(true);
    });

    it('should support multiple response interceptors', async () => {
      const interceptor1 = jest.fn((res) => {
        res.data = { step1: true, data: res.data };
        return res;
      });

      const interceptor2 = jest.fn((res) => {
        res.data = { step2: true, previous: res.data };
        return res;
      });

      peer.addResponseInterceptor(interceptor1);
      peer.addResponseInterceptor(interceptor2);

      const result = await peer.call('TestService', 'echo', [{}]);

      expect(interceptor1).toHaveBeenCalled();
      expect(interceptor2).toHaveBeenCalled();
      expect(result.step2).toBe(true);
    });
  });

  describe('Tracing Context', () => {
    it('should generate traceId and spanId', async () => {
      const requestCapture: any[] = [];

      peer.addRequestInterceptor((req) => {
        requestCapture.push(req);
        return req;
      });

      await peer.call('TestService', 'echo', [{}]);

      expect(requestCapture[0].context.traceId).toBeDefined();
      expect(requestCapture[0].context.spanId).toBeDefined();
    });

    it('should preserve existing traceId from headers', async () => {
      (peer as any).defaultOptions.headers = {
        'X-Trace-ID': 'existing-trace-123',
      };

      const requestCapture: any[] = [];
      peer.addRequestInterceptor((req) => {
        requestCapture.push(req);
        return req;
      });

      await peer.call('TestService', 'echo', [{}]);

      expect(requestCapture[0].context.traceId).toBe('existing-trace-123');
    });

    it('should extract userId and tenantId from headers', async () => {
      (peer as any).defaultOptions.headers = {
        'X-User-ID': 'user-123',
        'X-Tenant-ID': 'tenant-456',
      };

      const requestCapture: any[] = [];
      peer.addRequestInterceptor((req) => {
        requestCapture.push(req);
        return req;
      });

      await peer.call('TestService', 'echo', [{}]);

      expect(requestCapture[0].context.userId).toBe('user-123');
      expect(requestCapture[0].context.tenantId).toBe('tenant-456');
    });

    it('should extract metadata from custom headers', async () => {
      (peer as any).defaultOptions.headers = {
        'X-Meta-Environment': 'production',
        'X-Meta-Region': 'us-east-1',
      };

      const requestCapture: any[] = [];
      peer.addRequestInterceptor((req) => {
        requestCapture.push(req);
        return req;
      });

      await peer.call('TestService', 'echo', [{}]);

      expect(requestCapture[0].context.metadata.Environment).toBe('production');
      expect(requestCapture[0].context.metadata.Region).toBe('us-east-1');
    });
  });

  describe('Cache Manager Integration', () => {
    let cacheManager: HttpCacheManager;

    beforeEach(() => {
      cacheManager = new HttpCacheManager({ maxEntries: 100 });
      peer.setCacheManager(cacheManager);
    });

    it('should set cache manager', () => {
      expect(peer.getCacheManager()).toBe(cacheManager);
    });

    it('should use cache manager for fluent interface', async () => {
      const service = await peer.queryFluentInterface('TestService');
      expect(service).toBeDefined();
    });

    it('should handle cache hints from response', async () => {
      const requestCapture: any[] = [];
      peer.addRequestInterceptor((req) => {
        requestCapture.push(req);
        return req;
      });

      const responseCapture: any[] = [];
      peer.addResponseInterceptor((res) => {
        res.hints = {
          cache: {
            maxAge: 60000,
            tags: ['test'],
          },
        };
        responseCapture.push(res);
        return res;
      });

      await peer.call('TestService', 'echo', [{ test: 'cacheable' }]);

      expect(responseCapture[0].hints.cache).toBeDefined();
    });
  });

  describe('Retry Manager Integration', () => {
    let retryManager: RetryManager;

    beforeEach(() => {
      retryManager = new RetryManager({ maxAttempts: 3 });
      peer.setRetryManager(retryManager);
    });

    it('should set retry manager', () => {
      expect(peer.getRetryManager()).toBe(retryManager);
    });

    it('should use retry manager for fluent interface', async () => {
      const service = await peer.queryFluentInterface('TestService');
      expect(service).toBeDefined();
    });
  });

  describe('Global Options', () => {
    it('should set global query options', () => {
      const options = {
        cache: { maxAge: 60000 },
        retry: { attempts: 3 },
      };

      peer.setGlobalOptions(options);

      expect(peer.getGlobalOptions()).toEqual(options);
    });

    it('should use global options for fluent interface', async () => {
      peer.setGlobalOptions({
        cache: { maxAge: 30000 },
        retry: { attempts: 5 },
      });

      const service = await peer.queryFluentInterface('TestService');
      expect(service).toBeDefined();
    });

    it('should support method chaining', () => {
      const cacheManager = new HttpCacheManager();
      const retryManager = new RetryManager();

      const result = peer
        .setCacheManager(cacheManager)
        .setRetryManager(retryManager)
        .setGlobalOptions({ cache: { maxAge: 1000 } });

      expect(result).toBe(peer);
    });
  });

  describe('Service Interfaces', () => {
    it('should create standard HttpInterface', async () => {
      const service = await peer.queryInterface('TestService');
      expect(service).toBeDefined();
    });

    it('should create FluentInterface', async () => {
      const service = await peer.queryFluentInterface('TestService');
      expect(service).toBeDefined();
    });

    it('should cache interfaces by qualified name', async () => {
      const service1 = await peer.queryInterface('TestService');
      const service2 = await peer.queryInterface('TestService');

      // Should return same instance
      expect(service1).toBe(service2);
    });

    it('should increment refCount for cached interfaces', async () => {
      await peer.queryInterface('TestService');
      await peer.queryInterface('TestService');

      const iInfo = (peer as any).interfaces.get('TestService');
      expect(iInfo.refCount).toBe(2);
    });
  });

  describe('Definition Cache Invalidation', () => {
    beforeEach(async () => {
      // Create some cached interfaces
      await peer.queryInterface('TestService');
    });

    it('should invalidate all caches without pattern', () => {
      const count = peer.invalidateDefinitionCache();
      expect(count).toBeGreaterThan(0);
      expect((peer as any).interfaces.size).toBe(0);
    });

    it('should invalidate caches matching pattern', () => {
      const count = peer.invalidateDefinitionCache('Test*');
      expect(count).toBeGreaterThan(0);
    });

    it('should support exact match pattern', () => {
      const count = peer.invalidateDefinitionCache('TestService');
      expect(count).toBeGreaterThan(0);
    });

    it('should support wildcard patterns', () => {
      const count = peer.invalidateDefinitionCache('*Service');
      expect(count).toBeGreaterThan(0);
    });

    it('should not invalidate non-matching patterns', async () => {
      await peer.queryInterface('OtherService');

      const count = peer.invalidateDefinitionCache('Test*');

      // OtherService should still be cached
      const interfaces = (peer as any).interfaces;
      expect(interfaces.has('OtherService')).toBe(true);
    });
  });

  describe('Not Supported Operations', () => {
    it('should throw on property set', async () => {
      await expect(peer.set('service', 'property', 'value')).rejects.toThrow('not supported');
    });

    it('should throw on property get', async () => {
      await expect(peer.get('service', 'property')).rejects.toThrow('not supported');
    });

    it('should throw on subscribe', async () => {
      await expect(peer.subscribe('event', () => {})).rejects.toThrow('not supported');
    });

    it('should throw on unsubscribe', async () => {
      await expect(peer.unsubscribe('event', () => {})).rejects.toThrow('not supported');
    });

    it('should throw on exposeService', async () => {
      await expect(peer.exposeService({})).rejects.toThrow('not supported');
    });

    it('should throw on unexposeService', async () => {
      await expect(peer.unexposeService('service')).rejects.toThrow('not supported');
    });

    it('should throw on queryInterfaceRemote', async () => {
      await expect((peer as any).queryInterfaceRemote('service')).rejects.toThrow('not implemented');
    });

    it('should throw on getDefinitionById', () => {
      expect(() => (peer as any).getDefinitionById('def-id')).toThrow('not implemented');
    });

    it('should throw on getDefinitionByServiceName', () => {
      expect(() => (peer as any).getDefinitionByServiceName('service')).toThrow('not implemented');
    });
  });

  describe('Connection State', () => {
    it('should be connected by default', () => {
      expect(peer.isConnected).toBe(true);
    });

    it('should emit disconnect on close', async () => {
      let disconnected = false;
      (peer as any).events.on('disconnect', () => {
        disconnected = true;
      });

      await peer.close();

      expect(disconnected).toBe(true);
    });

    it('should clear caches on close', async () => {
      await peer.queryInterface('TestService');

      await peer.close();

      expect((peer as any).interfaces.size).toBe(0);
      expect((peer as any).services.size).toBe(0);
    });
  });

  describe('Service Names', () => {
    it('should return service names', () => {
      (peer as any).serviceNames.add('Service1');
      (peer as any).serviceNames.add('Service2');

      const names = peer.getServiceNames();
      expect(names).toContain('Service1');
      expect(names).toContain('Service2');
    });

    it('should return empty array when no services', () => {
      const names = peer.getServiceNames();
      expect(Array.isArray(names)).toBe(true);
      expect(names.length).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle HTTP 404 errors', async () => {
      await expect(peer.call('NonExistent', 'method', [{}])).rejects.toThrow();
    });

    it('should handle HTTP 500 errors', async () => {
      await expect(peer.call('TestService', 'error', [{}])).rejects.toThrow();
    });

    it('should handle network errors', async () => {
      // Close server to simulate network error
      await server.close();

      await expect(peer.call('TestService', 'echo', [{}])).rejects.toThrow();
    });

    it('should handle JSON parse errors', async () => {
      // Mock fetch to return invalid JSON
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      } as any);

      await expect(peer.call('TestService', 'echo', [{}])).rejects.toThrow();

      global.fetch = originalFetch;
    });
  });

  describe('Task Execution', () => {
    it('should execute system tasks', async () => {
      // Add system service to server
      const systemStub = {
        definition: {
          meta: {
            name: '__system',
            version: '1.0.0',
            methods: {
              ping: { name: 'ping' },
            },
          },
        },
        instance: {},
        call: jest.fn(async () => ({ pong: true })),
      };

      (server as any).services.set('__system', {
        name: '__system',
        version: '1.0.0',
        methods: new Map([
          [
            'ping',
            {
              name: 'ping',
              handler: async () => ({ pong: true }),
            },
          ],
        ]),
      });

      const result = await peer.executeTask('ping', {});
      expect(result.pong).toBe(true);
    });

    it('should handle task errors', async () => {
      await expect(peer.executeTask('nonExistent', {})).rejects.toThrow();
    });
  });
});
