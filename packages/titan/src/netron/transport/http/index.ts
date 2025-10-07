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
export { HttpCacheManager } from './cache-manager.js';
export { RetryManager } from './retry-manager.js';

// Advanced features (Phase 4)
export { RequestBatcher } from './request-batcher.js';
export { SubscriptionManager } from './subscription-manager.js';
export { OptimisticUpdateManager } from './optimistic-update-manager.js';

// Type safety enhancements
export { TypedContract, TypedHttpClient, QueryBuilder, createTypedContract, createTypedClient } from './typed-contract.js';
export { TypedMiddlewarePipeline, TypedMiddlewareFactory, createTypedPipeline } from './typed-middleware.js';
export type { TypedMiddleware } from './typed-middleware.js';

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

// Export type safety types
export type {
  ContractDefinition,
  ServiceType,
  InferInput,
  InferOutput,
  ServiceProxy,
  QueryOptions,
  MiddlewareConfig
} from './typed-contract.js';
export type {
  TypedHttpMiddlewareContext,
  TypedMetadata,
  MiddlewareConfig as TypedMiddlewareConfig
} from './typed-middleware.js';

// Export advanced feature types
export type { BatchOptions, BatchStatistics } from './request-batcher.js';
export type { SubscriptionOptions, SubscriptionStats } from './subscription-manager.js';
export type { OptimisticUpdateOptions, OptimisticUpdateStats, CacheProvider } from './optimistic-update-manager.js';