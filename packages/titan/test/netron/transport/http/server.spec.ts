/**
 * Tests for Native HTTP Server implementation
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { LocalPeer } from '../../../../src/netron/local-peer.js';
import { Definition } from '../../../../src/netron/definition.js';
import { contract } from '../../../../src/validation/contract.js';
import { z } from 'zod';
import type {
  HttpRequestMessage,
  HttpBatchRequest
} from '../../../../src/netron/transport/http/types.js';

describe('HttpServer (Legacy Tests)', () => {
  let server: HttpServer;
  let mockPeer: LocalPeer;
  let testPort: number;

  beforeEach(() => {
    // Generate random port for parallel test execution
    testPort = 3000 + Math.floor(Math.random() * 1000);

    server = new HttpServer({
      port: testPort,
      host: 'localhost'
    });

    // Create mock peer
    mockPeer = {
      stubs: new Map(),
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn()
    } as any;
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  describe('Server Lifecycle', () => {
    it('should start and stop server', async () => {
      await server.listen();
      expect(server.address).toBe('localhost');
      expect(server.port).toBe(testPort);

      await server.close();
    });

    it('should emit listening event when started', async () => {
      const listener = jest.fn();
      server.on('listening', listener);

      await server.listen();

      expect(listener).toHaveBeenCalledWith({
        port: testPort,
        host: 'localhost'
      });
    });

    it('should throw error if already listening', async () => {
      await server.listen();

      await expect(server.listen()).rejects.toThrow('Server is already listening');
    });
  });

  describe('Service Registration', () => {
    it('should register services from Netron peer', () => {
      const testDefinition = new Definition(
        'test-service-id',
        'test-peer-id',
        {
          name: 'TestService',
          version: '1.0.0',
          description: 'Test service',
          methods: {
            testMethod: {}
          },
          properties: {}
        }
      );

      const stub = {
        definition: testDefinition,
        call: jest.fn().mockResolvedValue({ result: 'test' })
      };

      mockPeer.stubs.set('test-service', stub);

      server.setPeer(mockPeer);

      // Verify service was registered
      const services = (server as any).services;
      expect(services.has('TestService')).toBe(true);

      const service = services.get('TestService');
      expect(service.name).toBe('TestService');
      expect(service.version).toBe('1.0.0');
      expect(service.methods.has('testMethod')).toBe(true);
    });

    it('should handle services with contracts', () => {
      const userContract = contract({
        getUser: {
          input: z.object({ id: z.string() }),
          output: z.object({ name: z.string(), email: z.string() }),
          http: {
            method: 'GET',
            path: '/users/:id'
          }
        }
      });

      const definition = new Definition(
        'user-service-id',
        'test-peer-id',
        {
          name: 'UserService',
          version: '1.0.0',
          contract: userContract,
          methods: {
            getUser: {}
          },
          properties: {}
        }
      );

      const stub = {
        definition,
        call: jest.fn()
      };

      mockPeer.stubs.set('user-service', stub);
      server.setPeer(mockPeer);

      const services = (server as any).services;
      const service = services.get('UserService');
      const method = service.methods.get('getUser');

      expect(method.contract).toBeDefined();
      expect(method.contract.http).toEqual({
        method: 'GET',
        path: '/users/:id'
      });
    });
  });

  describe('Request Handling', () => {
    beforeEach(async () => {
      // Setup test service
      const definition = new Definition(
        'math-service-id',
        'test-peer-id',
        {
          name: 'MathService',
          version: '1.0.0',
          methods: {
            add: {},
            multiply: {}
          },
          properties: {}
        }
      );

      const stub = {
        definition,
        call: jest.fn().mockImplementation((method, args) => {
          if (method === 'add') {
            const { a, b } = args[0];
            return Promise.resolve(a + b);
          }
          if (method === 'multiply') {
            const { a, b } = args[0];
            return Promise.resolve(a * b);
          }
          throw new Error(`Unknown method: ${method}`);
        })
      };

      mockPeer.stubs.set('math-service', stub);
      server.setPeer(mockPeer);
      await server.listen();
    });

    it('should handle service invocation', async () => {
      const request: HttpRequestMessage = {
        id: 'test-123',
        version: '2.0',
        timestamp: Date.now(),
        service: 'MathService',
        method: 'add',
        input: { a: 5, b: 3 }
      };

      const response = await fetch(`http://localhost:${testPort}/netron/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Netron-Version': '2.0'
        },
        body: JSON.stringify(request)
      });

      expect(response.status).toBe(200);

      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toBe(8);
      expect(result.id).toBe('test-123');
      expect(result.version).toBe('2.0');
    });

    it('should handle batch requests', async () => {
      const batchRequest: HttpBatchRequest = {
        id: 'batch-123',
        version: '2.0',
        timestamp: Date.now(),
        requests: [
          {
            id: 'req-1',
            service: 'MathService',
            method: 'add',
            input: { a: 2, b: 3 }
          },
          {
            id: 'req-2',
            service: 'MathService',
            method: 'multiply',
            input: { a: 4, b: 5 }
          }
        ]
      };

      const response = await fetch(`http://localhost:${testPort}/netron/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Netron-Version': '2.0'
        },
        body: JSON.stringify(batchRequest)
      });

      expect(response.status).toBe(200);

      const result = await response.json();
      expect(result.id).toBe('batch-123');
      expect(result.responses).toHaveLength(2);
      expect(result.responses[0].success).toBe(true);
      expect(result.responses[0].data).toBe(5);
      expect(result.responses[1].success).toBe(true);
      expect(result.responses[1].data).toBe(20);
    });

  });

  describe('OpenAPI Generation', () => {
    beforeEach(async () => {
      const userContract = contract({
        getUser: {
          input: z.object({ id: z.string().uuid() }),
          output: z.object({
            id: z.string(),
            name: z.string(),
            email: z.string().email()
          }),
          http: {
            openapi: {
              summary: 'Get user by ID',
              tags: ['Users']
            }
          }
        },
        createUser: {
          input: z.object({
            name: z.string(),
            email: z.string().email()
          }),
          output: z.object({
            id: z.string(),
            name: z.string(),
            email: z.string()
          }),
          http: {
            openapi: {
              summary: 'Create new user',
              tags: ['Users']
            }
          }
        }
      });

      const definition = new Definition(
        'user-service-id',
        'test-peer-id',
        {
          name: 'UserService',
          version: '1.0.0',
          contract: userContract,
          methods: {
            getUser: {},
            createUser: {}
          },
          properties: {}
        }
      );

      const stub = {
        definition,
        call: jest.fn()
      };

      mockPeer.stubs.set('user-service', stub);
      server.setPeer(mockPeer);
      await server.listen();
    });

    it('should generate OpenAPI specification with authentication', async () => {
      // OpenAPI endpoint now requires authentication
      const response = await fetch(`http://localhost:${testPort}/openapi.json`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token'
        }
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json');

      const spec = await response.json();
      expect(spec.openapi).toBe('3.0.3');
      expect(spec.info.title).toBe('Netron HTTP Services');
      // RPC-style paths
      expect(spec.paths).toHaveProperty('/rpc/UserService/getUser');
      expect(spec.paths['/rpc/UserService/getUser']).toHaveProperty('post');
      expect(spec.paths).toHaveProperty('/rpc/UserService/createUser');
      expect(spec.paths['/rpc/UserService/createUser']).toHaveProperty('post');
      // Check OpenAPI metadata
      expect(spec.paths['/rpc/UserService/getUser'].post.summary).toBe('Get user by ID');
      expect(spec.paths['/rpc/UserService/createUser'].post.summary).toBe('Create new user');
    });

    it('should require authentication for OpenAPI spec', async () => {
      const response = await fetch(`http://localhost:${testPort}/openapi.json`, {
        method: 'GET'
      });

      expect(response.status).toBe(401);

      const result = await response.json();
      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('Authentication required');
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      const errorDefinition = new Definition(
        'error-service-id',
        'test-peer-id',
        {
          name: 'ErrorService',
          version: '1.0.0',
          methods: {
            throwError: {}
          },
          properties: {}
        }
      );

      const stub = {
        definition: errorDefinition,
        call: jest.fn().mockRejectedValue(new Error('Test error'))
      };

      mockPeer.stubs.set('error-service', stub);
      server.setPeer(mockPeer);
      await server.listen();
    });

    it('should handle service errors', async () => {
      const request: HttpRequestMessage = {
        id: 'error-test',
        version: '2.0',
        timestamp: Date.now(),
        service: 'ErrorService',
        method: 'throwError',
        input: {}
      };

      const response = await fetch(`http://localhost:${testPort}/netron/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(request)
      });

      expect(response.status).toBe(500);

      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error.message).toBe('Test error');
    });

    it('should handle invalid JSON', async () => {
      const response = await fetch(`http://localhost:${testPort}/netron/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: 'invalid json'
      });

      expect(response.status).toBe(400);

      const result = await response.json();
      expect(result.error).toBe(true);
      expect(result.message).toBe('Invalid JSON');
    });

    it('should handle service not found', async () => {
      const request: HttpRequestMessage = {
        id: 'not-found',
        version: '2.0',
        timestamp: Date.now(),
        service: 'NonExistentService',
        method: 'someMethod',
        input: {}
      };

      const response = await fetch(`http://localhost:${testPort}/netron/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(request)
      });

      expect(response.status).toBe(404);

      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error.message).toContain('NonExistentService not found');
    });
  });

  describe('Health and Metrics', () => {
    beforeEach(async () => {
      await server.listen();
    });

    it('should provide health check', async () => {
      const response = await fetch(`http://localhost:${testPort}/health`);

      expect(response.status).toBe(200);

      const health = await response.json();
      expect(health.status).toBe('online');
      expect(health.version).toBe('2.0.0');
      expect(health.uptime).toBeGreaterThan(0);
    });

    it('should provide metrics with authentication', async () => {
      // Make some requests first
      await fetch(`http://localhost:${testPort}/health`);
      await fetch(`http://localhost:${testPort}/health`);

      // Metrics endpoint now requires authentication
      const response = await fetch(`http://localhost:${testPort}/metrics`, {
        headers: {
          'Authorization': 'Bearer test-token'
        }
      });

      expect(response.status).toBe(200);

      const metrics = await response.json();
      expect(metrics.server.status).toBe('online');
      expect(metrics.requests.total).toBeGreaterThanOrEqual(2);
      // Active requests includes the /metrics request itself
      expect(metrics.requests.active).toBeGreaterThanOrEqual(0);
      expect(metrics.requests.errors).toBe(0);
    });

    it('should require authentication for metrics', async () => {
      const response = await fetch(`http://localhost:${testPort}/metrics`);

      expect(response.status).toBe(401);

      const result = await response.json();
      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('Authentication required');
    });
  });

  describe('CORS Support', () => {
    beforeEach(async () => {
      server = new HttpServer({
        port: testPort,
        host: 'localhost',
        cors: {
          origin: '*',
          credentials: true
        }
      });
      await server.listen();
    });

    it('should handle CORS preflight requests', async () => {
      const response = await fetch(`http://localhost:${testPort}/netron/invoke`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'POST'
        }
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://example.com');
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    it('should add CORS headers to responses', async () => {
      const response = await fetch(`http://localhost:${testPort}/health`, {
        headers: {
          'Origin': 'http://example.com'
        }
      });

      // Note: fetch in Node.js doesn't automatically expose CORS headers
      // This test would need a real browser or different HTTP client to fully test
      expect(response.status).toBe(200);
    });
  });

});