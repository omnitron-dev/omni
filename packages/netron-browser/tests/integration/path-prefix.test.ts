/**
 * Path Prefix Integration Tests
 *
 * Tests path prefix handling with real HTTP calls to verify that
 * path-based routing works correctly through the gateway and backends.
 *
 * @module tests/integration/path-prefix.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createApiGateway, createMockBackend, type ApiGateway, type MockBackend } from '../fixtures/api-gateway.js';
import { createTitanServer, type TitanServerFixture } from '../fixtures/titan-server.js';
import { HttpClient } from '../../src/client/http-client.js';

// ============================================================================
// Test Services
// ============================================================================

const testServices = {
  'echo@1.0.0': {
    echo: (value: any) => value,
    echoWithPath: (value: any, pathInfo: any) => ({
      value,
      pathInfo,
      timestamp: Date.now(),
    }),
  },
  'health@1.0.0': {
    check: () => ({ status: 'healthy', timestamp: Date.now() }),
    detailed: () => ({
      status: 'healthy',
      uptime: process.uptime(),
      memory: process.memoryUsage().heapUsed,
    }),
  },
  'batch@1.0.0': {
    process: (items: any[]) => items.map((item, i) => ({ id: i, ...item, processed: true })),
    validate: (items: any[]) => ({ valid: items.length, invalid: 0 }),
  },
};

// ============================================================================
// Single Backend with Path Prefix Tests
// ============================================================================

describe('Single Backend with Path Prefix', () => {
  let gateway: ApiGateway;
  let backend: MockBackend;

  beforeAll(async () => {
    // Create a single backend
    backend = await createMockBackend(0, '/api', testServices);
    await backend.start();

    // Create gateway with single route
    gateway = await createApiGateway({
      port: 0,
      routes: [{ pathPrefix: '/api', target: backend.getUrl() }],
    });

    await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
    await backend.stop();
  });

  beforeEach(() => {
    gateway.clearRequestLog();
  });

  describe('Basic Path Prefix Routing', () => {
    it('should route requests with correct path prefix', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 5000,
      });

      await client.connect();

      const result = await client.invoke('echo@1.0.0', 'echo', ['hello']);
      expect(result).toBe('hello');

      // Verify the request went through the gateway
      const log = gateway.getRequestLog();
      expect(log.length).toBe(1);
      expect(log[0].matchedPrefix).toBe('/api');
      expect(log[0].url).toContain('/api/netron/invoke');

      await client.disconnect();
    });

    it('should strip path prefix when forwarding to backend', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 5000,
      });

      await client.connect();

      // The backend should receive /netron/invoke, not /api/netron/invoke
      const result = await client.invoke('echo@1.0.0', 'echo', ['test']);
      expect(result).toBe('test');

      // Verify the backend received the request
      expect(backend.getRequestCount()).toBeGreaterThan(0);

      await client.disconnect();
    });

    it('should handle multiple consecutive requests', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 5000,
      });

      await client.connect();

      for (let i = 0; i < 5; i++) {
        const result = await client.invoke('echo@1.0.0', 'echo', [i]);
        expect(result).toBe(i);
      }

      // All requests should have matched the same prefix
      const log = gateway.getRequestLog();
      expect(log.length).toBe(5);
      expect(log.every((entry) => entry.matchedPrefix === '/api')).toBe(true);

      await client.disconnect();
    });
  });

  describe('Health Check Through Prefix', () => {
    it('should access health service through path prefix', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 5000,
      });

      await client.connect();

      const health = await client.invoke('health@1.0.0', 'check', []);
      expect(health).toHaveProperty('status', 'healthy');
      expect(health).toHaveProperty('timestamp');

      await client.disconnect();
    });

    it('should get detailed health through path prefix', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 5000,
      });

      await client.connect();

      const health = await client.invoke('health@1.0.0', 'detailed', []);
      expect(health).toHaveProperty('status', 'healthy');
      expect(health).toHaveProperty('uptime');
      expect(health).toHaveProperty('memory');

      await client.disconnect();
    });
  });

  describe('Batch Requests Through Prefix', () => {
    it('should process batch requests through path prefix', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 5000,
      });

      await client.connect();

      const items = [{ name: 'item1' }, { name: 'item2' }, { name: 'item3' }];

      const result = await client.invoke('batch@1.0.0', 'process', [items]);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      expect(result[0]).toMatchObject({ id: 0, name: 'item1', processed: true });

      await client.disconnect();
    });

    it('should validate batch through path prefix', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 5000,
      });

      await client.connect();

      const items = [{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }];

      const result = await client.invoke('batch@1.0.0', 'validate', [items]);
      expect(result).toEqual({ valid: 4, invalid: 0 });

      await client.disconnect();
    });

    it('should handle large batch requests', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 10000,
      });

      await client.connect();

      const items = Array.from({ length: 100 }, (_, i) => ({ index: i, data: `item-${i}` }));

      const result = await client.invoke('batch@1.0.0', 'process', [items]);
      expect(result.length).toBe(100);

      await client.disconnect();
    });
  });

  describe('Error Responses with Path Context', () => {
    it('should return 404 for unknown path prefix', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/unknown`,
        timeout: 5000,
      });

      await client.connect();

      await expect(client.invoke('echo@1.0.0', 'echo', ['test'])).rejects.toThrow();

      // Verify error was logged
      const log = gateway.getRequestLog();
      expect(log.length).toBe(1);
      expect(log[0].matchedPrefix).toBeNull();
      expect(log[0].statusCode).toBe(404);

      await client.disconnect();
    });

    it('should propagate service errors through prefix', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 5000,
      });

      await client.connect();

      // Try to invoke non-existent service
      await expect(client.invoke('nonexistent@1.0.0', 'method', [])).rejects.toThrow(/not found/i);

      await client.disconnect();
    });

    it('should maintain path context in error responses', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 5000,
      });

      await client.connect();

      try {
        await client.invoke('nonexistent@1.0.0', 'method', []);
        expect.fail('Should have thrown');
      } catch (error: any) {
        // Error should contain service not found message
        expect(error.message).toMatch(/not found/i);
      }

      // Verify the request was properly routed
      const log = gateway.getRequestLog();
      expect(log.length).toBe(1);
      expect(log[0].matchedPrefix).toBe('/api');
      expect(log[0].statusCode).toBe(200); // Response was received (error in body)

      await client.disconnect();
    });
  });
});

// ============================================================================
// Multiple Path Prefixes Tests
// ============================================================================

describe('Multiple Path Prefixes', () => {
  let gateway: ApiGateway;
  let v1Backend: MockBackend;
  let v2Backend: MockBackend;
  let adminBackend: MockBackend;

  beforeAll(async () => {
    // Create backends for different API versions/purposes
    v1Backend = await createMockBackend(0, '/v1', {
      'api@1.0.0': {
        version: () => 'v1',
        data: (key: string) => ({ key, version: 'v1', data: `v1-${key}` }),
      },
    });

    v2Backend = await createMockBackend(0, '/v2', {
      'api@2.0.0': {
        version: () => 'v2',
        data: (key: string) => ({ key, version: 'v2', data: `v2-${key}`, enhanced: true }),
      },
    });

    adminBackend = await createMockBackend(0, '/admin', {
      'admin@1.0.0': {
        status: () => ({ adminMode: true, permissions: ['read', 'write', 'admin'] }),
        config: () => ({ debug: false, cache: true }),
      },
    });

    await Promise.all([v1Backend.start(), v2Backend.start(), adminBackend.start()]);

    gateway = await createApiGateway({
      port: 0,
      routes: [
        { pathPrefix: '/v1', target: v1Backend.getUrl() },
        { pathPrefix: '/v2', target: v2Backend.getUrl() },
        { pathPrefix: '/admin', target: adminBackend.getUrl() },
      ],
    });

    await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
    await Promise.all([v1Backend.stop(), v2Backend.stop(), adminBackend.stop()]);
  });

  beforeEach(() => {
    gateway.clearRequestLog();
  });

  describe('API Version Routing', () => {
    it('should route v1 requests to v1 backend', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/v1`,
        timeout: 5000,
      });

      await client.connect();

      const version = await client.invoke('api@1.0.0', 'version', []);
      expect(version).toBe('v1');

      const data = await client.invoke('api@1.0.0', 'data', ['test']);
      expect(data).toEqual({ key: 'test', version: 'v1', data: 'v1-test' });

      await client.disconnect();
    });

    it('should route v2 requests to v2 backend', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/v2`,
        timeout: 5000,
      });

      await client.connect();

      const version = await client.invoke('api@2.0.0', 'version', []);
      expect(version).toBe('v2');

      const data = await client.invoke('api@2.0.0', 'data', ['test']);
      expect(data).toEqual({ key: 'test', version: 'v2', data: 'v2-test', enhanced: true });

      await client.disconnect();
    });

    it('should route admin requests to admin backend', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/admin`,
        timeout: 5000,
      });

      await client.connect();

      const status = await client.invoke('admin@1.0.0', 'status', []);
      expect(status).toHaveProperty('adminMode', true);
      expect(status.permissions).toContain('admin');

      await client.disconnect();
    });
  });

  describe('Concurrent Multi-Prefix Requests', () => {
    it('should handle concurrent requests to different prefixes', async () => {
      const v1Client = new HttpClient({ url: `${gateway.getUrl()}/v1`, timeout: 5000 });
      const v2Client = new HttpClient({ url: `${gateway.getUrl()}/v2`, timeout: 5000 });
      const adminClient = new HttpClient({ url: `${gateway.getUrl()}/admin`, timeout: 5000 });

      await Promise.all([v1Client.connect(), v2Client.connect(), adminClient.connect()]);

      const [v1Result, v2Result, adminResult] = await Promise.all([
        v1Client.invoke('api@1.0.0', 'version', []),
        v2Client.invoke('api@2.0.0', 'version', []),
        adminClient.invoke('admin@1.0.0', 'status', []),
      ]);

      expect(v1Result).toBe('v1');
      expect(v2Result).toBe('v2');
      expect(adminResult).toHaveProperty('adminMode', true);

      // Verify all requests were routed correctly
      const log = gateway.getRequestLog();
      expect(log.length).toBe(3);

      const prefixes = log.map((entry) => entry.matchedPrefix);
      expect(prefixes).toContain('/v1');
      expect(prefixes).toContain('/v2');
      expect(prefixes).toContain('/admin');

      await Promise.all([v1Client.disconnect(), v2Client.disconnect(), adminClient.disconnect()]);
    });
  });

  describe('Prefix Priority and Matching', () => {
    it('should match the correct prefix for each request', async () => {
      const v1Client = new HttpClient({ url: `${gateway.getUrl()}/v1`, timeout: 5000 });

      await v1Client.connect();

      await v1Client.invoke('api@1.0.0', 'data', ['key1']);
      await v1Client.invoke('api@1.0.0', 'data', ['key2']);

      const log = gateway.getRequestLog();
      expect(log.length).toBe(2);
      expect(log.every((entry) => entry.matchedPrefix === '/v1')).toBe(true);

      await v1Client.disconnect();
    });
  });
});

// ============================================================================
// Path Prefix with Titan Server Tests
// ============================================================================

describe('Path Prefix with Titan Server', () => {
  let gateway: ApiGateway;
  let titanServer: TitanServerFixture;

  beforeAll(async () => {
    // Create real Titan server
    titanServer = await createTitanServer({
      enableHttp: true,
      enableWebSocket: false,
      logLevel: 'silent',
    });

    // Create gateway with path prefix
    gateway = await createApiGateway({
      port: 0,
      routes: [{ pathPrefix: '/api', target: titanServer.httpUrl }],
    });

    await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
    await titanServer.cleanup();
  });

  beforeEach(() => {
    gateway.clearRequestLog();
  });

  describe('Titan Services Through Path Prefix', () => {
    it('should access calculator service through prefix', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 5000,
      });

      await client.connect();

      const result = await client.invoke('calculator@1.0.0', 'add', [100, 200]);
      expect(result).toBe(300);

      // Verify routing
      const log = gateway.getRequestLog();
      expect(log.length).toBe(1);
      expect(log[0].matchedPrefix).toBe('/api');

      await client.disconnect();
    });

    it('should access user service through prefix', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 5000,
      });

      await client.connect();

      const user = await client.invoke('user@1.0.0', 'getUser', ['1']);
      expect(user).toMatchObject({
        id: '1',
        name: 'Alice',
      });

      await client.disconnect();
    });

    it('should access echo service through prefix', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 5000,
      });

      await client.connect();

      const testData = { foo: 'bar', nested: { deep: true } };
      const result = await client.invoke('echo@1.0.0', 'echoObject', [testData]);
      expect(result).toEqual(testData);

      await client.disconnect();
    });

    it('should handle errors through prefix correctly', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 5000,
      });

      await client.connect();

      await expect(client.invoke('calculator@1.0.0', 'divide', [10, 0])).rejects.toThrow('Division by zero');

      await client.disconnect();
    });
  });

  describe('High Load Through Path Prefix', () => {
    it('should handle many concurrent requests through prefix', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 10000,
      });

      await client.connect();

      const promises = Array.from({ length: 50 }, (_, i) => client.invoke('calculator@1.0.0', 'add', [i, i + 1]));

      const results = await Promise.all(promises);

      expect(results.length).toBe(50);
      results.forEach((result, i) => {
        expect(result).toBe(i + (i + 1));
      });

      // Verify all went through the gateway
      const log = gateway.getRequestLog();
      expect(log.length).toBe(50);
      expect(log.every((entry) => entry.matchedPrefix === '/api')).toBe(true);
      expect(log.every((entry) => entry.statusCode === 200)).toBe(true);

      await client.disconnect();
    });

    it('should maintain response ordering', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 10000,
      });

      await client.connect();

      // Send requests that return their input
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const promises = values.map((v) => client.invoke('echo@1.0.0', 'echoNumber', [v]));

      const results = await Promise.all(promises);

      // Results should match inputs (Promise.all preserves order)
      expect(results).toEqual(values);

      await client.disconnect();
    });
  });

  describe('Connection Lifecycle Through Prefix', () => {
    it('should connect and disconnect cleanly', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 5000,
      });

      expect(client.getState()).toBe('disconnected');

      await client.connect();
      expect(client.getState()).toBe('connected');

      // Make a request
      const result = await client.invoke('calculator@1.0.0', 'add', [1, 2]);
      expect(result).toBe(3);

      await client.disconnect();
      expect(client.getState()).toBe('disconnected');
    });

    it('should track metrics through prefix', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 5000,
      });

      await client.connect();

      const initialMetrics = client.getMetrics();
      expect(initialMetrics.requestsSent).toBe(0);

      await client.invoke('calculator@1.0.0', 'add', [1, 2]);
      await client.invoke('calculator@1.0.0', 'multiply', [3, 4]);
      await client.invoke('calculator@1.0.0', 'subtract', [10, 5]);

      const metrics = client.getMetrics();
      expect(metrics.requestsSent).toBe(3);
      expect(metrics.responsesReceived).toBe(3);
      expect(metrics.errors).toBe(0);
      expect(metrics.avgLatency).toBeGreaterThan(0);

      await client.disconnect();
    });
  });
});

// ============================================================================
// Nested Path Prefix Tests
// ============================================================================

describe('Nested Path Prefixes', () => {
  let gateway: ApiGateway;
  let apiBackend: MockBackend;
  let apiV1Backend: MockBackend;

  beforeAll(async () => {
    // Create backends for nested paths
    apiBackend = await createMockBackend(0, '/api', {
      'root@1.0.0': {
        info: () => ({ path: '/api', level: 'root' }),
      },
    });

    apiV1Backend = await createMockBackend(0, '/api/v1', {
      'nested@1.0.0': {
        info: () => ({ path: '/api/v1', level: 'nested' }),
      },
    });

    await Promise.all([apiBackend.start(), apiV1Backend.start()]);

    // Note: Longer prefixes should match first
    gateway = await createApiGateway({
      port: 0,
      routes: [
        { pathPrefix: '/api/v1', target: apiV1Backend.getUrl() },
        { pathPrefix: '/api', target: apiBackend.getUrl() },
      ],
    });

    await gateway.start();
  });

  afterAll(async () => {
    await gateway.stop();
    await Promise.all([apiBackend.stop(), apiV1Backend.stop()]);
  });

  beforeEach(() => {
    gateway.clearRequestLog();
  });

  describe('Prefix Matching Order', () => {
    it('should match longer prefix first', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api/v1`,
        timeout: 5000,
      });

      await client.connect();

      const result = await client.invoke('nested@1.0.0', 'info', []);
      expect(result).toEqual({ path: '/api/v1', level: 'nested' });

      const log = gateway.getRequestLog();
      expect(log[0].matchedPrefix).toBe('/api/v1');

      await client.disconnect();
    });

    it('should match shorter prefix for non-nested paths', async () => {
      const client = new HttpClient({
        url: `${gateway.getUrl()}/api`,
        timeout: 5000,
      });

      await client.connect();

      const result = await client.invoke('root@1.0.0', 'info', []);
      expect(result).toEqual({ path: '/api', level: 'root' });

      const log = gateway.getRequestLog();
      expect(log[0].matchedPrefix).toBe('/api');

      await client.disconnect();
    });
  });
});
