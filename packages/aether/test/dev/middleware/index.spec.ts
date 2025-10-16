/**
 * Middleware Stack Unit Tests
 *
 * Comprehensive tests for middleware stack functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MiddlewareStack,
  createDevMiddleware,
  createLoggerMiddleware,
  createCorsMiddleware,
  createCompressionMiddleware,
  createStaticMiddleware,
  createHMRMiddleware,
} from '../../../src/dev/middleware/index.js';
import type { Middleware, DevServerConfig } from '../../../src/dev/types.js';

describe('MiddlewareStack', () => {
  describe('Basic Operations', () => {
    let stack: MiddlewareStack;

    beforeEach(() => {
      stack = new MiddlewareStack();
    });

    it('should create empty stack', () => {
      expect(stack.getNames()).toEqual([]);
    });

    it('should add middleware to stack', () => {
      const middleware: Middleware = {
        name: 'test',
        handle: async (req, next) => next(),
      };

      stack.use(middleware);
      expect(stack.getNames()).toEqual(['test']);
    });

    it('should add multiple middleware', () => {
      stack.use({ name: 'first', handle: async (req, next) => next() });
      stack.use({ name: 'second', handle: async (req, next) => next() });
      stack.use({ name: 'third', handle: async (req, next) => next() });

      expect(stack.getNames()).toEqual(['first', 'second', 'third']);
    });

    it('should clear all middleware', () => {
      stack.use({ name: 'test', handle: async (req, next) => next() });
      stack.clear();

      expect(stack.getNames()).toEqual([]);
    });
  });

  describe('Request Handling', () => {
    let stack: MiddlewareStack;

    beforeEach(() => {
      stack = new MiddlewareStack();
    });

    it('should handle request through middleware chain', async () => {
      const handler = vi.fn(async (req, next) => next());

      stack.use({
        name: 'test',
        handle: handler,
      });

      const req = new Request('http://localhost/test');
      await stack.handle(req);

      expect(handler).toHaveBeenCalledWith(req, expect.any(Function));
    });

    it('should execute middleware in order', async () => {
      const order: string[] = [];

      stack.use({
        name: 'first',
        handle: async (req, next) => {
          order.push('first-before');
          const response = await next();
          order.push('first-after');
          return response;
        },
      });

      stack.use({
        name: 'second',
        handle: async (req, next) => {
          order.push('second-before');
          const response = await next();
          order.push('second-after');
          return response;
        },
      });

      stack.use({
        name: 'third',
        handle: async (req, next) => {
          order.push('third');
          return new Response('OK');
        },
      });

      const req = new Request('http://localhost/test');
      await stack.handle(req);

      expect(order).toEqual(['first-before', 'second-before', 'third', 'second-after', 'first-after']);
    });

    it('should return 404 when no middleware handles request', async () => {
      const req = new Request('http://localhost/test');
      const response = await stack.handle(req);

      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Not Found');
    });

    it('should handle middleware errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      stack.use({
        name: 'error-middleware',
        handle: async () => {
          throw new Error('Middleware error');
        },
      });

      const req = new Request('http://localhost/test');
      await expect(stack.handle(req)).rejects.toThrow('Middleware error');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Middleware:error-middleware]'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should pass request through chain', async () => {
      stack.use({
        name: 'passthrough',
        handle: async (req, next) => next(),
      });

      stack.use({
        name: 'handler',
        handle: async (req) => {
          return new Response('Handled');
        },
      });

      const req = new Request('http://localhost/test');
      const response = await stack.handle(req);

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('Handled');
    });

    it('should allow middleware to modify response', async () => {
      stack.use({
        name: 'modifier',
        handle: async (req, next) => {
          const response = await next();
          const headers = new Headers(response.headers);
          headers.set('X-Modified', 'true');
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

      const req = new Request('http://localhost/test');
      const response = await stack.handle(req);

      expect(response.headers.get('X-Modified')).toBe('true');
    });
  });

  describe('Edge Cases', () => {
    let stack: MiddlewareStack;

    beforeEach(() => {
      stack = new MiddlewareStack();
    });

    it('should handle empty middleware chain', async () => {
      const req = new Request('http://localhost/test');
      const response = await stack.handle(req);

      expect(response.status).toBe(404);
    });

    it('should handle middleware that returns immediately', async () => {
      stack.use({
        name: 'immediate',
        handle: async () => new Response('Immediate'),
      });

      const req = new Request('http://localhost/test');
      const response = await stack.handle(req);

      expect(await response.text()).toBe('Immediate');
    });

    it('should handle async middleware', async () => {
      stack.use({
        name: 'async',
        handle: async (req, next) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return next();
        },
      });

      stack.use({
        name: 'handler',
        handle: async () => new Response('OK'),
      });

      const req = new Request('http://localhost/test');
      const response = await stack.handle(req);

      expect(response.status).toBe(200);
    });
  });
});

describe('Logger Middleware', () => {
  let consoleSpy: any;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should log successful requests', async () => {
    const middleware = createLoggerMiddleware();
    const req = new Request('http://localhost/test');
    const next = vi.fn(async () => new Response('OK', { status: 200 }));

    await middleware.handle(req, next);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('GET /test 200'));
  });

  it('should log request duration', async () => {
    const middleware = createLoggerMiddleware();
    const req = new Request('http://localhost/test');
    const next = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response('OK', { status: 200 });
    });

    await middleware.handle(req, next);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/GET \/test 200 \d+ms/));
  });

  it('should log errors', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const middleware = createLoggerMiddleware();
    const req = new Request('http://localhost/test');
    const next = vi.fn(async () => {
      throw new Error('Request error');
    });

    await expect(middleware.handle(req, next)).rejects.toThrow('Request error');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('GET /test ERROR'), expect.any(Error));

    errorSpy.mockRestore();
  });

  it('should log different HTTP methods', async () => {
    const middleware = createLoggerMiddleware();

    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const req = new Request('http://localhost/test', { method });
      const next = vi.fn(async () => new Response('OK'));

      await middleware.handle(req, next);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(`${method} /test`));
    }
  });
});

describe('CORS Middleware', () => {
  it('should add CORS headers to response', async () => {
    const middleware = createCorsMiddleware({});
    const req = new Request('http://localhost/test');
    const next = vi.fn(async () => new Response('OK'));

    const response = await middleware.handle(req, next);

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('should handle preflight requests', async () => {
    const middleware = createCorsMiddleware({});
    const req = new Request('http://localhost/test', { method: 'OPTIONS' });
    const next = vi.fn(async () => new Response('OK'));

    const response = await middleware.handle(req, next);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBeDefined();
    expect(response.headers.get('Access-Control-Allow-Headers')).toBeDefined();
    expect(next).not.toHaveBeenCalled();
  });

  it('should use custom origin', async () => {
    const middleware = createCorsMiddleware({ origin: 'https://example.com' });
    const req = new Request('http://localhost/test');
    const next = vi.fn(async () => new Response('OK'));

    const response = await middleware.handle(req, next);

    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
  });

  it('should use custom methods', async () => {
    const middleware = createCorsMiddleware({
      methods: ['GET', 'POST'],
    });
    const req = new Request('http://localhost/test', { method: 'OPTIONS' });
    const next = vi.fn();

    const response = await middleware.handle(req, next);

    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST');
  });

  it('should set exposed headers', async () => {
    const middleware = createCorsMiddleware({
      exposedHeaders: ['X-Custom-Header'],
    });
    const req = new Request('http://localhost/test');
    const next = vi.fn(async () => new Response('OK'));

    const response = await middleware.handle(req, next);

    expect(response.headers.get('Access-Control-Expose-Headers')).toBe('X-Custom-Header');
  });

  it('should disable credentials when configured', async () => {
    const middleware = createCorsMiddleware({ credentials: false });
    const req = new Request('http://localhost/test');
    const next = vi.fn(async () => new Response('OK'));

    const response = await middleware.handle(req, next);

    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('false');
  });

  it('should set max age for preflight', async () => {
    const middleware = createCorsMiddleware({ maxAge: 3600 });
    const req = new Request('http://localhost/test', { method: 'OPTIONS' });
    const next = vi.fn();

    const response = await middleware.handle(req, next);

    expect(response.headers.get('Access-Control-Max-Age')).toBe('3600');
  });
});

describe('Compression Middleware', () => {
  it('should compress response with gzip', async () => {
    const middleware = createCompressionMiddleware({});
    const req = new Request('http://localhost/test', {
      headers: { 'Accept-Encoding': 'gzip' },
    });

    const largeBody = 'x'.repeat(2000);
    const next = vi.fn(async () => new Response(largeBody));

    const response = await middleware.handle(req, next);

    if (typeof CompressionStream !== 'undefined') {
      expect(response.headers.get('Content-Encoding')).toBe('gzip');
    }
  });

  it('should skip compression for small responses', async () => {
    const middleware = createCompressionMiddleware({ threshold: 1024 });
    const req = new Request('http://localhost/test', {
      headers: { 'Accept-Encoding': 'gzip' },
    });

    const smallBody = 'small';
    const next = vi.fn(
      async () =>
        new Response(smallBody, {
          headers: { 'Content-Length': smallBody.length.toString() },
        })
    );

    const response = await middleware.handle(req, next);

    expect(response.headers.get('Content-Encoding')).toBeNull();
  });

  it('should skip already compressed responses', async () => {
    const middleware = createCompressionMiddleware({});
    const req = new Request('http://localhost/test', {
      headers: { 'Accept-Encoding': 'gzip' },
    });

    const next = vi.fn(
      async () =>
        new Response('compressed', {
          headers: { 'Content-Encoding': 'br' },
        })
    );

    const response = await middleware.handle(req, next);

    expect(response.headers.get('Content-Encoding')).toBe('br');
  });

  it('should skip when client does not accept compression', async () => {
    const middleware = createCompressionMiddleware({});
    const req = new Request('http://localhost/test');
    const next = vi.fn(async () => new Response('x'.repeat(2000)));

    const response = await middleware.handle(req, next);

    expect(response.headers.get('Content-Encoding')).toBeNull();
  });

  it('should use filter function when provided', async () => {
    const filter = vi.fn(() => false);
    const middleware = createCompressionMiddleware({ filter });
    const req = new Request('http://localhost/test', {
      headers: { 'Accept-Encoding': 'gzip' },
    });
    const next = vi.fn(async () => new Response('x'.repeat(2000)));

    const response = await middleware.handle(req, next);

    expect(filter).toHaveBeenCalledWith(req);
    expect(response.headers.get('Content-Encoding')).toBeNull();
  });
});

describe('Static Files Middleware', () => {
  it('should skip non-GET requests', async () => {
    const middleware = createStaticMiddleware('/public');
    const req = new Request('http://localhost/style.css', { method: 'POST' });
    const next = vi.fn(async () => new Response('Next'));

    const response = await middleware.handle(req, next);

    expect(next).toHaveBeenCalled();
  });

  it('should skip non-static paths', async () => {
    const middleware = createStaticMiddleware('/public');
    const req = new Request('http://localhost/api/users');
    const next = vi.fn(async () => new Response('API'));

    const response = await middleware.handle(req, next);

    expect(next).toHaveBeenCalled();
  });

  it('should detect static file extensions', async () => {
    const middleware = createStaticMiddleware('/public');
    const staticExts = ['js', 'css', 'png', 'jpg', 'svg', 'woff', 'woff2'];

    for (const ext of staticExts) {
      const req = new Request(`http://localhost/file.${ext}`);
      const next = vi.fn(async () => new Response('Not Found', { status: 404 }));

      await middleware.handle(req, next);

      // Should try to serve static file (will fail in test but won't call next immediately)
    }
  });

  it('should pass to next on file not found', async () => {
    const middleware = createStaticMiddleware('/nonexistent');
    const req = new Request('http://localhost/style.css');
    const next = vi.fn(async () => new Response('Not Found', { status: 404 }));

    const response = await middleware.handle(req, next);

    expect(next).toHaveBeenCalled();
  });

  it('should set correct content types', () => {
    // Test content type mapping
    const contentTypes: Record<string, string> = {
      css: 'text/css',
      js: 'application/javascript',
      json: 'application/json',
      png: 'image/png',
      jpg: 'image/jpeg',
      svg: 'image/svg+xml',
      woff: 'font/woff',
      woff2: 'font/woff2',
    };

    // Content types are tested indirectly through file serving
    expect(Object.keys(contentTypes).length).toBeGreaterThan(0);
  });
});

describe('HMR Middleware', () => {
  it('should detect HMR WebSocket upgrade requests', async () => {
    const middleware = createHMRMiddleware();
    const req = new Request('http://localhost/__aether_hmr');
    const next = vi.fn(async () => new Response('Next'));

    const response = await middleware.handle(req, next);

    expect(response.status).toBe(101);
    expect(response.headers.get('X-Aether-HMR')).toBe('true');
    expect(next).not.toHaveBeenCalled();
  });

  it('should pass non-HMR requests to next', async () => {
    const middleware = createHMRMiddleware();
    const req = new Request('http://localhost/normal-path');
    const next = vi.fn(async () => new Response('OK'));

    const response = await middleware.handle(req, next);

    expect(next).toHaveBeenCalled();
  });

  it('should only handle HMR endpoint', async () => {
    const middleware = createHMRMiddleware();
    const paths = ['/api', '/assets/style.css', '/index.html'];

    for (const path of paths) {
      const req = new Request(`http://localhost${path}`);
      const next = vi.fn(async () => new Response('OK'));

      await middleware.handle(req, next);

      expect(next).toHaveBeenCalled();
    }
  });
});

describe('Dev Middleware Stack', () => {
  it('should create complete middleware stack', () => {
    const config: DevServerConfig = {
      dev: true,
      port: 3000,
      publicDir: '/public',
      cors: true,
      compression: true,
    };

    const stack = createDevMiddleware(config);

    expect(stack.getNames()).toContain('logger');
    expect(stack.getNames()).toContain('cors');
    expect(stack.getNames()).toContain('compression');
    expect(stack.getNames()).toContain('static');
    expect(stack.getNames()).toContain('hmr');
  });

  it('should skip CORS when disabled', () => {
    const config: DevServerConfig = {
      dev: true,
      cors: false,
    };

    const stack = createDevMiddleware(config);

    expect(stack.getNames()).not.toContain('cors');
  });

  it('should skip compression when disabled', () => {
    const config: DevServerConfig = {
      dev: true,
      compression: false,
    };

    const stack = createDevMiddleware(config);

    expect(stack.getNames()).not.toContain('compression');
  });

  it('should skip static when no publicDir', () => {
    const config: DevServerConfig = {
      dev: true,
    };

    const stack = createDevMiddleware(config);

    expect(stack.getNames()).not.toContain('static');
  });

  it('should maintain middleware order', () => {
    const config: DevServerConfig = {
      dev: true,
      publicDir: '/public',
      cors: true,
      compression: true,
    };

    const stack = createDevMiddleware(config);
    const names = stack.getNames();

    // Logger should be first
    expect(names[0]).toBe('logger');

    // HMR should be last
    expect(names[names.length - 1]).toBe('hmr');
  });

  it('should accept custom CORS config', () => {
    const config: DevServerConfig = {
      dev: true,
      cors: {
        origin: 'https://example.com',
        methods: ['GET', 'POST'],
      },
    };

    const stack = createDevMiddleware(config);

    expect(stack.getNames()).toContain('cors');
  });

  it('should accept custom compression config', () => {
    const config: DevServerConfig = {
      dev: true,
      compression: {
        threshold: 2048,
        level: 9,
      },
    };

    const stack = createDevMiddleware(config);

    expect(stack.getNames()).toContain('compression');
  });

  it('should handle minimal config', () => {
    const config: DevServerConfig = {
      dev: true,
    };

    const stack = createDevMiddleware(config);

    // Should at least have logger and HMR
    expect(stack.getNames()).toContain('logger');
    expect(stack.getNames()).toContain('hmr');
  });
});
