/**
 * Integration tests for Enhanced HTTP Transport Features
 *
 * Tests the enhanced features of the main HTTP server:
 * - Middleware pipeline
 * - Route caching
 * - Enhanced metrics
 * - Health/metrics endpoints
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { HttpServer } from '../../../../src/netron/transport/http/http-server.js';
import { HttpTransport } from '../../../../src/netron/transport/http/http-transport.js';
import { Netron } from '../../../../src/netron/netron.js';
import { LocalPeer } from '../../../../src/netron/local-peer.js';
import { Definition } from '../../../../src/netron/definition.js';
import { NetronBuiltinMiddleware } from '../../../../src/netron/middleware/index.js';
import { TitanError, ErrorCode } from '../../../../src/errors/index.js';
import { createMockLogger } from '../../test-utils.js';
import { Service, Public } from '../../../../src/decorators/core.js';

// Test service class
@Service('TestService', '1.0.0')
class TestService {
  @Public()
  async echo(input: { message: string }) {
    return { message: input.message };
  }

  @Public()
  async add(input: { a: number; b: number }) {
    return { result: input.a + input.b };
  }

  @Public()
  async slowMethod(input: { delay: number }) {
    await new Promise(resolve => setTimeout(resolve, input.delay));
    return { completed: true };
  }

  @Public()
  async errorMethod() {
    throw new TitanError({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Test error'
    });
  }

  @Public()
  async *streamMethod(input: { count: number }) {
    for (let i = 0; i < input.count; i++) {
      yield { index: i };
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}

describe('Enhanced HTTP Transport Features', () => {
  let server: HttpServer;
  let transport: HttpTransport;
  let netron: Netron;
  let peer: LocalPeer;
  let baseUrl: string;
  const port = 4500;

  beforeAll(async () => {
    // Create Netron instance with mock logger
    const logger = createMockLogger();
    netron = new Netron(logger);

    // Create server with enhanced features enabled
    server = new HttpServer({
      port,
      host: 'localhost',
      cors: true,
      maxBodySize: 10 * 1024 * 1024,
      requestTimeout: 5000,
      compression: true,
      middleware: {
        metrics: true,
        logging: false
      }
    });

    transport = new HttpTransport();
    peer = new LocalPeer(netron);

    // Register test service
    const testService = new TestService();
    const definition = await peer.exposeService(testService);
    server.setPeer(peer);

    // Register routes for the service
    server.registerService('TestService', definition);

    // Start server
    await server.listen();
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  describe('Basic Functionality', () => {
    it('should handle discovery requests', async () => {
      const response = await fetch(`${baseUrl}/netron/discovery`);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.services).toHaveProperty('TestService');
      expect(data.services.TestService).toBeDefined();
      expect(data.services.TestService.meta).toBeDefined();
      expect(data.services.TestService.meta.name).toBe('TestService');
      // Check if methods are present
      expect(Object.keys(data.services.TestService.meta.methods || {})).toContain('echo');
    });

    it('should handle health checks', async () => {
      const response = await fetch(`${baseUrl}/health`);
      expect(response.status).toBe(200);

      const health = await response.json();
      expect(health.status).toBe('online');
      expect(health.uptime).toBeGreaterThan(0);
    });

    it('should expose metrics endpoint', async () => {
      const response = await fetch(`${baseUrl}/metrics`);
      expect(response.status).toBe(200);

      const metrics = await response.json();
      expect(metrics.requests.totalRequests).toBeGreaterThanOrEqual(2); // discovery + health
      expect(metrics.server.uptime).toBeGreaterThan(0);
    });

    it('should handle RPC-style requests', async () => {
      const response = await fetch(`${baseUrl}/rpc/TestService/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello World' })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.message).toBe('Hello World');
    });

    it('should handle method with multiple parameters', async () => {
      const response = await fetch(`${baseUrl}/rpc/TestService/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ a: 5, b: 3 })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.result).toBe(8);
    });

    it('should handle errors properly', async () => {
      const response = await fetch(`${baseUrl}/rpc/TestService/errorMethod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(500);
      const error = await response.json();
      expect(error.error).toBeDefined();
      expect(error.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    });

    it('should return 404 for non-existent routes', async () => {
      const response = await fetch(`${baseUrl}/rpc/NonExistent/method`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(404);
    });
  });

  describe('Middleware Pipeline', () => {
    let middlewareServer: HttpServer;
    let middlewarePort = 4501;

    beforeEach(async () => {
      middlewareServer = new HttpServer({
        port: middlewarePort++,
        host: 'localhost'
      });

      const middlewareNetron = new Netron(createMockLogger());
      const localPeer = new LocalPeer(middlewareNetron);
      const testService = new TestService();
      const definition = await localPeer.exposeService(testService);
      middlewareServer.setPeer(localPeer);
      middlewareServer.registerService('TestService', definition);
    });

    afterEach(async () => {
      await middlewareServer.close();
    });

    it('should execute middleware in order', async () => {
      const order: string[] = [];

      middlewareServer.use(
        async (ctx, next) => {
          order.push('middleware1-before');
          await next();
          order.push('middleware1-after');
        },
        { name: 'middleware1', priority: 10 }
      );

      middlewareServer.use(
        async (ctx, next) => {
          order.push('middleware2-before');
          await next();
          order.push('middleware2-after');
        },
        { name: 'middleware2', priority: 20 }
      );

      await middlewareServer.listen();
      const url = `http://localhost:${middlewarePort - 1}`;

      const response = await fetch(`${url}/rpc/TestService/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'test' })
      });

      expect(response.status).toBe(200);
      expect(order).toEqual([
        'middleware1-before',
        'middleware2-before',
        'middleware2-after',
        'middleware1-after'
      ]);
    });

    it('should handle middleware errors', async () => {
      middlewareServer.use(
        async (ctx, next) => {
          throw new Error('Middleware error');
        },
        { name: 'error-middleware', priority: 10 }
      );

      await middlewareServer.listen();
      const url = `http://localhost:${middlewarePort - 1}`;

      const response = await fetch(`${url}/rpc/TestService/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'test' })
      });

      expect(response.status).toBe(500);
    });

    it('should skip remaining middleware when skipRemaining is set', async () => {
      const executed: string[] = [];

      middlewareServer.use(
        async (ctx, next) => {
          executed.push('middleware1');
          ctx.response = new Response('Early response', { status: 200 });
          ctx.skipRemaining = true;
        },
        { name: 'early-response', priority: 10 }
      );

      middlewareServer.use(
        async (ctx, next) => {
          executed.push('middleware2');
          await next();
        },
        { name: 'should-not-run', priority: 20 }
      );

      await middlewareServer.listen();
      const url = `http://localhost:${middlewarePort - 1}`;

      const response = await fetch(`${url}/rpc/TestService/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'test' })
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('Early response');
      expect(executed).toEqual(['middleware1']);
    });
  });

  describe('Built-in Middleware', () => {
    it('should handle CORS preflight requests', async () => {
      const response = await fetch(`${baseUrl}/rpc/TestService/echo`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://example.com',
          'Access-Control-Request-Method': 'POST'
        }
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('should add request ID to responses', async () => {
      const response = await fetch(`${baseUrl}/rpc/TestService/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'test' })
      });

      expect(response.headers.get('X-Request-ID')).toBeTruthy();
    });

    it('should preserve custom request ID', async () => {
      const customId = 'custom-request-id-123';
      const response = await fetch(`${baseUrl}/rpc/TestService/echo`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': customId
        },
        body: JSON.stringify({ message: 'test' })
      });

      expect(response.headers.get('X-Request-ID')).toBe(customId);
    });

    it('should add response time header', async () => {
      const response = await fetch(`${baseUrl}/rpc/TestService/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'test' })
      });

      const responseTime = response.headers.get('X-Response-Time');
      expect(responseTime).toBeTruthy();
      expect(responseTime).toMatch(/^\d+\.\d+ms$/);
    });
  });

  describe('Rate Limiting', () => {
    let rateLimitServer: HttpServer;
    const rateLimitPort = 4510;

    beforeAll(async () => {
      rateLimitServer = new HttpServer({
        port: rateLimitPort,
        host: 'localhost'
      });

      // Add rate limiting middleware
      rateLimitServer.use(
        NetronBuiltinMiddleware.rateLimit({
          windowMs: 1000,
          max: 5
        }),
        { name: 'rate-limit', priority: 5 }
      );

      const rateLimitNetron = new Netron(createMockLogger());
      const localPeer = new LocalPeer(rateLimitNetron);
      const testService = new TestService();
      const definition = await localPeer.exposeService(testService);
      rateLimitServer.setPeer(localPeer);
      rateLimitServer.registerService('TestService', definition);

      await rateLimitServer.listen();
    });

    afterAll(async () => {
      await rateLimitServer.close();
    });

    it('should enforce rate limits', async () => {
      const url = `http://localhost:${rateLimitPort}`;
      const requests = [];

      // Make 6 requests (limit is 5)
      for (let i = 0; i < 6; i++) {
        requests.push(
          fetch(`${url}/rpc/TestService/echo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `test${i}` })
          })
        );
      }

      const responses = await Promise.all(requests);
      const statuses = responses.map(r => r.status);

      // First 5 should succeed, 6th should be rate limited
      expect(statuses.slice(0, 5).every(s => s === 200)).toBe(true);
      expect(statuses[5]).toBe(429);

      // Check rate limit headers
      const lastSuccessful = responses[4];
      expect(lastSuccessful.headers.get('X-RateLimit-Limit')).toBe('5');
      expect(lastSuccessful.headers.get('X-RateLimit-Remaining')).toBe('0');
    });

    it('should reset rate limits after window', async () => {
      const url = `http://localhost:${rateLimitPort}`;

      // Wait for rate limit window to reset
      await new Promise(resolve => setTimeout(resolve, 1100));

      const response = await fetch(`${url}/rpc/TestService/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'after-reset' })
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('4');
    });
  });

  describe('Circuit Breaker', () => {
    let circuitServer: HttpServer;
    const circuitPort = 4520;
    let failureCount = 0;

    beforeAll(async () => {
      circuitServer = new HttpServer({
        port: circuitPort,
        host: 'localhost'
      });

      // Add circuit breaker middleware
      circuitServer.use(
        NetronBuiltinMiddleware.circuitBreaker({
          threshold: 3,
          timeout: 1000,
          resetTimeout: 2000
        }),
        { name: 'circuit-breaker', priority: 5 }
      );

      // Service that fails on demand
      @Service('CircuitService', '1.0.0')
      class CircuitService {
        @Public()
        async unstable() {
          failureCount++;
          if (failureCount <= 3) {
            throw new Error('Service failure');
          }
          return { success: true };
        }
      }

      const circuitNetron = new Netron(createMockLogger());
      const localPeer = new LocalPeer(circuitNetron);
      const circuitService = new CircuitService();
      const definition = await localPeer.exposeService(circuitService);
      circuitServer.setPeer(localPeer);
      circuitServer.registerService('CircuitService', definition);

      await circuitServer.listen();
    });

    afterAll(async () => {
      await circuitServer.close();
    });

    it('should open circuit after threshold failures', async () => {
      const url = `http://localhost:${circuitPort}`;
      const responses = [];

      // Make requests that will fail
      for (let i = 0; i < 4; i++) {
        const response = await fetch(`${url}/rpc/CircuitService/unstable`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        responses.push(response);
      }

      // First 3 should fail normally, 4th should be circuit breaker
      expect(responses[0].status).toBe(500);
      expect(responses[1].status).toBe(500);
      expect(responses[2].status).toBe(500);
      expect(responses[3].status).toBe(503); // Service Unavailable

      const lastResponse = await responses[3].text();
      expect(lastResponse).toContain('Circuit Breaker Open');
    });

    it('should close circuit after reset timeout', async () => {
      // Reset failure count for next attempt
      failureCount = 0;

      // Wait for circuit to reset
      await new Promise(resolve => setTimeout(resolve, 2100));

      const url = `http://localhost:${circuitPort}`;
      const response = await fetch(`${url}/rpc/CircuitService/unstable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      // Should work now (after reset and with failureCount reset)
      expect(response.status).toBe(500); // Will fail but circuit allows attempt
    });
  });

  describe('Performance and Load Testing', () => {
    it('should handle concurrent requests efficiently', async () => {
      const concurrentRequests = 100;
      const requests = [];

      const start = performance.now();

      for (let i = 0; i < concurrentRequests; i++) {
        requests.push(
          fetch(`${baseUrl}/rpc/TestService/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ a: i, b: i })
          })
        );
      }

      const responses = await Promise.all(requests);
      const duration = performance.now() - start;

      // All requests should succeed
      expect(responses.every(r => r.status === 200)).toBe(true);

      // Check performance (should handle 100 requests in reasonable time)
      expect(duration).toBeLessThan(5000); // 5 seconds for 100 requests

      // Verify results
      const results = await Promise.all(responses.map(r => r.json()));
      results.forEach((result, i) => {
        expect(result.result).toBe(i * 2);
      });
    });

    it('should maintain low latency under load', async () => {
      const latencies: number[] = [];
      const requests = 50;

      for (let i = 0; i < requests; i++) {
        const start = performance.now();
        const response = await fetch(`${baseUrl}/rpc/TestService/echo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `test-${i}` })
        });
        const latency = performance.now() - start;
        latencies.push(latency);

        expect(response.status).toBe(200);
      }

      // Calculate percentiles
      latencies.sort((a, b) => a - b);
      const p50 = latencies[Math.floor(latencies.length * 0.5)];
      const p95 = latencies[Math.floor(latencies.length * 0.95)];
      const p99 = latencies[Math.floor(latencies.length * 0.99)];

      // Expect low latencies
      expect(p50).toBeLessThan(50);  // 50ms median
      expect(p95).toBeLessThan(100); // 100ms 95th percentile
      expect(p99).toBeLessThan(200); // 200ms 99th percentile
    });

    it('should handle slow requests with timeout', async () => {
      const response = await fetch(`${baseUrl}/rpc/TestService/slowMethod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delay: 10000 }) // 10 seconds
      });

      // Should timeout (server has 5 second timeout)
      expect(response.status).toBe(500);
    }, 10000);
  });

  describe('Content Types', () => {
    it('should handle JSON requests', async () => {
      const response = await fetch(`${baseUrl}/rpc/TestService/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'json-test' })
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.message).toBe('json-test');
    });

    it('should handle form-urlencoded requests', async () => {
      const params = new URLSearchParams();
      params.append('message', 'form-test');

      const response = await fetch(`${baseUrl}/rpc/TestService/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.message).toBe('form-test');
    });

    it('should handle query parameters', async () => {
      const response = await fetch(`${baseUrl}/rpc/TestService/echo?message=query-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.message).toBe('query-test');
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON', async () => {
      const response = await fetch(`${baseUrl}/rpc/TestService/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-json'
      });

      expect(response.status).toBe(500);
    });

    it('should handle missing required parameters', async () => {
      const response = await fetch(`${baseUrl}/rpc/TestService/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ a: 5 }) // missing 'b'
      });

      // Service should handle or return appropriate error
      expect([400, 500]).toContain(response.status);
    });

    it('should handle unsupported methods', async () => {
      const response = await fetch(`${baseUrl}/rpc/TestService/echo`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'test' })
      });

      expect(response.status).toBe(404);
    });
  });

  describe('Metrics Collection', () => {
    it('should track request counts', async () => {
      const initialMetrics = await fetch(`${baseUrl}/metrics`).then(r => r.json());
      const initialCount = initialMetrics.totalRequests;

      // Make some requests
      await fetch(`${baseUrl}/rpc/TestService/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'test1' })
      });

      await fetch(`${baseUrl}/rpc/TestService/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ a: 1, b: 2 })
      });

      const finalMetrics = await fetch(`${baseUrl}/metrics`).then(r => r.json());
      expect(finalMetrics.totalRequests).toBe(initialCount + 3); // +2 requests +1 metrics
    });

    it('should track error counts', async () => {
      const initialMetrics = await fetch(`${baseUrl}/metrics`).then(r => r.json());
      const initialErrors = initialMetrics.totalErrors;

      // Cause an error
      await fetch(`${baseUrl}/rpc/TestService/errorMethod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const finalMetrics = await fetch(`${baseUrl}/metrics`).then(r => r.json());
      expect(finalMetrics.totalErrors).toBe(initialErrors + 1);
    });

    it('should track response times', async () => {
      // Make several requests
      for (let i = 0; i < 5; i++) {
        await fetch(`${baseUrl}/rpc/TestService/echo`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: `test${i}` })
        });
      }

      const metrics = await fetch(`${baseUrl}/metrics`).then(r => r.json());
      expect(metrics.avgResponseTime).toBeGreaterThan(0);
      expect(metrics.avgResponseTime).toBeLessThan(1000); // Should be fast
    });

    it('should track status code distribution', async () => {
      // Make requests with different outcomes
      await fetch(`${baseUrl}/rpc/TestService/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'success' })
      });

      await fetch(`${baseUrl}/rpc/NonExistent/method`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      await fetch(`${baseUrl}/rpc/TestService/errorMethod`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      const metrics = await fetch(`${baseUrl}/metrics`).then(r => r.json());
      expect(metrics.statusCounts['200']).toBeGreaterThan(0);
      expect(metrics.statusCounts['404']).toBeGreaterThan(0);
      expect(metrics.statusCounts['500']).toBeGreaterThan(0);
    });

    it('should track method distribution', async () => {
      await fetch(`${baseUrl}/health`); // GET
      await fetch(`${baseUrl}/rpc/TestService/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'test' })
      });

      const metrics = await fetch(`${baseUrl}/metrics`).then(r => r.json());
      expect(metrics.methodCounts['GET']).toBeGreaterThan(0);
      expect(metrics.methodCounts['POST']).toBeGreaterThan(0);
    });
  });
});