/**
 * Core module exports
 */

// Client
export { NetronReactClient, createNetronClient } from './client.js';

// Provider
export {
  NetronProvider,
  ConnectionAware,
  RequireConnection,
  type NetronProviderProps,
  type ConnectionAwareProps,
} from './provider.js';

// Context
export {
  NetronContext,
  ConnectionContext,
  DefaultsContext,
  HydrationContext,
  useNetronClient,
  useNetronClientSafe,
  useNetronConnection,
  useDefaults,
  useHydration,
  type ConnectionContextValue,
  type DefaultsContextValue,
  type HydrationContextValue,
} from './context.js';

// Types
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
} from './types.js';
