/**
 * HTTP Middleware Adapter for Netron
 *
 * Bridges HTTP-specific context with Netron's middleware system
 */

import type {
  HttpMiddlewareContext,
  HttpTransportContext,
  MiddlewareFunction,
  ITransportMiddlewareAdapter,
  CorsOptions,
} from './types.js';
import type { LocalPeer, RemotePeer } from '../../../index.js';
import { TitanError, ErrorCode } from '../../../../errors/index.js';
import { HttpBuiltinMiddleware } from './http-builtin.js';

/**
 * HTTP Middleware adapter implementation
 */
export class HttpMiddlewareAdapter implements ITransportMiddlewareAdapter<HttpMiddlewareContext, HttpTransportContext> {
  private corsOptions?: CorsOptions;

  constructor(options?: { cors?: CorsOptions }) {
    this.corsOptions = options?.cors;
  }

  /**
   * Transform HTTP request to Netron context
   */
  toNetronContext(httpCtx: HttpTransportContext): HttpMiddlewareContext {
    // Extract known properties with proper type guards
    const peer =
      httpCtx.peer && typeof httpCtx.peer === 'object' ? (httpCtx.peer as LocalPeer | RemotePeer) : ({} as LocalPeer);
    const metadata = httpCtx.metadata instanceof Map ? httpCtx.metadata : new Map<string, unknown>();
    const timing = httpCtx.timing || {
      start: Date.now(),
      middlewareTimes: new Map<string, number>(),
    };
    const request = httpCtx.request;
    const response = httpCtx.response;
    const route = typeof httpCtx.route === 'string' ? httpCtx.route : undefined;
    const body = httpCtx.body;

    if (!request || !response) {
      throw new TitanError({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: 'HTTP request and response are required',
      });
    }

    const context: HttpMiddlewareContext = {
      peer,
      metadata,
      timing,
      request,
      response,
      route,
      body,
    };

    // Set HTTP-specific metadata
    if (request.method) {
      metadata.set('http-method', request.method);
    }
    if (route || request.url) {
      metadata.set('http-url', route || request.url);
    }

    // Copy HTTP headers to metadata
    if (request.headers) {
      for (const [key, value] of Object.entries(request.headers)) {
        if (value) {
          metadata.set(key.toLowerCase().replace('x-', ''), value);
        }
      }
    }

    // Set body as input for service calls
    if (body !== undefined) {
      context.input = body;
    }

    return context;
  }

  /**
   * Apply Netron context changes back to HTTP response
   */
  fromNetronContext(netronCtx: HttpMiddlewareContext, httpCtx: HttpTransportContext): void {
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
