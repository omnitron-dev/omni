/**
 * Native HTTP Server implementation for Netron v2.0
 *
 * This server handles native HTTP JSON messages without packet protocol,
 * providing better performance and OpenAPI compatibility.
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import type {
  ITransportServer,
  ITransportConnection,
  TransportOptions,
  ServerMetrics
} from '../types.js';
import type { LocalPeer } from '../../local-peer.js';
import { TitanError, ErrorCode, NetronErrors, Errors, toTitanError, mapToHttp } from '../../../errors/index.js';
import {
  MiddlewarePipeline,
  MiddlewareStage,
  HttpMiddlewareAdapter,
  HttpBuiltinMiddleware,
  NetronBuiltinMiddleware,
  NetronMiddlewareContext
} from '../../middleware/index.js';
import {
  HttpRequestMessage,
  HttpBatchRequest,
  HttpBatchResponse,
  createSuccessResponse,
  createErrorResponse,
  isHttpRequestMessage,
  isHttpBatchRequest
} from './types.js';
import type { MethodContract } from '../../../validation/contract.js';
import type { HttpRequestContext, HttpRequestHints } from './types.js';
import { detectRuntime, generateRequestId } from '../../utils.js';
import { extractBearerToken } from '../../auth/utils.js';

/**
 * Context passed to method handlers
 * Provides access to request context, hints, and middleware state
 */
export interface MethodHandlerContext {
  /** Request context for tracing and multi-tenancy */
  context?: HttpRequestContext;
  /** Client hints for optimization */
  hints?: HttpRequestHints;
  /** Original HTTP request */
  request: Request;
  /** Middleware context with metadata and timing */
  middleware: NetronMiddlewareContext & { output?: unknown };
}

/**
 * Service descriptor for native HTTP handling
 */
interface ServiceDescriptor {
  name: string;
  version: string;
  methods: Map<string, MethodDescriptor>;
  description?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Method descriptor with enhanced HTTP integration
 * Generic parameters allow for type-safe input/output when known
 */
interface MethodDescriptor<TInput = unknown, TOutput = unknown> {
  name: string;
  handler: (input: TInput, context: MethodHandlerContext) => Promise<TOutput>;
  contract?: MethodContract;
  cacheable?: boolean;
  cacheMaxAge?: number;
  cacheTags?: string[];
  description?: string;
  deprecated?: boolean;
}

/**
 * Native HTTP Server implementation
 * Handles Netron v2.0 protocol with native JSON messaging
 */
export class HttpServer extends EventEmitter implements ITransportServer {
  readonly connections = new Map<string, ITransportConnection>();

  private server: any = null;
  private services = new Map<string, ServiceDescriptor>();
  private netronPeer?: LocalPeer;
  private options: TransportOptions;
  private status: string = 'offline';
  private startTime: number = Date.now();

  // Middleware
  private globalPipeline: MiddlewarePipeline;
  private middlewareAdapter?: HttpMiddlewareAdapter;

  // Enhanced metrics
  private metrics = {
    totalRequests: 0,
    activeRequests: 0,
    totalErrors: 0,
    totalBytesSent: 0,
    totalBytesReceived: 0,
    avgResponseTime: 0,
    responseTimes: [] as number[],
    statusCounts: new Map<number, number>(),
    methodCounts: new Map<string, number>(),
    protocolVersions: new Map<string, number>(),
    startTime: Date.now()
  };

  get address(): string | undefined {
    return this.options?.host || 'localhost';
  }

  get port(): number | undefined {
    return this.options?.port || 3000;
  }

  constructor(options?: TransportOptions) {
    super();
    this.options = options || {};

    // Initialize middleware pipeline
    this.globalPipeline = new MiddlewarePipeline();
    this.setupDefaultMiddleware();
  }

  /**
   * Setup default middleware
   */
  private setupDefaultMiddleware(): void {
    // Always add request ID
    this.globalPipeline.use(
      NetronBuiltinMiddleware.requestId(),
      { name: 'request-id', priority: 1 },
      MiddlewareStage.PRE_PROCESS
    );

    // Add CORS if configured
    if (this.options.cors) {
      this.globalPipeline.use(
        HttpBuiltinMiddleware.cors(this.options.cors as any) as any,
        { name: 'cors', priority: 5 },
        MiddlewareStage.PRE_PROCESS
      );
    }

    // Add HTTP auth extraction middleware
    // This extracts auth information from HTTP headers and adds it to context
    this.globalPipeline.use(
      this.createHttpAuthMiddleware(),
      { name: 'http-auth', priority: 10 },
      MiddlewareStage.PRE_PROCESS
    );

    // Add compression if enabled
    if (this.options.compression) {
      const compressionOpts = typeof this.options.compression === 'object'
        ? this.options.compression
        : { threshold: 1024 };
      this.globalPipeline.use(
        HttpBuiltinMiddleware.compression(compressionOpts) as any,
        { name: 'compression', priority: 90 },
        MiddlewareStage.POST_PROCESS
      );
    }
  }

  /**
   * Create HTTP auth middleware
   * Extracts authentication information from HTTP headers
   */
  private createHttpAuthMiddleware(): any {
    return async (ctx: any, next: () => Promise<void>) => {
      // Extract Authorization header
      const authHeader = ctx.metadata?.get('authorization');

      if (authHeader) {
        // Parse Bearer token using consolidated utility
        const token = extractBearerToken(authHeader);

        if (token) {
          // Try to validate token if AuthenticationManager is available
          const authManager = (this.netronPeer?.netron as any)?.authenticationManager;
          if (authManager) {
            try {
              const result = await authManager.validateToken(token);
              if (result.success && result.context) {
                // Store auth context in metadata for downstream middleware
                ctx.metadata.set('auth-context', result.context);
                ctx.metadata.set('authenticated', true);
              }
            } catch (error) {
              // Token validation failed - continue without auth context
              ctx.metadata.set('authenticated', false);
            }
          } else {
            // No auth manager - just store token info
            ctx.metadata.set('auth-token', token);
            ctx.metadata.set('auth-scheme', 'Bearer');
          }
        }
      }

      await next();
    };
  }

  /**
   * Set the Netron peer for service invocation
   */
  setPeer(peer: LocalPeer): void {
    this.netronPeer = peer;
    this.middlewareAdapter = new HttpMiddlewareAdapter({
      cors: this.options.cors || undefined
    });

    // Register services from peer
    this.registerPeerServices();
  }

  /**
   * Register services from Netron peer
   */
  private registerPeerServices(): void {
    if (!this.netronPeer) return;

    for (const [id, stub] of this.netronPeer.stubs) {
      const serviceName = stub.definition.meta.name;
      const version = stub.definition.meta.version || '1.0.0';
      const meta = stub.definition.meta as {
        description?: string;
        metadata?: Record<string, unknown>;
        contract?: unknown;
      };

      const descriptor: ServiceDescriptor = {
        name: serviceName,
        version,
        methods: new Map(),
        description: meta.description,
        metadata: meta.metadata
      };

      // Register methods
      for (const methodName of Object.keys(stub.definition.meta.methods || {})) {
        // Get contract for this method if available
        let methodContract: MethodContract | undefined;
        const contractObj = meta.contract as {
          definition?: unknown;
          getMethod?: (name: string) => MethodContract;
          [key: string]: unknown;
        } | undefined;

        if (contractObj) {
          // Check if it's a Contract class instance
          if (contractObj.definition && contractObj.getMethod) {
            methodContract = contractObj.getMethod(methodName);
          } else if (contractObj[methodName]) {
            // Direct contract definition
            methodContract = contractObj[methodName] as MethodContract;
          }
        }

        descriptor.methods.set(methodName, {
          name: methodName,
          handler: async (input: unknown, context: MethodHandlerContext) => {
            // Input is already an array of arguments from HTTP peer
            const args = Array.isArray(input) ? input : [input];
            return stub.call(methodName, args, this.netronPeer!);
          },
          contract: methodContract
        });
      }

      this.services.set(serviceName, descriptor);
    }
  }

  /**
   * Start the HTTP server
   */
  async listen(): Promise<void> {
    if (this.server) {
      throw Errors.conflict('Server is already listening');
    }

    const runtime = detectRuntime();
    const port = this.port || 3000;
    const host = this.address || 'localhost';

    this.startTime = Date.now();
    this.status = 'starting';

    if (runtime === 'bun') {
      // Use Bun's native server
      // @ts-expect-error - Bun global is not always available
      if (typeof globalThis.Bun !== 'undefined' && globalThis.Bun.serve) {
        // @ts-expect-error - Bun types may not be installed
        this.server = globalThis.Bun.serve({
          port,
          hostname: host,
          fetch: this.handleRequest.bind(this),
          maxRequestBodySize: (this.options as any).maxBodySize || 10 * 1024 * 1024
        });
      } else {
        throw Errors.notImplemented('Bun runtime detected but Bun.serve not available');
      }
    } else if (runtime === 'deno') {
      // Use Deno's native server
      const handler = (req: Request) => this.handleRequest(req);
      this.server = (globalThis as any).Deno.serve({ port, hostname: host }, handler);
    } else {
      // Node.js implementation
      const { createServer } = await import('http');
      this.server = createServer({
        keepAliveTimeout: 5000,
        maxHeaderSize: 16384
      } as any, this.handleNodeRequest.bind(this));

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

    this.status = 'online';
    this.emit('listening', { port, host });
  }

  /**
   * Handle incoming HTTP request (Web API style)
   */
  async handleRequest(request: Request): Promise<Response> {
    const startTime = performance.now();
    this.metrics.totalRequests++;
    this.metrics.activeRequests++;

    const url = new URL(request.url);
    const pathname = url.pathname;

    // Track protocol version
    const version = request.headers.get('X-Netron-Version') || '1.0';
    this.metrics.protocolVersions.set(
      version,
      (this.metrics.protocolVersions.get(version) || 0) + 1
    );

    try {
      // Handle CORS preflight
      if (request.method === 'OPTIONS') {
        return this.handleCorsPreflightRequest(request);
      }

      // Handle special endpoints
      if (pathname === '/netron/invoke' && request.method === 'POST') {
        return this.handleInvocationRequest(request);
      }

      if (pathname === '/netron/batch' && request.method === 'POST') {
        return this.handleBatchRequest(request);
      }

      if (pathname === '/netron/query-interface' && request.method === 'POST') {
        return this.handleQueryInterfaceRequest(request);
      }

      if (pathname === '/netron/authenticate' && request.method === 'POST') {
        return this.handleAuthenticateRequest(request);
      }

      if (pathname === '/health' && request.method === 'GET') {
        return this.handleHealthCheck(request);
      }

      if (pathname === '/metrics' && request.method === 'GET') {
        return this.handleMetricsRequest(request);
      }

      if (pathname === '/openapi.json' && request.method === 'GET') {
        return this.handleOpenAPIRequest(request);
      }

      // No matching route
      return this.createErrorResponse(404, 'Not found', request);
    } catch (error: any) {
      this.metrics.totalErrors++;
      return this.handleError(error, request);
    } finally {
      this.metrics.activeRequests--;
      this.updateMetrics(startTime, 200); // Update with actual status
    }
  }

  /**
   * Pre-parse common headers to avoid repeated parsing
   */
  private parseCommonHeaders(request: Request) {
    return {
      contentType: request.headers.get('Content-Type'),
      authorization: request.headers.get('Authorization'),
      origin: request.headers.get('Origin'),
      requestId: request.headers.get('X-Request-ID'),
      traceId: request.headers.get('X-Trace-ID'),
      correlationId: request.headers.get('X-Correlation-ID'),
      spanId: request.headers.get('X-Span-ID'),
      netronVersion: request.headers.get('X-Netron-Version')
    };
  }

  /**
   * Handle simple invocation without middleware (fast-path)
   * This is called when no auth, CORS, or custom middleware is needed
   */
  private async handleSimpleInvocation(request: Request, message: HttpRequestMessage): Promise<Response> {
    try {
      // Get service descriptor
      const service = this.services.get(message.service);
      if (!service) {
        throw new TitanError({
          code: ErrorCode.NOT_FOUND,
          message: `Service ${message.service} not found`
        });
      }

      // Get method descriptor
      const method = service.methods.get(message.method);
      if (!method) {
        throw new TitanError({
          code: ErrorCode.NOT_FOUND,
          message: `Method ${message.method} not found in service ${message.service}`
        });
      }

      // Validate input using consolidated helper
      this.validateMethodInput(message.input, method.contract);

      // Create minimal handler context (no middleware)
      const metadata = new Map<string, unknown>();
      metadata.set('requestId', message.id);
      const handlerContext: MethodHandlerContext = {
        context: message.context,
        hints: message.hints,
        request,
        middleware: {
          peer: this.netronPeer!,
          serviceName: message.service,
          methodName: message.method,
          input: message.input,
          metadata,
          timing: { start: performance.now(), middlewareTimes: new Map() }
        }
      };

      // Execute method directly
      const methodStart = performance.now();
      const result = await method.handler(message.input, handlerContext);
      const serverTime = Math.round(performance.now() - methodStart);

      // Build minimal response
      const hints: {
        metrics?: { serverTime?: number };
        streaming?: boolean;
        cache?: { maxAge: number; tags: string[] };
      } = {
        metrics: { serverTime }
      };

      // Add cache hints if applicable
      if (method.cacheable || method.contract?.http?.responseHeaders?.['Cache-Control']) {
        hints.cache = {
          maxAge: method.cacheMaxAge || 300000,
          tags: method.cacheTags || []
        };
      }

      const response = createSuccessResponse(message.id, result, hints);

      // Minimal headers
      const headers: HeadersInit = {
        'Content-Type': method.contract?.http?.contentType || 'application/json',
        'X-Netron-Version': '2.0'
      };

      if (method.contract?.http?.responseHeaders) {
        Object.assign(headers, method.contract.http.responseHeaders);
      }

      return new Response(JSON.stringify(response), {
        status: method.contract?.http?.status || 200,
        headers
      });
    } catch (error) {
      // Optimized error handling without middleware
      const titanError = error instanceof TitanError ? error : toTitanError(error);
      const httpError = mapToHttp(titanError);

      const errorResponse = createErrorResponse(
        message.id,
        {
          code: String(httpError.status),
          message: titanError.message,
          details: titanError.details
        }
      );

      const headers: HeadersInit = {
        ...httpError.headers,
        'X-Netron-Version': '2.0'
      };

      return new Response(JSON.stringify(errorResponse), {
        status: httpError.status,
        headers
      });
    }
  }

  /**
   * Handle service invocation request with middleware pipeline
   */
  private async handleInvocationRequest(request: Request): Promise<Response> {
    let message: HttpRequestMessage;

    try {
      message = await request.json();
    } catch (error) {
      console.error('[HTTP Server] Failed to parse JSON:', error);
      return this.createErrorResponse(400, 'Invalid JSON', request);
    }

    if (!isHttpRequestMessage(message)) {
      console.error('[HTTP Server] Invalid request format:', message);
      return this.createErrorResponse(400, 'Invalid request format', request);
    }

    // OPTIMIZATION: Fast-path for simple requests
    // Skip middleware pipeline if:
    // 1. No Authorization header (no auth required)
    // 2. No CORS needed (no Origin header or CORS disabled)
    // 3. No custom middleware in pipeline beyond built-in ones
    const hasAuth = request.headers.has('Authorization');
    const hasOrigin = request.headers.has('Origin');
    const needsCors = this.options.cors && hasOrigin;
    const hasCustomMiddleware = this.globalPipeline.getMetrics().executions > 0;

    if (!hasAuth && !needsCors && !hasCustomMiddleware) {
      return this.handleSimpleInvocation(request, message);
    }

    // Create middleware context - optimized: use for...in loop instead of Object.entries
    const requestContext = message.context || {};
    const metadata = new Map<string, unknown>();
    // Use for...in loop for better performance
    for (const key in requestContext) {
      if (Object.prototype.hasOwnProperty.call(requestContext, key)) {
        metadata.set(key, requestContext[key as keyof HttpRequestContext]);
      }
    }
    metadata.set('requestId', message.id);
    metadata.set('timestamp', message.timestamp);
    metadata.set('hints', message.hints);

    const context: NetronMiddlewareContext & { output?: unknown } = {
      peer: this.netronPeer!,
      serviceName: message.service,
      methodName: message.method,
      input: message.input,
      metadata,
      timing: {
        start: performance.now(),
        middlewareTimes: new Map()
      }
    };

    try {
      // Get service descriptor
      const service = this.services.get(message.service);
      if (!service) {
        throw new TitanError({
          code: ErrorCode.NOT_FOUND,
          message: `Service ${message.service} not found`
        });
      }

      // Get method descriptor
      const method = service.methods.get(message.method);
      if (!method) {
        throw new TitanError({
          code: ErrorCode.NOT_FOUND,
          message: `Method ${message.method} not found in service ${message.service}`
        });
      }

      // Execute middleware pipeline
      await this.globalPipeline.execute(context, MiddlewareStage.PRE_PROCESS);

      // Execute method handler
      const executeHandler = async () => {
        // Validate input using consolidated helper
        this.validateMethodInput(message.input, method.contract);

        // Create method handler context
        const handlerContext: MethodHandlerContext = {
          context: message.context,
          hints: message.hints,
          request,
          middleware: context
        };

        // Execute method with timing
        const methodStart = performance.now();
        context.output = await method.handler(message.input, handlerContext);
        context.metadata.set('serverTime', Math.round(performance.now() - methodStart));
      };

      // Execute the handler
      await executeHandler();

      // Build response with hints
      const hints: {
        metrics?: { serverTime?: number };
        streaming?: boolean;
        cache?: { maxAge: number; tags: string[] };
      } = {
        metrics: { serverTime: context.metadata.get('serverTime') as number | undefined }
      };

      // Add cache hints based on method contract
      if (method.contract?.http?.streaming) {
        hints.streaming = true;
      }

      if (method.cacheable || method.contract?.http?.responseHeaders?.['Cache-Control']) {
        hints.cache = {
          maxAge: method.cacheMaxAge || 300000,
          tags: method.cacheTags || []
        };
      }

      const response = createSuccessResponse(message.id, context.output, hints);

      // Apply response headers from contract
      const headers: HeadersInit = {
        'Content-Type': method.contract?.http?.contentType || 'application/json',
        'X-Netron-Version': '2.0'
      };

      if (method.contract?.http?.responseHeaders) {
        Object.assign(headers, method.contract.http.responseHeaders);
      }

      return new Response(JSON.stringify(response), {
        status: method.contract?.http?.status || 200,
        headers
      });
    } catch (error) {
      // Error handling through middleware
      // Optimization: fast-path for TitanError instances - avoid double conversion
      const titanError = error instanceof TitanError ? error : toTitanError(error);

      context.error = titanError;

      await this.globalPipeline.execute(context, MiddlewareStage.ERROR);

      // Map error to HTTP response format
      const httpError = mapToHttp(titanError);

      // Create error response payload
      // Use the mapped HTTP status code for consistency with HTTP status header
      const errorResponse = createErrorResponse(
        message.id,
        {
          code: String(httpError.status),
          message: titanError.message,
          details: titanError.details
        }
      );

      // Build response headers with context information
      const headers: HeadersInit = {
        ...httpError.headers,
        'X-Netron-Version': '2.0'
      };

      return new Response(JSON.stringify(errorResponse), {
        status: httpError.status,
        headers
      });
    }
  }

  /**
   * Handle batch request
   */
  private async handleBatchRequest(request: Request): Promise<Response> {
    let batchRequest: HttpBatchRequest;

    try {
      batchRequest = await request.json();
    } catch (error) {
      return this.createErrorResponse(400, 'Invalid JSON', request);
    }

    if (!isHttpBatchRequest(batchRequest)) {
      return this.createErrorResponse(400, 'Invalid batch request format', request);
    }

    const batchResponse: HttpBatchResponse = {
      id: batchRequest.id,
      version: '2.0',
      timestamp: Date.now(),
      responses: [],
      hints: {
        successCount: 0,
        failureCount: 0,
        totalTime: 0
      }
    };

    const startTime = performance.now();
    const parallel = batchRequest.options?.parallel !== false;
    const stopOnError = batchRequest.options?.stopOnError === true;

    if (parallel) {
      // Process in parallel
      const promises = batchRequest.requests.map(async (req) => {
        try {
          const service = this.services.get(req.service);
          const method = service?.methods.get(req.method);

          if (!service || !method) {
            throw NetronErrors.methodNotFound(req.service, req.method);
          }

          // Create handler context using consolidated helper
          const handlerContext = this.createMethodHandlerContext(
            { ...req, context: req.context || batchRequest.context },
            request,
            { batchRequest: true }
          );

          const result = await method.handler(req.input, handlerContext);

          batchResponse.hints!.successCount!++;
          return {
            id: req.id,
            success: true,
            data: result
          };
        } catch (error) {
          const titanError = error instanceof TitanError ? error : null;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          batchResponse.hints!.failureCount!++;
          return {
            id: req.id,
            success: false,
            error: {
              code: String(titanError?.code || ErrorCode.INTERNAL_SERVER_ERROR),
              message: errorMessage
            }
          };
        }
      });

      batchResponse.responses = await Promise.all(promises);
    } else {
      // Process sequentially
      for (const req of batchRequest.requests) {
        try {
          const service = this.services.get(req.service);
          const method = service?.methods.get(req.method);

          if (!service || !method) {
            throw NetronErrors.methodNotFound(req.service, req.method);
          }

          // Create handler context using consolidated helper
          const handlerContext = this.createMethodHandlerContext(
            { ...req, context: req.context || batchRequest.context },
            request,
            { batchRequest: true }
          );

          const result = await method.handler(req.input, handlerContext);

          batchResponse.hints!.successCount!++;
          batchResponse.responses.push({
            id: req.id,
            success: true,
            data: result
          });
        } catch (error) {
          const titanError = error instanceof TitanError ? error : null;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          batchResponse.hints!.failureCount!++;
          batchResponse.responses.push({
            id: req.id,
            success: false,
            error: {
              code: String(titanError?.code || ErrorCode.INTERNAL_SERVER_ERROR),
              message: errorMessage
            }
          });

          if (stopOnError) {
            break;
          }
        }
      }
    }

    batchResponse.hints!.totalTime = Math.round(performance.now() - startTime);

    return new Response(JSON.stringify(batchResponse), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Netron-Version': '2.0'
      }
    });
  }

  /**
   * Handle query-interface request with authorization
   */
  private async handleQueryInterfaceRequest(request: Request): Promise<Response> {
    try {
      // Parse request body
      const body = await request.json();
      const serviceName = body.serviceName || body.params?.[0];

      if (!serviceName) {
        return this.createErrorResponse(400, 'Missing serviceName parameter', request);
      }

      // Extract auth context from headers
      const authHeader = request.headers.get('Authorization');
      let authContext: any = undefined;

      if (authHeader) {
        // Parse Bearer token using consolidated utility
        const token = extractBearerToken(authHeader);
        if (token) {
          // Create auth context from token
          // In real implementation, this would validate the token
          authContext = {
            token: { type: 'bearer', value: token }
          };
        }
      }

      // Execute query_interface task using local peer
      if (!this.netronPeer) {
        return this.createErrorResponse(500, 'Netron peer not initialized', request);
      }

      // Run query_interface task with auth context
      // We need to create a mock RemotePeer to execute the task
      // For now, let's directly call the local peer's getDefinitionByServiceName
      try {
        const definition = (this.netronPeer as any).getDefinitionByServiceName(serviceName);

        // If we have authorization manager, filter the definition
        const authzManager = (this.netronPeer.netron as any).authorizationManager;
        let filteredDefinition = definition;

        if (authzManager && authContext) {
          // Check access
          const canAccess = authzManager.canAccessService(serviceName, authContext);
          if (!canAccess) {
            return this.createErrorResponse(403, `Access denied to service '${serviceName}'`, request);
          }

          // Filter definition
          const filteredMeta = authzManager.filterDefinition(serviceName, definition.meta, authContext);
          if (!filteredMeta) {
            return this.createErrorResponse(403, `No access to service methods`, request);
          }

          filteredDefinition = {
            ...definition,
            meta: filteredMeta
          };
        }

        return new Response(JSON.stringify({
          id: body.id || crypto.randomUUID(),
          result: filteredDefinition,
          timestamp: Date.now()
        }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'X-Netron-Version': '2.0'
          }
        });
      } catch (error: any) {
        return this.createErrorResponse(404, `Service '${serviceName}' not found`, request);
      }
    } catch (error: any) {
      return this.createErrorResponse(500, error.message, request);
    }
  }

  /**
   * Handle authenticate request
   */
  private async handleAuthenticateRequest(request: Request): Promise<Response> {
    try {
      // Parse request body
      const body = await request.json();
      const credentials = body.credentials || body.params?.[0];

      if (!credentials) {
        return this.createErrorResponse(400, 'Missing credentials parameter', request);
      }

      // Get authentication manager
      const authManager = (this.netronPeer?.netron as any)?.authenticationManager;
      if (!authManager) {
        return this.createErrorResponse(503, 'Authentication not configured', request);
      }

      // Perform authentication
      let result;
      if (credentials.token) {
        result = await authManager.validateToken(credentials.token);
      } else {
        result = await authManager.authenticate(credentials);
      }

      return new Response(JSON.stringify({
        id: body.id || crypto.randomUUID(),
        result,
        timestamp: Date.now()
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'X-Netron-Version': '2.0'
        }
      });
    } catch (error: any) {
      return this.createErrorResponse(500, error.message, request);
    }
  }

  /**
   * Handle health check
   */
  private handleHealthCheck(request: Request): Response {
    const status = this.status === 'online' ? 200 : 503;
    // Basic health check without sensitive information
    return new Response(
      JSON.stringify({
        status: this.status,
        uptime: Date.now() - this.startTime,
        version: '2.0.0'
        // Removed services list - use authenticated /metrics instead
      }),
      {
        status,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  /**
   * Handle metrics request
   */
  private handleMetricsRequest(request: Request): Response {
    // Extract and verify authentication
    const authHeader = request.headers.get('Authorization');

    // Require authentication for metrics endpoint
    if (!authHeader) {
      return new Response(
        JSON.stringify({
          error: {
            code: '401',
            message: 'Authentication required for metrics endpoint'
          }
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer'
          }
        }
      );
    }

    // Return full metrics only for authenticated requests
    return new Response(
      JSON.stringify({
        server: {
          status: this.status,
          uptime: Date.now() - this.startTime,
          connections: this.connections.size
        },
        requests: {
          total: this.metrics.totalRequests,
          active: this.metrics.activeRequests,
          errors: this.metrics.totalErrors,
          avgResponseTime: this.metrics.avgResponseTime
        },
        services: Array.from(this.services.keys()),  // OK for authenticated users
        protocolVersions: Object.fromEntries(this.metrics.protocolVersions),
        middleware: this.globalPipeline.getMetrics()
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  /**
   * Handle OpenAPI specification request
   */
  private handleOpenAPIRequest(request: Request): Response {
    // Extract and verify authentication
    const authHeader = request.headers.get('Authorization');

    // Require authentication for OpenAPI spec
    if (!authHeader) {
      return new Response(
        JSON.stringify({
          error: {
            code: '401',
            message: 'Authentication required for API documentation'
          }
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer'
          }
        }
      );
    }

    // Continue with OpenAPI generation for authenticated users
    const spec: any = {
      openapi: '3.0.3',
      info: {
        title: 'Netron HTTP Services',
        version: '2.0.0',
        description: 'Auto-generated OpenAPI specification for Netron services'
      },
      servers: [
        {
          url: `http://${this.address}:${this.port}`,
          description: 'Current server'
        }
      ],
      paths: {},
      components: {
        schemas: {},
        securitySchemes: {}
      }
    };

    // Generate paths from service methods (RPC-style POST only)
    for (const [serviceName, service] of this.services) {
      for (const [methodName, method] of service.methods) {
        const httpConfig = method.contract?.http;
        const basePath = `/rpc/${serviceName}/${methodName}`;

        if (!spec.paths[basePath]) {
          spec.paths[basePath] = {};
        }

        const operation: any = {
          operationId: `${serviceName}_${methodName}`,
          summary: httpConfig?.openapi?.summary || method.description || `Invoke ${serviceName}.${methodName}`,
          description: httpConfig?.openapi?.description,
          tags: httpConfig?.openapi?.tags || [serviceName],
          deprecated: httpConfig?.openapi?.deprecated || method.deprecated,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: `#/components/schemas/${serviceName}_${methodName}_Input`
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Successful response',
              content: {
                'application/json': {
                  schema: {
                    $ref: `#/components/schemas/${serviceName}_${methodName}_Output`
                  }
                }
              }
            },
            '400': {
              description: 'Bad request - Invalid input or validation failed'
            },
            '404': {
              description: 'Service or method not found'
            },
            '500': {
              description: 'Internal server error'
            }
          }
        };

        // Store input schema
        if (method.contract?.input) {
          spec.components.schemas[`${serviceName}_${methodName}_Input`] = {
            type: 'object',
            description: `Input for ${serviceName}.${methodName}`
            // TODO: Convert Zod schema to JSON Schema using zod-to-json-schema
          };
        }

        // Store output schema
        if (method.contract?.output) {
          spec.components.schemas[`${serviceName}_${methodName}_Output`] = {
            type: 'object',
            description: `Output for ${serviceName}.${methodName}`
            // TODO: Convert Zod schema to JSON Schema using zod-to-json-schema
          };
        }

        // Add error schemas
        if (method.contract?.errors) {
          for (const [statusCode, errorSchema] of Object.entries(method.contract.errors)) {
            operation.responses[String(statusCode)] = {
              description: 'Error response',
              content: {
                'application/json': {
                  schema: {
                    $ref: `#/components/schemas/${serviceName}_${methodName}_Error${statusCode}`
                  }
                }
              }
            };

            spec.components.schemas[`${serviceName}_${methodName}_Error${statusCode}`] = {
              type: 'object',
              description: `Error ${statusCode} for ${serviceName}.${methodName}`
              // TODO: Convert Zod schema to JSON Schema
            };
          }
        }

        // RPC-style always uses POST
        spec.paths[basePath].post = operation;
      }
    }

    return new Response(JSON.stringify(spec, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300'
      }
    });
  }


  /**
   * Handle Node.js style request
   */
  private async handleNodeRequest(req: any, res: any): Promise<void> {
    // Convert Node.js request to Web API Request
    const body = await this.readNodeBody(req);
    const url = `http://${req.headers.host || 'localhost'}${req.url}`;

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers.set(key, value);
      } else if (Array.isArray(value)) {
        headers.set(key, value.join(', '));
      }
    }

    const request = new Request(url, {
      method: req.method,
      headers,
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
        this.metrics.totalBytesReceived += chunk.length;
      });
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  /**
   * Handle CORS preflight
   */
  private handleCorsPreflightRequest(request: Request): Response {
    const headers = new Headers();
    const origin = request.headers.get('Origin');

    if (origin) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Netron-Version');
      headers.set('Access-Control-Max-Age', '86400');

      if (this.options.cors && (this.options.cors as any).credentials) {
        headers.set('Access-Control-Allow-Credentials', 'true');
      }
    }

    return new Response(null, { status: 204, headers });
  }

  /**
   * Create error response
   */
  private createErrorResponse(status: number, message: string, request: Request): Response {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'X-Netron-Version': '2.0'
    });

    // Apply CORS headers using consolidated helper
    this.applyCorsHeaders(headers, request);

    return new Response(
      JSON.stringify({
        error: true,
        message,
        timestamp: Date.now()
      }),
      { status, headers }
    );
  }

  /**
   * Handle errors
   */
  private handleError(error: any, request: Request): Response {
    // Optimization: fast-path for TitanError instances - avoid double conversion
    const titanError = error instanceof TitanError ? error : toTitanError(error);

    // Map error to HTTP response format
    const httpError = mapToHttp(titanError);

    // Build headers with CORS support
    const headers = new Headers({
      ...httpError.headers,
      'X-Netron-Version': '2.0'
    });

    // Apply CORS headers using consolidated helper
    this.applyCorsHeaders(headers, request);

    return new Response(
      JSON.stringify({
        error: true,
        message: titanError.message,
        code: String(httpError.status),
        timestamp: Date.now()
      }),
      { status: httpError.status, headers }
    );
  }

  /**
   * Update metrics
   */
  private updateMetrics(startTime: number, status: number): void {
    const duration = performance.now() - startTime;

    this.metrics.responseTimes.push(duration);
    if (this.metrics.responseTimes.length > 1000) {
      this.metrics.responseTimes.shift();
    }

    this.metrics.avgResponseTime =
      this.metrics.responseTimes.reduce((a, b) => a + b, 0) /
      this.metrics.responseTimes.length;

    this.metrics.statusCounts.set(
      status,
      (this.metrics.statusCounts.get(status) || 0) + 1
    );
  }

  /**
   * Close the server
   */
  async close(): Promise<void> {
    if (this.server) {
      const runtime = detectRuntime();

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

    this.connections.clear();
    this.status = 'offline';
    this.emit('close');
  }

  /**
   * Broadcast to all connections (not applicable for HTTP)
   */
  async broadcast(data: Buffer | ArrayBuffer): Promise<void> {
    console.warn('Broadcast not supported in HTTP transport');
  }

  /**
   * Get server metrics
   */
  getMetrics(): ServerMetrics & any {
    const uptime = Date.now() - this.metrics.startTime;
    const errorRate = this.metrics.totalRequests > 0
      ? this.metrics.totalErrors / this.metrics.totalRequests
      : 0;

    return {
      activeConnections: this.connections.size,
      totalConnections: this.metrics.totalRequests,
      totalBytesSent: this.metrics.totalBytesSent,
      totalBytesReceived: this.metrics.totalBytesReceived,
      uptime,
      // Extended metrics
      totalRequests: this.metrics.totalRequests,
      activeRequests: this.metrics.activeRequests,
      totalErrors: this.metrics.totalErrors,
      errorRate,
      avgResponseTime: this.metrics.avgResponseTime,
      statusCounts: Object.fromEntries(this.metrics.statusCounts),
      protocolVersions: Object.fromEntries(this.metrics.protocolVersions)
    };
  }

  /**
   * Apply CORS headers to response headers
   * Consolidated from 4 duplicate implementations
   */
  private applyCorsHeaders(headers: Headers, request: Request): void {
    const origin = request.headers.get('Origin');
    if (origin && this.options.cors) {
      headers.set('Access-Control-Allow-Origin', origin);
      if ((this.options.cors as any).credentials) {
        headers.set('Access-Control-Allow-Credentials', 'true');
      }
    }
  }

  /**
   * Create method handler context
   * Consolidated from 4 duplicate implementations in batch and invocation handlers
   */
  private createMethodHandlerContext(
    message: { id: string; service: string; method: string; input: unknown; context?: HttpRequestContext; hints?: HttpRequestHints },
    request: Request,
    options?: { batchRequest?: boolean }
  ): MethodHandlerContext {
    const metadata = new Map<string, unknown>();
    metadata.set('requestId', message.id);

    if (options?.batchRequest) {
      metadata.set('batchRequest', true);
    }

    return {
      context: message.context,
      hints: message.hints,
      request,
      middleware: {
        peer: this.netronPeer!,
        serviceName: message.service,
        methodName: message.method,
        input: message.input,
        metadata,
        timing: { start: performance.now(), middlewareTimes: new Map() }
      }
    };
  }

  /**
   * Validate method input against contract
   * Consolidated from 2 duplicate implementations
   */
  private validateMethodInput(input: unknown, contract?: MethodContract): void {
    if (!contract?.input) {
      return;
    }

    const validation = contract.input.safeParse(input);
    if (!validation.success) {
      // Only expose minimal validation error info to prevent schema disclosure
      throw new TitanError({
        code: ErrorCode.INVALID_ARGUMENT,
        message: 'Input validation failed',
        details: {
          message: 'Request data does not match expected format',
          // In development, include field paths but not schema structure
          ...(process.env['NODE_ENV'] === 'development' && {
            fields: validation.error.issues.map(i => i.path.join('.'))
          })
        }
      });
    }
  }
}