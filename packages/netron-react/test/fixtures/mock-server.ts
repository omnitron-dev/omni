/**
 * Mock HTTP server for integration testing
 *
 * Simulates Netron RPC protocol for testing the netron-react library.
 * Uses Node.js `node:http` module and works with happy-dom environment.
 */

import * as http from 'node:http';
import { AddressInfo } from 'node:net';

// ============================================================================
// Types
// ============================================================================

/**
 * Request record for tracking assertions
 */
export interface RequestRecord {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
  timestamp: number;
}

/**
 * Netron RPC request format
 */
export interface NetronRequest {
  service: string;
  method: string;
  args: unknown[];
  id?: string | number;
  hints?: {
    timeout?: number;
    [key: string]: unknown;
  };
}

/**
 * Netron RPC response format
 */
export interface NetronResponse {
  result?: unknown;
  error?: {
    code: string;
    message: string;
    data?: unknown;
  };
  id?: string | number;
}

/**
 * Request handler type
 */
export type RequestHandler = (req: NetronRequest, res: http.ServerResponse) => void | Promise<void>;

/**
 * Mock server options
 */
export interface MockServerOptions {
  /** Port to listen on (0 for random) */
  port?: number;
  /** Host to bind to */
  host?: string;
  /** Custom request handler */
  handler?: RequestHandler;
  /** Request timeout in ms */
  timeout?: number;
  /** Enable request logging */
  logging?: boolean;
}

/**
 * Mock server interface
 */
export interface MockServer {
  /** Underlying HTTP server */
  server: http.Server;
  /** Full URL to connect to */
  url: string;
  /** Port the server is listening on */
  port: number;
  /** Host the server is bound to */
  host: string;
  /** All recorded requests */
  requests: RequestRecord[];
  /** Close the server */
  close: () => Promise<void>;
  /** Set a custom request handler */
  setHandler: (handler: RequestHandler) => void;
  /** Reset recorded requests */
  resetRequests: () => void;
  /** Get last request */
  getLastRequest: () => RequestRecord | undefined;
  /** Wait for a specific number of requests */
  waitForRequests: (count: number, timeout?: number) => Promise<RequestRecord[]>;
  /** Check if server is running */
  isRunning: () => boolean;
}

// ============================================================================
// Netron Handler Factory
// ============================================================================

/**
 * Service method implementation
 */
export type ServiceMethod = (...args: unknown[]) => unknown | Promise<unknown>;

/**
 * Service definition
 */
export type ServiceDefinition = Record<string, ServiceMethod>;

/**
 * Services registry
 */
export type ServicesRegistry = Record<string, ServiceDefinition>;

/**
 * Create a Netron protocol handler from service definitions
 */
export function createNetronHandler(services: ServicesRegistry): RequestHandler {
  return async (req, res) => {
    const { service, method, args, id } = req;

    // Find service
    const serviceImpl = services[service];
    if (!serviceImpl) {
      sendNetronResponse(res, {
        error: {
          code: 'SERVICE_NOT_FOUND',
          message: `Service "${service}" not found`,
        },
        id,
      });
      return;
    }

    // Find method
    const methodImpl = serviceImpl[method];
    if (!methodImpl) {
      sendNetronResponse(res, {
        error: {
          code: 'METHOD_NOT_FOUND',
          message: `Method "${method}" not found on service "${service}"`,
        },
        id,
      });
      return;
    }

    try {
      // Execute method
      const result = await methodImpl(...args);
      sendNetronResponse(res, { result, id });
    } catch (error) {
      const err = error as Error;
      sendNetronResponse(res, {
        error: {
          code: 'INTERNAL_ERROR',
          message: err.message || 'Unknown error',
          data: { stack: err.stack },
        },
        id,
      });
    }
  };
}

/**
 * Send a Netron response
 */
function sendNetronResponse(res: http.ServerResponse, response: NetronResponse): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(response));
}

// ============================================================================
// Mock Server Factory
// ============================================================================

/**
 * Create a mock HTTP server that simulates Netron protocol
 */
export async function createMockServer(options: MockServerOptions = {}): Promise<MockServer> {
  const { port = 0, host = '127.0.0.1', handler: initialHandler, timeout = 30000, logging = false } = options;

  const requests: RequestRecord[] = [];
  let currentHandler: RequestHandler | null = initialHandler ?? null;
  let running = false;

  // Create server
  const server = http.createServer(async (req, res) => {
    // Set timeout
    res.setTimeout(timeout);

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Only handle POST requests to /netron/invoke
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    // Parse body
    let body: unknown;
    try {
      body = await parseRequestBody(req);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    // Record request
    const record: RequestRecord = {
      method: req.method,
      url: req.url ?? '/',
      headers: req.headers,
      body,
      timestamp: Date.now(),
    };
    requests.push(record);

    if (logging) {
      console.log('[MockServer]', record.method, record.url, record.body);
    }

    // Validate Netron request
    const netronReq = body as NetronRequest;
    if (!netronReq.service || !netronReq.method) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            code: 'INVALID_REQUEST',
            message: 'Missing service or method',
          },
        })
      );
      return;
    }

    // Use custom handler if set
    if (currentHandler) {
      try {
        await currentHandler(netronReq, res);
      } catch (error) {
        const err = error as Error;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              code: 'HANDLER_ERROR',
              message: err.message || 'Handler error',
            },
          })
        );
      }
      return;
    }

    // Default echo response
    sendNetronResponse(res, {
      result: {
        service: netronReq.service,
        method: netronReq.method,
        args: netronReq.args,
        echo: true,
      },
      id: netronReq.id,
    });
  });

  // Handle server errors
  server.on('error', (err) => {
    console.error('[MockServer] Error:', err);
  });

  // Start listening
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      running = true;
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const actualPort = address.port;
  const actualHost = address.address;
  const url = `http://${actualHost}:${actualPort}`;

  // Return mock server interface
  return {
    server,
    url,
    port: actualPort,
    host: actualHost,

    requests,

    async close() {
      if (!running) return;
      running = false;

      return new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },

    setHandler(handler: RequestHandler) {
      currentHandler = handler;
    },

    resetRequests() {
      requests.length = 0;
    },

    getLastRequest() {
      return requests[requests.length - 1];
    },

    async waitForRequests(count: number, timeout = 5000) {
      const startTime = Date.now();

      while (requests.length < count) {
        if (Date.now() - startTime > timeout) {
          throw new Error(`Timeout waiting for ${count} requests. Got ${requests.length} requests.`);
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      return requests.slice(0, count);
    },

    isRunning() {
      return running;
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse request body as JSON
 */
function parseRequestBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';

    req.on('data', (chunk) => {
      data += chunk.toString();
    });

    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

// ============================================================================
// Specialized Handlers
// ============================================================================

/**
 * Create a handler that delays responses
 */
export function createDelayedHandler(baseHandler: RequestHandler, delayMs: number): RequestHandler {
  return async (req, res) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return baseHandler(req, res);
  };
}

/**
 * Create a handler that fails a percentage of requests
 */
export function createFlakyHandler(baseHandler: RequestHandler, failureRate: number = 0.5): RequestHandler {
  return async (req, res) => {
    if (Math.random() < failureRate) {
      sendNetronResponse(res, {
        error: {
          code: 'RANDOM_FAILURE',
          message: 'Simulated random failure',
        },
        id: req.id,
      });
      return;
    }
    return baseHandler(req, res);
  };
}

/**
 * Create a handler that times out (never responds)
 */
export function createTimeoutHandler(): RequestHandler {
  return () => {
    // Never call res.end() - simulates timeout
  };
}

/**
 * Create a handler that returns an error for specific methods
 */
export function createErrorHandler(errorMethods: Record<string, { code: string; message: string }>): RequestHandler {
  return (req, res) => {
    const key = `${req.service}.${req.method}`;
    const errorDef = errorMethods[key];

    if (errorDef) {
      sendNetronResponse(res, {
        error: {
          code: errorDef.code,
          message: errorDef.message,
        },
        id: req.id,
      });
      return;
    }

    // Echo by default
    sendNetronResponse(res, {
      result: { service: req.service, method: req.method, args: req.args },
      id: req.id,
    });
  };
}

/**
 * Create a handler that tracks method call counts
 */
export function createCountingHandler(
  baseHandler: RequestHandler
): RequestHandler & { counts: Map<string, number>; resetCounts: () => void } {
  const counts = new Map<string, number>();

  const handler = async (req: NetronRequest, res: http.ServerResponse) => {
    const key = `${req.service}.${req.method}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    return baseHandler(req, res);
  };

  handler.counts = counts;
  handler.resetCounts = () => counts.clear();

  return handler;
}
