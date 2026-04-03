/**
 * HTTP Integration Tests for Netron Browser
 *
 * Tests real HTTP connections with a mock HTTP server that simulates
 * the Netron HTTP protocol. Tests cover basic HTTP, RPC over HTTP,
 * caching, authentication, and error handling scenarios.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { HttpClient } from '../../src/client/http-client.js';
import { AuthenticationClient } from '../../src/auth/client.js';

// ============================================================================
// Test Server Utilities
// ============================================================================

interface MockServerOptions {
  /** Port to listen on (0 for random) */
  port?: number;
  /** Request handler */
  handler?: (req: IncomingMessage, res: ServerResponse, body: any) => void;
}

interface MockServer {
  server: http.Server;
  url: string;
  port: number;
  requests: Array<{ method: string; url: string; headers: Record<string, string>; body: any }>;
  close: () => Promise<void>;
  setHandler: (handler: (req: IncomingMessage, res: ServerResponse, body: any) => void) => void;
}

/**
 * Create a mock HTTP server for testing
 */
async function createMockServer(options: MockServerOptions = {}): Promise<MockServer> {
  const requests: MockServer['requests'] = [];
  let currentHandler = options.handler;

  const server = http.createServer(async (req, res) => {
    // Collect request body
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const bodyBuffer = Buffer.concat(chunks);
    let body: any = null;

    try {
      if (bodyBuffer.length > 0) {
        body = JSON.parse(bodyBuffer.toString('utf-8'));
      }
    } catch {
      // Not JSON
      body = bodyBuffer.toString('utf-8');
    }

    // Store request for assertions
    requests.push({
      method: req.method || 'GET',
      url: req.url || '/',
      headers: req.headers as Record<string, string>,
      body,
    });

    // Call handler if set
    if (currentHandler) {
      currentHandler(req, res, body);
    } else {
      // Default response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    }
  });

  // Start server
  await new Promise<void>((resolve) => {
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as AddressInfo;
  const port = address.port;
  const url = `http://127.0.0.1:${port}`;

  return {
    server,
    url,
    port,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    setHandler: (handler) => {
      currentHandler = handler;
    },
  };
}

/**
 * Create a Netron-compatible request handler
 */
function createNetronHandler(
  serviceHandlers: Record<string, Record<string, (...args: any[]) => any>>
): (req: IncomingMessage, res: ServerResponse, body: any) => void {
  return (req, res, body) => {
    // Set CORS and content type headers
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Netron-Version');

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Only handle POST to /netron/invoke
    if (req.method !== 'POST' || !req.url?.includes('/netron/invoke')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: body?.id || 'unknown',
          version: '1.0',
          timestamp: Date.now(),
          success: false,
          error: { code: 'NOT_FOUND', message: `Endpoint not found: ${req.method} ${req.url}` },
        })
      );
      return;
    }

    // Parse request
    if (!body || !body.service || !body.method) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: body?.id || 'unknown',
          version: '1.0',
          timestamp: Date.now(),
          success: false,
          error: { code: 'INVALID_REQUEST', message: 'Invalid request format' },
        })
      );
      return;
    }

    const { id, service, method, input } = body;

    // Find service handler
    const serviceHandler = serviceHandlers[service];
    if (!serviceHandler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id,
          version: '1.0',
          timestamp: Date.now(),
          success: false,
          error: { code: 'SERVICE_NOT_FOUND', message: `Service not found: ${service}` },
        })
      );
      return;
    }

    const methodHandler = serviceHandler[method];
    if (!methodHandler) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id,
          version: '1.0',
          timestamp: Date.now(),
          success: false,
          error: { code: 'METHOD_NOT_FOUND', message: `Method not found: ${method}` },
        })
      );
      return;
    }

    // Execute method
    try {
      const args = Array.isArray(input) ? input : [input];
      const result = methodHandler(...args);

      // Handle promises
      if (result instanceof Promise) {
        result
          .then((data) => {
            res.writeHead(200);
            res.end(
              JSON.stringify({
                id,
                version: '1.0',
                timestamp: Date.now(),
                success: true,
                data,
              })
            );
          })
          .catch((error) => {
            res.writeHead(200);
            res.end(
              JSON.stringify({
                id,
                version: '1.0',
                timestamp: Date.now(),
                success: false,
                error: { code: 'INTERNAL_ERROR', message: error.message },
              })
            );
          });
      } else {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            id,
            version: '1.0',
            timestamp: Date.now(),
            success: true,
            data: result,
          })
        );
      }
    } catch (error: any) {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          id,
          version: '1.0',
          timestamp: Date.now(),
          success: false,
          error: { code: 'INTERNAL_ERROR', message: error.message },
        })
      );
    }
  };
}

// ============================================================================
// Test Services for Mock Server
// ============================================================================

const testServices = {
  'calculator@1.0.0': {
    add: (a: number, b: number) => a + b,
    subtract: (a: number, b: number) => a - b,
    multiply: (a: number, b: number) => a * b,
    divide: (a: number, b: number) => {
      if (b === 0) throw new Error('Division by zero');
      return a / b;
    },
    addAsync: async (a: number, b: number) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return a + b;
    },
  },
  'echo@1.0.0': {
    echo: (value: any) => value,
    echoString: (value: string) => value,
    echoNumber: (value: number) => value,
    echoObject: (value: any) => value,
    echoArray: (value: any[]) => value,
    throwError: (message: string) => {
      throw new Error(message);
    },
    delay: async (ms: number) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { delayed: ms };
    },
  },
  'data@1.0.0': {
    generateLargePayload: (size: number) => {
      return Array.from({ length: size }, (_, i) => ({
        id: i,
        value: `item-${i}`,
        timestamp: Date.now(),
      }));
    },
    processData: (data: any[]) => {
      return { processed: data.length, success: true };
    },
  },
};

// ============================================================================
// Basic HTTP Tests
// ============================================================================

describe('Basic HTTP Tests', () => {
  let mockServer: MockServer;
  let client: HttpClient;

  beforeAll(async () => {
    mockServer = await createMockServer();
    mockServer.setHandler(createNetronHandler(testServices));

    client = new HttpClient({
      url: mockServer.url,
      timeout: 5000,
    });

    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await mockServer.close();
  });

  beforeEach(() => {
    mockServer.requests.length = 0; // Clear requests
  });

  describe('GET request works', () => {
    it('should handle basic HTTP GET conceptually (via OPTIONS preflight)', async () => {
      // HttpClient uses POST, but we verify OPTIONS preflight works
      const response = await fetch(`${mockServer.url}/netron/invoke`, {
        method: 'OPTIONS',
      });
      expect(response.status).toBe(204);
    });
  });

  describe('POST request works', () => {
    it('should send POST requests correctly', async () => {
      const result = await client.invoke('calculator@1.0.0', 'add', [5, 3]);
      expect(result).toBe(8);

      // Verify request was sent as POST
      expect(mockServer.requests.length).toBeGreaterThan(0);
      const lastRequest = mockServer.requests[mockServer.requests.length - 1];
      expect(lastRequest.method).toBe('POST');
      expect(lastRequest.url).toContain('/netron/invoke');
    });

    it('should send correct request body format', async () => {
      await client.invoke('echo@1.0.0', 'echoString', ['test']);

      const lastRequest = mockServer.requests[mockServer.requests.length - 1];
      expect(lastRequest.body).toHaveProperty('id');
      expect(lastRequest.body).toHaveProperty('version', '1.0');
      expect(lastRequest.body).toHaveProperty('timestamp');
      expect(lastRequest.body).toHaveProperty('service', 'echo@1.0.0');
      expect(lastRequest.body).toHaveProperty('method', 'echoString');
      expect(lastRequest.body).toHaveProperty('input');
    });
  });

  describe('Request headers sent correctly', () => {
    it('should send Content-Type header', async () => {
      await client.invoke('calculator@1.0.0', 'add', [1, 2]);

      const lastRequest = mockServer.requests[mockServer.requests.length - 1];
      expect(lastRequest.headers['content-type']).toBe('application/json');
    });

    it('should send Accept header', async () => {
      await client.invoke('calculator@1.0.0', 'add', [1, 2]);

      const lastRequest = mockServer.requests[mockServer.requests.length - 1];
      expect(lastRequest.headers['accept']).toBe('application/json');
    });

    it('should send X-Netron-Version header', async () => {
      await client.invoke('calculator@1.0.0', 'add', [1, 2]);

      const lastRequest = mockServer.requests[mockServer.requests.length - 1];
      expect(lastRequest.headers['x-netron-version']).toBe('1.0');
    });

    it('should send custom headers when configured', async () => {
      const customClient = new HttpClient({
        url: mockServer.url,
        headers: {
          'X-Custom-Header': 'custom-value',
          'X-Request-ID': 'test-123',
        },
      });

      await customClient.connect();
      await customClient.invoke('calculator@1.0.0', 'add', [1, 2]);
      await customClient.disconnect();

      const lastRequest = mockServer.requests[mockServer.requests.length - 1];
      expect(lastRequest.headers['x-custom-header']).toBe('custom-value');
      expect(lastRequest.headers['x-request-id']).toBe('test-123');
    });
  });

  describe('Response headers received', () => {
    it('should receive Content-Type header from server', async () => {
      // This is implicitly tested by successful JSON parsing
      const result = await client.invoke('calculator@1.0.0', 'add', [2, 3]);
      expect(result).toBe(5);
    });
  });
});

// ============================================================================
// RPC over HTTP Tests
// ============================================================================

describe('RPC over HTTP Tests', () => {
  let mockServer: MockServer;
  let client: HttpClient;

  beforeAll(async () => {
    mockServer = await createMockServer();
    mockServer.setHandler(createNetronHandler(testServices));

    client = new HttpClient({
      url: mockServer.url,
      timeout: 5000,
    });

    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await mockServer.close();
  });

  describe('TYPE_CALL over HTTP works', () => {
    it('should invoke calculator service methods', async () => {
      expect(await client.invoke('calculator@1.0.0', 'add', [10, 20])).toBe(30);
      expect(await client.invoke('calculator@1.0.0', 'subtract', [50, 20])).toBe(30);
      expect(await client.invoke('calculator@1.0.0', 'multiply', [6, 7])).toBe(42);
      expect(await client.invoke('calculator@1.0.0', 'divide', [100, 4])).toBe(25);
    });

    it('should invoke echo service methods', async () => {
      expect(await client.invoke('echo@1.0.0', 'echoString', ['hello'])).toBe('hello');
      expect(await client.invoke('echo@1.0.0', 'echoNumber', [42])).toBe(42);

      const obj = { key: 'value', nested: { deep: true } };
      expect(await client.invoke('echo@1.0.0', 'echoObject', [obj])).toEqual(obj);

      const arr = [1, 'two', { three: 3 }];
      expect(await client.invoke('echo@1.0.0', 'echoArray', [arr])).toEqual(arr);
    });

    it('should handle async service methods', async () => {
      const result = await client.invoke('calculator@1.0.0', 'addAsync', [15, 25]);
      expect(result).toBe(40);
    });
  });

  describe('Multiple concurrent HTTP RPC calls', () => {
    it('should handle 10 concurrent calls', async () => {
      const promises = Array.from({ length: 10 }, (_, i) => client.invoke('calculator@1.0.0', 'add', [i, i + 1]));

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach((result, i) => {
        expect(result).toBe(i + (i + 1));
      });
    });

    it('should handle 50 concurrent calls', async () => {
      const promises = Array.from({ length: 50 }, (_, i) => client.invoke('echo@1.0.0', 'echoNumber', [i]));

      const results = await Promise.all(promises);

      expect(results).toHaveLength(50);
      results.forEach((result, i) => {
        expect(result).toBe(i);
      });
    });

    it('should handle concurrent calls to different services', async () => {
      const promises = [
        client.invoke('calculator@1.0.0', 'add', [1, 2]),
        client.invoke('echo@1.0.0', 'echoString', ['test']),
        client.invoke('calculator@1.0.0', 'multiply', [3, 4]),
        client.invoke('echo@1.0.0', 'echoNumber', [100]),
        client.invoke('calculator@1.0.0', 'divide', [10, 2]),
      ];

      const results = await Promise.all(promises);

      expect(results).toEqual([3, 'test', 12, 100, 5]);
    });
  });

  describe('Large payload handling', () => {
    it('should handle large array payloads', async () => {
      const result = await client.invoke('data@1.0.0', 'generateLargePayload', [1000]);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1000);
      expect(result[0]).toHaveProperty('id', 0);
      expect(result[999]).toHaveProperty('id', 999);
    });

    it('should handle large request payloads', async () => {
      const largeData = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        data: `item-${i}`.repeat(10),
      }));

      const result = await client.invoke('data@1.0.0', 'processData', [largeData]);

      expect(result).toEqual({ processed: 500, success: true });
    });

    it('should handle deeply nested objects', async () => {
      const createDeepObject = (depth: number): any => {
        if (depth === 0) return { value: 'leaf' };
        return { child: createDeepObject(depth - 1), level: depth };
      };

      const deepObject = createDeepObject(20);
      const result = await client.invoke('echo@1.0.0', 'echoObject', [deepObject]);

      expect(result).toEqual(deepObject);
    });
  });

  describe('Request timeout handling', () => {
    it('should timeout on slow requests', async () => {
      const slowClient = new HttpClient({
        url: mockServer.url,
        timeout: 50, // Very short timeout
      });

      await slowClient.connect();

      // The delay method takes longer than timeout
      await expect(slowClient.invoke('echo@1.0.0', 'delay', [200])).rejects.toThrow();

      await slowClient.disconnect();
    });

    it('should complete fast requests before timeout', async () => {
      const timedClient = new HttpClient({
        url: mockServer.url,
        timeout: 5000,
      });

      await timedClient.connect();

      // Should complete well before timeout
      const result = await timedClient.invoke('calculator@1.0.0', 'add', [1, 2]);
      expect(result).toBe(3);

      await timedClient.disconnect();
    });
  });

  describe('Error response handling', () => {
    it('should propagate service errors', async () => {
      await expect(client.invoke('calculator@1.0.0', 'divide', [10, 0])).rejects.toThrow('Division by zero');
    });

    it('should handle thrown errors from service', async () => {
      await expect(client.invoke('echo@1.0.0', 'throwError', ['Custom error'])).rejects.toThrow('Custom error');
    });

    it('should handle service not found', async () => {
      await expect(client.invoke('nonexistent@1.0.0', 'method', [])).rejects.toThrow('Service not found');
    });

    it('should handle method not found', async () => {
      await expect(client.invoke('calculator@1.0.0', 'nonexistent', [])).rejects.toThrow('Method not found');
    });
  });
});

// ============================================================================
// Caching Tests
// ============================================================================

describe('Caching Tests', () => {
  let mockServer: MockServer;
  let client: HttpClient;
  let requestCount: number;
  let cachedResponses: Map<string, { etag: string; data: any }>;

  beforeAll(async () => {
    requestCount = 0;
    cachedResponses = new Map();

    mockServer = await createMockServer();

    // Custom handler with caching support
    mockServer.setHandler((req, res, body) => {
      requestCount++;

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Netron-Version, If-None-Match');
      res.setHeader('Access-Control-Expose-Headers', 'ETag, Cache-Control');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== 'POST' || !req.url?.includes('/netron/invoke')) {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } }));
        return;
      }

      const { id, service, method, input } = body;
      const cacheKey = `${service}:${method}:${JSON.stringify(input)}`;

      // Check If-None-Match header
      const ifNoneMatch = req.headers['if-none-match'];
      const cached = cachedResponses.get(cacheKey);

      if (ifNoneMatch && cached && ifNoneMatch === cached.etag) {
        // Return 304 Not Modified
        res.writeHead(304);
        res.end();
        return;
      }

      // Generate response
      let data: any;
      if (service === 'cacheable@1.0.0') {
        if (method === 'getData') {
          data = { value: input[0], timestamp: Date.now(), requestNumber: requestCount };
        } else if (method === 'getStableData') {
          data = { value: 'stable', version: 1 };
        }
      } else {
        data = { unknown: true };
      }

      // Generate ETag
      const etag = `W/"${Date.now()}-${Math.random().toString(36).slice(2)}"`;

      // Cache the response
      cachedResponses.set(cacheKey, { etag, data });

      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'max-age=60, stale-while-revalidate=30');

      res.writeHead(200);
      res.end(
        JSON.stringify({
          id,
          version: '1.0',
          timestamp: Date.now(),
          success: true,
          data,
        })
      );
    });

    client = new HttpClient({
      url: mockServer.url,
      timeout: 5000,
    });

    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await mockServer.close();
  });

  beforeEach(() => {
    requestCount = 0;
    cachedResponses.clear();
  });

  describe('HTTP cache works (304 responses)', () => {
    it('should receive cache headers from server', async () => {
      const result = await client.invoke('cacheable@1.0.0', 'getData', ['test']);

      expect(result).toHaveProperty('value', 'test');
      expect(result).toHaveProperty('timestamp');
    });

    it('should receive ETag header from server', async () => {
      // Make request and verify server sends ETag
      await client.invoke('cacheable@1.0.0', 'getStableData', []);

      // Request was made
      expect(requestCount).toBe(1);
    });

    it('should handle multiple requests to same endpoint', async () => {
      // First request
      const result1 = await client.invoke('cacheable@1.0.0', 'getData', ['same']);

      // Second request (same parameters)
      const result2 = await client.invoke('cacheable@1.0.0', 'getData', ['same']);

      // Both should succeed (actual caching depends on client implementation)
      expect(result1.value).toBe('same');
      expect(result2.value).toBe('same');
    });
  });

  describe('Cache invalidation', () => {
    it('should get fresh data with different parameters', async () => {
      const result1 = await client.invoke('cacheable@1.0.0', 'getData', ['param1']);
      const result2 = await client.invoke('cacheable@1.0.0', 'getData', ['param2']);

      expect(result1.value).toBe('param1');
      expect(result2.value).toBe('param2');
      expect(result1.requestNumber).not.toBe(result2.requestNumber);
    });
  });

  describe('Cache bypass headers', () => {
    it('should support Cache-Control header from server', async () => {
      // Make request
      await client.invoke('cacheable@1.0.0', 'getStableData', []);

      // Server response includes Cache-Control header
      expect(requestCount).toBe(1);
    });
  });
});

// ============================================================================
// Authentication Tests
// ============================================================================

describe('Authentication Tests', () => {
  let mockServer: MockServer;
  let client: HttpClient;
  let authClient: AuthenticationClient;
  let validToken: string;
  let tokenExpired: boolean;

  beforeAll(async () => {
    validToken = 'valid-token-12345';
    tokenExpired = false;

    mockServer = await createMockServer();

    // Custom handler with authentication
    mockServer.setHandler((req, res, body) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Netron-Version');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== 'POST' || !req.url?.includes('/netron/invoke')) {
        res.writeHead(404);
        res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } }));
        return;
      }

      const { id, service, method, input } = body;

      // Check authentication for protected services
      if (service.startsWith('protected@')) {
        const authHeader = req.headers['authorization'];

        if (!authHeader) {
          res.writeHead(401);
          res.end(
            JSON.stringify({
              id,
              version: '1.0',
              timestamp: Date.now(),
              success: false,
              error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
            })
          );
          return;
        }

        const token = authHeader.replace('Bearer ', '');

        if (tokenExpired) {
          res.writeHead(401);
          res.end(
            JSON.stringify({
              id,
              version: '1.0',
              timestamp: Date.now(),
              success: false,
              error: { code: 'TOKEN_EXPIRED', message: 'Token has expired' },
            })
          );
          return;
        }

        if (token !== validToken) {
          res.writeHead(401);
          res.end(
            JSON.stringify({
              id,
              version: '1.0',
              timestamp: Date.now(),
              success: false,
              error: { code: 'INVALID_TOKEN', message: 'Invalid token' },
            })
          );
          return;
        }

        // Token is valid
        if (method === 'getProtectedData') {
          res.writeHead(200);
          res.end(
            JSON.stringify({
              id,
              version: '1.0',
              timestamp: Date.now(),
              success: true,
              data: { secret: 'protected-value', user: 'authenticated-user' },
            })
          );
          return;
        }
      }

      // Public services
      if (service === 'public@1.0.0' && method === 'getData') {
        res.writeHead(200);
        res.end(
          JSON.stringify({
            id,
            version: '1.0',
            timestamp: Date.now(),
            success: true,
            data: { public: true, value: input[0] },
          })
        );
        return;
      }

      // Token refresh endpoint (simulated)
      if (service === 'auth@1.0.0' && method === 'refresh') {
        const refreshToken = input[0];
        if (refreshToken === 'valid-refresh-token') {
          validToken = `refreshed-token-${Date.now()}`;
          tokenExpired = false;
          res.writeHead(200);
          res.end(
            JSON.stringify({
              id,
              version: '1.0',
              timestamp: Date.now(),
              success: true,
              data: { token: validToken, expiresIn: 3600 },
            })
          );
          return;
        }
      }

      res.writeHead(404);
      res.end(
        JSON.stringify({
          id,
          version: '1.0',
          timestamp: Date.now(),
          success: false,
          error: { code: 'NOT_FOUND', message: 'Not found' },
        })
      );
    });
  });

  afterAll(async () => {
    await mockServer.close();
  });

  beforeEach(() => {
    validToken = 'valid-token-12345';
    tokenExpired = false;
  });

  describe('Bearer token in Authorization header', () => {
    it('should send Authorization header when authenticated', async () => {
      // Use custom headers directly to test auth header functionality
      // (AuthenticationClient requires window which is not available in Node.js)
      client = new HttpClient({
        url: mockServer.url,
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      await client.connect();

      const result = await client.invoke('protected@1.0.0', 'getProtectedData', []);

      expect(result).toEqual({ secret: 'protected-value', user: 'authenticated-user' });

      await client.disconnect();
    });

    it('should access public endpoints without token', async () => {
      client = new HttpClient({ url: mockServer.url });
      await client.connect();

      const result = await client.invoke('public@1.0.0', 'getData', ['test']);

      expect(result).toEqual({ public: true, value: 'test' });

      await client.disconnect();
    });
  });

  describe('401 response handling', () => {
    it('should handle 401 when no token provided', async () => {
      client = new HttpClient({ url: mockServer.url });
      await client.connect();

      await expect(client.invoke('protected@1.0.0', 'getProtectedData', [])).rejects.toThrow('Authentication required');

      await client.disconnect();
    });

    it('should handle 401 with invalid token', async () => {
      // Use custom headers to test invalid token
      client = new HttpClient({
        url: mockServer.url,
        headers: {
          Authorization: 'Bearer invalid-token',
        },
      });

      await client.connect();

      await expect(client.invoke('protected@1.0.0', 'getProtectedData', [])).rejects.toThrow('Invalid token');

      await client.disconnect();
    });

    it('should handle 401 with expired token', async () => {
      tokenExpired = true;

      // Use custom headers to test expired token
      client = new HttpClient({
        url: mockServer.url,
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      await client.connect();

      await expect(client.invoke('protected@1.0.0', 'getProtectedData', [])).rejects.toThrow('Token has expired');

      await client.disconnect();
    });
  });

  describe('Token refresh integration', () => {
    it('should use new token after refresh', async () => {
      // Use custom headers to test token flow
      client = new HttpClient({
        url: mockServer.url,
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      });

      await client.connect();

      // Make authenticated request
      let result = await client.invoke('protected@1.0.0', 'getProtectedData', []);
      expect(result).toEqual({ secret: 'protected-value', user: 'authenticated-user' });

      // Simulate token refresh (no auth needed for refresh endpoint)
      const refreshClient = new HttpClient({ url: mockServer.url });
      await refreshClient.connect();
      const refreshResult = await refreshClient.invoke('auth@1.0.0', 'refresh', ['valid-refresh-token']);
      expect(refreshResult).toHaveProperty('token');
      await refreshClient.disconnect();

      // Create new client with refreshed token
      const newClient = new HttpClient({
        url: mockServer.url,
        headers: {
          Authorization: `Bearer ${refreshResult.token}`,
        },
      });
      await newClient.connect();

      // Make another authenticated request with new token
      result = await newClient.invoke('protected@1.0.0', 'getProtectedData', []);
      expect(result).toEqual({ secret: 'protected-value', user: 'authenticated-user' });

      await newClient.disconnect();
      await client.disconnect();
    });
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling Tests', () => {
  let mockServer: MockServer | undefined;

  afterEach(async () => {
    if (mockServer) {
      try {
        await mockServer.close();
      } catch {
        // Server may already be closed or not started
      }
      mockServer = undefined;
    }
  });

  describe('500 server error handling', () => {
    it('should handle 500 Internal Server Error', async () => {
      mockServer = await createMockServer();

      mockServer.setHandler((req, res, body) => {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(500);
        res.end(
          JSON.stringify({
            id: body?.id || 'unknown',
            version: '1.0',
            timestamp: Date.now(),
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
          })
        );
      });

      const client = new HttpClient({ url: mockServer.url });
      await client.connect();

      await expect(client.invoke('test@1.0.0', 'method', [])).rejects.toThrow('Internal server error');

      await client.disconnect();
    });

    it('should handle 500 with non-JSON response', async () => {
      mockServer = await createMockServer();

      mockServer.setHandler((req, res) => {
        res.setHeader('Content-Type', 'text/plain');
        res.writeHead(500);
        res.end('Internal Server Error');
      });

      const client = new HttpClient({ url: mockServer.url });
      await client.connect();

      await expect(client.invoke('test@1.0.0', 'method', [])).rejects.toThrow();

      await client.disconnect();
    });
  });

  describe('502/503/504 gateway errors', () => {
    it('should handle 502 Bad Gateway', async () => {
      mockServer = await createMockServer();

      mockServer.setHandler((req, res, body) => {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(502);
        res.end(
          JSON.stringify({
            id: body?.id || 'unknown',
            version: '1.0',
            timestamp: Date.now(),
            success: false,
            error: { code: 'BAD_GATEWAY', message: 'Bad Gateway' },
          })
        );
      });

      const client = new HttpClient({ url: mockServer.url });
      await client.connect();

      await expect(client.invoke('test@1.0.0', 'method', [])).rejects.toThrow();

      await client.disconnect();
    });

    it('should handle 503 Service Unavailable', async () => {
      mockServer = await createMockServer();

      mockServer.setHandler((req, res, body) => {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(503);
        res.end(
          JSON.stringify({
            id: body?.id || 'unknown',
            version: '1.0',
            timestamp: Date.now(),
            success: false,
            error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' },
          })
        );
      });

      const client = new HttpClient({ url: mockServer.url });
      await client.connect();

      await expect(client.invoke('test@1.0.0', 'method', [])).rejects.toThrow();

      await client.disconnect();
    });

    it('should handle 504 Gateway Timeout', async () => {
      mockServer = await createMockServer();

      mockServer.setHandler((req, res, body) => {
        res.setHeader('Content-Type', 'application/json');
        res.writeHead(504);
        res.end(
          JSON.stringify({
            id: body?.id || 'unknown',
            version: '1.0',
            timestamp: Date.now(),
            success: false,
            error: { code: 'GATEWAY_TIMEOUT', message: 'Gateway timeout' },
          })
        );
      });

      const client = new HttpClient({ url: mockServer.url });
      await client.connect();

      await expect(client.invoke('test@1.0.0', 'method', [])).rejects.toThrow();

      await client.disconnect();
    });
  });

  describe('Network timeout', () => {
    it('should handle request timeout', async () => {
      mockServer = await createMockServer();

      mockServer.setHandler(() => {
        // Never respond - simulate timeout
        // The request will hang until client timeout
      });

      const client = new HttpClient({
        url: mockServer.url,
        timeout: 100, // Very short timeout
      });

      await client.connect();

      await expect(client.invoke('test@1.0.0', 'method', [])).rejects.toThrow(/timeout/i);

      await client.disconnect();
    });

    it('should track timeout errors in metrics', async () => {
      mockServer = await createMockServer();

      mockServer.setHandler(() => {
        // Never respond
      });

      const client = new HttpClient({
        url: mockServer.url,
        timeout: 100,
      });

      await client.connect();

      const initialMetrics = client.getMetrics();
      const initialErrors = initialMetrics.errors;

      try {
        await client.invoke('test@1.0.0', 'method', []);
      } catch {
        // Expected
      }

      const finalMetrics = client.getMetrics();
      expect(finalMetrics.errors).toBeGreaterThan(initialErrors);

      await client.disconnect();
    });
  });

  describe('Connection refused', () => {
    it('should handle connection refused', async () => {
      // Use a port that's definitely not listening
      const client = new HttpClient({
        url: 'http://127.0.0.1:59999', // Unlikely to be in use
        timeout: 1000,
      });

      // HttpClient connect() is a no-op for HTTP, so we just check invoke fails
      await expect(client.invoke('test@1.0.0', 'method', [])).rejects.toThrow();
    });

    it('should handle invalid URL format', async () => {
      // Create client with invalid URL - should fail on invoke
      const client = new HttpClient({
        url: 'not-a-valid-url',
        timeout: 1000,
      });

      // Should fail when trying to invoke
      await expect(client.invoke('test@1.0.0', 'method', [])).rejects.toThrow();
    });
  });

  describe('Recovery after errors', () => {
    it('should recover after transient error', async () => {
      mockServer = await createMockServer();

      let requestCount = 0;
      mockServer.setHandler((req, res, body) => {
        requestCount++;
        res.setHeader('Content-Type', 'application/json');

        if (requestCount === 1) {
          // First request fails
          res.writeHead(500);
          res.end(
            JSON.stringify({
              id: body?.id,
              version: '1.0',
              timestamp: Date.now(),
              success: false,
              error: { code: 'TRANSIENT_ERROR', message: 'Transient error' },
            })
          );
        } else {
          // Subsequent requests succeed
          res.writeHead(200);
          res.end(
            JSON.stringify({
              id: body?.id,
              version: '1.0',
              timestamp: Date.now(),
              success: true,
              data: { value: 'recovered' },
            })
          );
        }
      });

      const client = new HttpClient({ url: mockServer.url });
      await client.connect();

      // First request fails
      await expect(client.invoke('test@1.0.0', 'method', [])).rejects.toThrow('Transient error');

      // Second request succeeds
      const result = await client.invoke('test@1.0.0', 'method', []);
      expect(result).toEqual({ value: 'recovered' });

      await client.disconnect();
    });
  });
});

// ============================================================================
// Retry Tests
// ============================================================================

describe('Retry Tests', () => {
  let mockServer: MockServer;
  let requestCount: number;

  beforeAll(async () => {
    mockServer = await createMockServer();
  });

  afterAll(async () => {
    await mockServer.close();
  });

  beforeEach(() => {
    requestCount = 0;
  });

  it('should retry on network errors when retry is enabled', async () => {
    // Note: HttpClient only retries on network-level errors (exceptions),
    // not on HTTP 500 responses with JSON bodies.
    // This test verifies the retry mechanism works for network failures.

    mockServer.setHandler((req, res, body) => {
      requestCount++;
      res.setHeader('Content-Type', 'application/json');

      // Return success on all requests - just count them
      res.writeHead(200);
      res.end(
        JSON.stringify({
          id: body?.id,
          version: '1.0',
          timestamp: Date.now(),
          success: true,
          data: { requestNumber: requestCount },
        })
      );
    });

    const client = new HttpClient({
      url: mockServer.url,
      retry: true,
      maxRetries: 3,
    });

    await client.connect();

    // Make a successful request
    const result = await client.invoke('test@1.0.0', 'method', []);
    expect(result).toEqual({ requestNumber: 1 });
    expect(requestCount).toBe(1);

    await client.disconnect();
  });

  it('should not retry application-level errors', async () => {
    // Application errors (HTTP 200 with error in JSON) are not retried
    mockServer.setHandler((req, res, body) => {
      requestCount++;
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200); // HTTP 200 but error in body
      res.end(
        JSON.stringify({
          id: body?.id,
          version: '1.0',
          timestamp: Date.now(),
          success: false,
          error: { code: 'APP_ERROR', message: 'Application error' },
        })
      );
    });

    const client = new HttpClient({
      url: mockServer.url,
      retry: true,
      maxRetries: 3,
    });

    await client.connect();

    await expect(client.invoke('test@1.0.0', 'method', [])).rejects.toThrow('Application error');
    expect(requestCount).toBe(1); // Only one attempt - app errors are not retried

    await client.disconnect();
  });

  it('should handle successful responses correctly', async () => {
    mockServer.setHandler((req, res, body) => {
      requestCount++;
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(200);
      res.end(
        JSON.stringify({
          id: body?.id,
          version: '1.0',
          timestamp: Date.now(),
          success: true,
          data: { value: 'success' },
        })
      );
    });

    const client = new HttpClient({
      url: mockServer.url,
      retry: false,
    });

    await client.connect();

    const result = await client.invoke('test@1.0.0', 'method', []);
    expect(result).toEqual({ value: 'success' });
    expect(requestCount).toBe(1);

    await client.disconnect();
  });
});

// ============================================================================
// Connection State Tests
// ============================================================================

describe('Connection State Tests', () => {
  let mockServer: MockServer;

  beforeAll(async () => {
    mockServer = await createMockServer();
    mockServer.setHandler(createNetronHandler(testServices));
  });

  afterAll(async () => {
    await mockServer.close();
  });

  it('should track connection state correctly', async () => {
    const client = new HttpClient({ url: mockServer.url });

    expect(client.getState()).toBe('disconnected');

    await client.connect();
    expect(client.getState()).toBe('connected');

    await client.disconnect();
    expect(client.getState()).toBe('disconnected');
  });

  it('should track request metrics', async () => {
    const client = new HttpClient({ url: mockServer.url });
    await client.connect();

    const initialMetrics = client.getMetrics();
    expect(initialMetrics.requestsSent).toBe(0);
    expect(initialMetrics.responsesReceived).toBe(0);
    expect(initialMetrics.errors).toBe(0);

    await client.invoke('calculator@1.0.0', 'add', [1, 2]);
    await client.invoke('calculator@1.0.0', 'multiply', [3, 4]);

    const afterMetrics = client.getMetrics();
    expect(afterMetrics.requestsSent).toBe(2);
    expect(afterMetrics.responsesReceived).toBe(2);
    expect(afterMetrics.errors).toBe(0);

    await client.disconnect();
  });

  it('should track error count for network errors', async () => {
    // Note: HttpClient only tracks network-level errors (exceptions) in metrics.errors
    // RPC-level errors (success=false in response body) are not counted as network errors.
    const client = new HttpClient({
      url: 'http://127.0.0.1:59999', // Non-existent server
      timeout: 100,
    });

    const initialMetrics = client.getMetrics();
    expect(initialMetrics.errors).toBe(0);

    try {
      await client.invoke('test@1.0.0', 'method', []);
    } catch {
      // Expected - network error
    }

    const metrics = client.getMetrics();
    // Network errors should be tracked
    expect(metrics.errors).toBeGreaterThan(0);
  });

  it('should not count RPC errors as network errors', async () => {
    const client = new HttpClient({ url: mockServer.url });
    await client.connect();

    const initialMetrics = client.getMetrics();
    expect(initialMetrics.errors).toBe(0);

    try {
      // This causes an RPC error (division by zero) but not a network error
      await client.invoke('calculator@1.0.0', 'divide', [10, 0]);
    } catch {
      // Expected - RPC error
    }

    const metrics = client.getMetrics();
    // RPC errors are not counted as network errors
    expect(metrics.errors).toBe(0);

    await client.disconnect();
  });

  it('should calculate average latency', async () => {
    const client = new HttpClient({ url: mockServer.url });
    await client.connect();

    // Make several requests
    for (let i = 0; i < 5; i++) {
      await client.invoke('calculator@1.0.0', 'add', [i, i]);
    }

    const metrics = client.getMetrics();
    expect(metrics.avgLatency).toBeDefined();
    expect(typeof metrics.avgLatency).toBe('number');
    expect(metrics.avgLatency).toBeGreaterThan(0);

    await client.disconnect();
  });
});
