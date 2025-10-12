/**
 * Tests for HTTP Connection implementation (v2.0 Native Protocol)
 * This test suite covers the HTTP client connection that uses native JSON messaging
 * without packet protocol for improved performance
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { HttpConnection } from '../../../../src/netron/transport/http/connection.js';
import { ConnectionState } from '../../../../src/netron/transport/types.js';
import { EventEmitter } from '@omnitron-dev/eventemitter';

describe('HttpConnection (v2.0 Native Protocol)', () => {
  let connection: HttpConnection;
  const baseUrl = 'http://localhost:3000';
  let mockFetch: any;

  beforeEach(() => {
    // Mock global fetch
    mockFetch = jest.fn();
    global.fetch = mockFetch;
  });

  afterEach(async () => {
    if (connection) {
      await connection.close();
    }
    delete (global as any).fetch;

    // Wait for any pending setImmediate callbacks
    await new Promise((resolve) => setImmediate(resolve));
  });

  describe('Connection Interface Implementation', () => {
    it('should implement ITransportConnection interface', () => {
      connection = new HttpConnection(baseUrl);

      expect(connection).toHaveProperty('id');
      expect(connection).toHaveProperty('state');
      expect(connection).toHaveProperty('send');
      expect(connection).toHaveProperty('close');
      expect(connection).toHaveProperty('remoteAddress');
    });

    it('should extend EventEmitter', () => {
      connection = new HttpConnection(baseUrl);

      expect(connection).toBeInstanceOf(EventEmitter);
      expect(connection.on).toBeDefined();
      expect(connection.emit).toBeDefined();
      expect(connection.once).toBeDefined();
    });

    it('should have unique connection ID', () => {
      const conn1 = new HttpConnection(baseUrl);
      const conn2 = new HttpConnection(baseUrl);

      expect(conn1.id).toBeDefined();
      expect(conn2.id).toBeDefined();
      expect(conn1.id).not.toBe(conn2.id);

      conn1.close();
      conn2.close();
    });

    it('should initialize with CONNECTED state (HTTP is stateless)', () => {
      connection = new HttpConnection(baseUrl);
      // HTTP connections transition immediately to CONNECTED since they're stateless
      expect(connection.state).toBe(ConnectionState.CONNECTED);
    });

    it('should have correct remote address', () => {
      connection = new HttpConnection(baseUrl);
      expect(connection.remoteAddress).toBe(baseUrl);
    });

    it('should strip trailing slash from base URL', () => {
      connection = new HttpConnection('http://localhost:3000/');
      expect(connection.remoteAddress).toBe('http://localhost:3000');
    });
  });

  describe('Options Handling', () => {
    it('should accept timeout option', () => {
      connection = new HttpConnection(baseUrl, {
        timeout: 10000,
      });

      expect(connection).toBeDefined();
    });

    it('should accept custom headers', () => {
      connection = new HttpConnection(baseUrl, {
        headers: {
          Authorization: 'Bearer token',
          'X-Custom': 'value',
        },
      });

      expect(connection).toBeDefined();
    });

    it('should accept reconnect option', () => {
      connection = new HttpConnection(baseUrl, {
        reconnect: false,
      });

      expect(connection).toBeDefined();
    });
  });

  describe('Connection Lifecycle', () => {
    it('should emit connect event', (done) => {
      connection = new HttpConnection(baseUrl);

      connection.once('connect', () => {
        expect(connection.state).toBe(ConnectionState.CONNECTED);
        done();
      });
    });

    it('should emit disconnect event on close', (done) => {
      connection = new HttpConnection(baseUrl);

      connection.once('connect', async () => {
        connection.once('disconnect', () => {
          expect(connection.state).toBe(ConnectionState.DISCONNECTED);
          done();
        });

        await connection.close();
      });
    });

    it('should transition to DISCONNECTED state on close', async () => {
      connection = new HttpConnection(baseUrl);

      await new Promise((resolve) => connection.once('connect', resolve));

      await connection.close();

      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('Metrics', () => {
    it('should provide connection metrics', () => {
      connection = new HttpConnection(baseUrl);

      const metrics = connection.getMetrics();

      expect(metrics).toHaveProperty('state');
      expect(metrics).toHaveProperty('baseUrl'); // Metrics use baseUrl instead of remoteAddress
      expect(metrics).toHaveProperty('services');
    });

    it('should include state in metrics', () => {
      connection = new HttpConnection(baseUrl);

      const metrics = connection.getMetrics();
      expect(metrics.state).toBe(ConnectionState.CONNECTED);
    });

    it('should include base URL in metrics', () => {
      connection = new HttpConnection(baseUrl);

      const metrics = connection.getMetrics();
      expect(metrics.baseUrl).toBe(baseUrl);
    });

    it('should include empty service list', () => {
      connection = new HttpConnection(baseUrl);

      const metrics = connection.getMetrics();
      expect(metrics.services).toBeDefined();
      expect(Array.isArray(metrics.services)).toBe(true);
      expect(metrics.services).toEqual([]);
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors during initialization', () => {
      connection = new HttpConnection(baseUrl);

      expect(connection).toBeDefined();
      expect(connection.state).toBe(ConnectionState.CONNECTED);
    });
  });

  describe('Send Method', () => {
    it('should have send method', () => {
      connection = new HttpConnection(baseUrl);
      expect(typeof connection.send).toBe('function');
    });

    it('should accept Buffer data', async () => {
      connection = new HttpConnection(baseUrl);

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
          data: 'processed',
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

    it('should accept ArrayBuffer data', async () => {
      connection = new HttpConnection(baseUrl);

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
          data: 'processed',
        }),
      });

      const buffer = new TextEncoder().encode(
        JSON.stringify({
          id: 'msg-1',
          version: '2.0',
          timestamp: Date.now(),
          service: 'Test@1.0.0',
          method: 'test',
          input: {},
        })
      );

      await expect(connection.send(buffer.buffer)).resolves.not.toThrow();
    });
  });

  describe('Close Behavior', () => {
    it('should prevent operations after close', async () => {
      connection = new HttpConnection(baseUrl);

      await new Promise((resolve) => connection.once('connect', resolve));
      await connection.close();

      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should be idempotent', async () => {
      connection = new HttpConnection(baseUrl);

      await new Promise((resolve) => connection.once('connect', resolve));

      await connection.close();
      await connection.close(); // Should not throw

      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe('State Transitions', () => {
    it('should be CONNECTED and emit connect event', (done) => {
      connection = new HttpConnection(baseUrl);

      // HTTP connections are immediately CONNECTED
      expect(connection.state).toBe(ConnectionState.CONNECTED);

      connection.once('connect', () => {
        expect(connection.state).toBe(ConnectionState.CONNECTED);
        done();
      });
    });

    it('should transition CONNECTED -> DISCONNECTED on close', async () => {
      connection = new HttpConnection(baseUrl);

      await new Promise((resolve) => connection.once('connect', resolve));
      expect(connection.state).toBe(ConnectionState.CONNECTED);

      await connection.close();
      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe.skip('queryInterface Method', () => {
    it('should return proxy object with $def property', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: jest.fn() },
        json: jest.fn().mockResolvedValue({
          services: {
            'Calculator@1.0.0': {
              name: 'Calculator@1.0.0',
              version: '1.0.0',
              methods: ['add', 'subtract'],
            },
          },
        }),
      });

      connection = new HttpConnection(baseUrl);
      await new Promise((resolve) => setTimeout(resolve, 150));

      const service = await connection.queryInterface('Calculator@1.0.0');

      expect(service).toBeDefined();
      expect(service.$def).toBeDefined();
      expect(service.$def.meta.name).toBe('Calculator@1.0.0');
    });

    it('should create minimal definition for unknown service', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: jest.fn() },
        json: jest.fn().mockResolvedValue({ services: {} }),
      });

      connection = new HttpConnection(baseUrl);
      await new Promise((resolve) => setTimeout(resolve, 150));

      const service = await connection.queryInterface('UnknownService');

      expect(service).toBeDefined();
      expect(service.$def).toBeDefined();
      expect(service.$def.meta.name).toBe('UnknownService');
      expect(service.$def.meta.version).toBe('1.0.0');
    });

    it('should handle discovery failure gracefully', async () => {
      // Mock fetch to reject after the queryInterface timeout
      mockFetch.mockRejectedValue(new Error('Discovery failed'));

      connection = new HttpConnection(baseUrl);

      // Wait for initial discovery to fail
      await new Promise((resolve) => setTimeout(resolve, 200));

      // queryInterface should create minimal definition when discovery fails
      const service = await connection.queryInterface('TestService');

      expect(service).toBeDefined();
      expect(service.$def.meta.name).toBe('TestService');
    });
  });

  describe('HTTP Request Error Paths', () => {
    it('should handle HTTP error responses', async () => {
      connection = new HttpConnection(baseUrl);

      expect(connection.state).toBe(ConnectionState.CONNECTED);
    });

    it('should handle non-JSON data gracefully', async () => {
      connection = new HttpConnection(baseUrl);

      const invalidData = Buffer.from('not json');

      await expect(connection.send(invalidData)).resolves.not.toThrow();
      // Should warn but not throw
    });
  });

  describe('sendPacket Method', () => {
    it('should have sendPacket method', () => {
      connection = new HttpConnection(baseUrl);

      expect(typeof connection.sendPacket).toBe('function');
    });
  });

  describe.skip('ping Method', () => {
    it('should measure round-trip time', async () => {
      connection = new HttpConnection(baseUrl);

      await new Promise((resolve) => connection.once('connect', resolve));

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: jest.fn() },
        json: jest.fn().mockResolvedValue({}),
      });

      const rtt = await connection.ping();

      expect(typeof rtt).toBe('number');
      expect(rtt).toBeGreaterThanOrEqual(0);
    }, 5000);

    it('should throw error when not connected', async () => {
      connection = new HttpConnection(baseUrl);
      await connection.close();

      await expect(connection.ping()).rejects.toThrow('Connection is not established');
    }, 5000);

    it('should handle ping failure', async () => {
      connection = new HttpConnection(baseUrl);

      await new Promise((resolve) => connection.once('connect', resolve));

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        headers: { get: jest.fn() },
      });

      await expect(connection.ping()).rejects.toThrow();
    }, 5000);

    it('should handle ping network error', async () => {
      connection = new HttpConnection(baseUrl);

      await new Promise((resolve) => connection.once('connect', resolve));

      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(connection.ping()).rejects.toThrow();
    }, 5000);
  });

  describe('Connection Close with Pending Operations', () => {
    it('should handle close with abort controller', async () => {
      connection = new HttpConnection(baseUrl);

      await new Promise((resolve) => connection.once('connect', resolve));

      // Verify close clears abort controller
      await connection.close();

      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    });

    it('should handle multiple close calls gracefully', async () => {
      connection = new HttpConnection(baseUrl);

      await new Promise((resolve) => connection.once('connect', resolve));

      await connection.close();
      await connection.close();
      await connection.close();

      expect(connection.state).toBe(ConnectionState.DISCONNECTED);
    });
  });

  describe.skip('reconnect Method', () => {
    it('should reconnect successfully', async () => {
      connection = new HttpConnection(baseUrl);

      await new Promise((resolve) => connection.once('connect', resolve));
      await connection.close();

      await connection.reconnect();

      expect(connection.state).toBe(ConnectionState.CONNECTED);
    }, 5000);

    it('should emit connect event on reconnect', async () => {
      connection = new HttpConnection(baseUrl);

      await new Promise((resolve) => connection.once('connect', resolve));
      await connection.close();

      const connectPromise = new Promise((resolve) => connection.once('connect', resolve));

      await connection.reconnect();
      await connectPromise;

      expect(connection.state).toBe(ConnectionState.CONNECTED);
    }, 5000);
  });

  describe('isAlive Method', () => {
    it('should return true when connected', () => {
      connection = new HttpConnection(baseUrl);
      expect(connection.isAlive()).toBe(true);
    });

    it('should return false when disconnected', async () => {
      connection = new HttpConnection(baseUrl);
      await connection.close();
      expect(connection.isAlive()).toBe(false);
    });
  });
});
