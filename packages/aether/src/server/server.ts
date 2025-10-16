/**
 * Built-in HTTP Server
 *
 * Runtime-agnostic HTTP server for SSR/SSG
 * Works on Node.js 22+, Bun 1.2+, Deno 2.0+
 *
 * Supports both development and production modes:
 * - Development: HMR, Fast Refresh, Error Overlay, DevTools
 * - Production: Optimized SSR/SSG, Static Assets, Caching
 */

import type { Server, ServerConfig, RenderContext } from './types.js';
import { renderToString, renderDocument } from './renderer.js';

/**
 * Create HTTP server instance
 *
 * Automatically detects and uses appropriate mode:
 * - If config.dev is true or process.env.NODE_ENV === 'development', uses dev server
 * - Otherwise uses production server
 *
 * @param config - Server configuration
 * @returns Server instance
 *
 * @example
 * ```typescript
 * import { createServer } from '@omnitron-dev/aether/server';
 *
 * // Production server
 * const server = createServer({
 *   mode: 'ssr',
 *   routes: [
 *     { path: '/', component: Home },
 *     { path: '/about', component: About }
 *   ],
 *   port: 3000
 * });
 *
 * // Development server with HMR
 * const devServer = createServer({
 *   dev: true,
 *   mode: 'ssr',
 *   routesDir: './src/pages',
 *   port: 3000
 * });
 *
 * await server.listen();
 * ```
 */
export async function createServer(config: ServerConfig): Promise<Server> {
  // Check if dev mode requested
  const isDev =
    (config as any).dev === true ||
    process.env.NODE_ENV === 'development' ||
    process.env.AETHER_DEV === 'true';

  // Delegate to dev server if in development mode
  if (isDev) {
    // Dynamic import to keep dev dependencies optional
    const { createDevServer } = await import('../dev/server.js');
    return createDevServer(config as any);
  }

  // Production server implementation
  return createProductionServer(config);
}

/**
 * Create production server
 */
function createProductionServer(config: ServerConfig): Server {
  const { port = 3000, host = '0.0.0.0' } = config;

  let serverInstance: any = null;

  /**
   * Handle HTTP request
   */
  async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle static files (for production builds)
    if (url.pathname.startsWith('/_assets/') || url.pathname.startsWith('/assets/')) {
      return new Response('Not Found', { status: 404 });
    }

    // Skip favicon.ico
    if (url.pathname === '/favicon.ico') {
      return new Response('', { status: 204 });
    }

    // Create render context
    const context: RenderContext = {
      url,
      headers: request.headers,
      method: request.method,
    };

    // Render route
    try {
      const result = await renderToString(config, context);

      // Build complete HTML document
      const html = renderDocument(result.html, result.data, result.meta as Record<string, string> | undefined);

      // Return response
      return new Response(html, {
        status: result.status || 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...result.headers,
        },
      });
    } catch (error) {
      console.error('Request handling error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  /**
   * Start the server
   */
  async function listen(): Promise<void> {
    // Detect runtime
    const runtime = detectRuntime();

    console.log(`Starting Aether server (${runtime}, ${config.mode} mode)...`);

    if (runtime === 'bun') {
      // Bun server
      serverInstance = (globalThis as any).Bun.serve({
        port,
        hostname: host,
        async fetch(request: Request) {
          return handleRequest(request);
        },
      });

      console.log(`✓ Server listening on http://${host}:${port}`);
    } else if (runtime === 'deno') {
      // Deno server
      serverInstance = (globalThis as any).Deno.serve(
        {
          port,
          hostname: host,
        },
        async (request: Request) => handleRequest(request)
      );

      console.log(`✓ Server listening on http://${host}:${port}`);
    } else {
      // Node.js server
      const { createServer: createNodeServer } = await import('node:http');

      serverInstance = createNodeServer(async (req, res) => {
        try {
          const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
          const request = new Request(url.href, {
            method: req.method,
            headers: req.headers as any,
          });

          const response = await handleRequest(request);

          // Write response
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });

          const body = await response.text();
          res.end(body);
        } catch (error) {
          console.error('Request error:', error);
          res.statusCode = 500;
          res.end('Internal Server Error');
        }
      });

      serverInstance.listen(port, host, () => {
        console.log(`✓ Server listening on http://${host}:${port}`);
      });
    }
  }

  /**
   * Stop the server
   */
  async function close(): Promise<void> {
    if (!serverInstance) return;

    const runtime = detectRuntime();

    if (runtime === 'bun') {
      serverInstance.stop();
    } else if (runtime === 'deno') {
      await serverInstance.shutdown();
    } else {
      // Node.js
      await new Promise<void>((resolve, reject) => {
        serverInstance.close((err: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    console.log('✓ Server stopped');
  }

  /**
   * Render a route (for SSG)
   */
  async function render(context: RenderContext) {
    return renderToString(config, context);
  }

  return {
    listen,
    close,
    render,
  };
}

/**
 * Detect current runtime
 */
function detectRuntime(): 'node' | 'bun' | 'deno' {
  // Check for Bun
  if (typeof (globalThis as any).Bun !== 'undefined') {
    return 'bun';
  }

  // Check for Deno
  if (typeof (globalThis as any).Deno !== 'undefined') {
    return 'deno';
  }

  // Default to Node.js
  return 'node';
}
