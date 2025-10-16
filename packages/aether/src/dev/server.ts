/**
 * Development Server
 *
 * Full-featured development server for Aether with HMR, Fast Refresh, and more
 */

import type { DevServer, DevServerConfig, DevMetrics, RenderContext } from '../server/types.js';
import type { FileWatcher, Middleware } from '../server/types.js';
import { HMREngine } from '../server/hmr/engine.js';
import { initFastRefresh } from '../server/hmr/fast-refresh.js';
import { createDevMiddleware } from '../server/middleware/index.js';
import { renderToString } from '../server/ssr.js';
import { renderDocument } from '../server/renderer.js';

/**
 * Create development server
 */
export async function createDevServer(config: DevServerConfig): Promise<DevServer> {
  const {
    port = 3000,
    host = '0.0.0.0',
    hmr: hmrConfig = {},
  } = config;

  // Initialize HMR engine
  const hmr = new HMREngine(
    typeof hmrConfig === 'object' ? hmrConfig : {}
  );

  // Initialize Fast Refresh
  const _fastRefresh = initFastRefresh({
    enabled: true,
    preserveLocalState: true,
  });

  // Create middleware stack
  const middleware = createDevMiddleware(config);

  // Add SSR rendering middleware
  middleware.use(createSSRMiddleware(config));

  // Server state
  let serverInstance: any = null;
  let wsServer: any = null;
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

  /**
   * Handle HTTP request
   */
  async function handleRequest(request: Request): Promise<Response> {
    const requestStart = Date.now();
    metrics.requests++;

    try {
      // Handle through middleware stack
      const response = await middleware.handle(request);

      // Update metrics
      const duration = Date.now() - requestStart;
      metrics.avgResponseTime =
        (metrics.avgResponseTime * (metrics.requests - 1) + duration) /
        metrics.requests;

      return response;
    } catch (error) {
      console.error('[Dev Server] Request error:', error);

      return new Response('Internal Server Error', {
        status: 500,
        headers: {
          'Content-Type': 'text/plain',
        },
      });
    }
  }

  /**
   * Handle WebSocket connection for HMR
   */
  function handleWebSocket(ws: WebSocket): void {
    console.log('[HMR] Client connected');

    hmr.addConnection(ws);

    ws.addEventListener('close', () => {
      console.log('[HMR] Client disconnected');
      hmr.removeConnection(ws);
    });

    ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data as string);

        // Handle client messages
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (error) {
        console.error('[HMR] Message error:', error);
      }
    });
  }

  /**
   * Start the server
   */
  async function listen(): Promise<void> {
    const runtime = detectRuntime();

    console.log(`\n🚀 Starting Aether Dev Server...`);
    console.log(`   Runtime: ${runtime}`);
    console.log(`   Mode: development`);
    console.log(`   HMR: ${hmrConfig !== false ? 'enabled' : 'disabled'}`);

    if (runtime === 'bun') {
      // Bun server with WebSocket support
      serverInstance = (globalThis as any).Bun.serve({
        port,
        hostname: host,
        async fetch(request: Request, server: any) {
          // Check for WebSocket upgrade
          if (
            request.headers.get('upgrade') === 'websocket' &&
            new URL(request.url).pathname === '/__aether_hmr'
          ) {
            const success = server.upgrade(request);

            if (success) {
              return undefined;
            }
          }

          return handleRequest(request);
        },
        websocket: {
          open(ws: any) {
            handleWebSocket(ws as unknown as WebSocket);
          },
          message(ws: any, message: any) {
            // Handled in handleWebSocket
          },
          close(ws: any) {
            // Handled in handleWebSocket
          },
        },
      });

      console.log(
        `\n✨ Dev server ready at http://${host}:${port}\n`
      );
    } else if (runtime === 'node') {
      // Node.js server
      const { createServer: createNodeServer } = await import('node:http');
      const { WebSocketServer } = await import('ws');

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

          // Write response
          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });

          const body = await response.text();
          res.end(body);
        } catch (error) {
          console.error('[Dev Server] Request error:', error);
          res.statusCode = 500;
          res.end('Internal Server Error');
        }
      });

      // Setup WebSocket server
      wsServer = new WebSocketServer({
        server: serverInstance,
        path: '/__aether_hmr',
      });

      wsServer.on('connection', (ws: any) => {
        handleWebSocket(ws as unknown as WebSocket);
      });

      serverInstance.listen(port, host, () => {
        console.log(
          `\n✨ Dev server ready at http://${host}:${port}\n`
        );
      });
    } else {
      // Deno server
      const handler = async (request: Request) => handleRequest(request);

      serverInstance = (globalThis as any).Deno.serve(
        {
          port,
          hostname: host,
        },
        handler
      );

      console.log(
        `\n✨ Dev server ready at http://${host}:${port}\n`
      );
    }
  }

  /**
   * Stop the server
   */
  async function close(): Promise<void> {
    const runtime = detectRuntime();

    if (runtime === 'bun' && serverInstance) {
      serverInstance.stop();
    } else if (runtime === 'node' && serverInstance) {
      if (wsServer) {
        wsServer.close();
      }

      await new Promise<void>((resolve, reject) => {
        serverInstance.close((err: Error) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } else if (runtime === 'deno' && serverInstance) {
      await serverInstance.shutdown();
    }

    // Close HMR engine
    hmr.close();

    console.log('✓ Dev server stopped');
  }

  /**
   * Restart server
   */
  async function restart(): Promise<void> {
    console.log('Restarting dev server...');
    await close();
    await listen();
  }

  /**
   * Invalidate module
   */
  function invalidate(path: string): void {
    hmr.handleUpdate(path).catch((error) => {
      console.error('[Dev Server] Invalidate error:', error);
    });
  }

  /**
   * Get metrics
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

  /**
   * Add middleware
   */
  function use(mw: Middleware): void {
    middleware.use(mw);
  }

  /**
   * Render route (for SSG)
   */
  async function render(context: RenderContext) {
    return renderToString(config, context);
  }

  // Dummy watcher for now
  const watcher: FileWatcher = {
    add: () => {},
    unwatch: () => {},
    close: async () => {},
    on: () => {},
  };

  return {
    listen,
    close,
    render,
    restart,
    invalidate,
    getMetrics,
    use,
    vite: undefined,
    watcher,
    hmr,
    middleware,
  };
}

/**
 * Create SSR rendering middleware
 */
function createSSRMiddleware(config: DevServerConfig): Middleware {
  return {
    name: 'ssr',
    async handle(req, next) {
      const url = new URL(req.url);

      // Skip non-HTML requests
      if (url.pathname.includes('.')) {
        return next();
      }

      try {
        // Create render context
        const context: RenderContext = {
          url,
          headers: req.headers,
          method: req.method,
        };

        // Render route
        const result = await renderToString(config, context);

        // Build complete HTML document
        const html = renderDocument(
          result.html,
          result.data,
          result.meta as Record<string, string> | undefined
        );

        // Inject HMR client script
        const htmlWithHMR = injectHMRClient(html);

        return new Response(htmlWithHMR, {
          status: result.status || 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            ...result.headers,
          },
        });
      } catch (error) {
        console.error('[SSR] Render error:', error);

        return new Response('SSR Error', {
          status: 500,
          headers: {
            'Content-Type': 'text/plain',
          },
        });
      }
    },
  };
}

/**
 * Inject HMR client script into HTML
 */
function injectHMRClient(html: string): string {
  const script = `
    <script type="module">
      import { initHMR } from '/__aether/hmr-client.js';
      initHMR();
    </script>
  `;

  return html.replace('</body>', `${script}</body>`);
}

/**
 * Detect current runtime
 */
function detectRuntime(): 'node' | 'bun' | 'deno' {
  if (typeof (globalThis as any).Bun !== 'undefined') {
    return 'bun';
  }

  if (typeof (globalThis as any).Deno !== 'undefined') {
    return 'deno';
  }

  return 'node';
}
