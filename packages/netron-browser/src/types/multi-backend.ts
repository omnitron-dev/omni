/**
 * Multi-Backend Client Type Definitions
 *
 * Type system for managing multiple backend connections through an API gateway.
 * Supports HTTP and WebSocket transports with flexible routing and shared middleware.
 *
 * @module types/multi-backend
 */

import type { AuthenticationClient } from '../auth/client.js';
import type { AuthOptions } from '../auth/types.js';
import {
  type MiddlewareConfig,
  type MiddlewareFunction,
  type IMiddlewareManager,
  MiddlewareStage,
} from '../middleware/types.js';
import type { ConnectionMetrics, RequestContext, RequestHints } from './index.js';

/**
 * Transport type for backend connections
 */
export type TransportType = 'http' | 'websocket';

/**
 * WebSocket-specific backend options
 */
export interface WebSocketBackendOptions {
  /**
   * WebSocket protocols
   */
  protocols?: string | string[];

  /**
   * Enable automatic reconnection
   * @default true
   */
  reconnect?: boolean;

  /**
   * Reconnection interval in milliseconds
   * @default 1000
   */
  reconnectInterval?: number;

  /**
   * Maximum reconnection attempts
   * @default Infinity
   */
  maxReconnectAttempts?: number;
}

/**
 * HTTP-specific backend options
 */
export interface HttpBackendOptions {
  /**
   * Enable retry mechanism
   * @default false
   */
  retry?: boolean;

  /**
   * Maximum retry attempts
   * @default 3
   */
  maxRetries?: number;

  /**
   * Enable response caching
   * @default false
   */
  caching?: boolean;

  /**
   * Cache TTL in milliseconds
   * @default 60000
   */
  cacheTTL?: number;

  /**
   * Enable request batching
   * @default false
   */
  batching?: boolean;
}

/**
 * Configuration for a single backend
 */
export interface BackendConfig {
  /**
   * Path prefix for this backend (e.g., '/core', '/storage')
   * Will be prepended to all Netron endpoints
   */
  path: string;

  /**
   * Transport type for this backend
   * @default 'http'
   */
  transport?: TransportType;

  /**
   * Override shared timeout for this backend (in milliseconds)
   */
  timeout?: number;

  /**
   * Additional headers for this backend
   */
  headers?: Record<string, string>;

  /**
   * WebSocket-specific options (when transport: 'websocket')
   */
  websocket?: WebSocketBackendOptions;

  /**
   * HTTP-specific options (when transport: 'http')
   */
  http?: HttpBackendOptions;

  /**
   * Per-backend authentication client.
   * Overrides `shared.auth` for this specific backend.
   *
   * Can be either a pre-configured AuthenticationClient instance,
   * or AuthOptions to create one automatically.
   *
   * @example
   * ```typescript
   * // Pre-configured client
   * const storageAuth = new AuthenticationClient({ storageKey: 'storage_token' });
   * backends: {
   *   storage: { path: '/storage', auth: storageAuth },
   * }
   * ```
   */
  auth?: AuthenticationClient | AuthOptions;
}

/**
 * Pattern-based routing rule
 */
export interface RoutingPattern {
  /**
   * Service name pattern (string prefix or RegExp)
   */
  pattern: string | RegExp;

  /**
   * Target backend name
   */
  backend: string;
}

/**
 * Service routing configuration
 */
export interface RoutingConfig {
  /**
   * Pattern-based routing rules
   * Evaluated in order, first match wins
   */
  patterns?: RoutingPattern[];

  /**
   * Explicit service-to-backend mappings
   * Takes precedence over patterns
   */
  services?: Record<string, string>;
}

/**
 * Shared options applied to all backends
 */
export interface SharedOptions {
  /**
   * Default request timeout in milliseconds
   * @default 30000
   */
  timeout?: number;

  /**
   * Headers to include in all backend requests
   */
  headers?: Record<string, string>;

  /**
   * Authentication client for automatic token attachment
   */
  auth?: AuthenticationClient;

  /**
   * Middleware configurations applied to all backends
   */
  middleware?: MiddlewareConfig[];
}

/**
 * Backend schema type for type-safe backend and service access
 *
 * @example
 * ```typescript
 * interface MyBackendSchema {
 *   core: {
 *     users: UserService;
 *     auth: AuthService;
 *   };
 *   storage: {
 *     files: FileService;
 *   };
 * }
 * ```
 */
export interface BackendSchema {
  [backendName: string]: {
    [serviceName: string]: object;
  };
}

/**
 * Options for creating a multi-backend client
 */
export interface MultiBackendClientOptions<T extends BackendSchema = BackendSchema> {
  /**
   * Base URL for API gateway (e.g., 'https://api.example.com')
   */
  baseUrl: string;

  /**
   * Backend configurations keyed by backend name
   */
  backends: { [K in keyof T]: BackendConfig };

  /**
   * Default backend for unqualified service names
   * @default first backend in config
   */
  defaultBackend?: keyof T & string;

  /**
   * Service routing rules (optional)
   */
  routing?: RoutingConfig;

  /**
   * Shared options applied to all backends
   */
  shared?: SharedOptions;
}

/**
 * Options for invoking a service method
 */
export interface InvokeOptions {
  /**
   * Request context (user ID, session, etc.)
   */
  context?: RequestContext;

  /**
   * Request hints (timeout, caching, etc.)
   */
  hints?: RequestHints;

  /**
   * Override timeout for this request
   */
  timeout?: number;

  /**
   * Skip automatic auth header attachment for this request.
   * Useful for unauthenticated endpoints like session refresh,
   * where the current token may be expired.
   */
  skipAuth?: boolean;
}

/**
 * Aggregated metrics across all backends
 */
export interface MultiBackendMetrics {
  /**
   * Per-backend metrics
   */
  backends: Record<string, ConnectionMetrics>;

  /**
   * Total requests sent across all backends
   */
  totalRequestsSent: number;

  /**
   * Total responses received across all backends
   */
  totalResponsesReceived: number;

  /**
   * Total errors across all backends
   */
  totalErrors: number;

  /**
   * Average latency across all backends (milliseconds)
   */
  avgLatency: number;
}

/**
 * Typed service proxy for method invocation
 * Allows type-safe method calls on remote services
 */
export type TypedServiceProxy<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => R extends Promise<any> ? R : Promise<R>
    : never;
};

/**
 * Backend client interface for single backend operations
 * @typeParam T - Service schema type for this backend
 */
export interface IBackendClient<T = unknown> {
  /**
   * Phantom property to preserve type parameter T for type inference
   * @internal
   */
  readonly __serviceSchema?: T;

  /**
   * Get a typed service proxy for this backend
   *
   * @param serviceName - Name of the service to access
   * @returns Typed service proxy for method invocation
   *
   * @example
   * ```typescript
   * const users = backend.service<UserService>('users');
   * const user = await users.getById('123');
   * ```
   */
  service<S>(serviceName: string): TypedServiceProxy<S>;

  /**
   * Invoke a service method on this backend
   *
   * @param service - Service name
   * @param method - Method name
   * @param args - Method arguments
   * @param options - Invoke options
   * @returns Promise resolving to method result
   */
  invoke<R = any>(service: string, method: string, args?: any[], options?: InvokeOptions): Promise<R>;

  /**
   * Get metrics for this backend
   */
  getMetrics(): ConnectionMetrics;

  /**
   * Check if this backend is connected
   */
  isConnected(): boolean;

  /**
   * Get the path prefix for this backend
   */
  getPath(): string;

  /**
   * Get the transport type for this backend
   */
  getTransportType(): TransportType;
}

/**
 * Multi-backend client interface
 */
export interface IMultiBackendClient<T extends BackendSchema = BackendSchema> {
  /**
   * Get a specific backend client
   *
   * @param name - Backend name
   * @returns Backend client instance
   *
   * @example
   * ```typescript
   * const coreBackend = client.backend('core');
   * const users = coreBackend.service<UserService>('users');
   * ```
   */
  backend<K extends keyof T>(name: K): IBackendClient<T[K]>;

  /**
   * Get a service with automatic backend routing
   * Uses routing config to determine backend
   *
   * @param serviceName - Service name (can be qualified as 'backend.service')
   * @returns Typed service proxy
   *
   * @example
   * ```typescript
   * // With routing config
   * const users = client.service<UserService>('users');
   *
   * // With qualified name
   * const users = client.service<UserService>('core.users');
   * ```
   */
  service<S>(serviceName: string): TypedServiceProxy<S>;

  /**
   * Direct invoke with explicit backend
   *
   * @param backend - Backend name
   * @param service - Service name
   * @param method - Method name
   * @param args - Method arguments
   * @param options - Invoke options
   * @returns Promise resolving to method result
   */
  invoke<R = any>(backend: string, service: string, method: string, args?: any[], options?: InvokeOptions): Promise<R>;

  /**
   * Get aggregated metrics across all backends
   */
  getMetrics(): MultiBackendMetrics;

  /**
   * Check if specific backend is connected
   *
   * @param backend - Backend name (optional, checks all if not provided)
   * @returns true if connected
   */
  isConnected(backend?: string): boolean;

  /**
   * Connect to specific or all backends
   *
   * @param backend - Backend name (optional, connects all if not provided)
   */
  connect(backend?: string): Promise<void>;

  /**
   * Disconnect from specific or all backends
   *
   * @param backend - Backend name (optional, disconnects all if not provided)
   */
  disconnect(backend?: string): Promise<void>;

  /**
   * Get shared middleware manager
   */
  getMiddleware(): IMiddlewareManager;

  /**
   * Add middleware to the shared pipeline
   */
  use(middleware: MiddlewareFunction, config?: Partial<MiddlewareConfig>, stage?: MiddlewareStage): this;

  /**
   * Destroy client and release all resources
   */
  destroy(): Promise<void>;
}

/**
 * Result of parsing a qualified service name
 */
export interface ParsedServiceName {
  /**
   * Backend name (if specified)
   */
  backend?: string;

  /**
   * Service name
   */
  service: string;
}

/**
 * Backend pool entry for managing backend instances
 */
export interface BackendPoolEntry {
  /**
   * Backend name
   */
  name: string;

  /**
   * Backend configuration
   */
  config: BackendConfig;

  /**
   * Transport client instance (lazy-initialized)
   */
  client?: unknown;

  /**
   * Connection state
   */
  connected: boolean;

  /**
   * Last health check timestamp
   */
  lastHealthCheck?: number;

  /**
   * Health check status
   */
  healthy: boolean;
}
