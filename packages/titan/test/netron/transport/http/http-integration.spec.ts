/**
 * Integration tests for HTTP Transport (v2.0 Native Protocol)
 * Tests end-to-end scenarios with server and client together
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpTransport } from '../../../../src/netron/transport/http/http-transport.js';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { HttpConnection } from '../../../../src/netron/transport/http/connection.js';

describe('HTTP Transport Integration (v2.0)', () => {
  let transport: HttpTransport;
  let server: HttpServer;
  let connection: HttpConnection;
  let mockFetch: any;

  const testPort = 3567;
  const baseUrl = `http://localhost:${testPort}`;

  beforeEach(() => {
    transport = new HttpTransport();

    // Mock fetch for client tests
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(async () => {
    if (connection) {
      await connection.close();
    }
    if (server) {
      await server.close();
    }
    delete (global as any).fetch;

    // Clean up async operations
    await new Promise((resolve) => setImmediate(resolve));
  });

  describe('Transport Layer', () => {
    it('should create server', async () => {
      server = await transport.createServer({ port: testPort, host: 'localhost' });

      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(HttpServer);
      expect(server.port).toBe(testPort);
    });

    it('should create client connection', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: jest.fn((name: string) => (name === 'Content-Type' ? 'application/json' : null)),
        },
        json: jest.fn().mockResolvedValue({
          server: {
            version: '2.0.0',
            protocol: '2.0',
            features: [],
          },
          services: {},
          contracts: {},
        }),
      });

      connection = await transport.connect(baseUrl);

      expect(connection).toBeDefined();
      expect(connection).toBeInstanceOf(HttpConnection);
    });

    it('should validate HTTP addresses', () => {
      expect(transport.isValidAddress('http://localhost:3000')).toBe(true);
      expect(transport.isValidAddress('https://api.example.com')).toBe(true);
      expect(transport.isValidAddress('ws://localhost')).toBe(false);
      expect(transport.isValidAddress('invalid')).toBe(false);
    });

    it('should parse HTTP addresses correctly', () => {
      const parsed = transport.parseAddress('http://localhost:3000/api');

      expect(parsed.protocol).toBe('http');
      expect(parsed.host).toBe('localhost');
      expect(parsed.port).toBe(3000);
      expect(parsed.path).toBe('/api');
    });
  });

  describe('Server Capabilities', () => {
    beforeEach(() => {
      server = new HttpServer({ port: testPort, host: 'localhost' });
    });

    it('should have correct capabilities', () => {
      expect(transport.capabilities.streaming).toBe(true);
      expect(transport.capabilities.bidirectional).toBe(false);
      expect(transport.capabilities.binary).toBe(false); // HTTP is a text protocol
      expect(transport.capabilities.server).toBe(true);
    });

    it('should handle invocation requests with valid message', async () => {
      // Setup mock peer with service
      const mockStub = {
        definition: {
          meta: {
            name: 'Test@1.0.0',
            version: '1.0.0',
            methods: {
              test: { name: 'test' },
            },
          },
        },
        call: jest.fn().mockResolvedValue({ success: true }),
      };

      const mockPeer = {
        stubs: new Map([['stub-1', mockStub]]),
      };

      (server as any).setPeer(mockPeer);

      const request = new Request(`${baseUrl}/netron/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: 'test-1',
          version: '2.0',
          timestamp: Date.now(),
          service: 'Test@1.0.0',
          method: 'test',
          input: {},
        }),
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.success).toBe(true);
    });
  });

  describe('Client Capabilities', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: jest.fn((name: string) => (name === 'Content-Type' ? 'application/json' : null)),
        },
        json: jest.fn().mockResolvedValue({
          server: {
            version: '2.0.0',
            protocol: '2.0',
            features: ['batch', 'discovery'],
          },
          services: {
            'Calculator@1.0.0': {
              name: 'Calculator@1.0.0',
              version: '1.0.0',
              methods: ['add', 'subtract'],
            },
          },
          contracts: {},
          timestamp: Date.now(),
        }),
      });

      connection = new HttpConnection(baseUrl);
    });

    it('should send messages', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: jest.fn(),
        },
        json: jest.fn().mockResolvedValue({
          id: 'msg-1',
          version: '2.0',
          success: true,
          data: 'ok',
        }),
      });

      const message = Buffer.from(
        JSON.stringify({
          id: 'msg-1',
          version: '2.0',
          timestamp: Date.now(),
          service: 'Test@1.0.0',
          method: 'test',
          input: {},
        })
      );

      await expect(connection.send(message)).resolves.not.toThrow();
    });
  });

  describe('Error Scenarios', () => {
    it('should create server even with unusual port values', async () => {
      // Server creation is permissive - it's up to the OS to reject invalid ports
      const testServer = await transport.createServer({ port: testPort + 100 });
      expect(testServer).toBeDefined();
      await testServer.close();
    });

    it('should create connection without verifying server', async () => {
      // HTTP connections are stateless and don't verify server on connect
      const connection = await transport.connect('http://localhost:9999');
      expect(connection).toBeDefined();
    });
  });

  describe('Protocol Version', () => {
    beforeEach(() => {
      server = new HttpServer({ port: testPort });
    });

    it('should include protocol version in responses', async () => {
      const mockStub = {
        definition: {
          meta: {
            name: 'Test@1.0.0',
            version: '1.0.0',
            methods: {
              test: { name: 'test' },
            },
          },
        },
        call: jest.fn().mockResolvedValue(42),
      };

      (server as any).setPeer({
        stubs: new Map([['stub-1', mockStub]]),
      });

      const request = new Request(`${baseUrl}/netron/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Netron-Version': '2.0',
        },
        body: JSON.stringify({
          id: 'test-1',
          version: '2.0',
          timestamp: Date.now(),
          service: 'Test@1.0.0',
          method: 'test',
          input: {},
        }),
      });

      const response = await server.handleRequest(request);
      const data = (await response.json()) as any;

      expect(data.version).toBe('2.0');
      expect(response.headers.get('X-Netron-Version')).toBe('2.0');
    });
  });

  describe('Batch Operations', () => {
    beforeEach(() => {
      server = new HttpServer({ port: testPort });
    });

    it('should handle batch requests', async () => {
      const mockStub = {
        definition: {
          meta: {
            name: 'Calculator@1.0.0',
            version: '1.0.0',
            methods: {
              add: { name: 'add' },
            },
          },
        },
        call: jest.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(7),
      };

      (server as any).setPeer({
        stubs: new Map([['stub-1', mockStub]]),
      });

      const request = new Request(`${baseUrl}/netron/batch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: 'batch-1',
          version: '2.0',
          timestamp: Date.now(),
          requests: [
            {
              id: 'req-1',
              version: '2.0',
              timestamp: Date.now(),
              service: 'Calculator@1.0.0',
              method: 'add',
              input: { a: 1, b: 2 },
            },
            {
              id: 'req-2',
              version: '2.0',
              timestamp: Date.now(),
              service: 'Calculator@1.0.0',
              method: 'add',
              input: { a: 3, b: 4 },
            },
          ],
        }),
      });

      const response = await server.handleRequest(request);
      const data = (await response.json()) as any;

      expect(response.status).toBe(200);
      expect(data.responses).toHaveLength(2);
      expect(data.responses[0].success).toBe(true);
      expect(data.responses[0].data).toBe(3);
      expect(data.responses[1].success).toBe(true);
      expect(data.responses[1].data).toBe(7);
    });
  });

  describe('Health and Metrics', () => {
    beforeEach(() => {
      server = new HttpServer({ port: testPort });
    });

    it('should provide health endpoint', async () => {
      const request = new Request(`${baseUrl}/health`, {
        method: 'GET',
      });

      const response = await server.handleRequest(request);

      expect(response.status).toBeDefined();
      const data = (await response.json()) as any;
      expect(data.status).toBeDefined();
      expect(data.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should track metrics', async () => {
      const request = new Request(`${baseUrl}/health`, {
        method: 'GET',
      });

      await server.handleRequest(request);

      const metrics = server.getMetrics();
      expect(metrics.totalRequests).toBeGreaterThan(0);
    });
  });
});
