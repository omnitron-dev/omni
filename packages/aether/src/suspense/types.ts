/**
 * Suspense Types
 *
 * Type definitions for Suspense boundaries, async components, and error handling
 */

import type { Component } from '../core/component/types.js';

/**
 * Suspense boundary state
 */
export type SuspenseState = 'pending' | 'resolved' | 'error';

/**
 * Suspense context for tracking async operations
 */
export interface SuspenseContext {
  /**
   * Unique ID for this suspense boundary
   */
  id: string;

  /**
   * Current state
   */
  state: SuspenseState;

  /**
   * Pending promises
   */
  pending: Set<Promise<any>>;

  /**
   * Error if state is 'error'
   */
  error?: Error;

  /**
   * Register a promise
   */
  register(promise: Promise<any>): void;

  /**
   * Reset the boundary
   */
  reset(): void;
}

/**
 * Suspense props
 */
export interface SuspenseProps {
  /**
   * Fallback to show while loading
   */
  fallback?: any;

  /**
   * Children to render when resolved
   */
  children?: any;

  /**
   * Suspense boundary name (for debugging)
   */
  name?: string;

  /**
   * Timeout in ms (0 = no timeout)
   */
  timeout?: number;

  /**
   * Called when boundary suspends
   */
  onSuspend?: () => void;

  /**
   * Called when boundary resolves
   */
  onResolve?: () => void;

  /**
   * Called when boundary times out
   */
  onTimeout?: () => void;
}

/**
 * Error boundary props
 */
export interface ErrorBoundaryProps {
  /**
   * Fallback to show on error
   */
  fallback?: ((error: Error, retry: () => void) => any) | any;

  /**
   * Children to render when no error
   */
  children?: any;

  /**
   * Called when error is caught
   */
  onError?: (error: Error, info: ErrorInfo) => void;

  /**
   * Error boundary name (for debugging)
   */
  name?: string;

  /**
   * Reset on props change
   */
  resetKeys?: any[];
}

/**
 * Error info passed to error handlers
 */
export interface ErrorInfo {
  /**
   * Component stack trace
   */
  componentStack?: string;

  /**
   * Digest/hash of the error (for deduplication)
   */
  digest?: string;
}

/**
 * Async component loader
 */
export type AsyncComponentLoader<T = any> = () => Promise<{
  default: Component<T>;
}>;

/**
 * Lazy component options
 */
export interface LazyOptions {
  /**
   * Preload strategy
   */
  preload?: 'eager' | 'lazy' | 'idle' | 'visible';

  /**
   * Timeout in ms
   */
  timeout?: number;

  /**
   * Retry count
   */
  retries?: number;

  /**
   * Called on load error
   */
  onError?: (error: Error) => void;
}

/**
 * Lazy component
 */
export interface LazyComponent<T = any> extends Component<T> {
  /**
   * Preload the component
   */
  preload(): Promise<void>;

  /**
   * Check if component is loaded
   */
  isLoaded(): boolean;
}

/**
 * Suspense cache entry
 */
export interface SuspenseCacheEntry<T = any> {
  /**
   * Cache status
   */
  status: 'pending' | 'resolved' | 'error';

  /**
   * Cached value (if resolved)
   */
  value?: T;

  /**
   * Error (if error)
   */
  error?: Error;

  /**
   * Promise (if pending)
   */
  promise?: Promise<T>;
}

/**
 * Suspense cache for deduplicating requests
 */
export interface SuspenseCache {
  /**
   * Get cached entry
   */
  get<T>(key: string): SuspenseCacheEntry<T> | undefined;

  /**
   * Set cached entry
   */
  set<T>(key: string, entry: SuspenseCacheEntry<T>): void;

  /**
   * Delete cached entry
   */
  delete(key: string): void;

  /**
   * Clear all entries
   */
  clear(): void;

  /**
   * Get cache size
   */
  size(): number;
}

/**
 * Throwable promise for Suspense integration
 */
export class SuspensePromise extends Promise<any> {
  readonly _suspense = true;
}

/**
 * Type guard for suspense promises
 */
export function isSuspensePromise(value: any): value is SuspensePromise {
  return value && typeof value === 'object' && '_suspense' in value;
}

/**
 * Streaming suspense options
 */
export interface StreamingSuspenseOptions {
  /**
   * Enable out-of-order streaming
   */
  outOfOrder?: boolean;

  /**
   * Maximum concurrent boundaries
   */
  maxConcurrency?: number;

  /**
   * Boundary timeout
   */
  timeout?: number;

  /**
   * Shell timeout (time to wait for initial HTML)
   */
  shellTimeout?: number;
}

/**
 * Suspense boundary marker for SSR
 */
export interface SuspenseBoundaryMarker {
  /**
   * Unique boundary ID
   */
  id: string;

  /**
   * Promise that resolves with rendered HTML
   */
  promise: Promise<string>;

  /**
   * Boundary resolved flag
   */
  resolved: boolean;

  /**
   * Rendered HTML (when resolved)
   */
  html?: string;

  /**
   * Error (if failed)
   */
  error?: Error;
}

/**
 * SSR suspense context
 */
export interface SSRSuspenseContext {
  /**
   * Tracked boundaries
   */
  boundaries: Map<string, SuspenseBoundaryMarker>;

  /**
   * Completed boundary IDs
   */
  completed: Set<string>;

  /**
   * Pending boundary count
   */
  pending: number;

  /**
   * Register a boundary
   */
  registerBoundary(id: string, promise: Promise<string>): void;

  /**
   * Mark boundary as completed
   */
  completeBoundary(id: string, html: string): void;

  /**
   * Mark boundary as failed
   */
  failBoundary(id: string, error: Error): void;
}
