/**
 * Netron Integration Types
 *
 * Re-exports from @omnitron-dev/netron-react and @omnitron-dev/netron-browser.
 * Prism consumers import everything from `@omnitron/prism/netron`.
 *
 * @module @omnitron/prism/netron
 */

export type {
  // Query
  QueryKey,
  QueryStatus,
  QueryOptions,
  QueryResult,

  // Mutation
  MutationStatus,
  MutationOptions,
  MutationResult,

  // Subscription
  SubscriptionOptions,
  SubscriptionResult,

  // Client config
  NetronReactClientConfig,
  TransportType,
  CacheConfig,
  DefaultOptions,
  AuthConfig,

  // Service
  ServiceOptions,
  ServiceMethodHooks,
  TypedServiceProxy,

  // Middleware
  Middleware,
  MiddlewareContext,

  // Utility
  RetryConfig,
  DehydratedState,
} from '@omnitron-dev/netron-react';

// Re-export error types from netron-browser (via netron-react)
export type {
  NetronError,
  // Multi-backend types
  IMultiBackendClient,
  IBackendClient,
  BackendSchema,
  BackendConfig,
  MultiBackendClientOptions,
} from '@omnitron-dev/netron-react';

// Re-export types from netron-browser
export type {
  ConnectionState,
  AuthOptions as NetronAuthOptions,
  AuthState as NetronAuthState,
  TokenStorage,
} from '@omnitron-dev/netron-browser';
