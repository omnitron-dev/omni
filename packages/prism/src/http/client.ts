/**
 * HTTP Client Implementation
 *
 * Framework-agnostic HTTP client built on the Fetch API.
 *
 * @module @omnitron-dev/prism/http/client
 */

import type {
  HttpClient,
  HttpClientConfig,
  HttpRequestConfig,
  HttpResponse,
  HttpError,
  RequestInterceptor,
  ResponseInterceptor,
  ErrorInterceptor,
  HttpParams,
} from './types.js';

/**
 * Default retry delay function (exponential backoff).
 */
const defaultRetryDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 30000);

/**
 * Default retry condition (retry on network errors and 5xx responses).
 */
const defaultRetryCondition = (error: HttpError, attempt: number): boolean => {
  // Don't retry if cancelled or timed out
  if (error.cancelled || error.timeout) return false;

  // Retry on network errors (no status)
  if (!error.status) return true;

  // Retry on 5xx errors and 429 (rate limit)
  return error.status >= 500 || error.status === 429;
};

/**
 * Build URL with query parameters.
 */
function buildUrl(baseUrl: string, url: string, params?: HttpParams): string {
  // Resolve URL against base
  let fullUrl: string;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    fullUrl = url;
  } else if (baseUrl) {
    fullUrl = `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
  } else {
    fullUrl = url;
  }

  // Add query parameters
  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        value.forEach((v) => searchParams.append(key, String(v)));
      } else {
        searchParams.append(key, String(value));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      fullUrl += (fullUrl.includes('?') ? '&' : '?') + queryString;
    }
  }

  return fullUrl;
}

/**
 * Parse response headers.
 */
function parseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

/**
 * Create an HTTP error.
 */
function createHttpError<TData = unknown>(
  message: string,
  config: HttpRequestConfig,
  options: Partial<HttpError<TData>> = {}
): HttpError<TData> {
  const error = new Error(message) as HttpError<TData>;
  error.name = 'HttpError';
  error.config = config;
  Object.assign(error, options);
  return error;
}

/**
 * Create HTTP client implementation.
 */
function createClientImpl(config: HttpClientConfig): HttpClient {
  const {
    baseUrl = '',
    headers: defaultHeaders = {},
    timeout: defaultTimeout = 30000,
    withCredentials: defaultWithCredentials = false,
    retry: retryConfig = {},
    requestInterceptors = [],
    responseInterceptors = [],
    errorInterceptors = [],
  } = config;

  const { maxRetries = 0, retryDelay = defaultRetryDelay, retryCondition = defaultRetryCondition } = retryConfig;

  // Mutable interceptor arrays
  const reqInterceptors = [...requestInterceptors];
  const resInterceptors = [...responseInterceptors];
  const errInterceptors = [...errorInterceptors];

  /**
   * Execute request with interceptors and retry logic.
   */
  async function executeRequest<TData>(requestConfig: HttpRequestConfig, attempt = 0): Promise<HttpResponse<TData>> {
    // Apply request interceptors
    let processedConfig = { ...requestConfig };
    for (const interceptor of reqInterceptors) {
      processedConfig = await interceptor(processedConfig);
    }

    const {
      url,
      method = 'GET',
      headers = {},
      params,
      data,
      timeout = defaultTimeout,
      responseType = 'json',
      withCredentials = defaultWithCredentials,
      signal,
      rawResponse = false,
    } = processedConfig;

    // Build full URL
    const fullUrl = buildUrl(baseUrl, url, params);

    // Merge headers
    const mergedHeaders = {
      ...defaultHeaders,
      ...headers,
    };

    // Set content-type for JSON data
    if (data && typeof data === 'object' && !mergedHeaders['content-type']) {
      mergedHeaders['content-type'] = 'application/json';
    }

    // Create abort controller for timeout
    const abortController = new AbortController();
    const timeoutId = timeout > 0 ? setTimeout(() => abortController.abort(), timeout) : null;

    // If external signal provided, link it (with cleanup)
    const onExternalAbort = signal ? () => abortController.abort() : null;
    if (signal && onExternalAbort) {
      if (signal.aborted) {
        abortController.abort();
      } else {
        signal.addEventListener('abort', onExternalAbort);
      }
    }

    const cleanup = () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (signal && onExternalAbort) signal.removeEventListener('abort', onExternalAbort);
    };

    try {
      // Make request
      const response = await fetch(fullUrl, {
        method,
        headers: mergedHeaders,
        body: data ? JSON.stringify(data) : undefined,
        credentials: withCredentials ? 'include' : 'same-origin',
        signal: abortController.signal,
      });

      // Clear timeout
      cleanup();

      // Parse response
      const responseHeaders = parseHeaders(response.headers);
      let responseData: TData;

      if (rawResponse) {
        responseData = response as unknown as TData;
      } else {
        try {
          switch (responseType) {
            case 'text':
              responseData = (await response.text()) as unknown as TData;
              break;
            case 'blob':
              responseData = (await response.blob()) as unknown as TData;
              break;
            case 'arraybuffer':
              responseData = (await response.arrayBuffer()) as unknown as TData;
              break;
            case 'json':
            default: {
              const text = await response.text();
              responseData = text ? JSON.parse(text) : null;
              break;
            }
          }
        } catch {
          responseData = null as TData;
        }
      }

      // Check for error status
      if (!response.ok) {
        const error = createHttpError<TData>(`Request failed with status ${response.status}`, processedConfig, {
          status: response.status,
          statusText: response.statusText,
          data: responseData,
          headers: responseHeaders,
        });

        // Check if should retry
        if (attempt < maxRetries && retryCondition(error, attempt)) {
          // Skip retry if already aborted
          if (abortController.signal.aborted) throw error;

          const delay = typeof retryDelay === 'function' ? retryDelay(attempt) : retryDelay;
          await new Promise<void>((resolve, reject) => {
            const timerId = setTimeout(resolve, delay);
            // Abort during retry delay should cancel the wait
            const onAbort = () => {
              clearTimeout(timerId);
              reject(new DOMException('Request cancelled', 'AbortError'));
            };
            abortController.signal.addEventListener('abort', onAbort, { once: true });
          });
          return executeRequest(requestConfig, attempt + 1);
        }

        throw error;
      }

      // Build response object
      let httpResponse: HttpResponse<TData> = {
        data: responseData,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        config: processedConfig,
      };

      // Apply response interceptors
      for (const interceptor of resInterceptors) {
        httpResponse = (await interceptor(httpResponse)) as HttpResponse<TData>;
      }

      return httpResponse;
    } catch (err) {
      // Cleanup on error
      cleanup();

      // Handle abort/timeout
      if (err instanceof DOMException && err.name === 'AbortError') {
        const isTimeout = !signal?.aborted;
        const error = createHttpError(isTimeout ? 'Request timeout' : 'Request cancelled', processedConfig, {
          cancelled: !isTimeout,
          timeout: isTimeout,
        });

        // Apply error interceptors
        let processedError = error;
        for (const interceptor of errInterceptors) {
          processedError = await interceptor(processedError);
        }
        throw processedError;
      }

      // Handle HTTP errors
      if ((err as HttpError).name === 'HttpError') {
        const httpError = err as HttpError;

        // Check if should retry
        if (attempt < maxRetries && retryCondition(httpError, attempt)) {
          const delay = typeof retryDelay === 'function' ? retryDelay(attempt) : retryDelay;
          await new Promise((resolve) => setTimeout(resolve, delay));
          return executeRequest(requestConfig, attempt + 1);
        }

        // Apply error interceptors
        let processedError = httpError;
        for (const interceptor of errInterceptors) {
          processedError = await interceptor(processedError);
        }
        throw processedError;
      }

      // Handle network errors
      const error = createHttpError((err as Error).message || 'Network error', processedConfig);

      // Check if should retry
      if (attempt < maxRetries && retryCondition(error, attempt)) {
        const delay = typeof retryDelay === 'function' ? retryDelay(attempt) : retryDelay;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return executeRequest(requestConfig, attempt + 1);
      }

      // Apply error interceptors
      let processedError = error;
      for (const interceptor of errInterceptors) {
        processedError = await interceptor(processedError);
      }
      throw processedError;
    }
  }

  // Return client interface
  const client: HttpClient = {
    get<TData>(url: string, requestConfig?: Omit<HttpRequestConfig, 'url' | 'method'>) {
      return executeRequest<TData>({ ...requestConfig, url, method: 'GET' });
    },

    post<TData, TBody>(url: string, data?: TBody, requestConfig?: Omit<HttpRequestConfig, 'url' | 'method' | 'data'>) {
      return executeRequest<TData>({ ...requestConfig, url, method: 'POST', data });
    },

    put<TData, TBody>(url: string, data?: TBody, requestConfig?: Omit<HttpRequestConfig, 'url' | 'method' | 'data'>) {
      return executeRequest<TData>({ ...requestConfig, url, method: 'PUT', data });
    },

    patch<TData, TBody>(url: string, data?: TBody, requestConfig?: Omit<HttpRequestConfig, 'url' | 'method' | 'data'>) {
      return executeRequest<TData>({ ...requestConfig, url, method: 'PATCH', data });
    },

    delete<TData>(url: string, requestConfig?: Omit<HttpRequestConfig, 'url' | 'method'>) {
      return executeRequest<TData>({ ...requestConfig, url, method: 'DELETE' });
    },

    head(url: string, requestConfig?: Omit<HttpRequestConfig, 'url' | 'method'>) {
      return executeRequest<void>({ ...requestConfig, url, method: 'HEAD' });
    },

    options<TData>(url: string, requestConfig?: Omit<HttpRequestConfig, 'url' | 'method'>) {
      return executeRequest<TData>({ ...requestConfig, url, method: 'OPTIONS' });
    },

    request<TData>(requestConfig: HttpRequestConfig) {
      return executeRequest<TData>(requestConfig);
    },

    addRequestInterceptor(interceptor: RequestInterceptor) {
      reqInterceptors.push(interceptor);
      return () => {
        const index = reqInterceptors.indexOf(interceptor);
        if (index > -1) reqInterceptors.splice(index, 1);
      };
    },

    addResponseInterceptor(interceptor: ResponseInterceptor) {
      resInterceptors.push(interceptor);
      return () => {
        const index = resInterceptors.indexOf(interceptor);
        if (index > -1) resInterceptors.splice(index, 1);
      };
    },

    addErrorInterceptor(interceptor: ErrorInterceptor) {
      errInterceptors.push(interceptor);
      return () => {
        const index = errInterceptors.indexOf(interceptor);
        if (index > -1) errInterceptors.splice(index, 1);
      };
    },

    getConfig() {
      return { ...config };
    },

    extend(extendConfig: HttpClientConfig) {
      return createClientImpl({
        ...config,
        ...extendConfig,
        headers: { ...defaultHeaders, ...extendConfig.headers },
        requestInterceptors: [...reqInterceptors, ...(extendConfig.requestInterceptors || [])],
        responseInterceptors: [...resInterceptors, ...(extendConfig.responseInterceptors || [])],
        errorInterceptors: [...errInterceptors, ...(extendConfig.errorInterceptors || [])],
      });
    },
  };

  return client;
}

/**
 * Create a new HTTP client instance.
 *
 * @param config - Client configuration
 * @returns HTTP client instance
 *
 * @example
 * ```ts
 * // Create a basic client
 * const api = createHttpClient({
 *   baseUrl: 'https://api.example.com',
 *   headers: {
 *     'Authorization': 'Bearer token',
 *   },
 * });
 *
 * // Make requests
 * const users = await api.get('/users');
 * const newUser = await api.post('/users', { name: 'John' });
 * ```
 *
 * @example
 * ```ts
 * // With interceptors
 * const api = createHttpClient({
 *   baseUrl: 'https://api.example.com',
 *   requestInterceptors: [
 *     (config) => {
 *       const token = getAuthToken();
 *       if (token) {
 *         config.headers = { ...config.headers, Authorization: `Bearer ${token}` };
 *       }
 *       return config;
 *     },
 *   ],
 *   errorInterceptors: [
 *     (error) => {
 *       if (error.status === 401) {
 *         // Handle unauthorized
 *         refreshToken();
 *       }
 *       throw error;
 *     },
 *   ],
 * });
 * ```
 *
 * @example
 * ```ts
 * // With retry
 * const api = createHttpClient({
 *   baseUrl: 'https://api.example.com',
 *   retry: {
 *     maxRetries: 3,
 *     retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
 *     retryCondition: (error) => error.status === 429 || error.status >= 500,
 *   },
 * });
 * ```
 */
export function createHttpClient(config: HttpClientConfig = {}): HttpClient {
  return createClientImpl(config);
}

/**
 * Default HTTP client instance.
 */
export const http = createHttpClient();
