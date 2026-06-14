/**
 * Shared HTTP request envelope types (SHARED-HTTP-CORE).
 *
 * The request-side cluster (context / hints / message) used by the fluent
 * interface — query builder, configurable proxy — and by the transport clients
 * in both @omnitron-dev/titan and @omnitron-dev/netron-browser. Single source of
 * truth; both packages re-export these from their local `http/types.ts`.
 *
 * (Response-side hints and discovery types stay per-package for now — they have
 * env/feature divergence outside this extraction's scope.)
 */

/**
 * Request context for distributed tracing and multi-tenancy
 */
export interface HttpRequestContext {
  /** Distributed tracing ID */
  traceId?: string;
  /** Span ID for request */
  spanId?: string;
  /** User context */
  userId?: string;
  /** Multi-tenancy context */
  tenantId?: string;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Client hints for request optimization
 */
export interface HttpRequestHints {
  /** Caching configuration */
  cache?: {
    /** Maximum age in milliseconds */
    maxAge?: number;
    /** Serve stale content while revalidating */
    staleWhileRevalidate?: number;
    /** Cache tags for invalidation */
    tags?: string[];
  };
  /** Conditional request for cache validation (HTTP 304 support) */
  conditional?: {
    /** ETag from previous response (for If-None-Match) */
    ifNoneMatch?: string;
    /** Timestamp from previous response (for If-Modified-Since) */
    ifModifiedSince?: number;
  };
  /** Retry configuration */
  retry?: {
    /** Maximum retry attempts */
    attempts?: number;
    /** Backoff strategy */
    backoff?: 'exponential' | 'linear' | 'constant';
    /** Maximum delay between retries in milliseconds */
    maxDelay?: number;
    /** Initial delay in milliseconds */
    initialDelay?: number;
  };
  /** Request priority */
  priority?: 'high' | 'normal' | 'low';
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * HTTP request message format
 */
export interface HttpRequestMessage {
  /** Request ID for correlation */
  id: string;

  /** Service invocation */
  service: string;
  method: string;
  input: any;

  /** Optional context */
  context?: HttpRequestContext;

  /** Client hints for optimization */
  hints?: HttpRequestHints;
}

/**
 * Minimal transport surface the fluent interface needs: the ability to invoke a
 * service method. The concrete HttpTransportClient in each package satisfies
 * this structurally, so the shared query builder / proxy depend on the interface
 * rather than the concrete client class.
 */
export interface IHttpRequestExecutor {
  invoke(
    service: string,
    method: string,
    args: any[],
    options?: { context?: HttpRequestContext; hints?: HttpRequestHints }
  ): Promise<any>;
}
