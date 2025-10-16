/**
 * Unified HTTP Server
 *
 * Runtime-agnostic HTTP server for SSR/SSG with dev and production modes
 * Works on Node.js 22+, Bun 1.2+, Deno 2.0+
 *
 * Features:
 * - Development: HMR, Fast Refresh, Error Overlay, DevTools
 * - Production: Optimized SSR/SSG, Compression, Caching, Metrics
 * - Both: Middleware stack, CORS, Static files, Graceful shutdown
 */

import type {
  Server,
  ServerConfig,
  DevServer,
  DevServerConfig,
  DevMetrics,
  RenderContext,
  FileWatcher,
  Middleware,
} from './types.js';
import { renderToString } from './ssr.js';
import { renderDocument } from './renderer.js';

// Dev-only imports (tree-shaken in production)
import { HMREngine } from './hmr/engine.js';
import { initFastRefresh } from './hmr/fast-refresh.js';
import { createDevMiddleware } from './middleware/index.js';

/**
 * Runtime detection utility
 */
function detectRuntime(): 'node' | 'bun' | 'deno' {
  if (typeof (globalThis as any).Bun !== 'undefined') return 'bun';
  if (typeof (globalThis as any).Deno !== 'undefined') return 'deno';
  return 'node';
}

/**
 * Check if running in development mode
 */
function isDevelopment(config: ServerConfig): boolean {
  return (
    (config as any).dev === true ||
    process.env.NODE_ENV === 'development' ||
    process.env.AETHER_DEV === 'true'
  );
}

/**
 * Create unified server instance
 *
 * Automatically uses appropriate features based on mode:
 * - Development: Full HMR, Fast Refresh, DevTools
 * - Production: Optimized performance, caching
 *
 * @param config - Server configuration
 * @returns Server instance with mode-appropriate features
 *
 * @example
 * ```typescript
 * // Production server
 * const server = await createServer({
 *   mode: 'ssr',
 *   routes: [...],
 *   port: 3000
 * });
 *
 * // Development server
 * const devServer = await createServer({
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
  const isDev = isDevelopment(config);
  const runtime = detectRuntime();

  // Common configuration
  const {
    port = 3000,
    host = '0.0.0.0',
    mode = 'ssr',
  } = config;

  // Server state
  let serverInstance: any = null;
  let wsServer: any = null;
  let isClosing = false;
  let isClosed = false;

  // Metrics (useful in both dev and prod)
  const metrics: DevMetrics = {
    uptime: 0,
    requests: 0,
    avgResponseTime: 0,
    updates: 0,
    avgUpdateTime: 0,
    fullReloads: 0,
    transforms: 0,
    cacheHits: 0,
    cacheMisses: 0,
    heapUsed: 0,
    heapTotal: 0,
    rss: 0,
  };

  const startTime = Date.now();

  // Development-only features
  let hmr: HMREngine | undefined;
  let devMiddleware: any | undefined;

  if (isDev) {
    // Initialize HMR
    const hmrConfig = (config as DevServerConfig).hmr;
    hmr = new HMREngine(
      typeof hmrConfig === 'object' ? hmrConfig : {}
    );

    // Initialize Fast Refresh
    initFastRefresh({
      enabled: true,
      preserveLocalState: true,
    });

    // Create dev middleware stack
    devMiddleware = createDevMiddleware(config as DevServerConfig);
    devMiddleware.use(createSSRMiddleware(config));
  }

  // Middleware stack (production uses a simpler version)
  const middleware = isDev ? devMiddleware : createProductionMiddleware(config);

  /**
   * Handle HTTP request (unified for both modes)
   */
  async function handleRequest(request: Request): Promise<Response> {
    const requestStart = Date.now();
    metrics.requests++;

    try {
      // Use middleware stack if available
      if (middleware) {
        const response = await middleware.handle(request);
        updateMetrics(requestStart);
        return response;
      }

      // Fallback to basic handling (production without middleware)
      const url = new URL(request.url);

      // Skip static assets
      if (url.pathname.startsWith('/_assets/') || url.pathname.includes('.')) {
        return new Response('Not Found', { status: 404 });
      }

      // Find matching route
      const route = findRoute(config.routes || [], url.pathname);

      if (!route) {
        return new Response('Not Found', { status: 404 });
      }

      // Render component
      const result = await renderToString(route.component, {
        props: route.props || {},
        url,
      });

      const html = isDev
        ? injectDevScripts(renderDocument(result.html, result.data, result.meta))
        : renderDocument(result.html, result.data, result.meta);

      updateMetrics(requestStart);

      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    } catch (error) {
      console.error(`[${isDev ? 'Dev' : 'Production'} Server] Request error:`, error);

      return new Response('Internal Server Error', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      });
    }
  }

  /**
   * Update request metrics
   */
  function updateMetrics(requestStart: number): void {
    const duration = Math.max(1, Date.now() - requestStart); // Ensure minimum 1ms
    metrics.avgResponseTime =
      (metrics.avgResponseTime * (metrics.requests - 1) + duration) /
      metrics.requests;
  }

  /**
   * Handle WebSocket for HMR (dev only)
   */
  function handleWebSocket(ws: WebSocket): void {
    if (!hmr) return;

    console.log('[HMR] Client connected');
    hmr.addConnection(ws);

    ws.addEventListener('close', () => {
      console.log('[HMR] Client disconnected');
      hmr!.removeConnection(ws);
    });

    ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data as string);
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (error) {
        console.error('[HMR] Message error:', error);
      }
    });
  }

  /**
   * Start the server (unified for all runtimes)
   */
  async function listen(): Promise<void> {
    console.log(`\n🚀 Starting Aether Server...`);
    console.log(`   Runtime: ${runtime}`);
    console.log(`   Mode: ${isDev ? 'development' : 'production'}`);
    console.log(`   SSR Mode: ${mode}`);

    if (isDev) {
      console.log(`   HMR: ${hmr ? 'enabled' : 'disabled'}`);
    }

    // Runtime-specific server setup
    if (runtime === 'bun') {
      serverInstance = (globalThis as any).Bun.serve({
        port,
        hostname: host,
        async fetch(request: Request, server: any) {
          // Handle WebSocket upgrade in dev mode
          if (
            isDev &&
            request.headers.get('upgrade') === 'websocket' &&
            new URL(request.url).pathname === '/__aether_hmr'
          ) {
            const success = server.upgrade(request);
            if (success) return undefined;
          }
          return handleRequest(request);
        },
        ...(isDev && {
          websocket: {
            open(ws: any) {
              handleWebSocket(ws as unknown as WebSocket);
            },
            message() {}, // Handled in handleWebSocket
            close() {},   // Handled in handleWebSocket
          },
        }),
      });
    } else if (runtime === 'node') {
      const { createServer: createNodeServer } = await import('node:http');

      serverInstance = createNodeServer(async (req, res) => {
        try {
          const url = new URL(
            req.url || '/',
            `http://${req.headers.host || 'localhost'}`
          );
          const request = new Request(url.href, {
            method: req.method,
            headers: req.headers as any,
          });

          const response = await handleRequest(request);

          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });

          const body = await response.text();
          res.end(body);
        } catch (error) {
          console.error('Node.js request error:', error);
          res.statusCode = 500;
          res.end('Internal Server Error');
        }
      });

      // Setup WebSocket in dev mode
      if (isDev && hmr) {
        const { WebSocketServer } = await import('ws');
        wsServer = new WebSocketServer({
          server: serverInstance,
          path: '/__aether_hmr',
        });

        wsServer.on('connection', (ws: any) => {
          handleWebSocket(ws as unknown as WebSocket);
        });
      }

      await new Promise<void>((resolve) => {
        serverInstance.listen(port, host, () => {
          console.log(`\n✨ Server ready at http://${host}:${port}\n`);
          resolve();
        });
      });
      return; // Early return for Node.js since it uses callback
    } else {
      // Deno server
      serverInstance = (globalThis as any).Deno.serve(
        { port, hostname: host },
        (request: Request) => handleRequest(request)
      );
    }

    console.log(`\n✨ Server ready at http://${host}:${port}\n`);
  }

  /**
   * Stop the server (unified for all runtimes)
   */
  async function close(): Promise<void> {
    // Prevent multiple simultaneous close operations
    if (isClosing || isClosed) {
      return;
    }

    isClosing = true;

    try {
      if (runtime === 'bun' && serverInstance) {
        serverInstance.stop();
      } else if (runtime === 'node' && serverInstance) {
        if (wsServer) wsServer.close();

        await new Promise<void>((resolve, reject) => {
          serverInstance.close((err: Error) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } else if (runtime === 'deno' && serverInstance) {
        await serverInstance.shutdown();
      }

      if (hmr) hmr.close();

      isClosed = true;
      console.log('✓ Server stopped');
    } finally {
      isClosing = false;
    }
  }

  /**
   * Render route (for SSG)
   */
  async function render(context: RenderContext) {
    const route = findRoute(config.routes || [], context.url.pathname);
    if (!route) {
      return { html: '', data: {}, status: 404 };
    }
    return renderToString(route.component, {
      props: route.props || {},
      url: context.url,
    });
  }

  /**
   * Get server metrics
   */
  function getMetrics(): DevMetrics {
    const mem = typeof process !== 'undefined' ? process.memoryUsage() : null;

    return {
      ...metrics,
      uptime: Date.now() - startTime,
      heapUsed: mem?.heapUsed || 0,
      heapTotal: mem?.heapTotal || 0,
      rss: mem?.rss || 0,
    };
  }

  // Base server interface
  const server: Server = {
    listen,
    close,
    render,
  };

  // Extend with dev features if in dev mode
  if (isDev) {
    return {
      ...server,
      // Dev-specific methods
      restart: async () => {
        console.log('Restarting server...');
        await close();
        // Reset closed flag for restart
        isClosed = false;
        await listen();
      },
      invalidate: (path: string) => {
        hmr?.handleUpdate(path).catch((error) => {
          console.error('[Dev Server] Invalidate error:', error);
        });
      },
      getMetrics,
      use: (mw: Middleware) => {
        devMiddleware?.use(mw);
      },
      // Dev-specific properties
      vite: undefined,
      watcher: createDummyWatcher(),
      hmr,
      middleware: devMiddleware,
    } as DevServer;
  }

  // Production server can also have metrics
  return {
    ...server,
    getMetrics,
  } as Server & { getMetrics: () => DevMetrics };
}

/**
 * Create production middleware stack
 */
function createProductionMiddleware(config: ServerConfig): any {
  // Simple middleware for production (can be expanded)
  return {
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);

      // Handle static files
      if (url.pathname.startsWith('/assets/') || url.pathname.includes('.')) {
        return new Response('Not Found', { status: 404 });
      }

      // Find matching route
      const route = findRoute(config.routes || [], url.pathname);
      if (!route) {
        return new Response('Not Found', { status: 404 });
      }

      // Render component
      const result = await renderToString(route.component, {
        props: route.props || {},
        url,
      });

      const html = renderDocument(result.html, result.data, result.meta);

      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    },
  };
}

/**
 * Create SSR middleware for development
 */
function createSSRMiddleware(config: ServerConfig): Middleware {
  return {
    name: 'ssr',
    async handle(req, next) {
      const url = new URL(req.url);

      // Skip non-HTML requests
      if (url.pathname.includes('.')) {
        return next();
      }

      try {
        // Find matching route
        const route = findRoute(config.routes || [], url.pathname);
        if (!route) {
          // No route found, pass to next middleware
          return next();
        }

        // Render component
        const result = await renderToString(route.component, {
          props: route.props || {},
          url,
        });

        const html = injectDevScripts(
          renderDocument(result.html, result.data, result.meta)
        );

        return new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
          },
        });
      } catch (error) {
        console.error('[SSR] Render error:', error);
        return new Response('SSR Error', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    },
  };
}

/**
 * Inject development scripts (HMR client, error overlay)
 */
function injectDevScripts(html: string): string {
  const scripts = `
    <script type="module">
      import { initHMR } from '/__aether/hmr-client.js';
      import { initErrorOverlay } from '/__aether/error-overlay.js';
      initHMR();
      initErrorOverlay();
    </script>
  `;

  return html.replace('</body>', `${scripts}</body>`);
}

/**
 * Create dummy file watcher for dev server interface
 */
function createDummyWatcher(): FileWatcher {
  return {
    add: () => {},
    unwatch: () => {},
    close: async () => {},
    on: () => {},
  };
}

/**
 * Find matching route for pathname
 */
function findRoute(routes: any[], pathname: string): any | null {
  // Exact match
  for (const route of routes) {
    if (route.path === pathname) {
      return route;
    }
  }

  // Dynamic route matching (/:param)
  for (const route of routes) {
    if (route.path && route.path.includes(':')) {
      const routeParts = route.path.split('/');
      const pathParts = pathname.split('/');

      if (routeParts.length === pathParts.length) {
        const match = routeParts.every((part, i) => part.startsWith(':') || part === pathParts[i]);

        if (match) {
          // Extract params
          const params: Record<string, string> = {};
          routeParts.forEach((part, i) => {
            if (part.startsWith(':')) {
              params[part.slice(1)] = pathParts[i];
            }
          });
          return { ...route, params };
        }
      }
    }
  }

  return null;
}

/**
 * Create dev server (for backward compatibility)
 * @deprecated Use createServer with dev: true instead
 */
export async function createDevServer(config: DevServerConfig): Promise<DevServer> {
  return createServer({ ...config, dev: true }) as Promise<DevServer>;
}