/**
 * @omnitron-dev/netron-browser
 *
 * Browser-optimized Netron RPC client for seamless backend communication
 */

// Core Netron components
export {
  AbstractPeer,
  isNetronPeer,
  Definition,
  Reference,
  Interface,
  StreamReference,
  isServiceDefinition,
  isServiceReference,
  isNetronStreamReference,
  isNetronStream,
  isNetronService,
  getServiceEventName,
  getPeerEventName,
  getQualifiedName,
  detectRuntime,
  parseCommonHeaders,
  MAX_UID_VALUE,
  CONTEXTIFY_SYMBOL,
  NETRON_EVENT_SERVICE_EXPOSE,
  NETRON_EVENT_SERVICE_UNEXPOSE,
  NETRON_EVENT_PEER_CONNECT,
  NETRON_EVENT_PEER_DISCONNECT,
  CONNECT_TIMEOUT,
  REQUEST_TIMEOUT,
  DEFAULT_DEFINITION_CACHE_OPTIONS,
  TaskManager,
  DEFAULT_TASK_MANAGER_OPTIONS,
} from './core/index.js';

export type {
  IPeer,
  EventSubscriber,
  ArgumentInfo,
  MethodInfo,
  PropertyInfo,
  ServiceMetadata,
  StreamReferenceType,
  RuntimeEnvironment,
  CommonHeaders,
  DefinitionCacheOptions,
  Task,
  OverwriteStrategy,
  TaskManagerOptions,
} from './core/index.js';

// Main client exports
export { NetronClient, createClient, HttpClient, WebSocketClient } from './client/index.js';
export type { HttpClientOptions, WebSocketClientOptions, TaskHandler } from './client/index.js';

// Multi-backend client exports
export { MultiBackendClient, createMultiBackendClient, BackendClient, BackendPool } from './client/index.js';
export type { BackendClientOptions, BackendPoolOptions } from './client/index.js';

// Transport exports
export {
  WebSocketPeer,
  WebSocketConnection,
  ConnectionState as WebSocketState,
  ConnectionManager,
  ConnectionManagerState,
  ManagedConnectionState,
  DEFAULT_CONNECTION_MANAGER_CONFIG,
} from './transport/ws/index.js';
export type {
  WebSocketPeerOptions,
  WebSocketConnectionOptions,
  ConnectionManagerConfig,
  ManagedConnection,
  ConnectionPoolStats,
  ConnectionManagerEvents,
} from './transport/ws/index.js';

// Value exports (enums that need runtime values)
export { ConnectionState } from './types/index.js';

// Type exports
export type {
  NetronClientOptions,
  TransportType,
  RequestContext,
  RequestHints,
  HttpRequestMessage,
  HttpResponseMessage,
  Packet,
  PacketType,
  ConnectionMetrics,
  ServiceDescriptor,
  MethodDescriptor,
  ParameterDescriptor,
  // Multi-backend types
  MultiBackendTransportType,
  WebSocketBackendOptions,
  HttpBackendOptions,
  BackendConfig,
  RoutingPattern,
  RoutingConfig,
  SharedOptions,
  BackendSchema,
  MultiBackendClientOptions,
  InvokeOptions,
  MultiBackendMetrics,
  TypedServiceProxy,
  IBackendClient,
  IMultiBackendClient,
  ParsedServiceName,
  BackendPoolEntry,
} from './types/index.js';

// Service routing exports
export { ServiceRouter } from './routing/index.js';

// Error exports
export {
  NetronError,
  ConnectionError,
  TimeoutError,
  NetworkError,
  ProtocolError,
  ServiceError,
  MethodNotFoundError,
  InvalidArgumentsError,
  TransportError,
  SerializationError,
} from './errors/index.js';

// HTTP Transport exports (for advanced usage)
export {
  HttpRemotePeer,
  HttpCacheManager,
  RetryManager,
  FluentInterface,
  QueryBuilder,
  ConfigurableProxy,
} from './transport/http/index.js';

export type {
  CacheOptions,
  CacheStats,
  RetryOptions,
  RetryStats,
  CircuitBreakerOptions,
  QueryOptions,
} from './transport/http/index.js';

// Utility exports
export {
  generateRequestId,
  createRequestMessage,
  validateUrl,
  normalizeUrl,
  httpToWsUrl,
  isBrowser,
  isWebSocketSupported,
  isFetchSupported,
  sleep,
  calculateBackoff,
  deepClone,
  deepMerge,
  debounce,
  throttle,
  // LRU Cache
  LRUCache,
  DEFAULT_LRU_CACHE_OPTIONS,
  // Validation utilities
  isValidDefId,
  isValidPropertyName,
  isValidServiceName,
  parseQualifiedServiceName,
  createValidationError,
  validateRpcInputs,
  escapeRegex,
  createPatternRegex,
  MAX_LENGTHS,
} from './utils/index.js';

export type { LRUCacheOptions, LRUCacheStats } from './utils/index.js';

// Constants
export { NETRON_VERSION } from './types/index.js';

// Utilities
export { uuid } from './utils/uuid.js';
export { Uid } from './utils/uid.js';

// Authentication exports
export { AuthenticationClient, LocalTokenStorage, SessionTokenStorage, MemoryTokenStorage } from './auth/index.js';

export type {
  AuthCredentials,
  AuthContext,
  AuthResult,
  TokenStorage,
  AuthOptions,
  AuthState,
  AuthEventType,
  AuthEventHandler,
  RefreshConfig,
  LogoutConfig,
  InactivityConfig,
  CrossTabSyncConfig,
  SessionMetadata,
} from './auth/index.js';

// Core tasks
export {
  // Authentication
  CORE_TASK_AUTHENTICATE,
  createAuthenticateRequest,
  isAuthenticateResponse,
  // Cache invalidation
  CORE_TASK_INVALIDATE_CACHE,
  createInvalidateCacheRequest,
  isInvalidateCacheResponse,
  matchesPattern,
  // Query interface
  CORE_TASK_QUERY_INTERFACE,
  createQueryInterfaceRequest,
  isQueryInterfaceResponse,
  resolveServiceName,
  isFilteredDefinition,
  // Event handling
  CORE_TASK_EMIT,
  emit,
  isEmitCapablePeer,
  CORE_TASK_SUBSCRIBE,
  CORE_TASK_UNSUBSCRIBE,
  subscribe,
  unsubscribe,
  cleanupSubscriptions,
  createSubscribeRequest,
  isSubscribeResponse,
  // Service management
  CORE_TASK_UNEXPOSE_SERVICE,
  CORE_TASK_UNREF_SERVICE,
  CORE_TASK_EXPOSE_SERVICE,
  unexpose_service,
  unref_service,
  isServiceExposed,
  getExposedServiceNames,
  createUnexposeServiceRequest,
  isUnexposeServiceResponse,
  createUnrefServiceRequest,
  isUnrefServiceResponse,
} from './core-tasks/index.js';

export type {
  AuthenticateRequest,
  AuthenticateResponse,
  InvalidateCacheRequest,
  InvalidateCacheResponse,
  QueryInterfaceRequest,
  QueryInterfaceResponse,
  EmitCapablePeer,
  SubscribableLocalPeer,
  TaskRunnablePeer,
  SubscriptionContext,
  SubscribeRequest,
  SubscribeResponse,
  ServiceManagingPeer,
  UnexposeServiceRequest,
  UnexposeServiceResponse,
  UnrefServiceRequest,
  UnrefServiceResponse,
} from './core-tasks/index.js';

// Middleware exports
export {
  MiddlewarePipeline,
  MiddlewareStage,
  createAuthMiddleware,
  createLoggingMiddleware,
  createTimingMiddleware,
  createErrorTransformMiddleware,
  SimpleTokenProvider,
  StorageTokenProvider,
  InMemoryMetricsCollector,
  ConsoleLogger,
  defaultErrorTransformer,
  CommonErrorMessages,
  isRetryableError,
  isClientError,
  isServerError,
} from './middleware/index.js';

export type {
  MiddlewareFunction,
  ClientMiddlewareContext,
  MiddlewareConfig,
  MiddlewareRegistration,
  MiddlewareMetrics,
  IMiddlewareManager,
  TokenProvider,
  AuthMiddlewareOptions,
  Logger,
  LogLevel,
  LoggingMiddlewareOptions,
  MetricsCollector,
  PerformanceMetrics,
  TimingMiddlewareOptions,
  ErrorTransformMiddlewareOptions,
  NormalizedError,
  ErrorTransformer,
  ErrorHandler,
} from './middleware/index.js';
