/**
 * Tests for HTTP Client Connection implementation
 * This test suite covers the HTTP client that makes HTTP requests
 * while maintaining the Netron service interface
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { z } from 'zod';
import { HttpClientConnection } from '../../../../src/netron/transport/http/http-client.js';
import { ConnectionState } from '../../../../src/netron/transport/types.js';
import { contract } from '../../../../src/validation/contract.js';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { Definition } from '../../../../src/netron/definition.js';
import { TYPE_CALL } from '../../../../src/netron/packet/index.js';

// Mock fetch globally for testing
global.fetch = jest.fn();

describe('HttpClientConnection', () => {
  let client: HttpClientConnection;
  const baseUrl = 'http://localhost:3000';
  const mockFetch = global.fetch as jest.Mock;

  beforeEach(() => {
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: {
        get: jest.fn((name: string) => {
          if (name === 'Content-Type') return 'application/json';
          return null;
        })
      },
      json: jest.fn().mockResolvedValue({ result: 'success' }),
      text: jest.fn().mockResolvedValue('text response'),
      blob: jest.fn().mockResolvedValue(new Blob())
    });

    client = new HttpClientConnection(baseUrl, {
      timeout: 5000,
      headers: { 'X-Api-Key': 'test123' }
    });
  });

  afterEach(() => {
    client.close();
  });

  describe('Connection Interface Implementation', () => {
    it('should implement ITransportConnection interface', () => {
      expect(client).toHaveProperty('id');
      expect(client).toHaveProperty('state');
      expect(client).toHaveProperty('send');
      expect(client).toHaveProperty('sendPacket');
      expect(client).toHaveProperty('close');
    });

    it('should extend EventEmitter', () => {
      expect(client).toBeInstanceOf(EventEmitter);
      expect(client.on).toBeDefined();
      expect(client.emit).toBeDefined();
    });

    it('should have unique connection ID', () => {
      const client2 = new HttpClientConnection(baseUrl);
      expect(client.id).toBeDefined();
      expect(client2.id).toBeDefined();
      expect(client.id).not.toBe(client2.id);
    });

    it('should be in CONNECTED state initially', () => {
      expect(client.state).toBe(ConnectionState.CONNECTED);
    });
  });

  describe('Service Registration', () => {
    it('should register service with REST endpoints from contract', () => {
      const userContract = contract({
        getUser: {
          input: z.object({ id: z.string() }),
          output: z.object({ id: z.string(), name: z.string() }),
          http: {
            method: 'GET',
            path: '/api/users/{id}'
          }
        },
        createUser: {
          input: z.object({ name: z.string(), email: z.string() }),
          output: z.object({ id: z.string() }),
          http: {
            method: 'POST',
            path: '/api/users',
            status: 201
          }
        }
      });

      const definition = new Definition(
        Definition.nextId(),
        'test-peer',
        {
          name: 'UserService',
          version: '1.0.0',
          properties: {},
          methods: {
            getUser: { name: 'getUser' },
            createUser: { name: 'createUser' }
          }
        }
      );

      client.registerService('UserService@1.0.0', definition, userContract);

      const routes = (client as any).serviceRoutes.get('UserService@1.0.0');
      expect(routes).toBeDefined();
      expect(routes.has('getUser')).toBe(true);
      expect(routes.has('createUser')).toBe(true);

      const getUserRoute = routes.get('getUser');
      expect(getUserRoute.method).toBe('GET');
      expect(getUserRoute.pattern).toBe('/api/users/{id}');
    });

    it('should create RPC endpoints for methods without HTTP metadata', () => {
      const calcContract = contract({
        add: {
          input: z.object({ a: z.number(), b: z.number() }),
          output: z.object({ result: z.number() })
        }
      });

      const definition = new Definition(
        Definition.nextId(),
        'test-peer',
        {
          name: 'Calculator',
          version: '1.0.0',
          properties: {},
          methods: {
            add: { name: 'add' }
          }
        }
      );

      client.registerService('Calculator@1.0.0', definition, calcContract);

      const routes = (client as any).serviceRoutes.get('Calculator@1.0.0');
      const addRoute = routes.get('add');
      expect(addRoute.method).toBe('POST');
      expect(addRoute.pattern).toBe('/rpc/add');
    });
  });

  describe('HTTP Request Building', () => {
    beforeEach(() => {
      const userContract = contract({
        getUser: {
          input: z.object({ id: z.string() }),
          output: z.object({ id: z.string(), name: z.string() }),
          http: {
            method: 'GET',
            path: '/api/users/{id}',
            params: z.object({ id: z.string() })
          }
        },
        listUsers: {
          input: z.object({ page: z.number(), limit: z.number() }),
          output: z.array(z.object({ id: z.string(), name: z.string() })),
          http: {
            method: 'GET',
            path: '/api/users',
            query: z.object({
              page: z.string().transform(Number),
              limit: z.string().transform(Number)
            })
          }
        },
        createUser: {
          input: z.object({ name: z.string(), email: z.string() }),
          output: z.object({ id: z.string() }),
          http: {
            method: 'POST',
            path: '/api/users'
          }
        },
        updateUser: {
          input: z.object({ id: z.string(), name: z.string(), email: z.string() }),
          output: z.object({ id: z.string(), name: z.string(), email: z.string() }),
          http: {
            method: 'PUT',
            path: '/api/users/{id}',
            params: z.object({ id: z.string() })
          }
        }
      });

      client.registerService('UserService@1.0.0', {
        name: 'UserService@1.0.0',
        contract: userContract,
        methods: ['getUser', 'listUsers', 'createUser', 'updateUser']
      });
    });

    it('should build GET request with path parameters', async () => {
      await client.callServiceMethod('UserService@1.0.0', 'getUser', [{ id: '123' }]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/users/123',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'X-Api-Key': 'test123'
          })
        })
      );
    });

    it('should build GET request with query parameters', async () => {
      await client.callServiceMethod('UserService@1.0.0', 'listUsers', [{ page: 1, limit: 10 }]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/users?page=1&limit=10',
        expect.objectContaining({
          method: 'GET'
        })
      );
    });

    it('should build POST request with JSON body', async () => {
      await client.callServiceMethod('UserService@1.0.0', 'createUser', [
        { name: 'Alice', email: 'alice@example.com' }
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/users',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Api-Key': 'test123'
          }),
          body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' })
        })
      );
    });

    it('should build PUT request with path params and body', async () => {
      await client.callServiceMethod('UserService@1.0.0', 'updateUser', [
        { id: '123', name: 'Bob', email: 'bob@example.com' }
      ]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/users/123',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ id: '123', name: 'Bob', email: 'bob@example.com' })
        })
      );
    });

    it('should handle colon-style path parameters', () => {
      const itemContract = contract({
        getItem: {
          input: z.object({ id: z.string() }),
          output: z.object({ id: z.string() }),
          http: {
            method: 'GET',
            path: '/api/items/:id'
          }
        }
      });

      client.registerService('ItemService@1.0.0', {
        name: 'ItemService@1.0.0',
        contract: itemContract,
        methods: ['getItem']
      });

      client.callServiceMethod('ItemService@1.0.0', 'getItem', [{ id: '456' }]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/items/456',
        expect.any(Object)
      );
    });
  });

  describe('Response Handling', () => {
    beforeEach(() => {
      const userContract = contract({
        getUser: {
          input: z.object({ id: z.string() }),
          output: z.object({ id: z.string(), name: z.string() }),
          http: {
            method: 'GET',
            path: '/api/users/{id}'
          }
        }
      });

      client.registerService('UserService@1.0.0', {
        name: 'UserService@1.0.0',
        contract: userContract,
        methods: ['getUser']
      });
    });

    it('should parse JSON responses', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: jest.fn((name: string) => {
            if (name === 'Content-Type') return 'application/json';
            return null;
          })
        },
        json: jest.fn().mockResolvedValue({ id: '123', name: 'John' })
      });

      const result = await client.callServiceMethod('UserService@1.0.0', 'getUser', [{ id: '123' }]);

      expect(result).toEqual({ id: '123', name: 'John' });
    });

    it('should handle error responses', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: {
          get: jest.fn((name: string) => {
            if (name === 'Content-Type') return 'application/json';
            return null;
          })
        },
        json: jest.fn().mockResolvedValue({ error: 'User not found' }),
        text: jest.fn().mockResolvedValue('Not Found')
      });

      await expect(
        client.callServiceMethod('UserService@1.0.0', 'getUser', [{ id: '999' }])
      ).rejects.toThrow('User not found');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(
        client.callServiceMethod('UserService@1.0.0', 'getUser', [{ id: '123' }])
      ).rejects.toThrow('Network error');
    });

    it('should handle non-JSON error responses', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: {
          get: jest.fn((name: string) => {
            if (name === 'Content-Type') return 'text/plain';
            return null;
          })
        },
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
        text: jest.fn().mockResolvedValue('Internal Server Error')
      });

      await expect(
        client.callServiceMethod('UserService@1.0.0', 'getUser', [{ id: '123' }])
      ).rejects.toThrow('HTTP 500 Internal Server Error');
    });
  });

  describe('RPC Fallback', () => {
    it('should use RPC endpoint for methods without HTTP metadata', async () => {
      const calcContract = contract({
        calculate: {
          input: z.object({ expression: z.string() }),
          output: z.object({ result: z.number() })
        }
      });

      client.registerService('Calculator@1.0.0', {
        name: 'Calculator@1.0.0',
        contract: calcContract,
        methods: ['calculate']
      });

      await client.callServiceMethod('Calculator@1.0.0', 'calculate', [{ expression: '2+2' }]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/rpc/calculate',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ expression: '2+2' })
        })
      );
    });

    it('should handle services without contracts', async () => {
      client.registerService('SimpleService@1.0.0', {
        name: 'SimpleService@1.0.0',
        methods: ['method1', 'method2']
      });

      await client.callServiceMethod('SimpleService@1.0.0', 'method1', [{ data: 'test' }]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/rpc/method1',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ data: 'test' })
        })
      );
    });
  });

  describe('Connection Lifecycle', () => {
    it('should emit connect event on creation', (done) => {
      const newClient = new HttpClientConnection(baseUrl);

      newClient.on('connect', () => {
        expect(newClient.state).toBe(ConnectionState.CONNECTED);
        done();
      });

      // HTTP connections are immediately "connected"
      newClient.emit('connect');
    });

    it('should close connection and update state', async () => {
      expect(client.state).toBe(ConnectionState.CONNECTED);

      await client.close();

      expect(client.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should emit disconnect event on close', (done) => {
      client.on('disconnect', () => {
        expect(client.state).toBe(ConnectionState.DISCONNECTED);
        done();
      });

      client.close();
    });

    it('should handle reconnection attempts', async () => {
      // HTTP is stateless, so "reconnection" is just ensuring the client can make requests again
      await client.close();
      expect(client.state).toBe(ConnectionState.DISCONNECTED);

      // Reconnect by resetting state
      await client.reconnect();
      expect(client.state).toBe(ConnectionState.CONNECTED);
    });
  });

  describe('Timeout Handling', () => {
    it('should timeout long-running requests', async () => {
      // Mock a slow response that checks for abort signal
      mockFetch.mockImplementation((url, options) =>
        new Promise((resolve, reject) => {
          const signal = options?.signal;

          if (signal?.aborted) {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
            return;
          }

          const timeoutId = setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              headers: {
                get: jest.fn((name: string) => {
                  if (name === 'Content-Type') return 'application/json';
                  return null;
                })
              },
              json: jest.fn().mockResolvedValue({ result: 'success' })
            });
          }, 10000); // Resolve after 10 seconds (way after timeout)

          // Listen for abort signal
          if (signal) {
            signal.addEventListener('abort', () => {
              clearTimeout(timeoutId);
              const error = new Error('Aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }
        })
      );

      const clientWithTimeout = new HttpClientConnection(baseUrl, {
        timeout: 100 // Very short timeout
      });

      clientWithTimeout.registerService('SlowService@1.0.0', {
        name: 'SlowService@1.0.0',
        methods: ['slowMethod']
      });

      await expect(
        clientWithTimeout.callServiceMethod('SlowService@1.0.0', 'slowMethod', [{}])
      ).rejects.toThrow(/timed out/i);
    });

    it('should respect per-request timeout', async () => {
      const quickContract = contract({
        quickMethod: {
          input: z.object({}),
          output: z.object({}),
          options: { timeout: 50 }
        }
      });

      client.registerService('TimeoutService@1.0.0', {
        name: 'TimeoutService@1.0.0',
        contract: quickContract,
        methods: ['quickMethod']
      });

      mockFetch.mockImplementation((url, options) =>
        new Promise((resolve, reject) => {
          const signal = options?.signal;

          if (signal?.aborted) {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
            return;
          }

          const timeoutId = setTimeout(() => {
            resolve({
              ok: true,
              status: 200,
              headers: {
                get: jest.fn((name: string) => {
                  if (name === 'Content-Type') return 'application/json';
                  return null;
                })
              },
              json: jest.fn().mockResolvedValue({ result: 'success' })
            });
          }, 200); // Longer than the per-request timeout

          // Listen for abort signal
          if (signal) {
            signal.addEventListener('abort', () => {
              clearTimeout(timeoutId);
              const error = new Error('Aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }
        })
      );

      await expect(
        client.callServiceMethod('TimeoutService@1.0.0', 'quickMethod', [{}])
      ).rejects.toThrow(/timed out/i);
    });
  });

  describe('Header Management', () => {
    it('should include custom headers from options', async () => {
      const clientWithHeaders = new HttpClientConnection(baseUrl, {
        headers: {
          'Authorization': 'Bearer token123',
          'X-Request-ID': 'req-456'
        }
      });

      clientWithHeaders.registerService('AuthService@1.0.0', {
        name: 'AuthService@1.0.0',
        methods: ['authenticate']
      });

      await clientWithHeaders.callServiceMethod('AuthService@1.0.0', 'authenticate', [{}]);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer token123',
            'X-Request-ID': 'req-456'
          })
        })
      );
    });

    it('should merge method-specific headers', async () => {
      const secureContract = contract({
        secureMethod: {
          input: z.object({}),
          output: z.object({}),
          http: {
            method: 'POST',
            path: '/secure',
            responseHeaders: {
              'X-Custom-Header': 'custom-value'
            }
          }
        }
      });

      client.registerService('SecureService@1.0.0', {
        name: 'SecureService@1.0.0',
        contract: secureContract,
        methods: ['secureMethod']
      });

      await client.callServiceMethod('SecureService@1.0.0', 'secureMethod', [{}]);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-Api-Key': 'test123' // From client options
          })
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should throw error for unregistered service', async () => {
      await expect(
        client.callServiceMethod('UnknownService@1.0.0', 'method', [{}])
      ).rejects.toThrow(/not found/i);
    });

    it('should throw error for unknown method', async () => {
      client.registerService('TestService@1.0.0', {
        name: 'TestService@1.0.0',
        methods: ['knownMethod']
      });

      await expect(
        client.callServiceMethod('TestService@1.0.0', 'unknownMethod', [{}])
      ).rejects.toThrow(/not found/i);
    });

    it('should handle malformed responses gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON'))
      });

      await expect(
        client.callServiceMethod('TestService@1.0.0', 'testMethod', [{}])
      ).rejects.toThrow();
    });
  });

  describe('Packet Protocol Support', () => {
    beforeEach(() => {
      // Register a service for packet tests
      const userContract = contract({
        getUser: {
          input: z.object({ id: z.string() }),
          output: z.object({ id: z.string(), name: z.string() }),
          http: {
            method: 'GET',
            path: '/api/users/{id}'
          }
        }
      });

      client.registerService('UserService@1.0.0', {
        name: 'UserService@1.0.0',
        contract: userContract,
        methods: ['getUser']
      });
    });

    it.skip('should send packets via HTTP', async () => {
      // Import createPacket function
      const { createPacket } = await import('../../../../src/netron/packet/index.js');

      // Check that routes are registered
      const routes = (client as any).serviceRoutes.get('UserService@1.0.0');
      expect(routes).toBeDefined();
      expect(routes.has('getUser')).toBe(true);

      const packet = createPacket(123, 1, TYPE_CALL, {
        service: 'UserService@1.0.0',
        method: 'getUser',
        args: [{ id: '456' }]
      });

      await client.sendPacket(packet);

      // The packet should be converted to appropriate HTTP request
      expect(mockFetch).toHaveBeenCalled();
    });

    it.skip('should handle raw data sending', async () => {
      // Register a service first
      client.registerService('TestService@1.0.0', {
        name: 'TestService@1.0.0',
        contract: contract({
          testMethod: {
            input: z.object({ value: z.number() }),
            output: z.object({ result: z.number() }),
            http: {
              method: 'POST',
              path: '/api/test'
            }
          }
        }),
        methods: ['testMethod']
      });

      // Import createPacket and encodePacket from packet module
      const { createPacket, encodePacket } = await import('../../../../src/netron/packet/index.js');

      // Create a proper packet for method call
      const packet = createPacket(456, 1, TYPE_CALL, {
        service: 'TestService@1.0.0',
        method: 'testMethod',
        args: [{ value: 42 }]
      });

      const encodedPacket = encodePacket(packet);

      await client.send(encodedPacket);

      // Now it should decode packet and make HTTP request
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});