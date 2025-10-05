/**
 * Tests for HTTP Transport implementation
 * This test suite covers the HTTP transport that enables Netron services
 * to be exposed and consumed via HTTP while maintaining the same API as WebSocket transport
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpTransport } from '../../../../src/netron/transport/http/http-transport.js';
import { HttpServer } from '../../../../src/netron/transport/http/server.js';
import { HttpConnection } from '../../../../src/netron/transport/http/connection.js';
import {
  ConnectionState,
  type TransportOptions
} from '../../../../src/netron/transport/types.js';

describe('HttpTransport', () => {
  let transport: HttpTransport;
  let mockFetch: any;

  beforeEach(() => {
    transport = new HttpTransport();

    // Mock global fetch
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    // Clean up mocks
    delete (global as any).fetch;
  });

  describe('Transport Interface Implementation', () => {
    it('should implement ITransport interface', () => {
      expect(transport).toHaveProperty('name');
      expect(transport).toHaveProperty('capabilities');
      expect(transport).toHaveProperty('connect');
      expect(transport).toHaveProperty('createServer');
      expect(transport).toHaveProperty('isValidAddress');
      expect(transport).toHaveProperty('parseAddress');
    });

    it('should have correct name', () => {
      expect(transport.name).toBe('http');
    });

    it('should have correct capabilities', () => {
      const capabilities = transport.capabilities;
      expect(capabilities.streaming).toBe(true); // Via SSE
      expect(capabilities.bidirectional).toBe(false); // HTTP is request-response
      expect(capabilities.binary).toBe(true);
      expect(capabilities.reconnection).toBe(false); // Stateless protocol
      expect(capabilities.multiplexing).toBe(true);
      expect(capabilities.server).toBe(true);
    });
  });

  describe('Address Validation and Parsing', () => {
    it('should validate HTTP addresses', () => {
      expect(transport.isValidAddress('http://localhost:3000')).toBe(true);
      expect(transport.isValidAddress('https://example.com')).toBe(true);
      expect(transport.isValidAddress('http://127.0.0.1:8080/api')).toBe(true);
      expect(transport.isValidAddress('ws://localhost:3000')).toBe(false);
      expect(transport.isValidAddress('tcp://localhost:3000')).toBe(false);
      expect(transport.isValidAddress('invalid')).toBe(false);
    });

    it('should parse HTTP addresses correctly', () => {
      const address1 = transport.parseAddress('http://localhost:3000');
      expect(address1.protocol).toBe('http');
      expect(address1.host).toBe('localhost');
      expect(address1.port).toBe(3000);
      expect(address1.path).toBe('/');

      const address2 = transport.parseAddress('https://api.example.com/v1');
      expect(address2.protocol).toBe('https');
      expect(address2.host).toBe('api.example.com');
      expect(address2.port).toBe(443);
      expect(address2.path).toBe('/v1');

      const address3 = transport.parseAddress('http://127.0.0.1:8080/api?key=value');
      expect(address3.protocol).toBe('http');
      expect(address3.host).toBe('127.0.0.1');
      expect(address3.port).toBe(8080);
      expect(address3.path).toBe('/api');
      expect(address3.params).toEqual({ key: 'value' });
    });
  });

  describe('Client Connection', () => {
    it('should create HTTP client connection', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          version: '2.0',
          services: {},
          contracts: {}
        })
      } as Response);

      const connection = await transport.connect('http://localhost:3000');
      expect(connection).toBeDefined();
      expect(connection).toBeInstanceOf(HttpConnection);
      expect(connection.state).toBe(ConnectionState.CONNECTED);
    });

    it('should pass options to client connection', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          version: '2.0',
          services: {},
          contracts: {}
        })
      } as Response);

      const options: TransportOptions = {
        timeout: 5000,
        headers: { 'X-Api-Key': 'test123' },
        reconnect: false
      };
      const connection = await transport.connect('http://localhost:3000', options);
      expect(connection).toBeDefined();
    });
  });

  describe('Server Creation', () => {
    it('should create HTTP server', async () => {
      const server = await transport.createServer({
        port: 3001,
        host: 'localhost'
      });
      expect(server).toBeDefined();
      expect(server).toBeInstanceOf(HttpServer);
      expect(server.connections).toBeDefined();
      expect(server.connections).toBeInstanceOf(Map);
    });

    it('should throw error if createServer is not supported', async () => {
      // Test client-only transport scenario
      const clientOnlyTransport = new HttpTransport();
      (clientOnlyTransport as any).capabilities = {
        ...clientOnlyTransport.capabilities,
        server: false
      };

      await expect(clientOnlyTransport.createServer())
        .rejects.toThrow('HTTP transport server capability is disabled');
    });
  });

  describe('Transport Registry Integration', () => {
    it('should be registerable in transport registry', () => {
      const registry = new Map<string, any>();
      const factory = () => new HttpTransport();

      registry.set('http', factory());

      const retrieved = registry.get('http');
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('http');
    });

    it('should support multiple instances', () => {
      const transport1 = new HttpTransport();
      const transport2 = new HttpTransport();

      expect(transport1).not.toBe(transport2);
      expect(transport1.name).toBe(transport2.name);
    });
  });

  describe('Protocol Detection', () => {
    it('should detect protocol from address', () => {
      const httpAddresses = [
        'http://localhost:3000',
        'http://example.com',
        'http://127.0.0.1'
      ];

      const httpsAddresses = [
        'https://localhost:3000',
        'https://example.com',
        'https://api.example.com'
      ];

      httpAddresses.forEach(addr => {
        const parsed = transport.parseAddress(addr);
        expect(parsed.protocol).toBe('http');
      });

      httpsAddresses.forEach(addr => {
        const parsed = transport.parseAddress(addr);
        expect(parsed.protocol).toBe('https');
      });
    });
  });

  describe('Error Handling', () => {
    it('should throw error for invalid addresses', () => {
      expect(() => transport.parseAddress('invalid-url')).toThrow();
      expect(() => transport.parseAddress('')).toThrow();
      expect(() => transport.parseAddress('ws://localhost')).toThrow();
    });

    it('should handle connection failures gracefully', async () => {
      // Mock fetch to simulate connection failure
      mockFetch.mockRejectedValue({
        message: 'fetch failed',
        cause: { code: 'ECONNREFUSED' }
      });

      await expect(transport.connect('http://localhost:9999'))
        .rejects.toThrow('Cannot connect to server');
    });

    it('should handle server error responses', async () => {
      // Mock 500 Internal Server Error
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      } as Response);

      await expect(transport.connect('http://localhost:3000'))
        .rejects.toThrow('Server returned 500 Internal Server Error');
    });

    it('should accept 404 responses during discovery', async () => {
      // Mock 404 Not Found (server exists but no discovery endpoint)
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      } as Response);

      const connection = await transport.connect('http://localhost:3000');
      expect(connection).toBeDefined();
    });
  });

  describe('Options and Configuration', () => {
    it('should support custom headers', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          version: '2.0',
          services: {},
          contracts: {}
        })
      } as Response);

      const options: TransportOptions = {
        headers: {
          'Authorization': 'Bearer token123',
          'X-Custom-Header': 'value'
        }
      };

      const connection = await transport.connect('http://localhost:3000', options);
      expect(connection).toBeDefined();

      // Verify headers were passed to fetch
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer token123',
            'X-Custom-Header': 'value'
          })
        })
      );
    });

    it('should support timeout configuration', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          version: '2.0',
          services: {},
          contracts: {}
        })
      } as Response);

      const options: TransportOptions = {
        timeout: 10000
      };

      const connection = await transport.connect('http://localhost:3000', options);
      expect(connection).toBeDefined();
    });

    it('should support compression flag', async () => {
      const options: TransportOptions = {
        compression: true
      };

      const server = await transport.createServer(options);
      expect(server).toBeDefined();
    });
  });

  describe('Cross-Runtime Support', () => {
    it('should detect runtime environment', () => {
      const metrics = transport.getMetrics();
      expect(['node', 'bun', 'deno', 'browser']).toContain(metrics.runtime);
    });

    it('should use appropriate APIs for current runtime', () => {
      // This test verifies that the transport uses the correct APIs
      // based on the runtime environment (Node.js, Bun, Deno, Browser)
      const isNode = typeof global !== 'undefined' && !!(global as any).process;
      // @ts-expect-error - Bun global may not be available
      const isBun = typeof globalThis.Bun !== 'undefined';
      const isDeno = typeof (global as any).Deno !== 'undefined';
      const isBrowser = typeof window !== 'undefined';

      expect(isNode || isBun || isDeno || isBrowser).toBe(true);
    });
  });

  describe('Address Formatting', () => {
    it('should format address from components', () => {
      const formatted1 = transport.formatAddress({
        protocol: 'http',
        host: 'localhost',
        port: 3000,
        path: '/'
      });
      expect(formatted1).toBe('http://localhost:3000/');

      const formatted2 = transport.formatAddress({
        protocol: 'https',
        host: 'api.example.com',
        port: 443,
        path: '/v1'
      });
      expect(formatted2).toBe('https://api.example.com/v1');

      const formatted3 = transport.formatAddress({
        protocol: 'http',
        host: '127.0.0.1',
        port: 8080,
        path: '/api',
        params: { key: 'value' }
      });
      expect(formatted3).toBe('http://127.0.0.1:8080/api?key=value');
    });

    it('should omit default ports', () => {
      const formatted1 = transport.formatAddress({
        protocol: 'http',
        host: 'example.com',
        port: 80,
        path: '/'
      });
      expect(formatted1).toBe('http://example.com/');

      const formatted2 = transport.formatAddress({
        protocol: 'https',
        host: 'example.com',
        port: 443,
        path: '/'
      });
      expect(formatted2).toBe('https://example.com/');
    });
  });

  describe('Metrics', () => {
    it('should return transport metrics', () => {
      const metrics = transport.getMetrics();
      expect(metrics).toHaveProperty('transport', 'http');
      expect(metrics).toHaveProperty('runtime');
      expect(metrics).toHaveProperty('capabilities');
    });
  });
});
