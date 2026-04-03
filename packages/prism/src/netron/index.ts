/**
 * Netron Integration
 *
 * Complete Netron RPC integration for React apps built with Prism.
 * Wraps @omnitron-dev/netron-react (which uses @omnitron-dev/netron-browser).
 *
 * Single-Backend Setup:
 * ```tsx
 * import { createNetronClient, NetronProvider, useNetronService } from '@omnitron-dev/prism/netron';
 *
 * const client = createNetronClient({ transport: 'http', url: '/api/main' });
 *
 * <NetronProvider client={client}>
 *   <App />
 * </NetronProvider>
 * ```
 *
 * Multi-Backend Setup:
 * ```tsx
 * import { createMultiBackendClient, MultiBackendProvider, useBackendService } from '@omnitron-dev/prism/netron';
 *
 * const client = createMultiBackendClient({
 *   baseUrl: '',
 *   backends: {
 *     main: { path: '/api/main' },
 *     storage: { path: '/api/storage' },
 *   },
 *   defaultBackend: 'main',
 * });
 *
 * <MultiBackendProvider client={client} autoConnect>
 *   <App />
 * </MultiBackendProvider>
 *
 * // In components:
 * const auth = useBackendService<IAuthService>('main', 'Auth@1.0.0');
 * const { data } = auth.validateSession.useQuery([sessionId]);
 * ```
 *
 * @module @omnitron-dev/prism/netron
 */

// Types
export type {
  ConnectionState,
  QueryKey,
  QueryStatus,
  QueryOptions,
  QueryResult,
  MutationStatus,
  MutationOptions,
  MutationResult,
  SubscriptionOptions,
  SubscriptionResult,
  NetronReactClientConfig,
  TransportType,
  CacheConfig,
  DefaultOptions,
  AuthConfig,
  ServiceOptions,
  ServiceMethodHooks,
  TypedServiceProxy,
  Middleware,
  MiddlewareContext,
  RetryConfig as NetronRetryConfig,
  DehydratedState,
  NetronError,
  // Multi-backend types
  IMultiBackendClient,
  IBackendClient,
  BackendSchema,
  BackendConfig,
  MultiBackendClientOptions,
} from './types.js';

// Context, Provider, Client, Auth, Guards, Multi-Backend
export {
  // Client (single-backend)
  NetronReactClient,
  createNetronClient,

  // Client (multi-backend)
  createMultiBackendClient,
  MultiBackendClient,

  // Provider (single-backend)
  NetronProvider,
  ConnectionAware,
  RequireConnection,
  type NetronProviderProps,
  type ConnectionAwareProps,
  type ConnectionContextValue,
  type DefaultsContextValue,
  type HydrationContextValue,

  // Context hooks
  useNetronClient,
  useNetronClientSafe,
  useNetronConnection,
  useDefaults,
  useHydration,

  // Auth
  AuthProvider,
  useAuth,
  useAuthRequired,
  useUser,
  useIsAuthenticated,
  type AuthProviderProps,
  type AuthContextValue as NetronAuthContextValue,
  type AuthState as NetronAuthState,
  type User,

  // Guards
  AuthGuard,
  RoleGuard,
  PermissionGuard,
  GuestGuard,
  Show,
  Hide,
  type AuthGuardProps,
  type RoleGuardProps,
  type PermissionGuardProps,
  type GuestGuardProps,

  // Auth (per-backend token management)
  AuthenticationClient,
  SessionTokenStorage,

  // WebSocket client for direct realtime connections
  WebSocketClient,

  // Cache
  QueryCache,
  MutationCache,
  hashQueryKey,
  matchQueryKey,

  // Multi-Backend Provider & Hooks
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
} from './context.js';

// Hooks
export {
  useNetronQuery,
  useNetronMutation,
  useNetronSubscription,
  useNetronService,
  createNetronServiceHook,
} from './hooks.js';
