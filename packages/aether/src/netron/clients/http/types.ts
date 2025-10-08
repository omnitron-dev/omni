/**
 * Native HTTP Message Format for Netron v2.0
 *
 * This defines the message format for HTTP transport that replaces
 * the binary packet protocol with native JSON messages.
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
 * HTTP request message format for Netron v2.0
 */
export interface HttpRequestMessage {
  /** Request ID for correlation */
  id: string;
  /** Protocol version */
  version: '2.0';
  /** Client timestamp */
  timestamp: number;

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
 * Server hints for response optimization
 */
export interface HttpResponseHints {
  /** Caching directives */
  cache?: {
    /** Entity tag for cache validation */
    etag?: string;
    /** Last modified timestamp */
    lastModified?: string;
    /** Maximum age in milliseconds */
    maxAge?: number;
    /** Cache tags */
    tags?: string[];
    /** Whether the response is private */
    private?: boolean;
    /** Whether the response should not be stored */
    noStore?: boolean;
  };
  /** Performance metrics */
  metrics?: {
    /** Server processing time in milliseconds */
    serverTime?: number;
    /** Number of database queries */
    dbQueries?: number;
    /** Cache hit/miss */
    cacheHit?: boolean;
    /** Additional metrics */
    custom?: Record<string, any>;
  };
  /** Rate limiting information */
  rateLimit?: {
    /** Remaining requests */
    remaining?: number;
    /** Rate limit maximum */
    limit?: number;
    /** Reset timestamp */
    resetAt?: number;
  };
}

/**
 * Error information in response
 */
export interface HttpResponseError {
  /** Error code */
  code: string;
  /** Human-readable message */
  message: string;
  /** Additional error details */
  details?: any;
  /** Stack trace (only in development) */
  stack?: string;
  /** Retry after (for rate limiting) */
  retryAfter?: number;
}

/**
 * HTTP response message format for Netron v2.0
 */
export interface HttpResponseMessage {
  /** Matching request ID */
  id: string;
  /** Protocol version */
  version: '2.0';
  /** Server timestamp */
  timestamp: number;

  /** Response status */
  success: boolean;
  /** Success result */
  data?: any;
  /** Error information */
  error?: HttpResponseError;

  /** Server hints */
  hints?: HttpResponseHints;
}

/**
 * Batch request for multiple operations
 */
export interface HttpBatchRequest {
  /** Batch ID */
  id: string;
  /** Protocol version */
  version: '2.0';
  /** Client timestamp */
  timestamp: number;

  /** Individual requests */
  requests: Array<{
    /** Request ID */
    id: string;
    /** Service name */
    service: string;
    /** Method name */
    method: string;
    /** Method input */
    input: any;
    /** Request-specific context */
    context?: HttpRequestContext;
    /** Request-specific hints */
    hints?: HttpRequestHints;
  }>;

  /** Batch-level context */
  context?: HttpRequestContext;

  /** Batch processing options */
  options?: {
    /** Process requests in parallel */
    parallel?: boolean;
    /** Stop on first error */
    stopOnError?: boolean;
    /** Maximum parallel requests */
    maxConcurrency?: number;
  };
}

/**
 * Batch response for multiple operations
 */
export interface HttpBatchResponse {
  /** Matching batch ID */
  id: string;
  /** Protocol version */
  version: '2.0';
  /** Server timestamp */
  timestamp: number;

  /** Individual responses */
  responses: Array<{
    /** Matching request ID */
    id: string;
    /** Response status */
    success: boolean;
    /** Success result */
    data?: any;
    /** Error information */
    error?: HttpResponseError;
    /** Response hints */
    hints?: HttpResponseHints;
  }>;

  /** Batch-level hints */
  hints?: {
    /** Total processing time */
    totalTime?: number;
    /** Number of successful requests */
    successCount?: number;
    /** Number of failed requests */
    failureCount?: number;
  };
}

/**
 * Service discovery response
 */
export interface HttpDiscoveryResponse {
  /** Available services */
  services: Record<string, {
    /** Service name */
    name: string;
    /** Service version */
    version: string;
    /** Available methods */
    methods: string[];
    /** Service description */
    description?: string;
    /** Service metadata */
    metadata?: Record<string, any>;
  }>;

  /** Service contracts (if available) */
  contracts?: Record<string, any>;

  /** Server information */
  server?: {
    /** Server version */
    version: string;
    /** Protocol version */
    protocol: '2.0';
    /** Supported features */
    features?: string[];
    /** Server metadata */
    metadata?: Record<string, any>;
  };

  /** Discovery timestamp */
  timestamp: number;
}

/**
 * Subscription request for real-time events
 */
export interface HttpSubscriptionRequest {
  /** Request ID */
  id: string;
  /** Protocol version */
  version: '2.0';
  /** Client timestamp */
  timestamp: number;

  /** Subscription type */
  type: 'subscribe' | 'unsubscribe';
  /** Service name */
  service: string;
  /** Event name or pattern */
  event: string;
  /** Filter criteria */
  filter?: any;

  /** Subscription options */
  options?: {
    /** Buffer size for events */
    bufferSize?: number;
    /** Acknowledgment required */
    ackRequired?: boolean;
    /** Reconnect on disconnect */
    autoReconnect?: boolean;
  };
}

/**
 * Subscription response
 */
export interface HttpSubscriptionResponse {
  /** Matching request ID */
  id: string;
  /** Protocol version */
  version: '2.0';
  /** Server timestamp */
  timestamp: number;

  /** Subscription status */
  success: boolean;
  /** Subscription ID for future reference */
  subscriptionId?: string;
  /** Error information */
  error?: HttpResponseError;

  /** Subscription details */
  details?: {
    /** WebSocket URL for events */
    websocketUrl?: string;
    /** SSE endpoint for events */
    sseUrl?: string;
    /** Polling interval if using polling */
    pollingInterval?: number;
  };
}

/**
 * Type guard for request message
 */
export function isHttpRequestMessage(value: any): value is HttpRequestMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    value.version === '2.0' &&
    typeof value.timestamp === 'number' &&
    typeof value.service === 'string' &&
    typeof value.method === 'string' &&
    'input' in value
  );
}

/**
 * Type guard for response message
 */
export function isHttpResponseMessage(value: any): value is HttpResponseMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    value.version === '2.0' &&
    typeof value.timestamp === 'number' &&
    typeof value.success === 'boolean' &&
    (value.success ? 'data' in value : 'error' in value)
  );
}

/**
 * Type guard for batch request
 */
export function isHttpBatchRequest(value: any): value is HttpBatchRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    value.version === '2.0' &&
    typeof value.timestamp === 'number' &&
    Array.isArray(value.requests) &&
    value.requests.every((r: any) =>
      typeof r.id === 'string' &&
      typeof r.service === 'string' &&
      typeof r.method === 'string' &&
      'input' in r
    )
  );
}

/**
 * Type guard for batch response
 */
export function isHttpBatchResponse(value: any): value is HttpBatchResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (
    typeof value.id === 'string' &&
    value.version === '2.0' &&
    typeof value.timestamp === 'number' &&
    Array.isArray(value.responses) &&
    value.responses.every((r: any) =>
      typeof r.id === 'string' &&
      typeof r.success === 'boolean' &&
      (r.success ? 'data' in r : 'error' in r)
    )
  );
}

/**
 * Generate unique request ID
 */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Create request message
 */
export function createRequestMessage(
  service: string,
  method: string,
  input: any,
  options?: {
    id?: string;
    context?: HttpRequestContext;
    hints?: HttpRequestHints;
  }
): HttpRequestMessage {
  return {
    id: options?.id || generateRequestId(),
    version: '2.0',
    timestamp: Date.now(),
    service,
    method,
    input,
    context: options?.context,
    hints: options?.hints
  };
}

/**
 * Create success response
 */
export function createSuccessResponse(
  requestId: string,
  data: any,
  hints?: HttpResponseHints
): HttpResponseMessage {
  return {
    id: requestId,
    version: '2.0',
    timestamp: Date.now(),
    success: true,
    data,
    hints
  };
}

/**
 * Create error response
 */
export function createErrorResponse(
  requestId: string,
  error: HttpResponseError,
  hints?: HttpResponseHints
): HttpResponseMessage {
  return {
    id: requestId,
    version: '2.0',
    timestamp: Date.now(),
    success: false,
    error,
    hints
  };
}