/**
 * HTTP Transport module for Netron v2.0
 * Provides native HTTP/REST transport with enhanced capabilities
 */

// Core transport
export { HttpTransport } from './http-transport.js';

// Native implementations (v2.0)
export { HttpServer as HttpNativeServer } from './server.js';
export { HttpRemotePeer } from './peer.js';
export { HttpConnection } from './connection.js';

// Enhanced client features
export { HttpInterface as EnhancedHttpInterface } from './interface.js';
export { HttpTransportClient } from './client.js';

// Fluent interface components
export {
  FluentInterface,
  ConfigurableProxy,
  QueryBuilder,
  HttpCacheManager,
  RetryManager
} from './fluent-interface/index.js';

// Advanced features (Phase 4)
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

// Export fluent interface types
export type { QueryOptions } from './fluent-interface/index.js';
export type { CacheOptions, CacheStats } from './fluent-interface/index.js';
export type { RetryOptions, RetryStats, CircuitBreakerOptions } from './fluent-interface/index.js';

// Export advanced feature types
export type { BatchOptions, BatchStatistics } from './request-batcher.js';