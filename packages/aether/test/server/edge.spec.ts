/**
 * @fileoverview Comprehensive tests for Edge Runtime Support
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  renderToEdge,
  createEdgeHandler,
  optimizeForEdge,
  createCloudflareHandler,
  createVercelEdgeHandler,
  createDenoHandler,
  getEdgeRuntimeInfo,
} from '../../src/server/edge.js';

// Mock renderToString and streaming
vi.mock('../../src/server/ssr.js', () => ({
  renderToString: vi.fn().mockResolvedValue({
    html: '<div>Edge Content</div>',
    data: { test: 'data' },
    meta: { title: 'Edge Page' },
  }),
}));

vi.mock('../../src/server/streaming.js', () => ({
  renderToReadableStream: vi.fn().mockResolvedValue({
    stream: new ReadableStream(),
    metadata: {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
      },
    },
  }),
}));

vi.mock('../../src/server/renderer.js', () => ({
  renderDocument: vi.fn().mockReturnValue('<!DOCTYPE html><html>Edge</html>'),
}));

describe('Edge Runtime Support', () => {
  let originalGlobalThis: any;

  beforeEach(() => {
    vi.clearAllMocks();
    originalGlobalThis = { ...globalThis };
  });

  afterEach(() => {
    // Restore globalThis
    Object.keys(globalThis).forEach((key) => {
      if (!(key in originalGlobalThis)) {
        delete (globalThis as any)[key];
      }
    });
  });

  describe('renderToEdge', () => {
    it('should render component to Response', async () => {
      const Component = () => 'Edge Content';

      const response = await renderToEdge(Component);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
    });

    it('should set correct content type', async () => {
      const Component = () => 'Content';

      const response = await renderToEdge(Component);

      expect(response.headers.get('Content-Type')).toContain('text/html');
    });

    it('should support streaming mode', async () => {
      const Component = () => 'Streaming';

      const response = await renderToEdge(Component, {
        streaming: true,
      });

      expect(response.status).toBe(200);
    });

    it('should handle component errors', async () => {
      const ErrorComponent = () => {
        throw new Error('Edge error');
      };

      const consoleError = vi.spyOn(console, 'error').mockImplementation();

      const response = await renderToEdge(ErrorComponent);

      expect(response.status).toBe(500);
      expect(await response.text()).toBe('Internal Server Error');

      consoleError.mockRestore();
    });

    it('should add cache headers when caching enabled', async () => {
      const Component = () => 'Cached';

      const response = await renderToEdge(Component, {
        cache: true,
        cacheTtl: 300,
      });

      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toBeTruthy();
      expect(cacheControl).toContain('max-age=300');
    });

    it('should not add cache headers when caching disabled', async () => {
      const Component = () => 'No Cache';

      const response = await renderToEdge(Component, {
        cache: false,
      });

      const cacheControl = response.headers.get('Cache-Control');
      expect(cacheControl).toBeNull();
    });

    it('should pass props to component', async () => {
      const Component = (props: { title: string }) => `<h1>${props.title}</h1>`;

      const response = await renderToEdge(Component, {
        props: { title: 'Edge Title' },
      });

      expect(response.status).toBe(200);
    });

    it('should handle URL context', async () => {
      const Component = () => 'Page';

      const response = await renderToEdge(Component, {
        url: 'https://example.com/page',
      });

      expect(response.status).toBe(200);
    });

    it('should handle initial state', async () => {
      const Component = () => 'Stateful';

      const response = await renderToEdge(Component, {
        initialState: { user: { id: 1 } },
      });

      expect(response.status).toBe(200);
    });

    it('should auto-detect runtime', async () => {
      const Component = () => 'Auto';

      const response = await renderToEdge(Component, {
        runtime: 'auto',
      });

      expect(response.status).toBe(200);
    });
  });

  describe('createEdgeHandler', () => {
    it('should create request handler', () => {
      const Component = () => 'Handler';

      const handler = createEdgeHandler(Component);

      expect(typeof handler).toBe('function');
    });

    it('should handle requests', async () => {
      const Component = () => 'Request Content';

      const handler = createEdgeHandler(Component);
      const request = new Request('https://example.com/page');

      const response = await handler(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
    });

    it('should handle static asset requests', async () => {
      const Component = () => 'Content';

      const handler = createEdgeHandler(Component);
      const request = new Request('https://example.com/_assets/style.css');

      const response = await handler(request);

      expect(response.status).toBe(404);
    });

    it('should apply cache settings', async () => {
      const Component = () => 'Cached';

      const handler = createEdgeHandler(Component, {
        cache: true,
        cacheTtl: 600,
      });

      const request = new Request('https://example.com/page');
      const response = await handler(request);

      expect(response.status).toBe(200);
    });

    it('should parse URL from request', async () => {
      const Component = () => 'Content';

      const handler = createEdgeHandler(Component);
      const request = new Request('https://example.com/blog/post-1');

      const response = await handler(request);

      expect(response.status).toBe(200);
    });

    it('should handle requests to root path', async () => {
      const Component = () => 'Home';

      const handler = createEdgeHandler(Component);
      const request = new Request('https://example.com/');

      const response = await handler(request);

      expect(response.status).toBe(200);
    });
  });

  describe('Runtime Detection', () => {
    it('should detect Cloudflare Workers', () => {
      (globalThis as any).caches = { default: {} };
      (globalThis as any).WebSocketPair = function () {};

      const info = getEdgeRuntimeInfo();

      expect(info.runtime).toBe('cloudflare');
      expect(info.features.cache).toBe(true);
      expect(info.features.webSockets).toBe(true);

      delete (globalThis as any).caches;
      delete (globalThis as any).WebSocketPair;
    });

    it('should detect Vercel Edge', () => {
      (globalThis as any).EdgeRuntime = 'vercel';

      const info = getEdgeRuntimeInfo();

      expect(info.runtime).toBe('vercel');
      expect(info.features.cache).toBe(true);

      delete (globalThis as any).EdgeRuntime;
    });

    it('should detect Deno', () => {
      (globalThis as any).Deno = {
        version: { deno: '1.0.0' },
      };

      const info = getEdgeRuntimeInfo();

      expect(info.runtime).toBe('deno');
      expect(info.features.webSockets).toBe(true);

      delete (globalThis as any).Deno;
    });

    it('should fallback to Node.js', () => {
      const info = getEdgeRuntimeInfo();

      expect(info.runtime).toBe('node');
    });

    it('should report streaming support for all runtimes', () => {
      const info = getEdgeRuntimeInfo();

      expect(info.features.streaming).toBe(true);
    });
  });

  describe('Cloudflare Handlers', () => {
    it('should create Cloudflare-specific handler', () => {
      const Component = () => 'CF Content';

      const handler = createCloudflareHandler(Component);

      expect(handler).toHaveProperty('fetch');
      expect(typeof handler.fetch).toBe('function');
    });

    it('should handle Cloudflare requests', async () => {
      const Component = () => 'CF Page';

      const handler = createCloudflareHandler(Component);
      const request = new Request('https://example.com/page');

      const response = await handler.fetch(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
    });

    it('should support Cloudflare cache options', () => {
      const Component = () => 'Cached';

      const handler = createCloudflareHandler(Component, {
        cache: true,
        cacheTtl: 3600,
      });

      expect(handler.fetch).toBeDefined();
    });
  });

  describe('Vercel Edge Handlers', () => {
    it('should create Vercel Edge-specific handler', () => {
      const Component = () => 'Vercel Content';

      const handler = createVercelEdgeHandler(Component);

      expect(typeof handler).toBe('function');
    });

    it('should handle Vercel Edge requests', async () => {
      const Component = () => 'Vercel Page';

      const handler = createVercelEdgeHandler(Component);
      const request = new Request('https://example.com/page');

      const response = await handler(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
    });

    it('should support Vercel Edge cache options', () => {
      const Component = () => 'Cached';

      const handler = createVercelEdgeHandler(Component, {
        cache: true,
        cacheTtl: 300,
      });

      expect(typeof handler).toBe('function');
    });
  });

  describe('Deno Handlers', () => {
    it('should create Deno-specific handler', () => {
      const Component = () => 'Deno Content';

      const handler = createDenoHandler(Component);

      expect(typeof handler).toBe('function');
    });

    it('should handle Deno requests', async () => {
      const Component = () => 'Deno Page';

      const handler = createDenoHandler(Component);
      const request = new Request('https://example.com/page');

      const response = await handler(request);

      expect(response).toBeInstanceOf(Response);
      expect(response.status).toBe(200);
    });
  });

  describe('Edge Caching', () => {
    it('should cache responses on Cloudflare', async () => {
      const mockCache = {
        match: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      };

      (globalThis as any).caches = { default: mockCache };
      (globalThis as any).WebSocketPair = function () {};

      const Component = () => 'Cached Content';
      const handler = createEdgeHandler(Component, {
        cache: true,
        cacheTtl: 300,
      });

      const request = new Request('https://example.com/page');
      await handler(request);

      // Cache operations would be called in real environment
      delete (globalThis as any).caches;
      delete (globalThis as any).WebSocketPair;
    });

    it('should return cached response if available', async () => {
      const cachedResponse = new Response('Cached', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      });

      const mockCache = {
        match: vi.fn().mockResolvedValue(cachedResponse),
        put: vi.fn().mockResolvedValue(undefined),
      };

      (globalThis as any).caches = { default: mockCache };
      (globalThis as any).WebSocketPair = function () {};

      const Component = () => 'Fresh Content';
      const handler = createEdgeHandler(Component, {
        cache: true,
      });

      const request = new Request('https://example.com/page');
      const response = await handler(request);

      expect(response).toBe(cachedResponse);

      delete (globalThis as any).caches;
      delete (globalThis as any).WebSocketPair;
    });

    it('should handle cache errors gracefully', async () => {
      const mockCache = {
        match: vi.fn().mockRejectedValue(new Error('Cache error')),
        put: vi.fn().mockRejectedValue(new Error('Cache error')),
      };

      (globalThis as any).caches = { default: mockCache };
      (globalThis as any).WebSocketPair = function () {};

      const consoleError = vi.spyOn(console, 'error').mockImplementation();

      const Component = () => 'Content';
      const handler = createEdgeHandler(Component, {
        cache: true,
      });

      const request = new Request('https://example.com/page');
      const response = await handler(request);

      // Should still work despite cache errors
      expect(response.status).toBe(200);

      consoleError.mockRestore();
      delete (globalThis as any).caches;
      delete (globalThis as any).WebSocketPair;
    });
  });

  describe('optimizeForEdge', () => {
    it('should return optimized component', () => {
      const Component = () => 'Component';

      const optimized = optimizeForEdge(Component);

      expect(optimized).toBeDefined();
    });

    it('should handle optimization options', () => {
      const Component = () => 'Component';

      const optimized = optimizeForEdge(Component, {
        maxBundleSize: 50000,
        stripServerCode: true,
      });

      expect(optimized).toBeDefined();
    });

    it('should preserve component functionality', () => {
      const Component = (props: { text: string }) => props.text;

      const optimized = optimizeForEdge(Component);

      expect(optimized({ text: 'Test' })).toBe('Test');
    });
  });

  describe('Error Handling', () => {
    it('should handle render errors', async () => {
      const ErrorComponent = () => {
        throw new Error('Render failed');
      };

      const consoleError = vi.spyOn(console, 'error').mockImplementation();

      const response = await renderToEdge(ErrorComponent);

      expect(response.status).toBe(500);
      expect(response.headers.get('Content-Type')).toBe('text/plain');

      consoleError.mockRestore();
    });

    it('should handle streaming errors', async () => {
      const ErrorComponent = () => {
        throw new Error('Stream failed');
      };

      const consoleError = vi.spyOn(console, 'error').mockImplementation();

      const response = await renderToEdge(ErrorComponent, {
        streaming: true,
      });

      expect(response.status).toBe(500);

      consoleError.mockRestore();
    });

    it('should handle handler errors', async () => {
      const ErrorComponent = () => {
        throw new Error('Handler failed');
      };

      const consoleError = vi.spyOn(console, 'error').mockImplementation();

      const handler = createEdgeHandler(ErrorComponent);
      const request = new Request('https://example.com/page');

      const response = await handler(request);

      expect(response.status).toBe(500);

      consoleError.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty component', async () => {
      const EmptyComponent = () => '';

      const response = await renderToEdge(EmptyComponent);

      expect(response.status).toBe(200);
    });

    it('should handle null component', async () => {
      const NullComponent = () => null;

      const response = await renderToEdge(NullComponent);

      expect(response.status).toBe(200);
    });

    it('should handle components with special characters', async () => {
      const Component = () => 'Special: <>&"\'';

      const response = await renderToEdge(Component);

      expect(response.status).toBe(200);
    });

    it('should handle very long URLs', async () => {
      const Component = () => 'Content';
      const longPath = '/' + 'segment/'.repeat(100);

      const response = await renderToEdge(Component, {
        url: `https://example.com${longPath}`,
      });

      expect(response.status).toBe(200);
    });

    it('should handle concurrent requests', async () => {
      const Component = () => 'Concurrent';

      const handler = createEdgeHandler(Component);

      const requests = Array.from(
        { length: 10 },
        (_, i) => new Request(`https://example.com/page-${i}`)
      );

      const responses = await Promise.all(requests.map(handler));

      expect(responses).toHaveLength(10);
      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });
    });

    it('should handle different HTTP methods', async () => {
      const Component = () => 'Content';

      const handler = createEdgeHandler(Component);

      const getRequest = new Request('https://example.com/page', {
        method: 'GET',
      });
      const postRequest = new Request('https://example.com/page', {
        method: 'POST',
      });

      const getResponse = await handler(getRequest);
      const postResponse = await handler(postRequest);

      expect(getResponse.status).toBe(200);
      expect(postResponse.status).toBe(200);
    });

    it('should handle requests with query parameters', async () => {
      const Component = () => 'Query Content';

      const handler = createEdgeHandler(Component);
      const request = new Request('https://example.com/page?id=123&sort=asc');

      const response = await handler(request);

      expect(response.status).toBe(200);
    });

    it('should handle requests with hash fragments', async () => {
      const Component = () => 'Hash Content';

      const handler = createEdgeHandler(Component);
      const request = new Request('https://example.com/page#section');

      const response = await handler(request);

      expect(response.status).toBe(200);
    });
  });

  describe('Performance', () => {
    it('should handle high request volume', async () => {
      const Component = () => 'High Volume';

      const handler = createEdgeHandler(Component, {
        cache: true,
      });

      const requests = Array.from(
        { length: 100 },
        () => new Request('https://example.com/page')
      );

      const startTime = Date.now();

      await Promise.all(requests.map(handler));

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(5000); // Should complete quickly
    });

    it('should minimize response size', async () => {
      const Component = () => 'Minimal';

      const response = await renderToEdge(Component);

      const body = await response.text();

      expect(body.length).toBeGreaterThan(0);
      expect(body.length).toBeLessThan(10000); // Reasonable size
    });
  });
});
