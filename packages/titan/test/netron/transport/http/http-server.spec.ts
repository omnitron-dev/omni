/**
 * Tests for HTTP Server implementation
 * This test suite covers the HTTP server that handles incoming requests
 * and routes them to Netron services
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { z } from 'zod';
import { HttpServer } from '../../../../src/netron/transport/http/http-server.js';
import { ITransportServer, ITransportConnection, ConnectionState } from '../../../../src/netron/transport/types.js';
import { contract } from '../../../../src/validation/contract.js';
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { LocalPeer } from '../../../../src/netron/local-peer.js';
import { Definition } from '../../../../src/netron/definition.js';

describe('HttpServer', () => {
  let server: HttpServer;
  let mockPeer: any;
  const testPort = 3456;

  beforeEach(() => {
    // Create mock stubs for services
    const userServiceStub = {
      call: jest.fn(),
      definition: {
        meta: {
          name: 'UserService@1.0.0'
        }
      }
    };

    const simpleServiceStub = {
      call: jest.fn(),
      definition: {
        meta: {
          name: 'SimpleService@1.0.0'
        }
      }
    };

    mockPeer = {
      stubs: new Map([
        ['UserService@1.0.0', userServiceStub],
        ['SimpleService@1.0.0', simpleServiceStub]
      ]),
      hasService: jest.fn(),
      getService: jest.fn(),
      // Add a helper method for tests to easily mock service calls
      callServiceMethod: jest.fn((serviceName, methodName, input) => {
        const stub = mockPeer.stubs.get(serviceName);
        if (stub) {
          return stub.call(methodName, [input], mockPeer);
        }
        throw new Error(`Service ${serviceName} not found`);
      })
    };

    server = new HttpServer({
      port: testPort,
      host: 'localhost'
    });

    // Inject mock peer
    (server as any).netronPeer = mockPeer;
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  describe('Server Interface Implementation', () => {
    it('should implement ITransportServer interface', () => {
      expect(server).toHaveProperty('address');
      expect(server).toHaveProperty('port');
      expect(server).toHaveProperty('connections');
      expect(server).toHaveProperty('listen');
      expect(server).toHaveProperty('close');
      expect(server).toHaveProperty('broadcast');
    });

    it('should extend EventEmitter', () => {
      expect(server).toBeInstanceOf(EventEmitter);
      expect(server.on).toBeDefined();
      expect(server.emit).toBeDefined();
    });

    it('should have empty connections map initially', () => {
      expect(server.connections).toBeInstanceOf(Map);
      expect(server.connections.size).toBe(0);
    });
  });

  describe('Service Registration', () => {
    it('should register service routes from contract', () => {
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
        createUser: {
          input: z.object({ name: z.string(), email: z.string() }),
          output: z.object({ id: z.string() }),
          http: {
            method: 'POST',
            path: '/api/users',
            status: 201
          }
        },
        deleteUser: {
          input: z.object({ id: z.string() }),
          output: z.object({ success: z.boolean() }),
          // No HTTP metadata - should create RPC endpoint
        }
      });

      const definition = new Definition(
        Definition.nextId(),
        'test-peer-id',
        {
          name: 'UserService@1.0.0',
          version: '1.0.0',
          properties: {},
          methods: {
            getUser: { name: 'getUser' },
            createUser: { name: 'createUser' },
            deleteUser: { name: 'deleteUser' }
          }
        }
      );

      server.registerService('UserService@1.0.0', definition, userContract);

      // Check REST routes
      const routes = (server as any).routes;
      expect(routes.has('GET:/api/users/{id}')).toBe(true);
      expect(routes.has('POST:/api/users')).toBe(true);

      // Check RPC routes (fallback for methods without HTTP metadata)
      expect(routes.has('POST:/rpc/getUser')).toBe(true);
      expect(routes.has('POST:/rpc/createUser')).toBe(true);
      expect(routes.has('POST:/rpc/deleteUser')).toBe(true);
    });

    it('should handle services without contracts', () => {
      const definition = new Definition(
        Definition.nextId(),
        'test-peer-id',
        {
          name: 'SimpleService@1.0.0',
          version: '1.0.0',
          properties: {},
          methods: {
            method1: { name: 'method1' },
            method2: { name: 'method2' }
          }
        }
      );

      server.registerService('SimpleService@1.0.0', definition);

      // Should create RPC endpoints for all methods
      const routes = (server as any).routes;
      expect(routes.has('POST:/rpc/method1')).toBe(true);
      expect(routes.has('POST:/rpc/method2')).toBe(true);
    });
  });

  describe('Route Matching', () => {
    beforeEach(() => {
      const userContract = contract({
        getUser: {
          input: z.object({ id: z.string() }),
          output: z.object({ id: z.string(), name: z.string() }),
          http: {
            method: 'GET',
            path: '/api/users/{id}'
          }
        },
        listUsers: {
          input: z.object({ page: z.number(), limit: z.number() }),
          output: z.array(z.object({ id: z.string(), name: z.string() })),
          http: {
            method: 'GET',
            path: '/api/users'
          }
        }
      });

      server.registerService('UserService@1.0.0', {
        name: 'UserService@1.0.0',
        contract: userContract,
        methods: ['getUser', 'listUsers']
      });
    });

    it('should match exact paths', () => {
      const route = (server as any).findRoute('GET:/api/users', '/api/users');
      expect(route).toBeDefined();
      expect(route.methodName).toBe('listUsers');
    });

    it('should match parameterized paths', () => {
      const route = (server as any).findRoute('GET:/api/users/123', '/api/users/123');
      expect(route).toBeDefined();
      expect(route.methodName).toBe('getUser');
    });

    it('should extract path parameters', () => {
      const params = (server as any).extractPathParams('/api/users/{id}', '/api/users/123');
      expect(params).toEqual({ id: '123' });

      const params2 = (server as any).extractPathParams('/api/users/{userId}/posts/{postId}', '/api/users/456/posts/789');
      expect(params2).toEqual({ userId: '456', postId: '789' });
    });

    it('should handle colon-style parameters', () => {
      const params = (server as any).extractPathParams('/api/users/:id', '/api/users/123');
      expect(params).toEqual({ id: '123' });
    });

    it('should return null for non-matching routes', () => {
      const route = (server as any).findRoute('POST:/api/unknown', '/api/unknown');
      expect(route).toBeNull();
    });
  });

  describe('Request Handling', () => {
    beforeEach(() => {
      // Register services for request handling tests
      const userContract = contract({
        getUser: {
          input: z.object({ id: z.string() }),
          output: z.object({ id: z.string(), name: z.string() }),
          http: {
            method: 'GET',
            path: '/api/users/{id}'
          }
        },
        listUsers: {
          input: z.object({ page: z.string().optional(), limit: z.string().optional() }),
          output: z.array(z.object({ id: z.string(), name: z.string() })),
          http: {
            method: 'GET',
            path: '/api/users'
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
        },
        deleteUser: {
          input: z.object({ id: z.string() }),
          output: z.object({ success: z.boolean() }),
          // No HTTP metadata - should create RPC endpoint
        }
      });

      server.registerService('UserService@1.0.0', {
        name: 'UserService@1.0.0',
        contract: userContract,
        methods: ['getUser', 'listUsers', 'createUser', 'deleteUser']
      });

      // Also register SimpleService for RPC tests
      server.registerService('SimpleService@1.0.0', {
        name: 'SimpleService@1.0.0',
        methods: ['simpleMethod']
      });
    });

    it('should handle GET requests with query parameters', async () => {
      const userStub = mockPeer.stubs.get('UserService@1.0.0');
      userStub.call.mockResolvedValue([{ id: '1', name: 'John' }]);

      const request = new Request('http://localhost:3456/api/users?page=1&limit=10', {
        method: 'GET'
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(200);
      expect(userStub.call).toHaveBeenCalledWith(
        'listUsers',
        [expect.objectContaining({
          page: '1',
          limit: '10'
        })],
        mockPeer
      );
    });

    it('should handle POST requests with JSON body', async () => {
      const userStub = mockPeer.stubs.get('UserService@1.0.0');
      userStub.call.mockResolvedValue({ id: '123' });

      const request = new Request('http://localhost:3456/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' })
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(201); // Custom status from HTTP metadata
      expect(userStub.call).toHaveBeenCalledWith(
        'createUser',
        [expect.objectContaining({
          name: 'Alice',
          email: 'alice@example.com'
        })],
        mockPeer
      );
    });

    it('should handle path parameters', async () => {
      const userStub = mockPeer.stubs.get('UserService@1.0.0');
      userStub.call.mockResolvedValue({ id: '123', name: 'John' });

      const request = new Request('http://localhost:3456/api/users/123', {
        method: 'GET'
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(200);
      expect(userStub.call).toHaveBeenCalledWith(
        'getUser',
        [expect.objectContaining({ id: '123' })],
        mockPeer
      );
    });

    it('should handle RPC-style endpoints', async () => {
      const userStub = mockPeer.stubs.get('UserService@1.0.0');
      userStub.call.mockResolvedValue({ success: true });

      const request = new Request('http://localhost:3456/rpc/deleteUser', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: '123' })
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(200);
      expect(userStub.call).toHaveBeenCalledWith(
        'deleteUser',
        [expect.objectContaining({ id: '123' })],
        mockPeer
      );
    });

    it('should return 404 for unknown routes', async () => {
      const request = new Request('http://localhost:3456/api/unknown', {
        method: 'GET'
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBeDefined();
    });

    it('should handle service errors', async () => {
      const userStub = mockPeer.stubs.get('UserService@1.0.0');
      userStub.call.mockRejectedValue(new Error('Service error'));

      const request = new Request('http://localhost:3456/api/users/123', {
        method: 'GET'
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBeDefined();
      expect(body.message).toContain('Service error');
    });
  });

  describe('CORS Handling', () => {
    it('should handle OPTIONS preflight requests', async () => {
      const request = new Request('http://localhost:3456/api/users', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'POST'
        }
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeDefined();
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('should add CORS headers to responses', async () => {
      const userStub = mockPeer.stubs.get('UserService@1.0.0');
      userStub.call.mockResolvedValue({ id: '123', name: 'John' });

      const request = new Request('http://localhost:3456/api/users/123', {
        method: 'GET',
        headers: { 'Origin': 'http://example.com' }
      });

      const response = await server.handleRequest(request);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeDefined();
    });

    it('should support configurable CORS options', () => {
      const serverWithCors = new HttpServer({
        port: 3457,
        cors: {
          origin: 'http://trusted.com',
          credentials: true,
          methods: ['GET', 'POST']
        }
      });

      const corsOptions = (serverWithCors as any).corsOptions;
      expect(corsOptions.origin).toBe('http://trusted.com');
      expect(corsOptions.credentials).toBe(true);
    });
  });

  describe('Server Lifecycle', () => {
    beforeEach(() => {
      // Register SimpleService for RPC tests
      server.registerService('SimpleService@1.0.0', {
        name: 'SimpleService@1.0.0',
        methods: ['simpleMethod']
      });
    });
    it('should start listening on specified port', async () => {
      await server.listen();
      expect(server.port).toBe(testPort);
      expect((server as any).server).toBeDefined();
    });

    it.skip('should emit connection event for incoming requests', async () => {
      const connectionHandler = jest.fn();
      server.on('connection', connectionHandler);

      await server.listen();

      const request = new Request(`http://localhost:${testPort}/api/test`, {
        method: 'GET'
      });

      await server.handleRequest(request);

      // HTTP doesn't maintain persistent connections, but we emit for each request
      expect(connectionHandler).toHaveBeenCalled();
    });

    it('should close server and cleanup', async () => {
      await server.listen();
      expect((server as any).server).toBeDefined();

      await server.close();
      expect((server as any).server).toBeNull();
    });

    it('should handle multiple concurrent requests', async () => {
      // Setup stub for SimpleService
      const simpleStub = mockPeer.stubs.get('SimpleService@1.0.0');
      simpleStub.call.mockImplementation((method, [input]) => {
        return Promise.resolve({ echo: input });
      });

      await server.listen();

      const requests = Array.from({ length: 10 }, (_, i) =>
        server.handleRequest(
          new Request(`http://localhost:${testPort}/rpc/simpleMethod`, {
            method: 'POST',
            body: JSON.stringify({ value: i })
          })
        )
      );

      const responses = await Promise.all(requests);

      expect(responses).toHaveLength(10);
      responses.forEach((response, i) => {
        expect(response.status).toBe(200);
      });
    });
  });

  describe('Content Type Handling', () => {
    beforeEach(() => {
      // Register SimpleService for RPC tests
      server.registerService('SimpleService@1.0.0', {
        name: 'SimpleService@1.0.0',
        methods: ['simpleMethod']
      });
    });
    it('should handle application/json content type', async () => {
      // Use SimpleService stub for generic RPC calls
      const simpleStub = mockPeer.stubs.get('SimpleService@1.0.0');
      simpleStub.call.mockResolvedValue({ result: 'ok' });

      const request = new Request('http://localhost:3456/rpc/simpleMethod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'test' })
      });

      const response = await server.handleRequest(request);
      expect(response.headers.get('Content-Type')).toContain('application/json');
    });

    it('should handle form data', async () => {
      // Use SimpleService stub for generic RPC calls
      const simpleStub = mockPeer.stubs.get('SimpleService@1.0.0');
      simpleStub.call.mockResolvedValue({ result: 'ok' });

      const formData = new URLSearchParams();
      formData.append('name', 'John');
      formData.append('email', 'john@example.com');

      const request = new Request('http://localhost:3456/rpc/simpleMethod', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString()
      });

      const response = await server.handleRequest(request);
      expect(response.status).toBe(200);
      expect(simpleStub.call).toHaveBeenCalledWith(
        'simpleMethod',
        [expect.objectContaining({
          name: 'John',
          email: 'john@example.com'
        })],
        mockPeer
      );
    });

    it('should set custom content type from HTTP metadata', async () => {
      const dataContract = contract({
        getData: {
          input: z.object({ format: z.string() }),
          output: z.string(),
          http: {
            method: 'GET',
            path: '/data',
            contentType: 'text/plain'
          }
        }
      });

      server.registerService('DataService@1.0.0', {
        name: 'DataService@1.0.0',
        contract: dataContract,
        methods: ['getData']
      });

      // Setup DataService stub
      const dataServiceStub = {
        call: jest.fn(),
        definition: {
          meta: {
            name: 'DataService@1.0.0'
          }
        }
      };
      mockPeer.stubs.set('DataService@1.0.0', dataServiceStub);
      dataServiceStub.call.mockResolvedValue('Plain text response');

      const request = new Request('http://localhost:3456/data?format=text', {
        method: 'GET'
      });

      const response = await server.handleRequest(request);
      expect(response.headers.get('Content-Type')).toBe('text/plain');
    });
  });

  describe('Metrics and Monitoring', () => {
    beforeEach(() => {
      // Register UserService for error rate test
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

      server.registerService('UserService@1.0.0', {
        name: 'UserService@1.0.0',
        contract: userContract,
        methods: ['getUser']
      });
    });
    it('should track request metrics', async () => {
      await server.listen();

      const metricsBegin = server.getMetrics?.();
      const initialRequests = metricsBegin?.totalConnections || 0;

      // Make some requests
      await server.handleRequest(new Request('http://localhost:3456/api/test', { method: 'GET' }));
      await server.handleRequest(new Request('http://localhost:3456/api/test', { method: 'POST', body: '{}' }));

      const metrics = server.getMetrics?.();
      expect(metrics?.totalConnections).toBe(initialRequests + 2);
    });

    it('should track error rates', async () => {
      const userStub = mockPeer.stubs.get('UserService@1.0.0');
      userStub.call.mockRejectedValue(new Error('Test error'));

      const request = new Request('http://localhost:3456/api/users/123', {
        method: 'GET'
      });

      await server.handleRequest(request);

      const metrics = server.getMetrics?.();
      expect(metrics?.errorRate).toBeGreaterThan(0);
    });
  });
});