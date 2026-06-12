/**
 * HTTP Transport Client for Netron Browser
 *
 * Provides HTTP-based RPC communication with the Netron server
 */

import type {
  HttpRequestMessage,
  HttpResponseMessage,
  RequestContext,
  RequestHints,
  ConnectionMetrics,
  ConnectionState,
} from '../types/index.js';
import type { AuthenticationClient } from '../auth/client.js';
import { createRequestMessage, normalizeUrl } from '../utils/index.js';
import {
  MiddlewarePipeline,
  MiddlewareStage,
  type ClientMiddlewareContext,
  type IMiddlewareManager,
  type MiddlewareFunction,
  type MiddlewareConfig,
} from '../middleware/index.js';
// Errors are handled inline in this implementation

/**
 * HTTP client options
 */
export interface HttpClientOptions {
  /**
   * Base URL for the Netron server
   */
  url: string;

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout?: number;

  /**
   * Custom headers to include in requests
   */
  headers?: Record<string, string>;

  /**
   * Enable request retry
   * @default false
   */
  retry?: boolean;

  /**
   * Maximum retry attempts
   * @default 3
   */
  maxRetries?: number;

  /**
   * Authentication client for automatic token attachment
   */
  auth?: AuthenticationClient;

  /**
   * Middleware pipeline (optional, will create default if not provided)
   */
  middleware?: IMiddlewareManager;
}

/**
 * HTTP Transport Client implementation
 */
export class HttpClient {
  private baseUrl: string;
  private timeout: number;
  private headers: Record<string, string>;
  private retry: boolean;
  private maxRetries: number;
  private auth?: AuthenticationClient;
  private state: ConnectionState = 'disconnected' as ConnectionState;
  private middleware: IMiddlewareManager;
  private metrics = {
    requestsSent: 0,
    responsesReceived: 0,
    errors: 0,
    latencies: [] as number[],
  };

  constructor(options: HttpClientOptions) {
    this.baseUrl = normalizeUrl(options.url);
    this.timeout = options.timeout ?? 30000;
    this.headers = options.headers ?? {};
    this.retry = options.retry ?? false;
    this.maxRetries = options.maxRetries ?? 3;
    this.auth = options.auth;
    this.middleware = options.middleware || new MiddlewarePipeline();
  }

  /**
   * Initialize the client
   */
  async connect(): Promise<void> {
    this.state = 'connecting' as ConnectionState;
    // HTTP client doesn't need explicit connection
    this.state = 'connected' as ConnectionState;
  }

  /**
   * Invoke a service method
   */
  async invoke(
    service: string,
    method: string,
    args: any[],
    options?: {
      context?: RequestContext;
      hints?: RequestHints;
      skipAuth?: boolean;
    }
  ): Promise<any> {
    // Create middleware context
    const ctx: ClientMiddlewareContext = {
      service,
      method,
      args,
      request: {
        headers: { ...this.headers },
        timeout: options?.hints?.timeout || this.timeout,
        metadata: options?.context as any,
      },
      timing: {
        start: performance.now(),
        middlewareTimes: new Map(),
      },
      metadata: new Map(),
      transport: 'http' as const,
    };

    const skipAuth = options?.skipAuth ?? false;

    // Execute pre-request middleware (once — not re-run on an auth retry).
    await this.middleware.execute(ctx, MiddlewareStage.PRE_REQUEST);

    // Check if middleware wants to skip remaining
    if (ctx.skipRemaining) {
      return ctx.response?.data;
    }

    // NB-6: a single auth re-invoke. When an ERROR-stage middleware (the auth
    // error handler) refreshes the token after a 401 and signals `auth:retry`,
    // we re-send the request ONCE with the refreshed headers/cookies instead of
    // failing — previously the request was never re-sent (the flag was set but
    // nothing consumed it, and invoke always re-threw the original error).
    const MAX_AUTH_REINVOKES = 1;
    for (let attempt = 0; ; attempt++) {
      try {
        // Create request message with (possibly refreshed) middleware data.
        const message = createRequestMessage(service, method, args, {
          context: ctx.request?.metadata as any,
          hints: {
            ...options?.hints,
            timeout: ctx.request?.timeout,
          },
        });

        // Send request — credentials threaded through so cookie-mode transport
        // ('include') reaches the fetch layer. The AuthenticationClient's
        // configured transport is the source of truth; middleware may override
        // per-request via ctx.request.credentials.
        const credentials = ctx.request?.credentials ?? this.auth?.getRequestCredentials();
        const response = await this.sendRequest(message, 0, ctx.request?.headers, skipAuth, credentials);

        if (!response.success) {
          const error = new Error(response.error?.message || 'Method invocation failed');
          (error as any).code = response.error?.code;
          throw error;
        }

        // Store response in context
        ctx.response = {
          data: response.data,
          headers: {},
          metadata: {},
        };

        // Execute post-response middleware
        await this.middleware.execute(ctx, MiddlewareStage.POST_RESPONSE);

        return ctx.response.data;
      } catch (error: any) {
        // Store error in context
        ctx.error = error;
        ctx.metadata.delete('auth:retry');

        // Execute error middleware
        try {
          await this.middleware.execute(ctx, MiddlewareStage.ERROR);
        } catch {
          // Ignore middleware errors during error handling
        }

        // NB-6: re-invoke once if a middleware refreshed auth and asked to retry.
        if (attempt < MAX_AUTH_REINVOKES && ctx.metadata.get('auth:retry')) {
          ctx.metadata.delete('auth:retry');
          ctx.error = undefined;
          continue;
        }

        throw error;
      }
    }
  }

  /**
   * Send HTTP request
   */
  private async sendRequest(
    message: HttpRequestMessage,
    retryCount = 0,
    customHeaders?: Record<string, string>,
    skipAuth = false,
    credentials?: RequestCredentials
  ): Promise<HttpResponseMessage> {
    const url = `${this.baseUrl}/netron/invoke`;
    const timeout = message.hints?.timeout || this.timeout;
    const startTime = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      this.metrics.requestsSent++;

      // Build headers with auth if available
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...this.headers,
        ...customHeaders, // Middleware can override headers
      };

      // Add auth headers if available (unless explicitly skipped or overridden by middleware)
      if (this.auth && !skipAuth && !customHeaders?.['Authorization']) {
        Object.assign(headers, this.auth.getAuthHeaders());
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
        // T#176 — credentials threaded from middleware (cookie mode sets
        // 'include'); undefined preserves the default 'same-origin'.
        ...(credentials !== undefined ? { credentials } : {}),
      });

      clearTimeout(timeoutId);

      const latency = Date.now() - startTime;
      this.metrics.latencies.push(latency);
      this.metrics.responsesReceived++;

      if (!response.ok) {
        // Try to parse error response
        try {
          const errorData = await response.json();
          return errorData;
        } catch {
          // Return generic error
          this.metrics.errors++;
          return {
            id: message.id,
            success: false,
            error: {
              code: 'HTTP_ERROR',
              message: `HTTP ${response.status}: ${response.statusText}`,
            },
          };
        }
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      this.metrics.errors++;

      // Retry logic
      if (this.retry && retryCount < this.maxRetries) {
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.sendRequest(message, retryCount + 1, customHeaders, skipAuth, credentials);
      }

      if (error.name === 'AbortError') {
        return {
          id: message.id,
          success: false,
          error: {
            code: 'TIMEOUT',
            message: `Request timeout after ${timeout}ms`,
          },
        };
      }

      return {
        id: message.id,
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error.message,
        },
      };
    }
  }

  /**
   * Close the client connection
   */
  async disconnect(): Promise<void> {
    this.state = 'disconnected' as ConnectionState;
  }

  /**
   * Get connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get connection metrics
   */
  getMetrics(): ConnectionMetrics {
    const avgLatency =
      this.metrics.latencies.length > 0
        ? this.metrics.latencies.reduce((a, b) => a + b, 0) / this.metrics.latencies.length
        : undefined;

    return {
      id: 'http-client',
      url: this.baseUrl,
      state: this.state,
      transport: 'http',
      requestsSent: this.metrics.requestsSent,
      responsesReceived: this.metrics.responsesReceived,
      errors: this.metrics.errors,
      avgLatency,
    };
  }

  /**
   * Get middleware manager
   */
  getMiddleware(): IMiddlewareManager {
    return this.middleware;
  }

  /**
   * Use middleware
   */
  use(middleware: MiddlewareFunction, config?: Partial<MiddlewareConfig>, stage?: MiddlewareStage): this {
    this.middleware.use(middleware, config, stage);
    return this;
  }
}
