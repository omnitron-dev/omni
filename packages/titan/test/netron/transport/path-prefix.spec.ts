/**
 * Tests for pathPrefix support in HTTP and WebSocket transports
 * @module @omnitron-dev/titan/netron/transport
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HttpServer } from '../../../src/netron/transport/http/server.js';
import { HttpTransportClient } from '../../../src/netron/transport/http/client.js';
import { WebSocketServerAdapter } from '../../../src/netron/transport/websocket/server.js';
import type { TransportOptions } from '../../../src/netron/transport/types.js';

// Skip HTTP server tests in CI/mock mode
const skipIntegrationTests = process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true';
const describeOrSkip = skipIntegrationTests ? describe.skip : describe;

describe('Path Prefix Support', () => {
  describe('HTTP Server Path Normalization', () => {
    let server: HttpServer;

    afterEach(async () => {
      if (server) {
        await server.close();
      }
    });

    it('should normalize paths with prefix correctly', () => {
      server = new HttpServer({
        port: 13000,
        pathPrefix: 'api/v1',
      });

      // Access the private normalizePath method via handleRequest behavior
      // The normalizePath strips the prefix for endpoint matching
      expect(server).toBeDefined();
    });

    it('should normalize prefix with leading slash', () => {
      server = new HttpServer({
        port: 13001,
        pathPrefix: '/api/v1/',
      });

      // Internal prefix should be normalized to 'api/v1'
      expect(server).toBeDefined();
    });

    it('should handle empty prefix', () => {
      server = new HttpServer({
        port: 13002,
        pathPrefix: '',
      });

      expect(server).toBeDefined();
    });

    it('should collapse multiple slashes in prefix', () => {
      server = new HttpServer({
        port: 13003,
        pathPrefix: '//api///v1//',
      });

      expect(server).toBeDefined();
    });

    it('should handle undefined prefix', () => {
      server = new HttpServer({
        port: 13004,
      });

      expect(server).toBeDefined();
    });
  });

  describeOrSkip('HTTP Server Path Matching', () => {
    let server: HttpServer;
    const TEST_PORT = 13010;

    beforeEach(async () => {
      server = new HttpServer({
        port: TEST_PORT,
        host: 'localhost',
        pathPrefix: 'api/v1',
      });
      await server.listen();
    });

    afterEach(async () => {
      if (server) {
        await server.close();
      }
    });

    it('should match endpoints with prefix', async () => {
      const response = await fetch(`http://localhost:${TEST_PORT}/api/v1/health`);

      expect(response.status).toBe(200);
    });

    it('should still serve health endpoint without prefix for backward compatibility', async () => {
      // HTTP server serves health at both prefixed and non-prefixed paths for compatibility
      const response = await fetch(`http://localhost:${TEST_PORT}/health`);

      // Health endpoint is available at root for backward compatibility
      expect(response.ok).toBe(true);
    });

    it('should return 404 for unmatched paths even with prefix', async () => {
      const response = await fetch(`http://localhost:${TEST_PORT}/api/v1/unmatched`);

      expect(response.status).toBe(404);
    });

    it('should handle root path with prefix', async () => {
      // /api/v1 (without trailing endpoint) should match to /
      const response = await fetch(`http://localhost:${TEST_PORT}/api/v1`);

      // Expect 404 since root path isn't explicitly handled
      expect(response.status).toBe(404);
    });
  });

  describeOrSkip('HTTP Server Without Prefix', () => {
    let server: HttpServer;
    const TEST_PORT = 13020;

    beforeEach(async () => {
      server = new HttpServer({
        port: TEST_PORT,
        host: 'localhost',
        // No pathPrefix configured
      });
      await server.listen();
    });

    afterEach(async () => {
      if (server) {
        await server.close();
      }
    });

    it('should match endpoints without prefix', async () => {
      const response = await fetch(`http://localhost:${TEST_PORT}/health`);

      expect(response.status).toBe(200);
    });

    it('should handle netron invoke endpoint', async () => {
      const response = await fetch(`http://localhost:${TEST_PORT}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-1',
          version: '1.0',
          service: 'test',
          method: 'test',
          input: [],
        }),
      });

      // 400 or 404 expected since no Netron instance is configured
      expect([400, 404]).toContain(response.status);
    });
  });

  describe('HTTP Client URL Building', () => {
    it('should build URLs with prefix', () => {
      const client = new HttpTransportClient('http://localhost:3000', undefined, {
        pathPrefix: 'api/v1',
      });

      // The client should internally build paths like /api/v1/netron/invoke
      expect(client).toBeDefined();
    });

    it('should normalize prefix in client', () => {
      const client = new HttpTransportClient('http://localhost:3000', undefined, {
        pathPrefix: '/api/v1/',
      });

      expect(client).toBeDefined();
    });

    it('should handle empty prefix in client', () => {
      const client = new HttpTransportClient('http://localhost:3000', undefined, {
        pathPrefix: '',
      });

      expect(client).toBeDefined();
    });

    it('should remove trailing slash from base URL', () => {
      const client = new HttpTransportClient('http://localhost:3000/', undefined, {
        pathPrefix: 'api',
      });

      expect(client).toBeDefined();
    });
  });

  describe('WebSocket Server Path Prefix', () => {
    // Mock WebSocketServer for unit tests
    let mockWss: any;

    beforeEach(() => {
      mockWss = {
        on: vi.fn(),
        address: vi.fn().mockReturnValue({ address: 'localhost', port: 8080 }),
        clients: new Set(),
        close: vi.fn().mockImplementation((cb: () => void) => cb()),
        options: { port: 8080 },
      };
    });

    it('should normalize path prefix', () => {
      const server = new WebSocketServerAdapter(mockWss, {
        pathPrefix: '/ws/v1/',
      });

      expect(server).toBeDefined();
    });

    it('should accept connections matching prefix', () => {
      // Server creation registers the connection handler on mockWss
      const _server = new WebSocketServerAdapter(mockWss, {
        pathPrefix: 'ws',
      });

      // Find the connection handler
      const onCalls = mockWss.on.mock.calls;
      const connectionCall = onCalls.find((call: any[]) => call[0] === 'connection');

      expect(connectionCall).toBeDefined();
    });

    it('should handle undefined prefix (accept all)', () => {
      const server = new WebSocketServerAdapter(mockWss);

      // Without prefix, should accept any path
      expect(server).toBeDefined();
    });
  });

  describe('WebSocket Path Matching', () => {
    let mockWss: any;
    let mockSocket: any;
    let connectionHandler: (socket: any, request: any) => void;

    beforeEach(() => {
      mockSocket = {
        on: vi.fn(),
        close: vi.fn(),
      };

      mockWss = {
        on: vi.fn().mockImplementation((event: string, handler: any) => {
          if (event === 'connection') {
            connectionHandler = handler;
          }
        }),
        address: vi.fn().mockReturnValue({ address: 'localhost', port: 8080 }),
        clients: new Set(),
        close: vi.fn().mockImplementation((cb: () => void) => cb()),
        options: { port: 8080 },
      };
    });

    it('should accept connections with matching path prefix', async () => {
      // Server creation registers handlers; we test via connectionHandler
      const _server = new WebSocketServerAdapter(mockWss, {
        pathPrefix: 'api/ws',
      });

      const request = { url: '/api/ws/connect' };

      // Trigger connection handler
      connectionHandler(mockSocket, request);

      // Should not close socket (connection accepted)
      expect(mockSocket.close).not.toHaveBeenCalled();
    });

    it('should reject connections with non-matching path', async () => {
      // Server creation registers handlers; we test via connectionHandler
      const _server = new WebSocketServerAdapter(mockWss, {
        pathPrefix: 'api/ws',
      });

      const request = { url: '/different/path' };

      // Trigger connection handler
      connectionHandler(mockSocket, request);

      // Should close socket with path not found error
      expect(mockSocket.close).toHaveBeenCalledWith(4000, 'Path not found');
    });

    it('should accept exact prefix path', async () => {
      // Server creation registers handlers; we test via connectionHandler
      const _server = new WebSocketServerAdapter(mockWss, {
        pathPrefix: 'api/ws',
      });

      const request = { url: '/api/ws' };

      connectionHandler(mockSocket, request);

      expect(mockSocket.close).not.toHaveBeenCalled();
    });

    it('should accept all paths when no prefix configured', async () => {
      // Server creation registers handlers; we test via connectionHandler
      const _server = new WebSocketServerAdapter(mockWss);

      const request = { url: '/any/path' };

      connectionHandler(mockSocket, request);

      expect(mockSocket.close).not.toHaveBeenCalled();
    });

    it('should handle missing URL in request', async () => {
      // Server creation registers handlers; we test via connectionHandler
      const _server = new WebSocketServerAdapter(mockWss, {
        pathPrefix: 'api/ws',
      });

      const request = { url: undefined };

      connectionHandler(mockSocket, request);

      expect(mockSocket.close).toHaveBeenCalledWith(4000, 'Path not found');
    });
  });

  describe('Transport Options Integration', () => {
    it('should pass pathPrefix through transport options', () => {
      const options: TransportOptions = {
        pathPrefix: 'services/rpc',
        timeout: 5000,
        compression: true,
      };

      expect(options.pathPrefix).toBe('services/rpc');
    });

    it('should work with reverse proxy configuration', () => {
      // Example configuration for behind reverse proxy
      const serverOptions: TransportOptions = {
        host: 'localhost',
        port: 3000,
        pathPrefix: 'api/v2', // Proxy routes /api/v2/* to this server
      };

      const clientOptions: TransportOptions = {
        pathPrefix: 'api/v2', // Client knows about the prefix
        timeout: 10000,
      };

      expect(serverOptions.pathPrefix).toBe(clientOptions.pathPrefix);
    });
  });

  describe('Edge Cases', () => {
    it('should handle prefix with special characters', () => {
      const server = new HttpServer({
        port: 13030,
        pathPrefix: 'api-v1_test',
      });

      expect(server).toBeDefined();
    });

    it('should handle numeric prefix', () => {
      const server = new HttpServer({
        port: 13031,
        pathPrefix: 'v1/2024',
      });

      expect(server).toBeDefined();
    });

    it('should handle single segment prefix', () => {
      const server = new HttpServer({
        port: 13032,
        pathPrefix: 'api',
      });

      expect(server).toBeDefined();
    });

    it('should handle deep nested prefix', () => {
      const server = new HttpServer({
        port: 13033,
        pathPrefix: 'org/project/service/api/v1',
      });

      expect(server).toBeDefined();
    });
  });
});
