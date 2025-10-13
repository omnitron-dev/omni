/**
 * @fileoverview Netron integration types for Aether
 * @module @omnitron-dev/aether/netron
 */

import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import type { CacheOptions, RetryOptions } from '@omnitron-dev/netron-browser';

// Re-export for convenience
export type { Signal, WritableSignal };

// Re-export types from netron-browser for convenience
export type {
  HttpRemotePeer,
  FluentInterface,
  HttpCacheManager,
  RetryManager,
  CacheOptions,
  RetryOptions,
} from '@omnitron-dev/netron-browser';

/**
 * Backend configuration
 */
export interface BackendConfig {
  /** Backend URLs or configurations */
  backends?: Record<string, string | BackendOptions>;

  /** Simple single backend URL (shorthand) */
  baseUrl?: string;

  /** Default backend name */
  default?: string;

  /** Global cache configuration */
  cache?: CacheConfig;

  /** Global retry configuration */
  retry?: RetryConfig;

  /** Global request headers */
  headers?: Record<string, string>;

  /** Global request timeout */
  timeout?: number;
}

export interface BackendOptions {
  /** Base URL */
  url: string;

  /** Cache configuration for this backend */
  cache?: CacheConfig;

  /** Retry configuration for this backend */
  retry?: RetryConfig;

  /** Request headers for this backend */
  headers?: Record<string, string>;

  /** Request timeout for this backend */
  timeout?: number;
}

export interface CacheConfig {
  /** Maximum number of cache entries */
  maxEntries?: number;

  /** Maximum cache size in bytes */
  maxSizeBytes?: number;

  /** Default max age for cache entries (ms) */
  defaultMaxAge?: number;

  /** Enable debug logging */
  debug?: boolean;
}

export interface RetryConfig {
  /** Number of retry attempts */
  attempts?: number;

  /** Backoff strategy */
  backoff?: 'exponential' | 'linear' | 'constant';

  /** Initial delay (ms) */
  initialDelay?: number;

  /** Maximum delay (ms) */
  maxDelay?: number;

  /** Jitter factor (0-1) */
  jitter?: number;

  /** Circuit breaker configuration */
  circuitBreaker?: {
    threshold: number;
    windowTime: number;
    cooldownTime: number;
  };
}

/**
 * Query options
 */
export interface QueryOptions {
  /** Caching options */
  cache?: CacheOptions | number;

  /** Retry options */
  retry?: RetryOptions | number;

  /** Request timeout */
  timeout?: number;

  /** Request priority */
  priority?: 'high' | 'normal' | 'low';

  /** Transform response */
  transform?: <T, R>(data: T) => R;

  /** Validate response */
  validate?: <T>(data: T) => boolean | Promise<boolean>;

  /** Fallback data on error */
  fallback?: any;

  /** Metrics callback */
  metrics?: (timing: { duration: number; cacheHit?: boolean }) => void;

  /** Refetch on mount */
  refetchOnMount?: boolean;

  /** Refetch on window focus */
  refetchOnFocus?: boolean;

  /** Refetch interval (ms) */
  refetchInterval?: number;

  /** Enable query */
  enabled?: boolean;
}

/**
 * Mutation options
 */
export interface MutationOptions<TData = any, TVariables = any> {
  /** Optimistic update function */
  optimistic?: (variables: TVariables) => TData;

  /** Cache tags to invalidate */
  invalidate?: string[];

  /** Success callback */
  onSuccess?: (data: TData) => void | Promise<void>;

  /** Error callback */
  onError?: (error: Error) => void | Promise<void>;

  /** Settled callback (success or error) */
  onSettled?: () => void | Promise<void>;

  /** Retry options */
  retry?: RetryOptions | number;
}

/**
 * Stream options
 */
export interface StreamOptions {
  /** Initial value */
  initialValue?: any;

  /** Auto-connect on mount */
  autoConnect?: boolean;

  /** Buffer size for accumulated data */
  bufferSize?: number;

  /** Enable reconnection on disconnect */
  reconnect?: boolean;

  /** Reconnect delay (ms) */
  reconnectDelay?: number;

  /** Maximum reconnect delay (ms) */
  reconnectMaxDelay?: number;

  /** Throttle data emissions (ms) */
  throttle?: number;

  /** Filter data before accumulating */
  filter?: (value: any) => boolean;

  /** Callback when data is received */
  onData?: (data: any) => void;

  /** Callback when error occurs */
  onError?: (error: Error) => void;

  /** Callback when connected */
  onConnect?: () => void;

  /** Callback when disconnected */
  onDisconnect?: () => void;

  /** Callback when stream completes */
  onComplete?: () => void;

  /** Auto-reconnect on disconnect (deprecated, use 'reconnect') */
  autoReconnect?: boolean;

  /** Maximum reconnect attempts */
  maxReconnectAttempts?: number;
}

/**
 * Query result
 */
export interface QueryResult<TData = any> {
  /** Data signal */
  data: Signal<TData | undefined>;

  /** Loading state signal */
  loading: Signal<boolean>;

  /** Error signal */
  error: Signal<Error | undefined>;

  /** Refetch function */
  refetch: () => Promise<void>;

  /** Is fetching in background */
  isFetching: Signal<boolean>;

  /** Is data stale */
  isStale: Signal<boolean>;
}

/**
 * Mutation result
 */
export interface MutationResult<TData = any, TVariables = any> {
  /** Mutate function */
  mutate: (variables: TVariables) => Promise<TData>;

  /** Async mutate function (returns void) */
  mutateAsync: (variables: TVariables) => void;

  /** Loading state signal */
  loading: Signal<boolean>;

  /** Error signal */
  error: Signal<Error | undefined>;

  /** Data signal (last successful result) */
  data: Signal<TData | undefined>;

  /** Reset mutation state */
  reset: () => void;
}

/**
 * Stream connection status
 */
export type StreamStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * Stream result
 */
export interface StreamResult<TData = any> {
  /** Data signal (accumulated array of values) */
  data: Signal<TData[]>;

  /** Error signal */
  error: Signal<Error | undefined>;

  /** Get connection status */
  status: () => StreamStatus;

  /** Check if reconnecting */
  isReconnecting: () => boolean;

  /** Manually connect to stream */
  connect: () => Promise<void>;

  /** Disconnect from stream */
  disconnect: () => void;

  /** Clear buffered data */
  clear: () => void;
}

/**
 * Type helper for extracting service interface
 */
export type ServiceInterface<T> = T extends NetronService<infer I> ? I : never;

/**
 * Type helper for extracting method parameters
 */
export type MethodParameters<T, K extends keyof T> = T[K] extends (...args: infer P) => any ? P : never;

/**
 * Type helper for extracting method return type
 */
export type MethodReturnType<T, K extends keyof T> = T[K] extends (...args: any[]) => infer R
  ? R extends Promise<infer U>
    ? U
    : R
  : never;

/**
 * Base interface for netron services
 */
export interface INetronService<T = any> {
  /** Get the service interface */
  getService(): Promise<T>;
}

/**
 * Base interface for netron stores
 */
export interface INetronStore<T = any> extends INetronService<T> {
  /** Query method helper */
  query<K extends keyof T>(
    method: K,
    args: MethodParameters<T, K>,
    options?: QueryOptions
  ): Promise<MethodReturnType<T, K>>;

  /** Mutation method helper */
  mutate<K extends keyof T>(
    method: K,
    args: MethodParameters<T, K>,
    options?: MutationOptions
  ): Promise<MethodReturnType<T, K>>;
}

/**
 * Module with providers type
 */
export interface ModuleWithProviders {
  module: any;
  providers: any[];
}

/**
 * Type for classes (constructors)
 */
export interface Type<T = any> {
  new (...args: any[]): T;
}

/**
 * Decorator for NetronService classes
 */
export abstract class NetronService<T> implements INetronService<T> {
  abstract getService(): Promise<T>;
}

/**
 * Decorator for NetronStore classes
 */
export abstract class NetronStore<T> implements INetronStore<T> {
  abstract getService(): Promise<T>;
  abstract query<K extends keyof T>(
    method: K,
    args: MethodParameters<T, K>,
    options?: QueryOptions
  ): Promise<MethodReturnType<T, K>>;
  abstract mutate<K extends keyof T>(
    method: K,
    args: MethodParameters<T, K>,
    options?: MutationOptions
  ): Promise<MethodReturnType<T, K>>;
}
