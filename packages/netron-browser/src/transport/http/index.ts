/**
 * HTTP Transport for Netron Browser Client
 *
 * Exports all HTTP transport components for browser usage
 */

// Core HTTP transport components
export { HttpConnection } from './connection.js';
export { HttpRemotePeer } from './peer.js';
export { HttpTransportClient } from './client.js';
export { HttpInterface } from './interface.js';

// HTTP message types and utilities
export {
  type HttpRequestMessage,
  type HttpResponseMessage,
  type HttpRequestContext,
  type HttpRequestHints,
  type HttpResponseHints,
  type HttpResponseError,
  type HttpBatchRequest,
  type HttpBatchResponse,
  createRequestMessage,
  createSuccessResponse,
  createErrorResponse,
  generateRequestId,
} from './types.js';

// Request batcher
export { RequestBatcher } from './request-batcher.js';

// Fluent interface and advanced features
export {
  FluentInterface,
  HttpCacheManager,
  RetryManager,
  QueryBuilder,
  ConfigurableProxy,
  type CacheOptions,
  type CacheStats,
  type RetryOptions,
  type RetryStats,
  type CircuitBreakerOptions,
  type QueryOptions,
} from './fluent-interface/index.js';
