/**
 * HTTP Middleware Adapter for Netron
 *
 * Bridges HTTP-specific context with Netron's middleware system
 */

import type {
  NetronMiddlewareContext,
  MiddlewareFunction,
  ITransportMiddlewareAdapter
} from './types.js';
import type { IncomingMessage, ServerResponse } from 'http';
import { TitanError, ErrorCode } from '../../errors/index.js';
import * as zlib from 'zlib';

/**
 * Extended context for HTTP-specific middleware
 */
export interface HttpMiddlewareContext extends NetronMiddlewareContext {
  request: IncomingMessage;
  response: ServerResponse;
  route?: string;
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: any;
  cookies?: Record<string, string>;
}

/**
 * CORS configuration options
 */
export interface CorsOptions {
  origin?: string | string[] | boolean | ((origin: string | undefined) => boolean | string);
  methods?: string[];
  headers?: string[];
  credentials?: boolean;
  maxAge?: number;
  preflightContinue?: boolean;
  optionsSuccessStatus?: number;
}

/**
 * HTTP Middleware adapter implementation
 */
export class HttpMiddlewareAdapter implements ITransportMiddlewareAdapter<HttpMiddlewareContext> {
  private corsOptions?: CorsOptions;

  constructor(options?: {
    cors?: CorsOptions;
  }) {
    this.corsOptions = options?.cors;
  }

  /**
   * Transform HTTP request to Netron context
   */
  toNetronContext(httpCtx: any): HttpMiddlewareContext {
    const context: HttpMiddlewareContext = {
      ...httpCtx,
      peer: httpCtx.peer || {},
      metadata: httpCtx.metadata || new Map(),
      timing: httpCtx.timing || {
        start: Date.now(),
        middlewareTimes: new Map()
      }
    };

    // Set HTTP-specific metadata
    if (httpCtx.request) {
      context.metadata.set('http-method', httpCtx.request.method);
      context.metadata.set('http-url', httpCtx.route || httpCtx.request.url);
    }

    // Copy HTTP headers to metadata
    if (httpCtx.request?.headers) {
      for (const [key, value] of Object.entries(httpCtx.request.headers)) {
        if (value) {
          context.metadata.set(key.toLowerCase().replace('x-', ''), value);
        }
      }
    }

    // Set body as input for service calls
    if (httpCtx.body !== undefined) {
      context.input = httpCtx.body;
    }

    return context;
  }

  /**
   * Apply Netron context changes back to HTTP response
   */
  fromNetronContext(netronCtx: HttpMiddlewareContext, httpCtx: any): void {
    // Update response body
    if (netronCtx.result !== undefined) {
      httpCtx.body = netronCtx.result;
    }

    // Apply headers from metadata
    if (netronCtx.response && netronCtx.metadata) {
      for (const [key, value] of netronCtx.metadata.entries()) {
        // Skip internal metadata
        if (!key.startsWith('_')) {
          netronCtx.response.setHeader(key, String(value));
        }
      }
    }

    // Set status code based on error
    if (netronCtx.error && netronCtx.response) {
      if (TitanError.isTitanError(netronCtx.error)) {
        netronCtx.response.statusCode = netronCtx.error.httpStatus;
      } else {
        netronCtx.response.statusCode = 500;
      }
    }
  }

  /**
   * Get HTTP-specific middleware
   */
  getTransportMiddleware(): MiddlewareFunction<HttpMiddlewareContext>[] {
    const middleware: MiddlewareFunction<HttpMiddlewareContext>[] = [];

    // Always add request ID middleware
    middleware.push(HttpBuiltinMiddleware.requestIdMiddleware());

    if (this.corsOptions) {
      middleware.push(HttpBuiltinMiddleware.corsMiddleware(this.corsOptions));
    }

    return middleware;
  }
}

/**
 * HTTP-specific built-in middleware
 */
export class HttpBuiltinMiddleware {
  /**
   * CORS middleware (alias)
   */
  static cors(options: CorsOptions = {}): MiddlewareFunction<HttpMiddlewareContext> {
    return this.corsMiddleware(options);
  }

  /**
   * Compression middleware (alias)
   */
  static compression(options?: boolean | { threshold?: number; level?: number }): MiddlewareFunction<HttpMiddlewareContext> {
    if (typeof options === 'boolean') {
      return options ? this.compressionMiddleware({}) : async (ctx, next) => next();
    }
    return this.compressionMiddleware(options || {});
  }

  /**
   * CORS middleware
   */
  static corsMiddleware(options: CorsOptions = {}): MiddlewareFunction<HttpMiddlewareContext> {
    const {
      origin = '*',
      methods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      headers = ['Content-Type', 'Authorization'],
      credentials = false,
      maxAge = 86400,
      preflightContinue = false,
      optionsSuccessStatus = 204
    } = options;

    return async (ctx, next) => {
      const requestOrigin = ctx.request.headers.origin;

      // Determine allowed origin
      let allowedOrigin: string | false = false;

      if (origin === '*' || origin === true) {
        allowedOrigin = '*';
      } else if (typeof origin === 'string') {
        allowedOrigin = origin;
      } else if (Array.isArray(origin)) {
        if (requestOrigin && origin.includes(requestOrigin)) {
          allowedOrigin = requestOrigin;
        }
      } else if (typeof origin === 'function') {
        const result = origin(requestOrigin);
        if (result === true) {
          allowedOrigin = requestOrigin || '*';
        } else if (typeof result === 'string') {
          allowedOrigin = result;
        }
      }

      if (allowedOrigin) {
        ctx.response.setHeader('Access-Control-Allow-Origin', allowedOrigin);

        if (credentials) {
          ctx.response.setHeader('Access-Control-Allow-Credentials', 'true');
        }

        // Handle preflight requests
        if (ctx.request.method === 'OPTIONS') {
          ctx.response.setHeader('Access-Control-Allow-Methods', methods.join(', '));
          ctx.response.setHeader('Access-Control-Allow-Headers', headers.join(', '));
          ctx.response.setHeader('Access-Control-Max-Age', String(maxAge));

          if (!preflightContinue) {
            ctx.response.statusCode = optionsSuccessStatus;
            ctx.response.end();
            ctx.skipRemaining = true;
            return;
          }
        }
      }

      await next();
    };
  }

  /**
   * Body parser middleware
   */
  static bodyParserMiddleware(options: {
    maxSize?: number;
    encoding?: BufferEncoding;
  } = {}): MiddlewareFunction<HttpMiddlewareContext> {
    const {
      maxSize = 1024 * 1024 * 10, // 10MB default
      encoding = 'utf8'
    } = options;

    return async (ctx, next) => {
      if (ctx.body !== undefined) {
        await next();
        return;
      }

      const contentType = ctx.request.headers['content-type'];
      const chunks: Buffer[] = [];
      let totalSize = 0;

      await new Promise<void>((resolve, reject) => {
        ctx.request.on('data', (chunk: Buffer) => {
          totalSize += chunk.length;

          if (totalSize > maxSize) {
            reject(new TitanError({
              code: ErrorCode.PAYLOAD_TOO_LARGE,
              message: 'Request body too large'
            }));
            return;
          }

          chunks.push(chunk);
        });

        ctx.request.on('end', () => {
          const buffer = Buffer.concat(chunks);

          try {
            if (contentType?.includes('application/json')) {
              ctx.body = JSON.parse(buffer.toString(encoding));
            } else if (contentType?.includes('text/')) {
              ctx.body = buffer.toString(encoding);
            } else {
              ctx.body = buffer;
            }
            resolve();
          } catch (error: any) {
            reject(new TitanError({
              code: ErrorCode.BAD_REQUEST,
              message: 'Invalid request body',
              cause: error
            }));
          }
        });

        ctx.request.on('error', reject);
      });

      await next();
    };
  }

  /**
   * Response compression middleware
   */
  static compressionMiddleware(options: {
    threshold?: number;
    level?: number;
  } = {}): MiddlewareFunction<HttpMiddlewareContext> {
    const {
      threshold = 1024, // 1KB
      level = 6
    } = options;

    return async (ctx, next) => {
      await next();

      if (!ctx.body) return;

      const acceptEncoding = ctx.request.headers['accept-encoding'] || '';
      const isCompressible = ctx.body &&
        (typeof ctx.body === 'string' || Buffer.isBuffer(ctx.body) || typeof ctx.body === 'object');

      if (!isCompressible) return;

      let data: Buffer;
      if (typeof ctx.body === 'string') {
        data = Buffer.from(ctx.body);
      } else if (Buffer.isBuffer(ctx.body)) {
        data = ctx.body;
      } else {
        data = Buffer.from(JSON.stringify(ctx.body));
      }

      if (data.length < threshold) return;

      if (acceptEncoding.includes('gzip')) {
        ctx.body = zlib.gzipSync(data, { level });
        ctx.response.setHeader('Content-Encoding', 'gzip');
      } else if (acceptEncoding.includes('deflate')) {
        ctx.body = zlib.deflateSync(data, { level });
        ctx.response.setHeader('Content-Encoding', 'deflate');
      }
    };
  }

  /**
   * Security headers middleware
   */
  static securityHeadersMiddleware(options: {
    contentSecurityPolicy?: string;
    xFrameOptions?: 'DENY' | 'SAMEORIGIN';
    xContentTypeOptions?: boolean;
    xXssProtection?: boolean;
    strictTransportSecurity?: {
      maxAge: number;
      includeSubDomains?: boolean;
      preload?: boolean;
    };
  } = {}): MiddlewareFunction<HttpMiddlewareContext> {
    return async (ctx, next) => {
      // Content Security Policy
      if (options.contentSecurityPolicy) {
        ctx.response.setHeader('Content-Security-Policy', options.contentSecurityPolicy);
      }

      // X-Frame-Options
      ctx.response.setHeader('X-Frame-Options', options.xFrameOptions || 'SAMEORIGIN');

      // X-Content-Type-Options
      if (options.xContentTypeOptions !== false) {
        ctx.response.setHeader('X-Content-Type-Options', 'nosniff');
      }

      // X-XSS-Protection
      if (options.xXssProtection !== false) {
        ctx.response.setHeader('X-XSS-Protection', '1; mode=block');
      }

      // Strict-Transport-Security
      if (options.strictTransportSecurity) {
        let value = `max-age=${options.strictTransportSecurity.maxAge}`;
        if (options.strictTransportSecurity.includeSubDomains) {
          value += '; includeSubDomains';
        }
        if (options.strictTransportSecurity.preload) {
          value += '; preload';
        }
        ctx.response.setHeader('Strict-Transport-Security', value);
      }

      await next();
    };
  }

  /**
   * Request ID middleware
   */
  static requestIdMiddleware(options: {
    header?: string;
    generator?: () => string;
  } = {}): MiddlewareFunction<HttpMiddlewareContext> {
    const {
      header = 'X-Request-Id',
      generator = () => crypto.randomUUID()
    } = options;

    return async (ctx, next) => {
      const requestId = ctx.request.headers[header.toLowerCase()] || generator();

      ctx.metadata.set('requestId', requestId);
      ctx.response.setHeader(header, requestId);

      await next();
    };
  }

  /**
   * Request logging middleware
   */
  static requestLoggingMiddleware(logger: any): MiddlewareFunction<HttpMiddlewareContext> {
    return async (ctx, next) => {
      const start = Date.now();

      // Log request
      logger.info({
        method: ctx.request.method,
        url: ctx.request.url,
        ip: ctx.request.socket?.remoteAddress,
        userAgent: ctx.request.headers['user-agent']
      }, 'HTTP Request');

      try {
        await next();

        // Log response
        const duration = Date.now() - start;
        logger.info({
          method: ctx.request.method,
          url: ctx.request.url,
          statusCode: ctx.response.statusCode,
          duration
        }, 'HTTP Response');
      } catch (error: any) {
        const duration = Date.now() - start;

        logger.error({
          method: ctx.request.method,
          url: ctx.request.url,
          error: error.message,
          code: error.code,
          duration
        }, 'HTTP Error');

        throw error;
      }
    };
  }
}