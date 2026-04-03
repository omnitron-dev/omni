/**
 * Fetch Interceptor Factory
 *
 * A flexible fetch wrapper with support for request/response interceptors,
 * automatic token refresh, and retry logic.
 *
 * Designed for production applications that need centralized HTTP handling.
 *
 * @module @omnitron/prism/utils
 */

import { createAsyncLock, type AsyncLock } from './async-lock.js';
import { extractErrorContext, withRetry, type RetryConfig } from './errors.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Extended request init with additional options.
 */
export interface FetchRequestInit extends RequestInit {
  /** Skip all interceptors for this request */
  skipInterceptors?: boolean;
  /** Skip request interceptors only */
  skipRequestInterceptors?: boolean;
  /** Skip response interceptors only */
  skipResponseInterceptors?: boolean;
  /** Custom timeout in milliseconds */
  timeout?: number;
  /** Enable automatic retry on failure */
  retry?: boolean | RetryConfig;
  /** Request metadata for logging/debugging */
  metadata?: Record<string, unknown>;
}

/**
 * Request interceptor context.
 */
export interface RequestContext {
  url: string;
  init: FetchRequestInit;
  /** Original request info (can be string or Request) */
  input: RequestInfo | URL;
  /** Request metadata */
  metadata: Record<string, unknown>;
}

/**
 * Response interceptor context.
 */
export interface ResponseContext {
  response: Response;
  request: RequestContext;
  /** Time taken for the request in ms */
  duration: number;
}

/**
 * Error interceptor context.
 */
export interface ErrorContext {
  error: unknown;
  request: RequestContext;
  /** Time taken before error in ms */
  duration: number;
  /** Number of retry attempts made */
  retryCount: number;
}

/**
 * Request interceptor function.
 * Can modify the request or return a new one.
 */
export type RequestInterceptor = (ctx: RequestContext) => RequestContext | Promise<RequestContext>;

/**
 * Response interceptor function.
 * Can modify the response or return a new one.
 */
export type ResponseInterceptor = (ctx: ResponseContext) => Response | Promise<Response>;

/**
 * Error interceptor function.
 * Can handle the error, retry, or rethrow.
 */
export type ErrorInterceptor = (ctx: ErrorContext) => Response | Promise<Response> | never;

/**
 * Interceptor configuration.
 */
export interface FetchInterceptorConfig {
  /** Base URL to prepend to relative paths */
  baseUrl?: string;
  /** Default headers for all requests */
  defaultHeaders?: HeadersInit;
  /** Default timeout in milliseconds (0 = no timeout) */
  defaultTimeout?: number;
  /** Request interceptors (run in order) */
  requestInterceptors?: RequestInterceptor[];
  /** Response interceptors (run in order) */
  responseInterceptors?: ResponseInterceptor[];
  /** Error interceptors (run in order, first to handle wins) */
  errorInterceptors?: ErrorInterceptor[];
  /** Default retry configuration */
  defaultRetry?: RetryConfig | false;
  /** Credentials mode for all requests */
  credentials?: RequestCredentials;
}

/**
 * Token refresh handler configuration.
 */
export interface TokenRefreshConfig {
  /** Check if a response indicates token expiration */
  isTokenExpired: (response: Response) => boolean;
  /** Refresh the token (called when token is expired) */
  refreshToken: () => Promise<string | null>;
  /** Get the current access token */
  getAccessToken: () => string | null;
  /** Called when refresh fails (e.g., redirect to login) */
  onRefreshFailure?: () => void;
  /** Maximum number of refresh attempts */
  maxRefreshAttempts?: number;
}

/**
 * Fetch client interface.
 */
export interface FetchClient {
  /** Make a fetch request */
  fetch: (input: RequestInfo | URL, init?: FetchRequestInit) => Promise<Response>;
  /** Add a request interceptor */
  addRequestInterceptor: (interceptor: RequestInterceptor) => () => void;
  /** Add a response interceptor */
  addResponseInterceptor: (interceptor: ResponseInterceptor) => () => void;
  /** Add an error interceptor */
  addErrorInterceptor: (interceptor: ErrorInterceptor) => () => void;
  /** Remove all interceptors */
  clearInterceptors: () => void;
  /** Get current configuration */
  getConfig: () => FetchInterceptorConfig;
}

// =============================================================================
// FETCH INTERCEPTOR FACTORY
// =============================================================================

/**
 * Create a fetch client with interceptor support.
 *
 * @example
 * ```tsx
 * // Basic usage
 * const api = createFetchClient({
 *   baseUrl: 'https://api.example.com',
 *   defaultHeaders: { 'Content-Type': 'application/json' },
 *   defaultTimeout: 30000,
 * });
 *
 * // Add auth header interceptor
 * api.addRequestInterceptor(async (ctx) => {
 *   const token = getAccessToken();
 *   if (token) {
 *     ctx.init.headers = {
 *       ...ctx.init.headers,
 *       Authorization: `Bearer ${token}`,
 *     };
 *   }
 *   return ctx;
 * });
 *
 * // Add response logging
 * api.addResponseInterceptor(async (ctx) => {
 *   console.log(`${ctx.request.init.method} ${ctx.request.url} - ${ctx.response.status} (${ctx.duration}ms)`);
 *   return ctx.response;
 * });
 *
 * // Make requests
 * const response = await api.fetch('/users');
 * const data = await response.json();
 * ```
 */
export function createFetchClient(config: FetchInterceptorConfig = {}): FetchClient {
  const requestInterceptors: RequestInterceptor[] = [...(config.requestInterceptors ?? [])];
  const responseInterceptors: ResponseInterceptor[] = [...(config.responseInterceptors ?? [])];
  const errorInterceptors: ErrorInterceptor[] = [...(config.errorInterceptors ?? [])];

  /**
   * Build the full URL from input.
   */
  function buildUrl(input: RequestInfo | URL): string {
    const baseUrl = config.baseUrl ?? '';

    if (typeof input === 'string') {
      // If input is absolute, use it as-is
      if (input.startsWith('http://') || input.startsWith('https://')) {
        return input;
      }
      // Combine with base URL
      const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
      const path = input.startsWith('/') ? input : `/${input}`;
      return `${base}${path}`;
    }

    if (input instanceof URL) {
      return input.toString();
    }

    // Request object
    return input.url;
  }

  /**
   * Merge headers from multiple sources.
   */
  function mergeHeaders(...sources: (HeadersInit | undefined)[]): Record<string, string> {
    const result: Record<string, string> = {};

    for (const source of sources) {
      if (!source) continue;

      if (source instanceof Headers) {
        source.forEach((value, key) => {
          result[key] = value;
        });
      } else if (Array.isArray(source)) {
        for (const [key, value] of source) {
          result[key] = value;
        }
      } else {
        Object.assign(result, source);
      }
    }

    return result;
  }

  /**
   * Execute fetch with timeout.
   */
  async function fetchWithTimeout(url: string, init: RequestInit, timeout: number): Promise<Response> {
    if (timeout <= 0) {
      return fetch(url, init);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * The main fetch function.
   */
  async function clientFetch(input: RequestInfo | URL, init: FetchRequestInit = {}): Promise<Response> {
    const startTime = Date.now();
    let retryCount = 0;

    // Build initial request context
    let ctx: RequestContext = {
      url: buildUrl(input),
      init: {
        ...init,
        headers: mergeHeaders(config.defaultHeaders, init.headers),
        credentials: init.credentials ?? config.credentials,
      },
      input,
      metadata: init.metadata ?? {},
    };

    // Run request interceptors
    if (!init.skipInterceptors && !init.skipRequestInterceptors) {
      for (const interceptor of requestInterceptors) {
        ctx = await interceptor(ctx);
      }
    }

    const timeout = init.timeout ?? config.defaultTimeout ?? 0;

    /**
     * Execute the actual request.
     */
    async function executeRequest(): Promise<Response> {
      try {
        const response = await fetchWithTimeout(ctx.url, ctx.init, timeout);
        const duration = Date.now() - startTime;

        // Run response interceptors
        if (!init.skipInterceptors && !init.skipResponseInterceptors) {
          let finalResponse = response;
          for (const interceptor of responseInterceptors) {
            finalResponse = await interceptor({
              response: finalResponse,
              request: ctx,
              duration,
            });
          }
          return finalResponse;
        }

        return response;
      } catch (error) {
        const duration = Date.now() - startTime;

        // Run error interceptors
        if (!init.skipInterceptors) {
          for (const interceptor of errorInterceptors) {
            try {
              const recoveredResponse = await interceptor({
                error,
                request: ctx,
                duration,
                retryCount,
              });
              // If interceptor returns a response, use it
              return recoveredResponse;
            } catch {
              // Interceptor didn't handle the error, continue to next
            }
          }
        }

        // No interceptor handled the error, rethrow
        throw error;
      }
    }

    // Handle retry logic
    const retryConfig = init.retry ?? config.defaultRetry;
    if (retryConfig) {
      const finalConfig = typeof retryConfig === 'boolean' ? {} : retryConfig;
      return withRetry(executeRequest, {
        ...finalConfig,
        onRetry: (error, attempt, delay) => {
          retryCount = attempt;
          finalConfig.onRetry?.(error, attempt, delay);
        },
      });
    }

    return executeRequest();
  }

  return {
    fetch: clientFetch,

    addRequestInterceptor(interceptor) {
      requestInterceptors.push(interceptor);
      return () => {
        const index = requestInterceptors.indexOf(interceptor);
        if (index !== -1) {
          requestInterceptors.splice(index, 1);
        }
      };
    },

    addResponseInterceptor(interceptor) {
      responseInterceptors.push(interceptor);
      return () => {
        const index = responseInterceptors.indexOf(interceptor);
        if (index !== -1) {
          responseInterceptors.splice(index, 1);
        }
      };
    },

    addErrorInterceptor(interceptor) {
      errorInterceptors.push(interceptor);
      return () => {
        const index = errorInterceptors.indexOf(interceptor);
        if (index !== -1) {
          errorInterceptors.splice(index, 1);
        }
      };
    },

    clearInterceptors() {
      requestInterceptors.length = 0;
      responseInterceptors.length = 0;
      errorInterceptors.length = 0;
    },

    getConfig() {
      return { ...config };
    },
  };
}

// =============================================================================
// TOKEN REFRESH INTERCEPTOR
// =============================================================================

/**
 * Create a token refresh interceptor that automatically refreshes
 * expired tokens and retries failed requests.
 *
 * Uses AsyncLock to prevent multiple simultaneous refresh attempts.
 *
 * @example
 * ```tsx
 * const api = createFetchClient({ baseUrl: '/api' });
 *
 * const { addToClient } = createTokenRefreshInterceptor({
 *   isTokenExpired: (response) => response.status === 401,
 *   refreshToken: async () => {
 *     const response = await fetch('/auth/refresh', { method: 'POST' });
 *     const data = await response.json();
 *     localStorage.setItem('token', data.accessToken);
 *     return data.accessToken;
 *   },
 *   getAccessToken: () => localStorage.getItem('token'),
 *   onRefreshFailure: () => {
 *     localStorage.removeItem('token');
 *     window.location.href = '/login';
 *   },
 * });
 *
 * addToClient(api);
 * ```
 */
export function createTokenRefreshInterceptor(config: TokenRefreshConfig): {
  addToClient: (client: FetchClient) => void;
  refreshLock: AsyncLock;
} {
  const refreshLock = createAsyncLock({ timeout: 30000 });
  let isRefreshing = false;
  let refreshAttempts = 0;
  const maxAttempts = config.maxRefreshAttempts ?? 3;

  const requestInterceptor: RequestInterceptor = async (ctx) => {
    // Add auth header if we have a token
    const token = config.getAccessToken();
    if (token) {
      ctx.init.headers = {
        ...(ctx.init.headers as Record<string, string>),
        Authorization: `Bearer ${token}`,
      };
    }
    return ctx;
  };

  const responseInterceptor: ResponseInterceptor = async (ctx) => {
    // Check if token is expired
    if (!config.isTokenExpired(ctx.response)) {
      // Reset refresh attempts on successful request
      refreshAttempts = 0;
      return ctx.response;
    }

    // Token expired, try to refresh
    if (refreshAttempts >= maxAttempts) {
      config.onRefreshFailure?.();
      throw new Error('Token refresh failed after maximum attempts');
    }

    // Use lock to prevent multiple simultaneous refresh attempts
    const lockResult = await refreshLock.acquire('token-refresh', async () => {
      // Double-check if another request already refreshed
      if (isRefreshing) {
        // Wait for the ongoing refresh to complete
        return config.getAccessToken();
      }

      isRefreshing = true;
      refreshAttempts++;

      try {
        const token = await config.refreshToken();
        if (!token) {
          config.onRefreshFailure?.();
          throw new Error('Token refresh returned null');
        }
        return token;
      } finally {
        isRefreshing = false;
      }
    });

    const newToken = lockResult.value;

    // Retry the original request with new token
    if (newToken) {
      const retryInit: RequestInit = {
        ...ctx.request.init,
        headers: {
          ...(ctx.request.init.headers as Record<string, string>),
          Authorization: `Bearer ${newToken}`,
        },
      };
      return fetch(ctx.request.url, retryInit);
    }

    return ctx.response;
  };

  return {
    addToClient(client) {
      client.addRequestInterceptor(requestInterceptor);
      client.addResponseInterceptor(responseInterceptor);
    },
    refreshLock,
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create a simple JSON API client.
 *
 * @example
 * ```tsx
 * const api = createJsonApiClient({
 *   baseUrl: 'https://api.example.com',
 *   getAuthToken: () => localStorage.getItem('token'),
 * });
 *
 * // GET request
 * const users = await api.get<User[]>('/users');
 *
 * // POST request
 * const newUser = await api.post<User>('/users', { name: 'John' });
 *
 * // DELETE request
 * await api.delete('/users/1');
 * ```
 */
export function createJsonApiClient(options: {
  baseUrl?: string;
  getAuthToken?: () => string | null;
  defaultHeaders?: Record<string, string>;
  timeout?: number;
}) {
  const client = createFetchClient({
    baseUrl: options.baseUrl,
    defaultHeaders: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...options.defaultHeaders,
    },
    defaultTimeout: options.timeout,
    credentials: 'include',
  });

  if (options.getAuthToken) {
    client.addRequestInterceptor(async (ctx) => {
      const token = options.getAuthToken!();
      if (token) {
        ctx.init.headers = {
          ...(ctx.init.headers as Record<string, string>),
          Authorization: `Bearer ${token}`,
        };
      }
      return ctx;
    });
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const response = await client.fetch(path, {
      method,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorContext = extractErrorContext(response);
      const error = new Error(errorContext.message || `HTTP ${response.status}`);
      Object.assign(error, { response, context: errorContext });
      throw error;
    }

    // Handle empty responses (204 No Content, non-JSON responses)
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      return null;
    }

    const text = await response.text();
    if (!text) {
      return null;
    }

    return JSON.parse(text) as T;
  }

  return {
    client,
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
    put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
    patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
    delete: <T>(path: string) => request<T>('DELETE', path),
  };
}
