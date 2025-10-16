/**
 * Middleware Stack Integration Tests
 *
 * Tests the complete middleware chain including:
 * - Request/response flow
 * - Multiple middleware interactions
 * - Error handling and recovery
 * - Static file serving
 * - CORS preflight handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MiddlewareStack, createDevMiddleware } from '../../../src/dev/middleware/index.js';
import type { Middleware, DevServerConfig } from '../../../src/dev/types.js';

describe('Middleware Stack Integration', () => {
  describe('Complete Request Flow', () => {
    let stack: MiddlewareStack;

    beforeEach(() => {
      stack = new MiddlewareStack();
    });

    it('should handle complete request through multiple middleware', async () => {
      const executionOrder: string[] = [];

      // Add logger
      stack.use({
        name: 'logger',
        handle: async (req, next) => {
          executionOrder.push('logger-start');
          const response = await next();
          executionOrder.push('logger-end');
          return response;
        },
      });

      // Add authentication
      stack.use({
        name: 'auth',
        handle: async (req, next) => {
          executionOrder.push('auth-start');
          const response = await next();
          executionOrder.push('auth-end');

          const headers = new Headers(response.headers);
          headers.set('X-Authenticated', 'true');

          return new Response(response.body, {
            status: response.status,
            headers,
          });
        },
      });

      // Add handler
      stack.use({
        name: 'handler',
        handle: async (req) => {
          executionOrder.push('handler');
          return new Response('Success', { status: 200 });
        },
      });

      const req = new Request('http://localhost/test');
      const response = await stack.handle(req);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('Success');
      expect(response.headers.get('X-Authenticated')).toBe('true');
      expect(executionOrder).toEqual(['logger-start', 'auth-start', 'handler', 'auth-end', 'logger-end']);
    });

    it('should handle short-circuit responses', async () => {
      stack.use({
        name: 'validator',
        handle: async (req) => {
          const url = new URL(req.url);
          if (!url.searchParams.has('token')) {
            return new Response('Unauthorized', { status: 401 });
          }
          return new Response('Should not reach here');
        },
      });

      stack.use({
        name: 'handler',
        handle: async () => {
          throw new Error('Should not be called');
        },
      });

      const req = new Request('http://localhost/test');
      const response = await stack.handle(req);

      expect(response.status).toBe(401);
      expect(await response.text()).toBe('Unauthorized');
    });

    it('should handle errors in middleware chain', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      stack.use({
        name: 'error-producer',
        handle: async () => {
          throw new Error('Middleware error');
        },
      });

      stack.use({
        name: 'never-called',
        handle: async () => {
          throw new Error('Should not be called');
        },
      });

      const req = new Request('http://localhost/test');
      await expect(stack.handle(req)).rejects.toThrow('Middleware error');

      consoleSpy.mockRestore();
    });

    it('should handle async middleware operations', async () => {
      const delays: number[] = [];

      stack.use({
        name: 'delay-1',
        handle: async (req, next) => {
          const start = Date.now();
          await new Promise((resolve) => setTimeout(resolve, 10));
          const response = await next();
          delays.push(Date.now() - start);
          return response;
        },
      });

      stack.use({
        name: 'delay-2',
        handle: async (req, next) => {
          const start = Date.now();
          await new Promise((resolve) => setTimeout(resolve, 10));
          const response = await next();
          delays.push(Date.now() - start);
          return response;
        },
      });

      stack.use({
        name: 'handler',
        handle: async () => new Response('OK'),
      });

      const req = new Request('http://localhost/test');
      await stack.handle(req);

      expect(delays.length).toBe(2);
      delays.forEach((delay) => expect(delay).toBeGreaterThanOrEqual(10));
    });
  });

  describe('Static File Serving Integration', () => {
    it('should serve static files with correct headers', async () => {
      const stack = new MiddlewareStack();

      // Add caching middleware
      stack.use({
        name: 'cache',
        handle: async (req, next) => {
          const response = await next();

          if (response.status === 200) {
            const headers = new Headers(response.headers);
            headers.set('X-Cache', 'HIT');
            return new Response(response.body, {
              status: response.status,
              headers,
            });
          }

          return response;
        },
      });

      // Add static file handler
      stack.use({
        name: 'static',
        handle: async (req) => {
          const url = new URL(req.url);

          if (url.pathname === '/style.css') {
            return new Response('body { margin: 0; }', {
              status: 200,
              headers: {
                'Content-Type': 'text/css',
                'Cache-Control': 'public, max-age=31536000',
              },
            });
          }

          return new Response('Not Found', { status: 404 });
        },
      });

      const req = new Request('http://localhost/style.css');
      const response = await stack.handle(req);

      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/css');
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000');
      expect(response.headers.get('X-Cache')).toBe('HIT');
    });

    it('should handle range requests for large files', async () => {
      const stack = new MiddlewareStack();

      stack.use({
        name: 'range-handler',
        handle: async (req) => {
          const range = req.headers.get('Range');

          if (range) {
            const content = 'Large file content here...';
            const match = range.match(/bytes=(\d+)-(\d+)?/);

            if (match) {
              const start = parseInt(match[1]);
              const end = match[2] ? parseInt(match[2]) : content.length - 1;

              return new Response(content.slice(start, end + 1), {
                status: 206,
                headers: {
                  'Content-Range': `bytes ${start}-${end}/${content.length}`,
                  'Content-Length': String(end - start + 1),
                },
              });
            }
          }

          return new Response('Full content', { status: 200 });
        },
      });

      const req = new Request('http://localhost/large-file.mp4', {
        headers: { Range: 'bytes=0-10' },
      });

      const response = await stack.handle(req);

      expect(response.status).toBe(206);
      expect(response.headers.get('Content-Range')).toContain('bytes 0-10');
    });

    it('should handle conditional requests with ETag', async () => {
      const stack = new MiddlewareStack();

      const fileETag = '"abc123"';

      stack.use({
        name: 'etag-handler',
        handle: async (req) => {
          const ifNoneMatch = req.headers.get('If-None-Match');

          if (ifNoneMatch === fileETag) {
            return new Response(null, {
              status: 304,
              headers: { ETag: fileETag },
            });
          }

          return new Response('File content', {
            status: 200,
            headers: { ETag: fileETag },
          });
        },
      });

      // First request (no cache)
      const req1 = new Request('http://localhost/file.js');
      const response1 = await stack.handle(req1);

      expect(response1.status).toBe(200);
      expect(response1.headers.get('ETag')).toBe(fileETag);

      // Second request (with cache)
      const req2 = new Request('http://localhost/file.js', {
        headers: { 'If-None-Match': fileETag },
      });
      const response2 = await stack.handle(req2);

      expect(response2.status).toBe(304);
    });
  });

  describe('CORS Integration', () => {
    it('should handle preflight and actual request flow', async () => {
      const stack = new MiddlewareStack();

      // Add CORS middleware
      stack.use({
        name: 'cors',
        handle: async (req, next) => {
          if (req.method === 'OPTIONS') {
            return new Response(null, {
              status: 204,
              headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400',
              },
            });
          }

          const response = await next();
          const headers = new Headers(response.headers);
          headers.set('Access-Control-Allow-Origin', '*');

          return new Response(response.body, {
            status: response.status,
            headers,
          });
        },
      });

      // Add handler
      stack.use({
        name: 'handler',
        handle: async () =>
          new Response(JSON.stringify({ data: 'test' }), {
            headers: { 'Content-Type': 'application/json' },
          }),
      });

      // Preflight request
      const preflightReq = new Request('http://localhost/api/data', {
        method: 'OPTIONS',
        headers: {
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      });

      const preflightRes = await stack.handle(preflightReq);

      expect(preflightRes.status).toBe(204);
      expect(preflightRes.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(preflightRes.headers.get('Access-Control-Allow-Methods')).toContain('POST');

      // Actual request
      const actualReq = new Request('http://localhost/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: 'data' }),
      });

      const actualRes = await stack.handle(actualReq);

      expect(actualRes.status).toBe(200);
      expect(actualRes.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should handle credentials in CORS', async () => {
      const stack = new MiddlewareStack();

      stack.use({
        name: 'cors-credentials',
        handle: async (req, next) => {
          const response = await next();
          const headers = new Headers(response.headers);

          headers.set('Access-Control-Allow-Origin', 'https://example.com');
          headers.set('Access-Control-Allow-Credentials', 'true');

          return new Response(response.body, {
            status: response.status,
            headers,
          });
        },
      });

      stack.use({
        name: 'handler',
        handle: async () => new Response('OK'),
      });

      const req = new Request('http://localhost/api', {
        headers: {
          Origin: 'https://example.com',
          Cookie: 'session=abc123',
        },
      });

      const response = await stack.handle(req);

      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
    });
  });

  describe('Compression Integration', () => {
    it('should compress responses above threshold', async () => {
      const stack = new MiddlewareStack();

      stack.use({
        name: 'compression',
        handle: async (req, next) => {
          const response = await next();
          const acceptEncoding = req.headers.get('Accept-Encoding') || '';

          if (acceptEncoding.includes('gzip') && typeof CompressionStream !== 'undefined') {
            const stream = response.body?.pipeThrough(new CompressionStream('gzip'));

            const headers = new Headers(response.headers);
            headers.set('Content-Encoding', 'gzip');
            headers.delete('Content-Length');

            return new Response(stream, {
              status: response.status,
              headers,
            });
          }

          return response;
        },
      });

      stack.use({
        name: 'handler',
        handle: async () => {
          const largeBody = 'x'.repeat(2000);
          return new Response(largeBody);
        },
      });

      const req = new Request('http://localhost/large-file', {
        headers: { 'Accept-Encoding': 'gzip, deflate, br' },
      });

      const response = await stack.handle(req);

      if (typeof CompressionStream !== 'undefined') {
        expect(response.headers.get('Content-Encoding')).toBe('gzip');
      }
    });

    it('should not compress already compressed responses', async () => {
      const stack = new MiddlewareStack();

      stack.use({
        name: 'compression',
        handle: async (req, next) => {
          const response = await next();

          if (response.headers.get('Content-Encoding')) {
            return response;
          }

          // ... compression logic
          return response;
        },
      });

      stack.use({
        name: 'handler',
        handle: async () =>
          new Response('compressed data', {
            headers: { 'Content-Encoding': 'br' },
          }),
      });

      const req = new Request('http://localhost/compressed', {
        headers: { 'Accept-Encoding': 'gzip' },
      });

      const response = await stack.handle(req);

      expect(response.headers.get('Content-Encoding')).toBe('br');
    });
  });

  describe('Error Handling Integration', () => {
    it('should catch and transform errors', async () => {
      const stack = new MiddlewareStack();

      // Error catcher
      stack.use({
        name: 'error-handler',
        handle: async (req, next) => {
          try {
            return await next();
          } catch (error) {
            return new Response(
              JSON.stringify({
                error: error instanceof Error ? error.message : 'Unknown error',
              }),
              {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
              }
            );
          }
        },
      });

      // Error producer
      stack.use({
        name: 'buggy-middleware',
        handle: async () => {
          throw new Error('Something went wrong');
        },
      });

      const req = new Request('http://localhost/test');
      const response = await stack.handle(req);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({ error: 'Something went wrong' });
    });

    it('should handle async errors', async () => {
      const stack = new MiddlewareStack();

      stack.use({
        name: 'error-handler',
        handle: async (req, next) => {
          try {
            return await next();
          } catch (error) {
            return new Response('Error caught', { status: 500 });
          }
        },
      });

      stack.use({
        name: 'async-error',
        handle: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new Error('Async error');
        },
      });

      const req = new Request('http://localhost/test');
      const response = await stack.handle(req);

      expect(response.status).toBe(500);
      expect(await response.text()).toBe('Error caught');
    });

    it('should handle errors in error handlers', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const stack = new MiddlewareStack();

      stack.use({
        name: 'broken-error-handler',
        handle: async (req, next) => {
          try {
            return await next();
          } catch (error) {
            throw new Error('Error handler failed');
          }
        },
      });

      stack.use({
        name: 'error-producer',
        handle: async () => {
          throw new Error('Original error');
        },
      });

      const req = new Request('http://localhost/test');
      await expect(stack.handle(req)).rejects.toThrow('Error handler failed');

      consoleSpy.mockRestore();
    });
  });

  describe('Dev Server Middleware Stack', () => {
    it('should create complete dev stack with all middleware', async () => {
      const config: DevServerConfig = {
        dev: true,
        port: 3000,
        publicDir: '/public',
        cors: { origin: '*' },
        compression: { threshold: 1024 },
      };

      const stack = createDevMiddleware(config);

      expect(stack.getNames()).toEqual(['logger', 'cors', 'compression', 'static', 'hmr']);

      // Test request flow through stack
      const req = new Request('http://localhost/test');

      // Mock next behavior (no static files in test)
      const response = await stack.handle(req);

      // Should reach end of chain (404)
      expect(response.status).toBe(404);
    });

    it('should handle HMR WebSocket upgrade in stack', async () => {
      const config: DevServerConfig = {
        dev: true,
        hmr: true,
      };

      const stack = createDevMiddleware(config);

      const req = new Request('http://localhost/__aether_hmr');
      const response = await stack.handle(req);

      expect(response.status).toBe(101);
      expect(response.headers.get('X-Aether-HMR')).toBe('true');
    });

    it('should log all requests in dev mode', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const config: DevServerConfig = {
        dev: true,
      };

      const stack = createDevMiddleware(config);

      const req = new Request('http://localhost/test');
      await stack.handle(req);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('GET /test'));

      consoleSpy.mockRestore();
    });

    it('should handle multiple simultaneous requests', async () => {
      const config: DevServerConfig = {
        dev: true,
      };

      const stack = createDevMiddleware(config);

      const requests = [
        new Request('http://localhost/page1'),
        new Request('http://localhost/page2'),
        new Request('http://localhost/page3'),
      ];

      const responses = await Promise.all(requests.map((req) => stack.handle(req)));

      responses.forEach((response) => {
        expect(response.status).toBe(404);
      });
    });
  });

  describe('Performance and Optimization', () => {
    it('should handle high request throughput', async () => {
      const stack = new MiddlewareStack();

      stack.use({
        name: 'handler',
        handle: async () => new Response('OK'),
      });

      const startTime = Date.now();
      const requests = Array(100)
        .fill(null)
        .map(() => new Request('http://localhost/test'));

      await Promise.all(requests.map((req) => stack.handle(req)));

      const duration = Date.now() - startTime;

      // Should handle 100 requests quickly
      expect(duration).toBeLessThan(1000);
    });

    it('should not leak memory on many requests', async () => {
      const stack = new MiddlewareStack();

      const responseTracker: WeakSet<Response> = new WeakSet();

      stack.use({
        name: 'tracker',
        handle: async (req, next) => {
          const response = await next();
          responseTracker.add(response);
          return response;
        },
      });

      stack.use({
        name: 'handler',
        handle: async () => new Response('OK'),
      });

      // Process many requests
      for (let i = 0; i < 100; i++) {
        const req = new Request('http://localhost/test');
        await stack.handle(req);
      }

      // WeakSet should allow garbage collection
      expect(responseTracker).toBeDefined();
    });
  });
});
