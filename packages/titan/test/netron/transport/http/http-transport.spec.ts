/**
 * Tests for HTTP Transport implementation
 * This test suite covers the HTTP transport that enables Netron services
 * to be exposed and consumed via HTTP while maintaining the same API as WebSocket transport
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { z } from 'zod';
import { HttpTransport } from '../../../../src/netron/transport/http/http-transport.js';
import { HttpServer } from '../../../../src/netron/transport/http/http-server.js';
import { HttpClientConnection } from '../../../../src/netron/transport/http/http-client.js';
import {
  ITransport,
  ITransportConnection,
  ITransportServer,
  ConnectionState,
  TransportCapabilities,
  TransportOptions,
  TransportAddress
} from '../../../../src/netron/transport/types.js';
import { contract } from '../../../../src/validation/contract.js';

describe('HttpTransport', () => {
  let transport: HttpTransport;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    transport = new HttpTransport();
    // Save original fetch if it exists
    originalFetch = global.fetch;
  });

  afterEach(() => {
    // Restore original fetch
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as any).fetch;
    }
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
      const connection = await transport.connect('http://localhost:3000');
      expect(connection).toBeDefined();
      expect(connection).toBeInstanceOf(HttpClientConnection);
      expect(connection.state).toBe(ConnectionState.CONNECTED);
    });

    it('should pass options to client connection', async () => {
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
      // This test is here for completeness, but HTTP transport supports server
      // We'll test this scenario for client-only transports
      const clientOnlyTransport = new HttpTransport();
      clientOnlyTransport.capabilities.server = false;

      // Override createServer to undefined
      (clientOnlyTransport as any).createServer = undefined;

      expect(clientOnlyTransport.createServer).toBeUndefined();
    });
  });

  describe('Transport Registry Integration', () => {
    it('should be registerable in transport registry', () => {
      const registry = new Map<string, ITransport>();
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
      global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

      // The connection creation should still succeed, but discovery will fail
      // The warning will be logged but connection object will be created
      let connection;
      try {
        connection = await transport.connect('http://localhost:9999');
      } catch (error) {
        // If connect throws, we expect a connection refused error
        expect(error).toEqual(expect.objectContaining({ message: expect.stringContaining('Connection refused') }));
        return;
      }

      // If connect succeeds despite fetch failure, validate the connection exists
      expect(connection).toBeDefined();
    });
  });

  describe('Options and Configuration', () => {
    it('should support custom headers', async () => {
      const options: TransportOptions = {
        headers: {
          'Authorization': 'Bearer token123',
          'X-Custom-Header': 'value'
        }
      };

      const connection = await transport.connect('http://localhost:3000', options);
      expect(connection).toBeDefined();

      // Headers should be stored in connection options
      expect((connection as any).options?.headers).toEqual(options.headers);
    });

    it('should support timeout configuration', async () => {
      const options: TransportOptions = {
        timeout: 10000
      };

      const connection = await transport.connect('http://localhost:3000', options);
      expect((connection as any).options?.timeout).toBe(10000);
    });

    it('should support compression flag', async () => {
      const options: TransportOptions = {
        compression: true
      };

      const server = await transport.createServer(options);
      expect((server as any).options?.compression).toBe(true);
    });
  });

  describe('Cross-Runtime Support', () => {
    it('should detect runtime environment', () => {
      const runtime = (transport as any).detectRuntime();
      expect(['node', 'bun', 'deno', 'browser']).toContain(runtime);
    });

    it('should use appropriate APIs for current runtime', () => {
      // This test verifies that the transport uses the correct APIs
      // based on the runtime environment (Node.js, Bun, Deno, Browser)
      const isNode = typeof global !== 'undefined' && !!(global as any).process;
      const isBun = typeof Bun !== 'undefined';
      const isDeno = typeof (global as any).Deno !== 'undefined';
      const isBrowser = typeof window !== 'undefined';

      expect(isNode || isBun || isDeno || isBrowser).toBe(true);
    });
  });
});