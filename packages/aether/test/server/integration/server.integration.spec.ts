/**
 * Integration Tests for Unified Server
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../../../src/server/server';
import type { Server, ServerConfig, DevServerConfig } from '../../../src/server/types';

// Use built-in fetch in Node.js 18+
const fetch = globalThis.fetch;

describe('Server Integration Tests', () => {
  let server: Server;
  let port: number;

  beforeEach(() => {
    // Use random port to avoid conflicts
    port = Math.floor(Math.random() * 10000) + 30000;
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  describe('Production Server', () => {
    it('should start and respond to requests', async () => {
      const config: ServerConfig = {
        mode: 'ssr',
        port,
        host: 'localhost',
        routes: [
          {
            path: '/',
            component: () => '<h1>Home</h1>',
          },
        ],
      };

      server = await createServer(config);
      await server.listen();

      const response = await fetch(`http://localhost:${port}/`);
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('should handle 404 for unknown routes', async () => {
      const config: ServerConfig = {
        mode: 'ssr',
        port,
        host: 'localhost',
        routes: [],
      };

      server = await createServer(config);
      await server.listen();

      const response = await fetch(`http://localhost:${port}/unknown`);
      expect(response.status).toBe(404);
    });

    it('should return static files', async () => {
      const config: ServerConfig = {
        mode: 'ssr',
        port,
        host: 'localhost',
        routes: [],
      };

      server = await createServer(config);
      await server.listen();

      const response = await fetch(`http://localhost:${port}/assets/test.js`);
      expect(response.status).toBe(404); // No actual files, so 404
    });

    it('should set correct content-type headers', async () => {
      const config: ServerConfig = {
        mode: 'ssr',
        port,
        host: 'localhost',
        routes: [
          {
            path: '/',
            component: () => '<h1>Home</h1>',
          },
        ],
      };

      server = await createServer(config);
      await server.listen();

      const response = await fetch(`http://localhost:${port}/`);
      expect(response.headers.get('content-type')).toContain('text/html');
    });

    it('should set cache headers in production', async () => {
      const config: ServerConfig = {
        mode: 'ssr',
        port,
        host: 'localhost',
        routes: [
          {
            path: '/',
            component: () => '<h1>Home</h1>',
          },
        ],
      };

      server = await createServer(config);
      await server.listen();

      const response = await fetch(`http://localhost:${port}/`);
      expect(response.headers.get('cache-control')).toContain('public');
    });
  });

  describe('Development Server', () => {
    it('should start dev server with HMR support', async () => {
      const config: DevServerConfig = {
        dev: true,
        mode: 'ssr',
        port,
        host: 'localhost',
        hmr: true,
        routes: [
          {
            path: '/',
            component: () => '<h1>Dev Home</h1>',
          },
        ],
      };

      server = await createServer(config);
      await server.listen();

      const response = await fetch(`http://localhost:${port}/`);
      expect(response.status).toBe(200);

      const html = await response.text();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('/__aether/hmr-client.js'); // HMR script injected
    });

    it('should inject error overlay in dev mode', async () => {
      const config: DevServerConfig = {
        dev: true,
        mode: 'ssr',
        port,
        host: 'localhost',
        errorOverlay: true,
        routes: [
          {
            path: '/',
            component: () => '<h1>Dev</h1>',
          },
        ],
      };

      server = await createServer(config);
      await server.listen();

      const response = await fetch(`http://localhost:${port}/`);
      const html = await response.text();
      expect(html).toContain('/__aether/error-overlay.js');
    });

    it('should support CORS in dev mode', async () => {
      const config: DevServerConfig = {
        dev: true,
        mode: 'ssr',
        port,
        host: 'localhost',
        cors: true,
        routes: [],
      };

      server = await createServer(config);
      await server.listen();

      const response = await fetch(`http://localhost:${port}/`, {
        method: 'OPTIONS',
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
    });

    it('should support middleware in dev mode', async () => {
      const config: DevServerConfig = {
        dev: true,
        mode: 'ssr',
        port,
        host: 'localhost',
        routes: [],
      };

      server = await createServer(config);

      // Add custom middleware
      server.use({
        name: 'test-middleware',
        async handle(req, next) {
          if (new URL(req.url).pathname === '/test') {
            return new Response('Test Middleware', { status: 200 });
          }
          return next();
        },
      });

      await server.listen();

      const response = await fetch(`http://localhost:${port}/test`);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe('Test Middleware');
    });
  });

  describe('Server Metrics', () => {
    it('should track request metrics', async () => {
      const config: ServerConfig = {
        mode: 'ssr',
        port,
        host: 'localhost',
        routes: [
          {
            path: '/',
            component: () => '<h1>Home</h1>',
          },
        ],
      };

      server = await createServer(config);
      await server.listen();

      // Make some requests
      await fetch(`http://localhost:${port}/`);
      await fetch(`http://localhost:${port}/`);
      await fetch(`http://localhost:${port}/`);

      const metrics = (server as any).getMetrics();
      expect(metrics.requests).toBe(3);
      expect(metrics.avgResponseTime).toBeGreaterThan(0);
    });

    it('should track uptime', async () => {
      const config: ServerConfig = {
        mode: 'ssr',
        port,
        host: 'localhost',
        routes: [],
      };

      server = await createServer(config);
      await server.listen();

      await new Promise((resolve) => setTimeout(resolve, 100));

      const metrics = (server as any).getMetrics();
      expect(metrics.uptime).toBeGreaterThanOrEqual(100);
    });

    it('should track memory usage', async () => {
      const config: ServerConfig = {
        mode: 'ssr',
        port,
        host: 'localhost',
        routes: [],
      };

      server = await createServer(config);
      await server.listen();

      const metrics = (server as any).getMetrics();
      expect(metrics.heapUsed).toBeGreaterThan(0);
      expect(metrics.heapTotal).toBeGreaterThan(0);
      expect(metrics.rss).toBeGreaterThan(0);
    });
  });

  describe('SSR/SSG Modes', () => {
    it('should render SSR content', async () => {
      const config: ServerConfig = {
        mode: 'ssr',
        port,
        host: 'localhost',
        routes: [
          {
            path: '/',
            component: () => '<h1>SSR Content</h1>',
            getServerSideProps: async () => ({
              props: { title: 'SSR Page' },
            }),
          },
        ],
      };

      server = await createServer(config);
      await server.listen();

      const response = await fetch(`http://localhost:${port}/`);
      const html = await response.text();
      expect(html).toContain('SSR Content');
    });

    it('should support SSG mode', async () => {
      const config: ServerConfig = {
        mode: 'ssg',
        port,
        host: 'localhost',
        routes: [
          {
            path: '/',
            component: () => '<h1>SSG Content</h1>',
            getStaticProps: async () => ({
              props: { title: 'SSG Page' },
            }),
          },
        ],
      };

      server = await createServer(config);
      const result = await server.render({
        url: new URL('http://localhost/'),
        headers: new Headers(),
        method: 'GET',
      });

      expect(result.html).toContain('SSG Content');
    });

    it('should support Islands mode', async () => {
      const config: ServerConfig = {
        mode: 'islands',
        port,
        host: 'localhost',
        routes: [
          {
            path: '/',
            component: () => '<h1>Islands</h1>',
            islands: [
              {
                name: 'Counter',
                component: () => '<button>Count: 0</button>',
              },
            ],
          },
        ],
      };

      server = await createServer(config);
      await server.listen();

      const response = await fetch(`http://localhost:${port}/`);
      const html = await response.text();
      expect(html).toContain('Islands');
    });
  });

  describe('Error Handling', () => {
    it('should handle render errors gracefully', async () => {
      const config: ServerConfig = {
        mode: 'ssr',
        port,
        host: 'localhost',
        routes: [
          {
            path: '/',
            component: () => {
              throw new Error('Render error');
            },
          },
        ],
      };

      server = await createServer(config);
      await server.listen();

      const response = await fetch(`http://localhost:${port}/`);
      expect(response.status).toBe(500);
    });

    it('should handle invalid requests', async () => {
      const config: ServerConfig = {
        mode: 'ssr',
        port,
        host: 'localhost',
        routes: [],
      };

      server = await createServer(config);
      await server.listen();

      // Send invalid request
      const response = await fetch(`http://localhost:${port}/`, {
        method: 'INVALID',
      } as any);

      // Should still respond, even if with an error
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle server errors in dev mode', async () => {
      const config: DevServerConfig = {
        dev: true,
        mode: 'ssr',
        port,
        host: 'localhost',
        errorOverlay: true,
        routes: [
          {
            path: '/error',
            component: () => {
              throw new Error('Dev error');
            },
          },
        ],
      };

      server = await createServer(config);
      await server.listen();

      const response = await fetch(`http://localhost:${port}/error`);
      expect(response.status).toBe(500);
      const text = await response.text();
      expect(text).toContain('Error');
    });
  });

  describe('Graceful Shutdown', () => {
    it('should close server gracefully', async () => {
      const config: ServerConfig = {
        mode: 'ssr',
        port,
        host: 'localhost',
        routes: [],
      };

      server = await createServer(config);
      await server.listen();

      // Verify server is running
      const response = await fetch(`http://localhost:${port}/`);
      expect(response.status).toBeGreaterThanOrEqual(200);

      // Close server
      await server.close();

      // Verify server is closed
      await expect(
        fetch(`http://localhost:${port}/`)
      ).rejects.toThrow();
    });

    it('should handle multiple close calls', async () => {
      const config: ServerConfig = {
        mode: 'ssr',
        port,
        host: 'localhost',
        routes: [],
      };

      server = await createServer(config);
      await server.listen();

      await server.close();
      await server.close(); // Second call should not throw

      expect(true).toBe(true);
    });
  });

  describe('WebSocket Support', () => {
    it('should support WebSocket connections in dev mode', async () => {
      const config: DevServerConfig = {
        dev: true,
        mode: 'ssr',
        port,
        host: 'localhost',
        hmr: true,
        routes: [],
      };

      server = await createServer(config);
      await server.listen();

      // WebSocket connection test would require WebSocket client
      // For now, just verify HMR endpoint exists
      const response = await fetch(`http://localhost:${port}/__aether_hmr`);
      expect(response.status).toBe(101); // Switching Protocols
    });
  });

  describe('Restart Functionality', () => {
    it('should restart dev server', async () => {
      const config: DevServerConfig = {
        dev: true,
        mode: 'ssr',
        port,
        host: 'localhost',
        routes: [],
      };

      server = await createServer(config);
      await server.listen();

      const firstResponse = await fetch(`http://localhost:${port}/`);
      expect(firstResponse.status).toBeGreaterThanOrEqual(200);

      await server.restart();

      const secondResponse = await fetch(`http://localhost:${port}/`);
      expect(secondResponse.status).toBeGreaterThanOrEqual(200);
    });
  });

  describe('Performance', () => {
    it('should handle multiple concurrent requests', async () => {
      const config: ServerConfig = {
        mode: 'ssr',
        port,
        host: 'localhost',
        routes: [
          {
            path: '/',
            component: () => '<h1>Home</h1>',
          },
        ],
      };

      server = await createServer(config);
      await server.listen();

      const requests = Array.from({ length: 10 }, () =>
        fetch(`http://localhost:${port}/`)
      );

      const responses = await Promise.all(requests);
      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });

      const metrics = (server as any).getMetrics();
      expect(metrics.requests).toBe(10);
    });

    it('should maintain performance under load', async () => {
      const config: ServerConfig = {
        mode: 'ssr',
        port,
        host: 'localhost',
        routes: [
          {
            path: '/',
            component: () => '<h1>Home</h1>',
          },
        ],
      };

      server = await createServer(config);
      await server.listen();

      const startTime = Date.now();
      const requests = Array.from({ length: 100 }, () =>
        fetch(`http://localhost:${port}/`)
      );

      await Promise.all(requests);
      const duration = Date.now() - startTime;

      // Should handle 100 requests in reasonable time
      expect(duration).toBeLessThan(5000);

      const metrics = (server as any).getMetrics();
      expect(metrics.avgResponseTime).toBeLessThan(50); // Average should be fast
    });
  });
});