/**
 * @omnitron-dev/netron-http-core
 *
 * Shared, environment-neutral HTTP fluent-interface primitives consumed by both
 * @omnitron-dev/titan and @omnitron-dev/netron-browser. Single source of truth
 * for the cache/retry/query/batcher building blocks (SHARED-HTTP-CORE).
 */

export type { HttpCoreLogger } from './logger.js';
export { HttpCacheManager } from './cache-manager.js';
export type { CacheOptions, CacheStats } from './cache-manager.js';
export { RetryManager } from './retry-manager.js';
export type { RetryOptions, RetryStats, CircuitBreakerOptions } from './retry-manager.js';
export { QueryBuilder } from './query-builder.js';
export type { QueryOptions } from './query-builder.js';
export { ConfigurableProxy } from './configurable-proxy.js';
export type {
  HttpRequestContext,
  HttpRequestHints,
  HttpRequestMessage,
  IHttpRequestExecutor,
} from './http-types.js';
