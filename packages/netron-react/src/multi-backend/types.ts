/**
 * Multi-Backend React Types
 *
 * Type definitions for multi-backend React integration with netron-browser.
 * Provides type-safe hooks and components for managing multiple backend connections.
 *
 * @module multi-backend/types
 */

import type { ReactNode } from 'react';
import type {
  IMultiBackendClient,
  IBackendClient,
  BackendSchema,
  TypedServiceProxy,
  NetronError,
} from '@omnitron-dev/netron-browser';
import type { QueryOptions, QueryResult, MutationOptions, MutationResult, ServiceOptions } from '../core/types.js';

// ============================================================================
// Provider Types
// ============================================================================

/**
 * Props for MultiBackendProvider component
 */
export interface MultiBackendProviderProps<T extends BackendSchema = BackendSchema> {
  /** Multi-backend client instance */
  client: IMultiBackendClient<T>;
  /** Children */
  children: ReactNode;
  /** Auto-connect on mount */
  autoConnect?: boolean;
  /** Connect timeout in milliseconds */
  connectTimeout?: number;
  /** Callback when a backend connects */
  onConnect?: (backend: string) => void;
  /** Callback when a backend disconnects */
  onDisconnect?: (backend: string) => void;
  /** Callback on backend error */
  onError?: (backend: string, error: Error) => void;
}

// ============================================================================
// Context Types
// ============================================================================

/**
 * Context value for multi-backend access
 */
export interface MultiBackendContextValue<T extends BackendSchema = BackendSchema> {
  /** The multi-backend client */
  client: IMultiBackendClient<T>;
  /** Get a specific backend client */
  getBackend: <K extends keyof T>(name: K) => IBackendClient<T[K]>;
  /** All backend names */
  backendNames: string[];
  /** Check if specific backend is connected (or all if not specified) */
  isConnected: (backend?: string) => boolean;
  /** Connect to backend(s) */
  connect: (backend?: string) => Promise<void>;
  /** Disconnect from backend(s) */
  disconnect: (backend?: string) => Promise<void>;
}

/**
 * Connection state for a single backend
 */
export interface BackendConnectionState {
  /** Backend name */
  name: string;
  /** Is connected */
  isConnected: boolean;
  /** Is connecting */
  isConnecting: boolean;
  /** Error if any */
  error: Error | null;
}

/**
 * Aggregated connection state for all backends
 */
export interface MultiBackendConnectionState {
  /** Per-backend connection states */
  backends: Map<string, BackendConnectionState>;
  /** All backends connected */
  allConnected: boolean;
  /** Any backend connected */
  anyConnected: boolean;
  /** Any backend connecting */
  anyConnecting: boolean;
  /** Global error (if any) */
  globalError: Error | null;
}

// ============================================================================
// Hook Types
// ============================================================================

/**
 * Options for useBackend hook
 */
export interface UseBackendOptions {
  /** Auto-connect if not connected */
  autoConnect?: boolean;
}

/**
 * Result from useBackend hook
 */
export interface UseBackendResult<T = unknown> {
  /** Backend client instance */
  client: IBackendClient<T>;
  /** Is connected */
  isConnected: boolean;
  /** Is connecting */
  isConnecting: boolean;
  /** Error if any */
  error: Error | null;
  /** Connect to this backend */
  connect: () => Promise<void>;
  /** Disconnect from this backend */
  disconnect: () => Promise<void>;
}

/**
 * Options for useBackendService hook
 */
export interface UseBackendServiceOptions extends ServiceOptions {
  /** Auto-connect to backend if not connected */
  autoConnect?: boolean;
}

/**
 * Options for useBackendQuery hook
 * Extends standard QueryOptions but requires backendName context
 */
export interface BackendQueryOptions<TData = unknown, TError = NetronError> extends Omit<
  QueryOptions<TData, TError>,
  'queryFn'
> {
  /** Service name on the backend */
  service: string;
  /** Method name to call */
  method: string;
  /** Method arguments */
  args?: unknown[];
  /** Request timeout override */
  timeout?: number;
}

/**
 * Options for useBackendMutation hook
 */
export interface BackendMutationOptions<
  TData = unknown,
  TError = NetronError,
  TVariables = unknown,
  TContext = unknown,
> extends Omit<MutationOptions<TData, TError, TVariables, TContext>, 'mutationFn'> {
  /** Service name on the backend */
  service: string;
  /** Method name to call */
  method: string;
  /** Request timeout override */
  timeout?: number;
}

// ============================================================================
// Component Types
// ============================================================================

/**
 * Props for BackendConnectionAware component
 */
export interface BackendConnectionAwareProps {
  /** Backend name to check */
  backend: string;
  /** Children to render when connected */
  children: ReactNode;
  /** Render while connecting */
  connecting?: ReactNode;
  /** Render when disconnected */
  disconnected?: ReactNode;
  /** Render on error */
  error?: (error: Error, retry: () => void) => ReactNode;
}

/**
 * Props for RequireBackendConnection component
 */
export interface RequireBackendConnectionProps {
  /** Backend name to require */
  backend: string;
  /** Children to render when connected */
  children: ReactNode;
  /** Fallback when not connected */
  fallback?: ReactNode;
}

/**
 * Props for MultiBackendConnectionAware component
 */
export interface MultiBackendConnectionAwareProps {
  /** Require all backends (true) or any backend (false) */
  requireAll?: boolean;
  /** Specific backends to check (optional, defaults to all) */
  backends?: string[];
  /** Children to render when condition met */
  children: ReactNode;
  /** Render while connecting */
  connecting?: ReactNode;
  /** Render when disconnected */
  disconnected?: ReactNode;
  /** Render on error */
  error?: (errors: Map<string, Error>, retry: () => void) => ReactNode;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Extract service type from backend schema
 */
export type ExtractService<T extends BackendSchema, B extends keyof T, S extends keyof T[B]> = T[B][S];

/**
 * Backend-qualified service name (e.g., "core.users")
 */
export type QualifiedServiceName<T extends BackendSchema> = {
  [B in keyof T]: {
    [S in keyof T[B]]: `${B & string}.${S & string}`;
  }[keyof T[B]];
}[keyof T];

/**
 * Re-export TypedServiceProxy for convenience
 */
export type { TypedServiceProxy };

/**
 * Re-export core query/mutation result types
 */
export type { QueryResult, MutationResult };
