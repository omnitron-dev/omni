/**
 * Retry Manager — re-export shim (browser).
 *
 * SHARED-HTTP-CORE: the implementation now lives in @omnitron-dev/netron-http-core
 * (single source of truth shared with @omnitron-dev/titan). This module is kept
 * as a stable import path for existing consumers (query-builder, configurable-proxy).
 */
export { RetryManager } from '@omnitron-dev/netron-http-core';
export type { RetryOptions, RetryStats, CircuitBreakerOptions } from '@omnitron-dev/netron-http-core';
