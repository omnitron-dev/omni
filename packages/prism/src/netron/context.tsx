'use client';

/**
 * Netron React Context — Prism wrapper
 *
 * Re-exports and extends @omnitron-dev/netron-react provider and hooks.
 * All Prism consumers use these — zero boilerplate, full type safety.
 *
 * @module @omnitron-dev/prism/netron
 */

// Re-export everything from netron-react core
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
} from '@omnitron-dev/netron-react';

// Re-export auth module
export {
  AuthProvider,
  useAuth,
  useAuthRequired,
  useUser,
  useIsAuthenticated,
  AuthGuard,
  RoleGuard,
  PermissionGuard,
  GuestGuard,
  Show,
  Hide,
  type AuthProviderProps,
  type AuthContextValue,
  type AuthState,
  type User,
  type AuthGuardProps,
  type RoleGuardProps,
  type PermissionGuardProps,
  type GuestGuardProps,
} from '@omnitron-dev/netron-react/auth';

// Re-export cache utilities
export { QueryCache, MutationCache, hashQueryKey, matchQueryKey } from '@omnitron-dev/netron-react/cache';

// Re-export multi-backend support
export {
  MultiBackendProvider,
  useMultiBackend,
  useBackend,
  useBackendConnectionState,
  useBackendService,
  useBackendQuery,
  useBackendMutation,
  useAllBackendsConnected,
  useAnyBackendConnected,
  BackendConnectionAware,
  RequireBackendConnection,
  MultiBackendConnectionAware,
  RequireAllBackends,
  RequireAnyBackend,
  BackendStatus,
  type MultiBackendProviderProps,
} from '@omnitron-dev/netron-react';

// Re-export multi-backend client factory from netron-browser
export { createMultiBackendClient, MultiBackendClient } from '@omnitron-dev/netron-browser';

// Re-export authentication client for per-backend JWT auth
export { AuthenticationClient, SessionTokenStorage } from '@omnitron-dev/netron-browser';

// Re-export WebSocket client for direct realtime connections
export { WebSocketClient } from '@omnitron-dev/netron-browser';
