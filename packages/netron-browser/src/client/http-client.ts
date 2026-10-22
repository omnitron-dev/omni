/**
 * HTTP Transport Client for Netron Browser
 *
 * Provides HTTP-based RPC communication with the Netron server
 */

import type {
  HttpRequestMessage,
  HttpResponseMessage,
  InvocationOptions,
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
import { abortable, abortableDelay, invocationScope } from './request-lifecycle.js';

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
   * Enable network-failure retries for invocations explicitly marked idempotent
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
 * An answer, with the HTTP status it came under when that was not 2xx.
 *
 * The envelope has no field for the status, and a caller that has no word for
 * a business code can still tell «wait» (429) from «refused» (403) by it.
 */
type Answer = HttpResponseMessage & { httpStatus?: number };

/** What a failed call throws. */
type RefusalError = Error & { code?: unknown; details?: unknown; status?: number };

/**
 * The error a failed call throws: the server's code, and what it said with it.
 *
 * This threw `new Error(message)` with `code` and nothing else, so everything
 * a server put in `error.details` ended here — the `retryAfter` of a refused
 * sign-in (a page could say «later», never when), the fields a validation
 * refusal named, the two currencies of a mismatched cart. Measured in the
 * downstream portal on 2026-09-29: six refused sign-ins, six errors whose only
 * own key was `code`, while each body carried
 * `details: { retryAfter: 897, errorCode: 'RATE_LIMIT_EXCEEDED' }`. Fourteen
 * of its messages interpolate a detail; with none arriving, i18next leaves
 * each `{{placeholder}}` in the text.
 *
 * `code` stays exactly what the envelope carried — a business string from an
 * application's error, a number from titan's — because callers compare it.
 * `details` and `status` come beside it, never in its place.
 */
function refusal(answer: Answer): RefusalError {
  const error: RefusalError = new Error(answer.error?.message || 'Method invocation failed');
  error.code = answer.error?.code;
  if (answer.error?.details !== undefined) error.details = answer.error.details;
  if (answer.httpStatus !== undefined) error.status = answer.httpStatus;
  return error;
}

class InvalidResponseError extends Error {
  readonly code = 'INVALID_RESPONSE';
  constructor(message: string, readonly status?: number) { super(message); this.name = 'InvalidResponseError'; }
}

function invalidResponse(message: string, status?: number): InvalidResponseError {
  return new InvalidResponseError(message, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isErrorBody(value: unknown): value is NonNullable<HttpResponseMessage['error']> {
  return isRecord(value) && typeof value.message === 'string' &&
    (typeof value.code === 'string' || (typeof value.code === 'number' && Number.isFinite(value.code)));
}

/** Validate the envelope, not application data: callers still own their result schema. */
function parseAnswer(value: unknown, requestId: string, response: Response): Answer {
  const status = response.ok ? undefined : response.status;
  // Titan's pre-RPC transport errors have no RPC id and cannot carry a result.
  if (!response.ok && isRecord(value) && value.error === true && isErrorBody(value)) {
    return { id: requestId, success: false, error: value, httpStatus: status };
  }
  if (value === undefined && !response.ok) {
    return { id: requestId, success: false, error: {
      code: 'HTTP_ERROR', message: `HTTP ${response.status}: ${response.statusText}`,
    }, httpStatus: status };
  }
  if (!isRecord(value) || typeof value.success !== 'boolean' || value.id !== requestId) {
    throw invalidResponse('Invalid RPC response envelope or mismatched request id', status);
  }
  if (value.success) {
    if (!response.ok) throw invalidResponse('Unsuccessful HTTP response cannot carry RPC success', status);
    return { id: requestId, success: true, data: value.data };
  }
  if (!isErrorBody(value.error)) throw invalidResponse('Invalid RPC error envelope', status);
  return { id: requestId, success: false, error: value.error, ...(status === undefined ? {} : { httpStatus: status }) };
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
    avgLatency: 0,
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
  async invoke(service: string, method: string, args: any[], options?: InvocationOptions): Promise<any> {
    options?.signal?.throwIfAborted();
    const ctx: ClientMiddlewareContext = {
      service, method, args,
      request: {
        headers: { ...this.headers },
        timeout: options?.timeout ?? options?.hints?.timeout ?? this.timeout,
        metadata: options?.context,
      },
      timing: { start: performance.now(), middlewareTimes: new Map() },
      metadata: new Map(),
      transport: 'http',
    };
    await abortable(() => this.middleware.execute(ctx, MiddlewareStage.PRE_REQUEST), options?.signal);
    if (ctx.skipRemaining) return ctx.response?.data;

    const timeout = ctx.request?.timeout ?? this.timeout;
    const timeoutError = Object.assign(new Error(`Request timeout after ${timeout}ms`), { code: 'TIMEOUT' });
    const scope = invocationScope(timeout, timeoutError, options?.signal);
    try {
      // A refresh middleware can request one re-invocation after authentication
      // was refused. Cancellation or deadline expiry never enters that path.
      for (let attempt = 0; ; attempt++) {
        try {
          scope.signal.throwIfAborted();
          const message = createRequestMessage(service, method, args, {
            context: ctx.request?.metadata,
            hints: { ...options?.hints, timeout },
          });
          const credentials = ctx.request?.credentials ?? this.auth?.getRequestCredentials();
          const response = await this.sendRequest(message, scope.signal, options?.idempotent === true,
            ctx.request?.headers, options?.skipAuth ?? false, credentials);
          if (!response.success) throw refusal(response);
          ctx.response = { data: response.data, headers: {}, metadata: {} };
          await abortable(() => this.middleware.execute(ctx, MiddlewareStage.POST_RESPONSE), scope.signal);
          return ctx.response.data;
        } catch (error) {
          scope.signal.throwIfAborted();
          ctx.error = error as Error;
          ctx.metadata.delete('auth:retry');
          try {
            await abortable(() => this.middleware.execute(ctx, MiddlewareStage.ERROR), scope.signal);
          } catch {
            // Preserve the original failure, except when the caller/deadline ended the invocation.
          }
          scope.signal.throwIfAborted();
          if (attempt < 1 && ctx.metadata.get('auth:retry')) {
            ctx.metadata.delete('auth:retry');
            ctx.error = undefined;
            continue;
          }
          throw error;
        }
      }
    } finally {
      scope.dispose();
    }
  }

  private async sendRequest(
    message: HttpRequestMessage,
    signal: AbortSignal,
    idempotent: boolean,
    customHeaders?: Record<string, string>,
    skipAuth = false,
    credentials?: RequestCredentials
  ): Promise<Answer> {
    const url = `${this.baseUrl}/netron/invoke`;
    const headers = new Headers({
      'Content-Type': 'application/json', Accept: 'application/json',
      ...this.headers, ...customHeaders,
    });
    // Titan uses this header for errors refused before the RPC body is parsed.
    // Own the correlation value even when middleware supplied a different case.
    headers.set('X-Request-ID', message.id);
    if (this.auth && !skipAuth && !headers.has('Authorization')) {
      for (const [name, value] of Object.entries(this.auth.getAuthHeaders())) headers.set(name, value);
    }
    const body = JSON.stringify(message);
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      const start = performance.now();
      try {
        this.metrics.requestsSent++;
        const response = await abortable(() => fetch(url, {
          method: 'POST', headers, body, signal,
          ...(credentials !== undefined ? { credentials } : {}),
        }), signal);
        let value: unknown;
        try {
          // The same deadline and caller signal remain active through body consumption.
          value = await abortable(() => response.json(), signal);
        } catch (error) {
          signal.throwIfAborted();
          if (response.ok) throw invalidResponse('Response body is not valid JSON');
          value = undefined;
        }
        this.metrics.responsesReceived++;
        this.metrics.avgLatency += (performance.now() - start - this.metrics.avgLatency) / this.metrics.responsesReceived;
        const answer = parseAnswer(value, message.id, response);
        if (!answer.success) this.metrics.errors++;
        return answer;
      } catch (error) {
        this.metrics.errors++;
        signal.throwIfAborted();
        if (error instanceof InvalidResponseError) throw error;
        // A transport failure does not establish whether a POST was executed.
        // Replay requires an explicit caller assertion; method names are never guessed.
        if (this.retry && idempotent && attempt < this.maxRetries) {
          await abortableDelay(Math.min(2 ** attempt * 1000, 30_000), signal);
          continue;
        }
        return { id: message.id, success: false, error: {
          code: 'NETWORK_ERROR', message: error instanceof Error ? error.message : String(error),
        } };
      }
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
    return {
      id: 'http-client',
      url: this.baseUrl,
      state: this.state,
      transport: 'http',
      requestsSent: this.metrics.requestsSent,
      responsesReceived: this.metrics.responsesReceived,
      errors: this.metrics.errors,
      avgLatency: this.metrics.responsesReceived ? this.metrics.avgLatency : undefined,
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
