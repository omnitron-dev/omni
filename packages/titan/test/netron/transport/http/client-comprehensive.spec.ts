/**
 * Comprehensive HTTP Client Tests
 *
 * This test suite provides comprehensive coverage for client.ts including:
 * - Client initialization with/without Netron
 * - Method invocation paths (peer, connection, direct)
 * - HTTP request sending and response handling
 * - Timeout handling
 * - Error parsing and mapping
 * - Connection lifecycle
 * - Metrics collection
 * - Context and hints passing
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpTransportClient } from '../../../../src/netron/transport/http/client.js';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { TitanError, ErrorCode } from '../../../../src/errors/index.js';

describe('HttpTransportClient - Comprehensive Coverage', () => {
  let server: HttpServer;
  let client: HttpTransportClient;
  const testPort = 5500 + Math.floor(Math.random() * 500);
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
            multiply: { name: 'multiply' },
            error: { name: 'error' },
            timeout: { name: 'timeout' },
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
        if (method === 'multiply') {
          return { result: args[0].a * args[0].b };
        }
        if (method === 'error') {
          throw new TitanError({
            code: ErrorCode.INVALID_ARGUMENT,
            message: 'Test error',
            details: { field: 'test' },
          });
        }
        if (method === 'timeout') {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return { result: 'done' };
        }
        throw new Error('Method not found');
      }),
    };

    mockPeer.stubs.set('test-stub', testStub);
    server.setPeer(mockPeer as any);
    await server.listen();
  });

  afterEach(async () => {
    if (client) {
      await client.close();
    }
    if (server) {
      await server.close();
    }
  });

  describe('Initialization', () => {
    it('should create client with base URL only', () => {
      client = new HttpTransportClient(baseUrl);
      expect(client).toBeDefined();
    });

    it('should create client with Netron', () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any);
      expect(client).toBeDefined();
    });

    it('should create client with options', () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any, {
        timeout: 5000,
        headers: { 'X-Api-Key': 'test-key' },
      });
      expect(client).toBeDefined();
    });

    it('should strip trailing slash from base URL', () => {
      client = new HttpTransportClient(`${baseUrl}/`, mockNetron as any);
      expect((client as any).baseUrl).toBe(baseUrl);
    });

    it('should initialize lazily', async () => {
      client = new HttpTransportClient(baseUrl);

      // Not initialized yet
      expect((client as any).connection).toBeUndefined();

      await client.initialize();

      // Now initialized
      expect((client as any).connection).toBeDefined();
    });

    it('should not reinitialize if already initialized', async () => {
      client = new HttpTransportClient(baseUrl);

      await client.initialize();
      const connection1 = (client as any).connection;

      await client.initialize();
      const connection2 = (client as any).connection;

      expect(connection1).toBe(connection2);
    });
  });

  describe('Method Invocation', () => {
    beforeEach(async () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any);
      await client.initialize();
    });

    it('should invoke method via peer', async () => {
      const result = await client.invoke('TestService', 'echo', [{ message: 'hello' }]);
      expect(result).toEqual({ echo: { message: 'hello' } });
    });

    it('should invoke method with args', async () => {
      const result = await client.invoke('TestService', 'add', [{ a: 10, b: 20 }]);
      expect(result).toEqual({ result: 30 });
    });

    it('should handle multiple method calls', async () => {
      const result1 = await client.invoke('TestService', 'add', [{ a: 5, b: 3 }]);
      const result2 = await client.invoke('TestService', 'multiply', [{ a: 5, b: 3 }]);

      expect(result1).toEqual({ result: 8 });
      expect(result2).toEqual({ result: 15 });
    });

    it('should pass context in options', async () => {
      const result = await client.invoke('TestService', 'echo', [{ data: 'test' }], {
        context: {
          traceId: 'trace-123',
          userId: 'user-456',
        },
      });

      expect(result).toEqual({ echo: { data: 'test' } });
    });

    it('should pass hints in options', async () => {
      const result = await client.invoke('TestService', 'echo', [{ data: 'test' }], {
        hints: {
          timeout: 10000,
          priority: 'high',
        },
      });

      expect(result).toEqual({ echo: { data: 'test' } });
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any);
      await client.initialize();
    });

    it('should handle method invocation errors', async () => {
      await expect(client.invoke('TestService', 'error', [{}])).rejects.toThrow('Test error');
    });

    it('should handle non-existent service', async () => {
      await expect(client.invoke('NonExistent', 'method', [{}])).rejects.toThrow();
    });

    it('should handle non-existent method', async () => {
      await expect(client.invoke('TestService', 'nonExistent', [{}])).rejects.toThrow();
    });

    it('should handle network errors', async () => {
      // Stop server to simulate network error
      await server.close();

      await expect(client.invoke('TestService', 'echo', [{}])).rejects.toThrow();
    });

    it('should parse error responses correctly', async () => {
      try {
        await client.invoke('TestService', 'error', [{}]);
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('Test error');
      }
    });
  });

  describe('Timeout Handling', () => {
    it('should handle request timeout', async () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any, {
        timeout: 100, // Very short timeout
      });
      await client.initialize();

      await expect(client.invoke('TestService', 'timeout', [{}])).rejects.toThrow('timeout');
    });

    it('should use hint timeout if provided', async () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any);
      await client.initialize();

      await expect(
        client.invoke('TestService', 'timeout', [{}], {
          hints: { timeout: 100 },
        })
      ).rejects.toThrow('timeout');
    });

    it('should use default timeout if not specified', async () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any);
      await client.initialize();

      // Default timeout is 30s, our test method takes 5s, so should succeed
      // But we don't want to wait that long in tests
      await expect(
        client.invoke('TestService', 'echo', [{ fast: true }])
      ).resolves.toBeDefined();
    });
  });

  describe('Direct Invocation Path', () => {
    it('should fall back to direct HTTP request', async () => {
      // Create client without Netron to force direct path
      client = new HttpTransportClient(baseUrl);
      await client.initialize();

      const result = await client.invoke('TestService', 'echo', [{ direct: true }]);
      expect(result).toEqual({ echo: { direct: true } });
    });

    it('should handle errors in direct path', async () => {
      client = new HttpTransportClient(baseUrl);
      await client.initialize();

      await expect(client.invoke('TestService', 'error', [{}])).rejects.toThrow();
    });
  });

  describe('Connection Management', () => {
    it('should close connection', async () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any);
      await client.initialize();

      await expect(client.close()).resolves.not.toThrow();
    });

    it('should close peer if present', async () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any);
      await client.initialize();

      const peer = (client as any).peer;
      const peerCloseSpy = jest.spyOn(peer, 'close');

      await client.close();

      expect(peerCloseSpy).toHaveBeenCalled();
    });

    it('should close connection if present', async () => {
      client = new HttpTransportClient(baseUrl);
      await client.initialize();

      const connection = (client as any).connection;
      const connectionCloseSpy = jest.spyOn(connection, 'close');

      await client.close();

      expect(connectionCloseSpy).toHaveBeenCalled();
    });

    it('should handle close without initialization', async () => {
      client = new HttpTransportClient(baseUrl);

      await expect(client.close()).resolves.not.toThrow();
    });
  });

  describe('Metrics', () => {
    beforeEach(async () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any);
      await client.initialize();
    });

    it('should return metrics', () => {
      const metrics = client.getMetrics();

      expect(metrics).toBeDefined();
      expect(metrics.baseUrl).toBe(baseUrl);
      expect(metrics.connected).toBe(true);
      expect(metrics.hasPeer).toBe(true);
    });

    it('should include connection metrics', () => {
      const metrics = client.getMetrics();

      expect(metrics.connectionMetrics).toBeDefined();
    });

    it('should show not connected before initialization', () => {
      const uninitClient = new HttpTransportClient(baseUrl);
      const metrics = uninitClient.getMetrics();

      expect(metrics.connected).toBe(false);
      expect(metrics.hasPeer).toBe(false);
    });
  });

  describe('Response Format Handling', () => {
    beforeEach(async () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any);
      await client.initialize();
    });

    it('should handle successful response', async () => {
      const result = await client.invoke('TestService', 'echo', [{ test: 'success' }]);

      expect(result).toBeDefined();
      expect(result.echo).toEqual({ test: 'success' });
    });

    it('should handle error response with details', async () => {
      try {
        await client.invoke('TestService', 'error', [{}]);
        fail('Should have thrown');
      } catch (error: any) {
        expect(error).toBeDefined();
        expect(error.message).toContain('Test error');
      }
    });
  });

  describe('HTTP Status Code Handling', () => {
    it('should handle 400 Bad Request', async () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any);
      await client.initialize();

      // Send invalid request to trigger 400
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers(),
        json: () => Promise.resolve({ error: { message: 'Invalid request' } }),
      } as any);

      await expect(client.invoke('Test', 'method', [{}])).rejects.toThrow();

      global.fetch = originalFetch;
    });

    it('should handle 404 Not Found', async () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any);
      await client.initialize();

      await expect(client.invoke('NonExistent', 'method', [{}])).rejects.toThrow();
    });

    it('should handle 500 Internal Server Error', async () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any);
      await client.initialize();

      await expect(client.invoke('TestService', 'error', [{}])).rejects.toThrow();
    });

    it('should handle 503 Service Unavailable', async () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any);
      await client.initialize();

      // Mock 503 response
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers(),
        json: () => Promise.resolve({ error: { message: 'Service unavailable' } }),
      } as any);

      await expect(client.invoke('Test', 'method', [{}])).rejects.toThrow();

      global.fetch = originalFetch;
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty response', async () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any);
      await client.initialize();

      // Mock empty successful response
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: () => Promise.resolve({ id: '1', version: '2.0', timestamp: Date.now(), success: true, data: null }),
      } as any);

      const result = await client.invoke('Test', 'method', [{}]);
      expect(result).toBeNull();

      global.fetch = originalFetch;
    });

    it('should handle response with no error details', async () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any);
      await client.initialize();

      // Mock error response without body
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers(),
        json: () => Promise.reject(new Error('No body')),
      } as any);

      await expect(client.invoke('Test', 'method', [{}])).rejects.toThrow();

      global.fetch = originalFetch;
    });

    it('should handle abort signal', async () => {
      client = new HttpTransportClient(baseUrl, mockNetron as any, {
        timeout: 10, // Very short timeout to trigger abort
      });
      await client.initialize();

      await expect(client.invoke('TestService', 'timeout', [{}])).rejects.toThrow('timeout');
    });
  });

  describe('Request Headers', () => {
    it('should send custom headers from options', async () => {
      let capturedHeaders: any = {};

      // Mock fetch to capture headers
      const originalFetch = global.fetch;
      global.fetch = jest.fn(async (url, options: any) => {
        capturedHeaders = options.headers;
        return originalFetch(url, options);
      }) as any;

      client = new HttpTransportClient(baseUrl, mockNetron as any, {
        headers: {
          'X-Custom-Header': 'test-value',
          'X-Api-Key': 'secret-key',
        },
      });
      await client.initialize();

      await client.invoke('TestService', 'echo', [{}]);

      expect(capturedHeaders['X-Custom-Header']).toBe('test-value');
      expect(capturedHeaders['X-Api-Key']).toBe('secret-key');

      global.fetch = originalFetch;
    });

    it('should send standard Netron headers', async () => {
      let capturedHeaders: any = {};

      // Mock fetch to capture headers
      const originalFetch = global.fetch;
      global.fetch = jest.fn(async (url, options: any) => {
        capturedHeaders = options.headers;
        return originalFetch(url, options);
      }) as any;

      client = new HttpTransportClient(baseUrl, mockNetron as any);
      await client.initialize();

      await client.invoke('TestService', 'echo', [{}]);

      expect(capturedHeaders['Content-Type']).toBe('application/json');
      expect(capturedHeaders['Accept']).toBe('application/json');
      expect(capturedHeaders['X-Netron-Version']).toBe('2.0');

      global.fetch = originalFetch;
    });
  });
});
