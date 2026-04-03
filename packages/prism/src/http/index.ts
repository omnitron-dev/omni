/**
 * HTTP Client Module
 *
 * Framework-agnostic HTTP client with interceptors, retry logic, and TypeScript support.
 *
 * @module @omnitron-dev/prism/http
 */

export { createHttpClient, http } from './client.js';

export type {
  HttpMethod,
  HttpHeaders,
  HttpParams,
  HttpRequestConfig,
  HttpResponse,
  HttpError,
  RequestInterceptor,
  ResponseInterceptor,
  ErrorInterceptor,
  RetryCondition,
  HttpClientConfig,
  HttpClient,
} from './types.js';
