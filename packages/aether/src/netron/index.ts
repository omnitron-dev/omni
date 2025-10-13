/**
 * @fileoverview Netron module exports
 * @module @omnitron-dev/aether/netron
 */

// Core client
export { NetronClient } from './client.js';

// Module
export { NetronModule } from './module.js';
export type { NetronModuleConfig } from './module.js';

// Decorators
export { Backend, Service, getBackendName, getServiceName } from './decorators/index.js';

// Hooks
export {
  useQuery,
  useQueries,
  usePaginatedQuery,
  useInfiniteQuery,
  useMutation,
  useOptimisticMutation,
  useMutations,
  useStream,
  useMultiStream,
  useBroadcast,
} from './hooks/index.js';

// Base classes
export { NetronService, NetronStore } from './base/index.js';

// DI Tokens
export {
  BACKEND_CONFIG,
  CACHE_MANAGER,
  RETRY_MANAGER,
  BACKEND_REGISTRY,
  DEFAULT_BACKEND,
  NETRON_METADATA,
} from './tokens.js';

// Types
export type {
  // Backend configuration
  BackendConfig,
  BackendOptions,
  CacheConfig,
  RetryConfig,
  CircuitBreakerConfig,

  // Query types
  QueryOptions,
  QueryResult,

  // Mutation types
  MutationOptions,
  MutationResult,

  // Stream types
  StreamOptions,
  StreamResult,

  // Service types
  INetronService,
  INetronStore,

  // Utility types
  Type,
  Signal,
  WritableSignal,
  MethodParameters,
  MethodReturnType,
} from './types.js';

// Re-export netron-browser for advanced usage
export * as NetronBrowser from '@omnitron-dev/netron-browser';