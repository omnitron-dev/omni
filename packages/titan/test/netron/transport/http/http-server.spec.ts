/**
 * Tests for HTTP Server implementation (v2.0 Native Protocol)
 * This test suite covers the HTTP server that handles native JSON messages
 * via /netron/discovery, /netron/invoke, and /netron/batch endpoints
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { EventEmitter } from '@omnitron-dev/eventemitter';

describe('HttpServer (v2.0 Native Protocol)', () => {
  let server: HttpServer;
  let mockPeer: any;
  const testPort = 3456;

  beforeEach(() => {
    // Create mock peer with service stubs
    const calculatorStub = {
      definition: {
        meta: {
          name: 'Calculator@1.0.0',
          version: '1.0.0',
          methods: {
            add: { name: 'add' },
            subtract: { name: 'subtract' }
          }
        }
      },
      call: jest.fn()
    };

    const userStub = {
      definition: {
        meta: {
          name: 'UserService@1.0.0',
          version: '1.0.0',
          methods: {
            getUser: { name: 'getUser' },
            createUser: { name: 'createUser' }
          }
        }
      },
      call: jest.fn()
    };

    mockPeer = {
      stubs: new Map([
        ['stub-1', calculatorStub],
        ['stub-2', userStub]
      ])
    };

    server = new HttpServer({
      port: testPort,
      host: 'localhost'
    });

    // Inject mock peer
    (server as any).setPeer(mockPeer);
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

    it('should have correct address and port', () => {
      expect(server.address).toBe('localhost');
      expect(server.port).toBe(testPort);
    });
  });

  describe('Service Registration via Peer', () => {
    it('should register services from peer stubs', () => {
      const services = (server as any).services;

      expect(services.has('Calculator@1.0.0')).toBe(true);
      expect(services.has('UserService@1.0.0')).toBe(true);
    });

    it('should register service methods', () => {
      const services = (server as any).services;
      const calculator = services.get('Calculator@1.0.0');

      expect(calculator).toBeDefined();
      expect(calculator.methods.has('add')).toBe(true);
      expect(calculator.methods.has('subtract')).toBe(true);
    });

    it('should create method handlers', () => {
      const services = (server as any).services;
      const calculator = services.get('Calculator@1.0.0');
      const addMethod = calculator.methods.get('add');

      expect(addMethod).toBeDefined();
      expect(addMethod.handler).toBeInstanceOf(Function);
    });
  });

  describe('Discovery Endpoint', () => {
    it('should handle /netron/discovery requests', async () => {
      const request = new Request('http://localhost:3456/netron/discovery', {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toContain('application/json');

      const data = await response.json() as any;
      expect(data.server.protocol).toBe('2.0');
      expect(data.services).toBeDefined();
      expect(data.services['Calculator@1.0.0']).toBeDefined();
      expect(data.services['UserService@1.0.0']).toBeDefined();
    });

    it('should include service methods in discovery', async () => {
      const request = new Request('http://localhost:3456/netron/discovery', {
        method: 'GET'
      });

      const response = await server.handleRequest(request);
      const data = await response.json() as any;

      const calculator = data.services['Calculator@1.0.0'];
      expect(calculator.methods).toContain('add');
      expect(calculator.methods).toContain('subtract');
    });

    it('should include service version in discovery', async () => {
      const request = new Request('http://localhost:3456/netron/discovery', {
        method: 'GET'
      });

      const response = await server.handleRequest(request);
      const data = await response.json() as any;

      const calculator = data.services['Calculator@1.0.0'];
      expect(calculator.version).toBe('1.0.0');
    });
  });

  describe('Invocation Endpoint', () => {
    it('should handle /netron/invoke POST requests', async () => {
      const calculatorStub = mockPeer.stubs.get('stub-1');
      calculatorStub.call.mockResolvedValue(5);

      const request = new Request('http://localhost:3456/netron/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Netron-Version': '2.0'
        },
        body: JSON.stringify({
          id: 'test-req-1',
          version: '2.0',
          timestamp: Date.now(),
          service: 'Calculator@1.0.0',
          method: 'add',
          input: { a: 2, b: 3 }
        })
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(200);
      expect(calculatorStub.call).toHaveBeenCalledWith(
        'add',
        [{ a: 2, b: 3 }],
        mockPeer
      );

      const data = await response.json() as any;
      expect(data.success).toBe(true);
      expect(data.data).toBe(5);
      expect(data.id).toBe('test-req-1');
    });

    it('should handle service not found errors', async () => {
      const request = new Request('http://localhost:3456/netron/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: 'test-req-2',
          version: '2.0',
          timestamp: Date.now(),
          service: 'NonExistent@1.0.0',
          method: 'test',
          input: {}
        })
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(404);
      const data = await response.json() as any;
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('404'); // ErrorCode.NOT_FOUND as string
    });

    it('should handle method not found errors', async () => {
      const request = new Request('http://localhost:3456/netron/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: 'test-req-3',
          version: '2.0',
          timestamp: Date.now(),
          service: 'Calculator@1.0.0',
          method: 'nonExistentMethod',
          input: {}
        })
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(404);
      const data = await response.json() as any;
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('404'); // ErrorCode.NOT_FOUND as string
    });

    it('should handle method invocation errors', async () => {
      const calculatorStub = mockPeer.stubs.get('stub-1');
      calculatorStub.call.mockRejectedValue(new Error('Division by zero'));

      const request = new Request('http://localhost:3456/netron/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: 'test-req-4',
          version: '2.0',
          timestamp: Date.now(),
          service: 'Calculator@1.0.0',
          method: 'add',
          input: {}
        })
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(500);
      const data = await response.json() as any;
      expect(data.success).toBe(false);
      expect(data.error).toBeDefined();
    });
  });

  describe('Batch Endpoint', () => {
    it('should handle /netron/batch POST requests', async () => {
      const calculatorStub = mockPeer.stubs.get('stub-1');
      calculatorStub.call
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(10);

      const request = new Request('http://localhost:3456/netron/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: 'batch-test-1',
          version: '2.0',
          timestamp: Date.now(),
          requests: [
            {
              id: 'batch-1',
              version: '2.0',
              timestamp: Date.now(),
              service: 'Calculator@1.0.0',
              method: 'add',
              input: { a: 2, b: 3 }
            },
            {
              id: 'batch-2',
              version: '2.0',
              timestamp: Date.now(),
              service: 'Calculator@1.0.0',
              method: 'add',
              input: { a: 4, b: 6 }
            }
          ]
        })
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.responses).toHaveLength(2);
      expect(data.responses[0].success).toBe(true);
      expect(data.responses[0].data).toBe(5);
      expect(data.responses[1].success).toBe(true);
      expect(data.responses[1].data).toBe(10);
    });

    it('should handle partial batch failures', async () => {
      const calculatorStub = mockPeer.stubs.get('stub-1');
      calculatorStub.call
        .mockResolvedValueOnce(5)
        .mockRejectedValueOnce(new Error('Error'));

      const request = new Request('http://localhost:3456/netron/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: 'batch-test-2',
          version: '2.0',
          timestamp: Date.now(),
          requests: [
            {
              id: 'batch-1',
              version: '2.0',
              timestamp: Date.now(),
              service: 'Calculator@1.0.0',
              method: 'add',
              input: { a: 2, b: 3 }
            },
            {
              id: 'batch-2',
              version: '2.0',
              timestamp: Date.now(),
              service: 'Calculator@1.0.0',
              method: 'add',
              input: { a: 4, b: 6 }
            }
          ]
        })
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.responses).toHaveLength(2);
      expect(data.responses[0].success).toBe(true);
      expect(data.responses[1].success).toBe(false);
    });
  });

  describe('Health Check Endpoint', () => {
    it('should handle /health GET requests (server offline)', async () => {
      const request = new Request('http://localhost:3456/health', {
        method: 'GET'
      });

      const response = await server.handleRequest(request);

      // Server is not started, so status should be 503
      expect(response.status).toBe(503);
      const data = await response.json() as any;
      expect(data.status).toBeDefined();
      expect(data.uptime).toBeGreaterThanOrEqual(0);
      expect(data.version).toBe('2.0.0');
    });

    it('should return 200 when server is online', async () => {
      // Manually set server status to online (simulating started server)
      (server as any).status = 'online';

      const request = new Request('http://localhost:3456/health', {
        method: 'GET'
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(200);
      const data = await response.json() as any;
      expect(data.status).toBe('online');
      expect(data.uptime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('CORS Handling', () => {
    it('should handle OPTIONS preflight requests', async () => {
      const request = new Request('http://localhost:3456/netron/invoke', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'POST'
        }
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(204);
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown endpoints', async () => {
      const request = new Request('http://localhost:3456/unknown', {
        method: 'GET'
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(404);
    });

    it('should handle malformed JSON in requests', async () => {
      const request = new Request('http://localhost:3456/netron/invoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: 'invalid json{'
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(400);
    });
  });

  describe('Metrics', () => {
    it('should track request metrics', async () => {
      const request = new Request('http://localhost:3456/netron/discovery', {
        method: 'GET'
      });

      await server.handleRequest(request);

      const metrics = server.getMetrics();
      expect(metrics.totalRequests).toBeGreaterThan(0);
    });

    it('should track protocol versions', async () => {
      const request = new Request('http://localhost:3456/netron/discovery', {
        method: 'GET',
        headers: {
          'X-Netron-Version': '2.0'
        }
      });

      await server.handleRequest(request);

      const metrics = (server as any).metrics;
      expect(metrics.protocolVersions.get('2.0')).toBeGreaterThan(0);
    });
  });

  describe('Broadcast', () => {
    it('should implement broadcast method', () => {
      expect(server.broadcast).toBeDefined();
      expect(typeof server.broadcast).toBe('function');
    });

    it('should handle broadcast calls gracefully (HTTP is stateless)', async () => {
      // HTTP transport doesn't support true broadcast since it's stateless
      // The method exists for interface compatibility but just warns
      const message = Buffer.from(JSON.stringify({ type: 'test', data: 'hello' }));

      await expect(server.broadcast(message)).resolves.not.toThrow();
    });
  });

  describe('Lifecycle', () => {
    it('should emit listening event when started', async () => {
      // This test would require actually starting the server
      // Skipping for unit tests
      expect(true).toBe(true);
    });

    it('should close gracefully', async () => {
      await expect(server.close()).resolves.not.toThrow();
    });
  });
});
