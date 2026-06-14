/**
 * HTTP Cache Manager — re-export shim.
 *
 * SHARED-HTTP-CORE: the implementation now lives in @omnitron-dev/netron-http-core
 * (single source of truth shared with netron-browser). This module is kept as a
 * stable import path for existing consumers (query-builder, configurable-proxy).
 */
export { HttpCacheManager } from '@omnitron-dev/netron-http-core';
export type { CacheOptions, CacheStats, HttpCoreLogger } from '@omnitron-dev/netron-http-core';
