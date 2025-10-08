/**
 * HTTP Transport module for Netron v2.0 - Browser Client
 * Provides native HTTP/REST transport with enhanced client capabilities
 *
 * Unified API compatible with Titan backend:
 * - HttpInterface: Simple RPC proxy (queryInterface)
 * - FluentInterface: Advanced HTTP features (queryFluentInterface)
 */

// Native client implementations
export { HttpRemotePeer } from './peer.js';
export { HttpConnection } from './connection.js';

// Core interfaces
export { HttpInterface } from './interface.js';
export { FluentInterface } from './fluent-interface.js';
export { ConfigurableProxy } from './configurable-proxy.js';

// Enhanced client features
export { HttpTransportClient } from './client.js';
export { HttpCacheManager } from './cache-manager.js';
export { RetryManager } from './retry-manager.js';

// Advanced features
export { RequestBatcher } from './request-batcher.js';

// Message types
export * from './types.js';

// Re-export transport types
export type {
  ITransport,
  ITransportConnection,
  ITransportServer,
  TransportCapabilities,
  TransportOptions,
  TransportAddress,
  ConnectionState,
  ServerMetrics
} from '../types.js';

// Export QueryOptions type
export type { QueryOptions } from './query-builder.js';

// Export cache and retry types
export type { CacheOptions } from './cache-manager.js';
export type { RetryOptions } from './retry-manager.js';

// Export advanced feature types
export type { BatchOptions, BatchStatistics } from './request-batcher.js';
