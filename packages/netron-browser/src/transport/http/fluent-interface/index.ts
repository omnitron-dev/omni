/**
 * Fluent Interface Module for Netron HTTP Transport - Browser
 *
 * Provides chainable, natural method calls with integrated caching,
 * retries, and query building capabilities.
 */

// Main fluent interface
export { FluentInterface } from './fluent-interface.js';

// Supporting components
export { HttpCacheManager, type CacheOptions, type CacheStats } from './cache-manager.js';
export { RetryManager, type RetryOptions, type RetryStats, type CircuitBreakerOptions } from './retry-manager.js';
export { QueryBuilder, type QueryOptions } from './query-builder.js';
export { ConfigurableProxy } from './configurable-proxy.js';
