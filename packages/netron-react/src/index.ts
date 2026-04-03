/**
 * @omnitron-dev/netron-react
 *
 * Production-grade React library for Netron RPC with type-safe hooks,
 * real-time subscriptions, and unified state management.
 *
 * @packageDocumentation
 */

// ============================================================================
// Core
// ============================================================================

export {
  // Client
  NetronReactClient,
  createNetronClient,

  // Provider
  NetronProvider,
  ConnectionAware,
  RequireConnection,

  // Context hooks
  useNetronClient,
  useNetronClientSafe,
  useNetronConnection,
  useDefaults,
  useHydration,

  // Types
  type NetronProviderProps,
  type ConnectionAwareProps,
  type ConnectionContextValue,
  type DefaultsContextValue,
  type HydrationContextValue,
} from './core/index.js';

// ============================================================================
// Hooks
// ============================================================================

export {
  // Data fetching
  useQuery,
  useMutation,
  useSubscription,

  // Service
  useService,
  createServiceHook,
} from './hooks/index.js';

// ============================================================================
// Types
// ============================================================================

export type {
  // Query types
  QueryKey,
  QueryStatus,
  QueryOptions,
  QueryResult,
  QueryFunctionContext,
  QueryFilters,
  Query,

  // Mutation types
  MutationStatus,
  MutationOptions,
  MutationResult,

  // Subscription types
  SubscriptionOptions,
  SubscriptionResult,

  // Stream types
  StreamOptions,
  StreamResult,

  // Infinite query types
  InfiniteQueryOptions,
  InfiniteQueryResult,

  // Client types
  NetronReactClientConfig,
  TransportType,
  CacheConfig,
  DevToolsConfig,
  SSRConfig,
  DefaultOptions,
  AuthConfig,

  // Service types
  ServiceOptions,
  ServiceMethodHooks,
  TypedServiceProxy,

  // Middleware types
  Middleware,
  MiddlewareContext,

  // Utility types
  RetryConfig,
  Unsubscribe,
  EventHandler,
  DehydratedState,
} from './core/types.js';

// ============================================================================
// Cache (for advanced usage)
// ============================================================================

export { QueryCache, MutationCache, hashQueryKey, matchQueryKey } from './cache/index.js';

// ============================================================================
// Multi-Backend Support
// ============================================================================

export {
  // Provider
  MultiBackendProvider,

  // Context hooks
  MultiBackendContext,
  MultiBackendConnectionContext,
  useMultiBackendContext,
  useMultiBackendContextSafe,
  useMultiBackendConnectionState,
  useMultiBackendConnectionStateSafe,

  // Hooks
  useMultiBackend,
  useBackend,
  useBackendConnectionState,
  useBackendService,
  useBackendQuery,
  useBackendMutation,
  useAllBackendsConnected,
  useAnyBackendConnected,

  // Components
  BackendConnectionAware,
  RequireBackendConnection,
  MultiBackendConnectionAware,
  RequireAllBackends,
  RequireAnyBackend,
  BackendStatus,
} from './multi-backend/index.js';

export type {
  // Provider types
  MultiBackendProviderProps,

  // Context types
  MultiBackendContextValue,
  BackendConnectionState,
  MultiBackendConnectionState,

  // Hook option types
  UseBackendOptions,
  UseBackendResult,
  UseBackendServiceOptions,
  BackendQueryOptions,
  BackendMutationOptions,

  // Component prop types
  BackendConnectionAwareProps,
  RequireBackendConnectionProps,
  MultiBackendConnectionAwareProps,

  // Utility types
  ExtractService,
  QualifiedServiceName,
} from './multi-backend/index.js';

// ============================================================================
// Re-exports from netron-browser for convenience
// ============================================================================

export type {
  NetronError,
  ConnectionError,
  TimeoutError,
  NetworkError,
  ServiceError,
  // Multi-backend types from netron-browser
  IMultiBackendClient,
  IBackendClient,
  BackendSchema,
  BackendConfig,
  MultiBackendClientOptions,
  TypedServiceProxy as NetronTypedServiceProxy,
} from '@omnitron-dev/netron-browser';
