/**
 * HTTP Client Types
 *
 * Type definitions for the HTTP client module.
 *
 * @module @omnitron/prism/http/types
 */

/**
 * HTTP request methods.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/**
 * Request headers type.
 */
export type HttpHeaders = Record<string, string>;

/**
 * Request parameters type.
 */
export type HttpParams = Record<string, string | number | boolean | string[] | number[] | undefined>;

/**
 * Request configuration.
 */
export interface HttpRequestConfig<TData = unknown> {
  /** Request URL (relative or absolute) */
  url: string;
  /** HTTP method */
  method?: HttpMethod;
  /** Request headers */
  headers?: HttpHeaders;
  /** Query parameters */
  params?: HttpParams;
  /** Request body */
  data?: TData;
  /** Request timeout in ms */
  timeout?: number;
  /** Response type */
  responseType?: 'json' | 'text' | 'blob' | 'arraybuffer';
  /** Whether to include credentials */
  withCredentials?: boolean;
  /** AbortController signal */
  signal?: AbortSignal;
  /** Custom tags for middleware */
  tags?: string[];
  /** Skip response transformation */
  rawResponse?: boolean;
}

/**
 * Response type from HTTP client.
 */
export interface HttpResponse<TData = unknown> {
  /** Response data */
  data: TData;
  /** HTTP status code */
  status: number;
  /** Status text */
  statusText: string;
  /** Response headers */
  headers: Record<string, string>;
  /** Original request config */
  config: HttpRequestConfig;
}

/**
 * HTTP error type.
 */
export interface HttpError<TData = unknown> extends Error {
  /** Error name (always 'HttpError') */
  name: 'HttpError';
  /** HTTP status code (if response received) */
  status?: number;
  /** Status text */
  statusText?: string;
  /** Response data (if any) */
  data?: TData;
  /** Response headers */
  headers?: Record<string, string>;
  /** Original request config */
  config: HttpRequestConfig;
  /** Whether request was cancelled */
  cancelled?: boolean;
  /** Whether request timed out */
  timeout?: boolean;
}

/**
 * Request interceptor function.
 */
export type RequestInterceptor = (config: HttpRequestConfig) => HttpRequestConfig | Promise<HttpRequestConfig>;

/**
 * Response interceptor function.
 */
export type ResponseInterceptor<TData = unknown> = (
  response: HttpResponse<TData>
) => HttpResponse<TData> | Promise<HttpResponse<TData>>;

/**
 * Error interceptor function.
 */
export type ErrorInterceptor = (error: HttpError) => HttpError | Promise<HttpError> | never;

/**
 * Retry condition function.
 */
export type RetryCondition = (error: HttpError, attempt: number) => boolean;

/**
 * HTTP client configuration.
 */
export interface HttpClientConfig {
  /** Base URL for all requests */
  baseUrl?: string;
  /** Default headers for all requests */
  headers?: HttpHeaders;
  /** Default timeout in ms */
  timeout?: number;
  /** Whether to include credentials by default */
  withCredentials?: boolean;
  /** Retry configuration */
  retry?: {
    /** Maximum number of retries */
    maxRetries?: number;
    /** Delay between retries in ms */
    retryDelay?: number | ((attempt: number) => number);
    /** Condition to determine if should retry */
    retryCondition?: RetryCondition;
  };
  /** Request interceptors */
  requestInterceptors?: RequestInterceptor[];
  /** Response interceptors */
  responseInterceptors?: ResponseInterceptor[];
  /** Error interceptors */
  errorInterceptors?: ErrorInterceptor[];
}

/**
 * HTTP client interface.
 */
export interface HttpClient {
  /** Make a GET request */
  get<TData = unknown>(url: string, config?: Omit<HttpRequestConfig, 'url' | 'method'>): Promise<HttpResponse<TData>>;
  /** Make a POST request */
  post<TData = unknown, TBody = unknown>(
    url: string,
    data?: TBody,
    config?: Omit<HttpRequestConfig, 'url' | 'method' | 'data'>
  ): Promise<HttpResponse<TData>>;
  /** Make a PUT request */
  put<TData = unknown, TBody = unknown>(
    url: string,
    data?: TBody,
    config?: Omit<HttpRequestConfig, 'url' | 'method' | 'data'>
  ): Promise<HttpResponse<TData>>;
  /** Make a PATCH request */
  patch<TData = unknown, TBody = unknown>(
    url: string,
    data?: TBody,
    config?: Omit<HttpRequestConfig, 'url' | 'method' | 'data'>
  ): Promise<HttpResponse<TData>>;
  /** Make a DELETE request */
  delete<TData = unknown>(
    url: string,
    config?: Omit<HttpRequestConfig, 'url' | 'method'>
  ): Promise<HttpResponse<TData>>;
  /** Make a HEAD request */
  head(url: string, config?: Omit<HttpRequestConfig, 'url' | 'method'>): Promise<HttpResponse<void>>;
  /** Make an OPTIONS request */
  options<TData = unknown>(
    url: string,
    config?: Omit<HttpRequestConfig, 'url' | 'method'>
  ): Promise<HttpResponse<TData>>;
  /** Make a request with full configuration */
  request<TData = unknown>(config: HttpRequestConfig): Promise<HttpResponse<TData>>;
  /** Add request interceptor */
  addRequestInterceptor(interceptor: RequestInterceptor): () => void;
  /** Add response interceptor */
  addResponseInterceptor(interceptor: ResponseInterceptor): () => void;
  /** Add error interceptor */
  addErrorInterceptor(interceptor: ErrorInterceptor): () => void;
  /** Get current configuration */
  getConfig(): HttpClientConfig;
  /** Create a new instance with merged config */
  extend(config: HttpClientConfig): HttpClient;
}
