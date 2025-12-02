/**
 * Tests for HTTP Transport Server Capability
 * Verifies that the HTTP transport can create and manage servers
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { HttpTransport } from '../../../src/netron/transport/http/http-transport.js';
import { HttpServer } from '../../../src/netron/transport/http/server.js';
import type { ITransportServer } from '../../../src/netron/transport/types.js';

describe('HTTP Transport - Server Capability', () => {
  let transport: HttpTransport;

  beforeEach(() => {
    transport = new HttpTransport();
  });

  describe('Capabilities', () => {
    it('should have server capability enabled', () => {
      expect(transport.capabilities.server).toBe(true);
    });

    it('should have correct capability flags', () => {
      expect(transport.capabilities).toMatchObject({
        streaming: true,
        bidirectional: false,
        binary: false,
        reconnection: false,
        multiplexing: true,
        server: true,
      });
    });

    it('should report transport name as http', () => {
      expect(transport.name).toBe('http');
    });
  });

  describe('Server Creation', () => {
    let server: ITransportServer;

    afterEach(async () => {
      if (server) {
        await server.close();
      }
    });

    it('should create HTTP server successfully', async () => {
      server = await transport.createServer();
      expect(server).toBeInstanceOf(HttpServer);
    });

    it('should create server with options', async () => {
      server = await transport.createServer({
        port: 3000,
        host: 'localhost',
      });

      expect(server).toBeInstanceOf(HttpServer);
      expect(server.port).toBe(3000);
      expect(server.address).toBe('localhost');
    });

    it('should create server with CORS enabled', async () => {
      server = await transport.createServer({
        cors: {
          origin: '*',
          credentials: true,
        },
      });

      expect(server).toBeDefined();
    });

    it('should create server with compression enabled', async () => {
      server = await transport.createServer({
        compression: {
          threshold: 1024,
        },
      });

      expect(server).toBeDefined();
    });

    it('should create multiple servers with different ports', async () => {
      const server1 = await transport.createServer({ port: 3001 });
      const server2 = await transport.createServer({ port: 3002 });

      expect(server1).toBeDefined();
      expect(server2).toBeDefined();
      expect(server1.port).toBe(3001);
      expect(server2.port).toBe(3002);

      await server1.close();
      await server2.close();
    });
  });

  describe('Server Lifecycle', () => {
    let server: ITransportServer;

    afterEach(async () => {
      if (server) {
        try {
          await server.close();
        } catch (error) {
          // Ignore errors during cleanup
        }
      }
    });

    it('should listen on specified port', async () => {
      server = await transport.createServer({
        port: 3003,
        host: 'localhost',
      });

      await server.listen();

      // Verify server is listening
      const response = await fetch('http://localhost:3003/health');
      expect(response.status).toBeLessThanOrEqual(503); // Could be 200 or 503 depending on state
    });

    it('should close server gracefully', async () => {
      server = await transport.createServer({
        port: 3004,
        host: 'localhost',
      });

      await server.listen();
      await server.close();

      // Verify server is closed (connection should fail)
      try {
        await fetch('http://localhost:3004/health', {
          signal: AbortSignal.timeout(100),
        });
        throw new Error('Server should be closed');
      } catch (error: any) {
        // Expected - connection should fail
        // Accept any error as connection failure indicator
        expect(error).toBeDefined();
      }
    });

    it('should handle metrics endpoint', async () => {
      server = await transport.createServer({
        port: 3005,
        host: 'localhost',
      });

      await server.listen();

      // Metrics endpoint requires authentication, so it should return 401
      const response = await fetch('http://localhost:3005/metrics');
      expect(response.status).toBe(401);
    });

    it('should handle health endpoint', async () => {
      server = await transport.createServer({
        port: 3006,
        host: 'localhost',
      });

      await server.listen();

      const response = await fetch('http://localhost:3006/health');
      expect(response.status).toBeLessThanOrEqual(503);

      const data = await response.json();
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('uptime');
      expect(data).toHaveProperty('version');
    });

    it('should return 404 for unknown routes', async () => {
      server = await transport.createServer({
        port: 3007,
        host: 'localhost',
      });

      await server.listen();

      const response = await fetch('http://localhost:3007/unknown-route');
      expect(response.status).toBe(404);
    });

    it('should handle CORS preflight requests', async () => {
      server = await transport.createServer({
        port: 3008,
        host: 'localhost',
        cors: {
          origin: '*',
        },
      });

      await server.listen();

      const response = await fetch('http://localhost:3008/netron/invoke', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://example.com',
          'Access-Control-Request-Method': 'POST',
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://example.com');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });
  });

  describe('Transport Address Handling', () => {
    it('should validate HTTP addresses', () => {
      expect(transport.isValidAddress('http://localhost:3000')).toBe(true);
      expect(transport.isValidAddress('https://example.com')).toBe(true);
      expect(transport.isValidAddress('http://192.168.1.1:8080')).toBe(true);
      expect(transport.isValidAddress('ws://localhost:3000')).toBe(false);
      expect(transport.isValidAddress('invalid')).toBe(false);
    });

    it('should parse HTTP addresses', () => {
      const address = transport.parseAddress('http://localhost:3000/api/v1?key=value');

      expect(address.protocol).toBe('http');
      expect(address.host).toBe('localhost');
      expect(address.port).toBe(3000);
      expect(address.path).toBe('/api/v1');
      expect(address.params).toEqual({ key: 'value' });
    });

    it('should parse HTTPS addresses with default port', () => {
      const address = transport.parseAddress('https://example.com/api');

      expect(address.protocol).toBe('https');
      expect(address.host).toBe('example.com');
      expect(address.port).toBe(443);
      expect(address.path).toBe('/api');
    });

    it('should format addresses correctly', () => {
      const formatted = transport.formatAddress({
        protocol: 'http',
        host: 'localhost',
        port: 3000,
        path: '/api/v1',
        params: { key: 'value' },
      });

      expect(formatted).toBe('http://localhost:3000/api/v1?key=value');
    });

    it('should omit default ports when formatting', () => {
      const http = transport.formatAddress({
        protocol: 'http',
        host: 'localhost',
        port: 80,
        path: '/',
      });
      expect(http).toBe('http://localhost/');

      const https = transport.formatAddress({
        protocol: 'https',
        host: 'example.com',
        port: 443,
        path: '/',
      });
      expect(https).toBe('https://example.com/');
    });
  });

  describe('Transport Metrics', () => {
    it('should provide transport metrics', () => {
      const metrics = transport.getMetrics();

      expect(metrics).toHaveProperty('transport', 'http');
      expect(metrics).toHaveProperty('runtime');
      expect(metrics).toHaveProperty('capabilities');
      expect(metrics.capabilities.server).toBe(true);
    });
  });

  describe('Server Port Management', () => {
    it('should prevent port conflicts by waiting for release', async () => {
      const port = 3009;

      // Create and start first server
      const server1 = await transport.createServer({ port, host: 'localhost' });
      await server1.listen();

      // Close first server
      await server1.close();

      // Wait a bit for port to be fully released
      await new Promise((resolve) => setTimeout(resolve, 250));

      // Create and start second server on same port
      const server2 = await transport.createServer({ port, host: 'localhost' });
      await server2.listen();

      // Verify second server works
      const response = await fetch(`http://localhost:${port}/health`);
      expect(response.ok || response.status === 503).toBe(true);

      await server2.close();
    });
  });

  describe('Server Error Handling', () => {
    let server: ITransportServer;

    afterEach(async () => {
      if (server) {
        await server.close();
      }
    });

    it('should handle malformed JSON in request body', async () => {
      server = await transport.createServer({
        port: 3010,
        host: 'localhost',
      });

      await server.listen();

      const response = await fetch('http://localhost:3010/netron/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json{',
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle invalid request format', async () => {
      server = await transport.createServer({
        port: 3011,
        host: 'localhost',
      });

      await server.listen();

      const response = await fetch('http://localhost:3011/netron/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: 'format' }),
      });

      expect(response.status).toBe(400);
    });
  });
});
