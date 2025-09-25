/**
 * HTTP Server implementation for Netron
 * Handles incoming HTTP requests and routes them to Netron services
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import type {
  ITransportServer,
  ITransportConnection,
  TransportOptions,
  ServerMetrics
} from '../types.js';
import type { LocalPeer } from '../../local-peer.js';
import type { Definition } from '../../definition.js';
import type { MethodContract } from '../../../validation/contract.js';
import { TitanError, ErrorCode } from '../../../errors/index.js';

/**
 * Service route information
 */
interface ServiceRoute {
  serviceName: string;
  methodName: string;
  pattern: string;
  method: string;
  contract: MethodContract;
}

/**
 * CORS options
 */
interface CorsOptions {
  origin?: string | string[] | boolean;
  methods?: string[];
  headers?: string[];
  credentials?: boolean;
  maxAge?: number;
}

/**
 * HTTP Server implementation
 * Routes incoming HTTP requests to Netron services transparently
 */
export class HttpServer extends EventEmitter implements ITransportServer {
  readonly connections = new Map<string, ITransportConnection>();

  private server: any = null;
  private routes = new Map<string, ServiceRoute>();
  private netronPeer?: LocalPeer;
  private options: TransportOptions;
  private corsOptions: CorsOptions;

  // Metrics tracking
  private totalRequests = 0;
  private totalErrors = 0;
  private startTime = Date.now();

  get address(): string | undefined {
    return this.options?.host || 'localhost';
  }

  get port(): number | undefined {
    return this.options?.port || 3000;
  }

  constructor(options?: TransportOptions) {
    super();
    this.options = options || {};

    // Setup CORS options
    this.corsOptions = this.options.cors || {
      origin: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      headers: ['Content-Type', 'Authorization', 'X-Request-ID'],
      credentials: true,
      maxAge: 86400
    };
  }

  /**
   * Set the Netron peer for service method invocation
   */
  setPeer(peer: LocalPeer): void {
    this.netronPeer = peer;
  }

  /**
   * Get all registered services for discovery
   */
  getServiceDiscovery(): any {
    const services: Record<string, any> = {};
    const contracts: Record<string, any> = {};

    // Get services from Netron peer
    if (this.netronPeer) {
      for (const [id, stub] of this.netronPeer.stubs) {
        const serviceName = stub.definition.meta.name;
        services[serviceName] = stub.definition;

        // Include contract if available
        const contract = (stub.definition.meta as any)?.contract;
        if (contract) {
          contracts[serviceName] = contract;
        }
      }
    }

    return {
      services,
      contracts,
      timestamp: Date.now()
    };
  }

  /**
   * Register a service with its routes
   */
  registerService(serviceName: string, definition: Definition | any, contract?: any): void {
    // Handle both Definition instances and plain objects for backwards compatibility
    let serviceContract = contract;

    // Check if definition is a plain object with contract property (legacy format)
    if (!serviceContract && definition && typeof definition === 'object' && 'contract' in definition) {
      serviceContract = definition.contract;
    }

    // Otherwise use contract from definition.meta if available
    if (!serviceContract && definition?.meta) {
      serviceContract = (definition.meta as any)?.contract;
    }

    if (!serviceContract) {
      // No contract, register RPC endpoints for all methods from metadata
      // Support both definition.meta.methods and plain object.methods
      const methods = definition.meta?.methods || definition.methods;
      if (methods) {
        const methodNames = Array.isArray(methods) ? methods : Object.keys(methods);
        for (const methodName of methodNames) {
          this.registerRpcRoute(serviceName, methodName);
        }
      }
      return;
    }

    // Register routes from contract
    const contractDef = serviceContract.definition || serviceContract;
    for (const [methodName, methodContract] of Object.entries(contractDef)) {
      const http = (methodContract as MethodContract).http;

      if (http?.path && http?.method) {
        // Register REST-style endpoint
        const routeKey = `${http.method}:${http.path}`;
        this.routes.set(routeKey, {
          serviceName,
          methodName,
          pattern: http.path,
          method: http.method,
          contract: methodContract as MethodContract
        });
      }

      // Always register RPC-style endpoint as fallback
      this.registerRpcRoute(serviceName, methodName, methodContract as MethodContract);
    }
  }

  /**
   * Register an RPC-style route
   */
  private registerRpcRoute(serviceName: string, methodName: string, contract?: MethodContract): void {
    const rpcKey = `POST:/rpc/${methodName}`;
    this.routes.set(rpcKey, {
      serviceName,
      methodName,
      pattern: `/rpc/${methodName}`,
      method: 'POST',
      contract: contract || {}
    });
  }

  /**
   * Start the HTTP server
   */
  async listen(): Promise<void> {
    // Prevent double listening
    if (this.server) {
      throw new Error('Server is already listening');
    }

    const runtime = this.detectRuntime();
    const port = this.port || 3000;
    const host = this.address || 'localhost';

    if (runtime === 'bun') {
      // Use Bun's native server
      // @ts-ignore - Bun global is not always available
      if (typeof globalThis.Bun !== 'undefined' && globalThis.Bun.serve) {
        // @ts-ignore - Bun types may not be installed
        this.server = globalThis.Bun.serve({
          port,
          hostname: host,
          fetch: this.handleRequest.bind(this)
        });
      } else {
        throw new Error('Bun runtime detected but Bun.serve not available');
      }
    } else if (runtime === 'deno') {
      // Use Deno's native server
      const handler = (req: Request) => this.handleRequest(req);
      this.server = (globalThis as any).Deno.serve({ port, hostname: host }, handler);
    } else {
      // Node.js implementation
      const { createServer } = await import('http');
      this.server = createServer(this.handleNodeRequest.bind(this));

      await new Promise<void>((resolve, reject) => {
        const errorHandler = (err: any) => {
          this.server.removeListener('error', errorHandler);
          reject(err);
        };

        this.server.once('error', errorHandler);
        this.server.listen(port, host, () => {
          this.server.removeListener('error', errorHandler);
          resolve();
        });
      });
    }

    this.emit('listening', { port, host });
  }

  /**
   * Handle incoming HTTP request (Web API style)
   */
  async handleRequest(request: Request): Promise<Response> {
    this.totalRequests++;

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return this.handleCorsPreflightBe(request);
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    // Handle discovery endpoint
    if (pathname === '/netron/discovery' && request.method === 'GET') {
      return this.handleDiscoveryRequest(request);
    }

    // Try to find matching route
    const route = this.findRoute(`${request.method}:${pathname}`, pathname);

    if (!route) {
      return this.createErrorResponse(404, 'Route not found');
    }

    try {
      // Extract input from request
      const input = await this.extractInput(request, route, url);

      // Call the service method through Netron
      if (!this.netronPeer) {
        throw new TitanError({
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Netron peer not initialized'
        });
      }

      // Find the service stub and call the method
      let result: any;
      for (const stub of this.netronPeer.stubs.values()) {
        if (stub.definition.meta.name === route.serviceName) {
          result = await stub.call(route.methodName, [input], this.netronPeer);
          break;
        }
      }

      if (result === undefined) {
        throw new TitanError({
          code: ErrorCode.NOT_FOUND,
          message: `Service ${route.serviceName} not found`
        });
      }

      // Create response
      return this.createResponse(result, route, request);
    } catch (error: any) {
      this.totalErrors++;
      return this.handleError(error, request);
    }
  }

  /**
   * Handle Node.js style request
   */
  private async handleNodeRequest(req: any, res: any): Promise<void> {
    // Convert Node.js request to Web API Request
    const body = await this.readNodeBody(req);
    const url = `http://${req.headers.host || 'localhost'}${req.url}`;

    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: body && ['POST', 'PUT', 'PATCH'].includes(req.method) ? body : undefined
    });

    const response = await this.handleRequest(request);

    // Convert Web API Response to Node.js response
    res.statusCode = response.status;
    response.headers.forEach((value: string, key: string) => {
      res.setHeader(key, value);
    });

    const responseBody = await response.text();
    res.end(responseBody);
  }

  /**
   * Read body from Node.js request
   */
  private readNodeBody(req: any): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: any) => {
        body += chunk.toString();
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  /**
   * Find matching route for request
   */
  findRoute(routeKey: string, pathname: string): ServiceRoute | null {
    // Try exact match first
    const exactRoute = this.routes.get(routeKey);
    if (exactRoute) {
      return exactRoute;
    }

    // Try pattern matching for parameterized routes
    const [method] = routeKey.split(':');

    for (const [key, route] of this.routes) {
      const [routeMethod] = key.split(':');
      if (routeMethod !== method) continue;

      if (this.matchPattern(route.pattern, pathname)) {
        return route;
      }
    }

    return null;
  }

  /**
   * Check if a pathname matches a route pattern
   */
  private matchPattern(pattern: string, pathname: string): boolean {
    // Convert pattern to regex
    // /api/users/{id} -> /api/users/([^/]+)
    // /api/users/:id -> /api/users/([^/]+)
    const regexPattern = pattern
      .replace(/\{([^}]+)\}/g, '([^/]+)')
      .replace(/:([^/]+)/g, '([^/]+)');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(pathname);
  }

  /**
   * Extract path parameters from URL
   */
  extractPathParams(pattern: string, pathname: string): Record<string, string> {
    const params: Record<string, string> = {};

    // Extract parameter names from pattern
    const paramNames: string[] = [];
    const regexPattern = pattern
      .replace(/\{([^}]+)\}/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
      })
      .replace(/:([^/]+)/g, (_, name) => {
        paramNames.push(name);
        return '([^/]+)';
      });

    const regex = new RegExp(`^${regexPattern}$`);
    const match = pathname.match(regex);

    if (match) {
      paramNames.forEach((name, index) => {
        params[name] = match[index + 1] || '';
      });
    }

    return params;
  }

  /**
   * Extract input from HTTP request
   */
  private async extractInput(request: Request, route: ServiceRoute, url: URL): Promise<any> {
    const http = route.contract.http;
    const input: any = {};

    // Extract path parameters
    if (http?.params || route.pattern.includes('{') || route.pattern.includes(':')) {
      const params = this.extractPathParams(route.pattern, url.pathname);
      Object.assign(input, params);
    }

    // Extract query parameters
    if (request.method === 'GET' || http?.query) {
      const queryParams: any = {};
      url.searchParams.forEach((value, key) => {
        queryParams[key] = value;
      });

      // If there's a query schema, parse and transform the query params
      if (http?.query) {
        const parsed = http.query.safeParse(queryParams);
        if (parsed.success) {
          Object.assign(input, parsed.data);
        } else {
          // If validation fails, use raw values
          Object.assign(input, queryParams);
        }
      } else {
        Object.assign(input, queryParams);
      }
    }

    // Extract body for non-GET requests
    if (request.method !== 'GET' && request.body) {
      const contentType = request.headers.get('Content-Type') || '';

      if (contentType.includes('application/json')) {
        const body = await request.json();
        Object.assign(input, body);
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const text = await request.text();
        const formData = new URLSearchParams(text);
        formData.forEach((value, key) => {
          input[key] = value;
        });
      } else if (contentType.includes('multipart/form-data')) {
        // Handle multipart form data
        const formData = await request.formData();
        formData.forEach((value, key) => {
          input[key] = value;
        });
      }
    }

    // Apply the contract's input validation/transformation if available
    if (route.contract?.input) {
      const parsed = route.contract.input.safeParse(input);
      if (parsed.success) {
        return parsed.data;
      } else {
        // Validation failed - throw a validation error
        throw new TitanError({
          code: ErrorCode.INVALID_ARGUMENT,
          message: 'Input validation failed',
          details: parsed.error.issues
        });
      }
    }

    return input;
  }

  /**
   * Create HTTP response from service result
   */
  private createResponse(result: any, route: ServiceRoute, request: Request): Response {
    const http = route.contract.http;
    const status = http?.status || 200;
    const contentType = http?.contentType || 'application/json';

    const headers = new Headers({
      'Content-Type': contentType,
      ...this.getCorsHeaders(request),
      ...(http?.responseHeaders || {})
    });

    // Handle different content types
    let body: string;
    if (contentType === 'application/json') {
      body = JSON.stringify(result);
    } else if (typeof result === 'string') {
      body = result;
    } else {
      body = String(result);
    }

    return new Response(body, { status, headers });
  }

  /**
   * Create error response
   */
  private createErrorResponse(status: number, message: string): Response {
    const headers = new Headers({
      'Content-Type': 'application/json'
    });

    return new Response(
      JSON.stringify({ error: true, message }),
      { status, headers }
    );
  }

  /**
   * Handle service errors
   */
  private handleError(error: any, request: Request): Response {
    let status = 500;
    let message = 'Internal server error';
    let code: string | undefined;

    if (error instanceof TitanError) {
      // Map TitanError codes to HTTP status
      switch (error.code) {
        case ErrorCode.NOT_FOUND:
          status = 404;
          break;
        case ErrorCode.INVALID_ARGUMENT:
        case ErrorCode.VALIDATION_ERROR:
          status = 400;
          break;
        case ErrorCode.UNAUTHORIZED:
          status = 401;
          break;
        case ErrorCode.FORBIDDEN:
          status = 403;
          break;
        case ErrorCode.CONFLICT:
          status = 409;
          break;
        case ErrorCode.RATE_LIMITED:
          status = 429;
          break;
        case ErrorCode.SERVICE_UNAVAILABLE:
          status = 503;
          break;
        default:
          status = 500;
      }
      message = error.message;
      code = String(error.code);
    } else if (error instanceof Error) {
      message = error.message;
    }

    const headers = new Headers({
      'Content-Type': 'application/json',
      ...this.getCorsHeaders(request)
    });

    return new Response(
      JSON.stringify({
        error: true,
        message,
        code,
        timestamp: Date.now()
      }),
      { status, headers }
    );
  }

  /**
   * Handle discovery request
   */
  private handleDiscoveryRequest(request: Request): Response {
    const discovery = this.getServiceDiscovery();
    return new Response(JSON.stringify(discovery), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        ...this.getCorsHeaders(request)
      }
    });
  }

  /**
   * Handle CORS preflight request
   */
  private handleCorsPreflightBe(request: Request): Response {
    const headers = new Headers(this.getCorsHeaders(request));
    return new Response(null, { status: 204, headers });
  }

  /**
   * Get CORS headers
   */
  private getCorsHeaders(request: Request): Record<string, string> {
    const headers: Record<string, string> = {};
    const origin = request.headers.get('Origin');

    if (!origin) return headers;

    // Check if origin is allowed
    if (this.corsOptions.origin === true) {
      headers['Access-Control-Allow-Origin'] = origin;
    } else if (typeof this.corsOptions.origin === 'string') {
      headers['Access-Control-Allow-Origin'] = this.corsOptions.origin;
    } else if (Array.isArray(this.corsOptions.origin) && this.corsOptions.origin.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
    }

    if (this.corsOptions.credentials) {
      headers['Access-Control-Allow-Credentials'] = 'true';
    }

    if (this.corsOptions.methods) {
      headers['Access-Control-Allow-Methods'] = this.corsOptions.methods.join(', ');
    }

    if (this.corsOptions.headers) {
      headers['Access-Control-Allow-Headers'] = this.corsOptions.headers.join(', ');
    }

    if (this.corsOptions.maxAge) {
      headers['Access-Control-Max-Age'] = String(this.corsOptions.maxAge);
    }

    return headers;
  }

  /**
   * Close the server
   */
  async close(): Promise<void> {
    if (this.server) {
      const runtime = this.detectRuntime();

      if (runtime === 'bun') {
        this.server.stop();
      } else if (runtime === 'deno') {
        await this.server.close();
      } else {
        // Node.js
        await new Promise<void>((resolve) => {
          this.server.close(() => resolve());
        });
      }

      this.server = null;
    }

    // Clear all connections
    this.connections.clear();

    this.emit('close');
  }

  /**
   * Broadcast to all connections (not applicable for HTTP)
   */
  async broadcast(data: Buffer | ArrayBuffer): Promise<void> {
    // HTTP is stateless, so broadcast doesn't apply
    // This could be implemented with Server-Sent Events in the future
    console.warn('Broadcast not supported in HTTP transport');
  }

  /**
   * Get server metrics
   */
  getMetrics(): ServerMetrics & { errorRate?: number } {
    const uptime = Date.now() - this.startTime;
    const errorRate = this.totalRequests > 0 ? this.totalErrors / this.totalRequests : 0;

    return {
      activeConnections: this.connections.size,
      totalConnections: this.totalRequests, // Use requests as connections for HTTP
      totalBytesSent: 0, // Would need to track this
      totalBytesReceived: 0, // Would need to track this
      uptime,
      errorRate
    };
  }

  /**
   * Detect runtime environment
   */
  private detectRuntime(): 'node' | 'bun' | 'deno' | 'browser' {
    if (typeof window !== 'undefined') {
      return 'browser';
    }
    // @ts-ignore - Bun global may not be available
    if (typeof globalThis.Bun !== 'undefined') {
      return 'bun';
    }
    if (typeof (global as any).Deno !== 'undefined') {
      return 'deno';
    }
    return 'node';
  }
}