/**
 * API Gateway Simulator for Integration Testing
 *
 * A simple Node.js HTTP proxy that routes requests to multiple backend servers
 * based on path prefix. Supports both HTTP proxying and WebSocket upgrade proxying.
 *
 * @module tests/fixtures/api-gateway
 */

import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Route configuration for a path prefix
 */
export interface RouteConfig {
  /** Path prefix to match (e.g., '/core', '/storage') */
  pathPrefix: string;
  /** Target backend URL (e.g., 'http://localhost:3001') */
  target: string;
}

/**
 * API Gateway configuration
 */
export interface GatewayConfig {
  /** Port to listen on (0 for random) */
  port: number;
  /** Route configurations */
  routes: RouteConfig[];
  /** Enable verbose logging */
  debug?: boolean;
}

/**
 * Request log entry for debugging and testing
 */
export interface RequestLogEntry {
  /** Timestamp of the request */
  timestamp: number;
  /** HTTP method */
  method: string;
  /** Original request URL */
  url: string;
  /** Matched route prefix (or null if no match) */
  matchedPrefix: string | null;
  /** Target backend URL */
  targetUrl: string | null;
  /** Response status code */
  statusCode: number;
  /** Request duration in ms */
  duration: number;
  /** Whether this was a WebSocket upgrade */
  isWebSocket: boolean;
  /** Error message if any */
  error?: string;
}

/**
 * API Gateway interface
 */
export interface ApiGateway {
  /** Start the gateway server */
  start(): Promise<void>;
  /** Stop the gateway server */
  stop(): Promise<void>;
  /** Get the gateway URL */
  getUrl(): string;
  /** Get the gateway port */
  getPort(): number;
  /** Get the request log */
  getRequestLog(): RequestLogEntry[];
  /** Clear the request log */
  clearRequestLog(): void;
  /** Check if the gateway is running */
  isRunning(): boolean;
}

/**
 * Create an API Gateway simulator
 *
 * @param config - Gateway configuration
 * @returns API Gateway instance
 *
 * @example
 * ```typescript
 * const gateway = await createApiGateway({
 *   port: 3000,
 *   routes: [
 *     { pathPrefix: '/core', target: 'http://localhost:3001' },
 *     { pathPrefix: '/storage', target: 'http://localhost:3002' },
 *     { pathPrefix: '/chat', target: 'http://localhost:3003' },
 *   ],
 * });
 *
 * await gateway.start();
 * console.log(`Gateway running at ${gateway.getUrl()}`);
 *
 * // Later...
 * await gateway.stop();
 * ```
 */
export async function createApiGateway(config: GatewayConfig): Promise<ApiGateway> {
  const requestLog: RequestLogEntry[] = [];
  let server: http.Server | null = null;
  let wss: WebSocketServer | null = null;
  let actualPort = config.port;
  let running = false;

  /**
   * Log a message if debug is enabled
   */
  function debugLog(...args: any[]): void {
    if (config.debug) {
      console.log('[API Gateway]', ...args);
    }
  }

  /**
   * Find matching route for a given path
   */
  function findRoute(path: string): RouteConfig | null {
    // Sort routes by prefix length (longest first) to ensure most specific match
    const sortedRoutes = [...config.routes].sort((a, b) => b.pathPrefix.length - a.pathPrefix.length);

    for (const route of sortedRoutes) {
      if (path.startsWith(route.pathPrefix)) {
        return route;
      }
    }
    return null;
  }

  /**
   * Proxy an HTTP request to the target backend
   */
  function proxyRequest(req: IncomingMessage, res: ServerResponse, route: RouteConfig, startTime: number): void {
    const targetUrl = new URL(route.target);
    const path = req.url || '/';

    // Remove the prefix from the path when proxying
    // e.g., /core/netron/invoke -> /netron/invoke
    const strippedPath = path.startsWith(route.pathPrefix) ? path.slice(route.pathPrefix.length) || '/' : path;

    const proxyOptions: http.RequestOptions = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      path: strippedPath,
      method: req.method,
      headers: {
        ...req.headers,
        host: targetUrl.host,
        'x-forwarded-host': req.headers.host || '',
        'x-forwarded-proto': 'http',
        'x-gateway-path-prefix': route.pathPrefix,
      },
    };

    debugLog(`Proxying ${req.method} ${path} -> ${route.target}${strippedPath}`);

    const protocol = targetUrl.protocol === 'https:' ? https : http;
    const proxyReq = protocol.request(proxyOptions, (proxyRes) => {
      const duration = Date.now() - startTime;

      // Log the request
      requestLog.push({
        timestamp: startTime,
        method: req.method || 'GET',
        url: path,
        matchedPrefix: route.pathPrefix,
        targetUrl: `${route.target}${strippedPath}`,
        statusCode: proxyRes.statusCode || 500,
        duration,
        isWebSocket: false,
      });

      // Copy status and headers
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);

      // Pipe the response
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (error) => {
      const duration = Date.now() - startTime;

      debugLog(`Proxy error: ${error.message}`);

      requestLog.push({
        timestamp: startTime,
        method: req.method || 'GET',
        url: path,
        matchedPrefix: route.pathPrefix,
        targetUrl: `${route.target}${strippedPath}`,
        statusCode: 502,
        duration,
        isWebSocket: false,
        error: error.message,
      });

      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: false,
            error: {
              code: 'BAD_GATEWAY',
              message: `Backend unavailable: ${error.message}`,
            },
          })
        );
      }
    });

    // Pipe the request body
    req.pipe(proxyReq);
  }

  /**
   * Handle HTTP requests
   */
  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const startTime = Date.now();
    const path = req.url || '/';

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Netron-Version, X-Request-ID');

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Find matching route
    const route = findRoute(path);

    if (!route) {
      const duration = Date.now() - startTime;

      requestLog.push({
        timestamp: startTime,
        method: req.method || 'GET',
        url: path,
        matchedPrefix: null,
        targetUrl: null,
        statusCode: 404,
        duration,
        isWebSocket: false,
        error: 'No matching route',
      });

      debugLog(`No route found for ${path}`);

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: `No route configured for path: ${path}`,
            availableRoutes: config.routes.map((r) => r.pathPrefix),
          },
        })
      );
      return;
    }

    // Proxy the request
    proxyRequest(req, res, route, startTime);
  }

  /**
   * Handle WebSocket upgrade
   */
  function handleUpgrade(req: IncomingMessage, socket: any, head: Buffer): void {
    const startTime = Date.now();
    const path = req.url || '/';

    // Find matching route
    const route = findRoute(path);

    if (!route) {
      debugLog(`No WebSocket route found for ${path}`);

      requestLog.push({
        timestamp: startTime,
        method: 'UPGRADE',
        url: path,
        matchedPrefix: null,
        targetUrl: null,
        statusCode: 404,
        duration: Date.now() - startTime,
        isWebSocket: true,
        error: 'No matching route',
      });

      socket.destroy();
      return;
    }

    // Parse target URL
    const targetUrl = new URL(route.target);
    const wsProtocol = targetUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    const strippedPath = path.startsWith(route.pathPrefix) ? path.slice(route.pathPrefix.length) || '/' : path;

    const wsTarget = `${wsProtocol}//${targetUrl.host}${strippedPath}`;

    debugLog(`Proxying WebSocket ${path} -> ${wsTarget}`);

    // Create upstream WebSocket connection
    const upstream = new WebSocket(wsTarget, {
      headers: {
        ...req.headers,
        host: targetUrl.host,
        'x-forwarded-host': req.headers.host || '',
        'x-gateway-path-prefix': route.pathPrefix,
      },
    });

    upstream.on('open', () => {
      debugLog(`WebSocket connected to upstream: ${wsTarget}`);

      // Handle the upgrade on our side
      wss!.handleUpgrade(req, socket, head, (clientWs) => {
        const duration = Date.now() - startTime;

        requestLog.push({
          timestamp: startTime,
          method: 'UPGRADE',
          url: path,
          matchedPrefix: route.pathPrefix,
          targetUrl: wsTarget,
          statusCode: 101,
          duration,
          isWebSocket: true,
        });

        // Bidirectional message forwarding
        clientWs.on('message', (data) => {
          if (upstream.readyState === WebSocket.OPEN) {
            upstream.send(data);
          }
        });

        upstream.on('message', (data) => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(data);
          }
        });

        // Handle close events
        clientWs.on('close', () => {
          upstream.close();
        });

        upstream.on('close', () => {
          clientWs.close();
        });

        // Handle errors
        clientWs.on('error', (error) => {
          debugLog(`Client WebSocket error: ${error.message}`);
          upstream.close();
        });

        upstream.on('error', (error) => {
          debugLog(`Upstream WebSocket error: ${error.message}`);
          clientWs.close();
        });
      });
    });

    upstream.on('error', (error) => {
      const duration = Date.now() - startTime;

      debugLog(`WebSocket upstream error: ${error.message}`);

      requestLog.push({
        timestamp: startTime,
        method: 'UPGRADE',
        url: path,
        matchedPrefix: route.pathPrefix,
        targetUrl: wsTarget,
        statusCode: 502,
        duration,
        isWebSocket: true,
        error: error.message,
      });

      socket.destroy();
    });
  }

  return {
    async start(): Promise<void> {
      if (running) {
        return;
      }

      return new Promise((resolve, reject) => {
        server = http.createServer(handleRequest);

        // Create WebSocket server for upgrade handling
        wss = new WebSocketServer({ noServer: true });

        server.on('upgrade', handleUpgrade);

        server.on('error', (error) => {
          reject(error);
        });

        server.listen(config.port, '127.0.0.1', () => {
          const address = server!.address() as AddressInfo;
          actualPort = address.port;
          running = true;

          debugLog(`Started on port ${actualPort}`);
          debugLog(
            'Routes:',
            config.routes.map((r) => `${r.pathPrefix} -> ${r.target}`)
          );

          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      if (!running || !server) {
        return;
      }

      return new Promise((resolve, reject) => {
        // Close WebSocket server
        if (wss) {
          wss.close();
          wss = null;
        }

        // Close HTTP server
        server!.close((error) => {
          if (error) {
            reject(error);
          } else {
            running = false;
            server = null;

            debugLog('Stopped');
            resolve();
          }
        });

        // Force close after timeout
        setTimeout(() => {
          if (server) {
            server.closeAllConnections?.();
          }
        }, 100);
      });
    },

    getUrl(): string {
      return `http://127.0.0.1:${actualPort}`;
    },

    getPort(): number {
      return actualPort;
    },

    getRequestLog(): RequestLogEntry[] {
      return [...requestLog];
    },

    clearRequestLog(): void {
      requestLog.length = 0;
    },

    isRunning(): boolean {
      return running;
    },
  };
}

/**
 * Create a simple mock backend server for testing
 *
 * @param port - Port to listen on
 * @param pathPrefix - Expected path prefix (for validation)
 * @param services - Service handlers
 * @returns Mock server with start/stop methods
 */
export interface MockBackend {
  start(): Promise<void>;
  stop(): Promise<void>;
  getUrl(): string;
  getPort(): number;
  getRequestCount(): number;
}

export async function createMockBackend(
  port: number,
  pathPrefix: string,
  services: Record<string, Record<string, (...args: any[]) => any>>,
  options?: { debug?: boolean }
): Promise<MockBackend> {
  let server: http.Server | null = null;
  let actualPort = port;
  let requestCount = 0;

  function debugLog(...args: any[]): void {
    if (options?.debug) {
      console.log(`[Mock Backend ${pathPrefix}]`, ...args);
    }
  }

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    requestCount++;

    // Collect body
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf-8');

      // Set CORS headers
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Netron-Version');

      // Handle OPTIONS
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Only handle POST to /netron/invoke
      if (req.method !== 'POST' || !req.url?.includes('/netron/invoke')) {
        res.writeHead(404);
        res.end(
          JSON.stringify({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
          })
        );
        return;
      }

      // Parse request
      let requestData: any;
      try {
        requestData = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end(
          JSON.stringify({
            success: false,
            error: { code: 'INVALID_JSON', message: 'Invalid JSON body' },
          })
        );
        return;
      }

      const { id, service, method, input } = requestData;

      debugLog(`Received: ${service}.${method}(${JSON.stringify(input)})`);

      // Find service
      const serviceHandler = services[service];
      if (!serviceHandler) {
        res.writeHead(200);
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

      // Find method
      const methodHandler = serviceHandler[method];
      if (!methodHandler) {
        res.writeHead(200);
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

      // Execute
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
    });
  }

  return {
    async start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server = http.createServer(handleRequest);

        server.on('error', reject);

        server.listen(port, '127.0.0.1', () => {
          const address = server!.address() as AddressInfo;
          actualPort = address.port;
          debugLog(`Started on port ${actualPort}`);
          resolve();
        });
      });
    },

    async stop(): Promise<void> {
      return new Promise((resolve, reject) => {
        if (!server) {
          resolve();
          return;
        }

        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            server = null;
            debugLog('Stopped');
            resolve();
          }
        });

        // Force close connections
        setTimeout(() => {
          if (server) {
            server.closeAllConnections?.();
          }
        }, 100);
      });
    },

    getUrl(): string {
      return `http://127.0.0.1:${actualPort}`;
    },

    getPort(): number {
      return actualPort;
    },

    getRequestCount(): number {
      return requestCount;
    },
  };
}
