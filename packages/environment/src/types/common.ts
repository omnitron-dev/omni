/**
 * Common types used across the environment system
 */

/**
 * Unique identifier for an environment
 */
export type EnvironmentId = string;

/**
 * Semantic versioning
 */
export type SemVer = string;

/**
 * Disposable interface for cleanup
 */
export interface Disposable {
  dispose(): void | Promise<void>;
}

/**
 * Watch callback for observing changes
 */
export type WatchCallback = (event: WatchEvent) => void | Promise<void>;

/**
 * Watch event
 */
export interface WatchEvent {
  type: 'created' | 'modified' | 'deleted';
  path: string;
  timestamp: Date;
}

/**
 * Change callback for specific key changes
 */
export type ChangeCallback<T = any> = (newValue: T, oldValue: T | undefined, path: string) => void | Promise<void>;

/**
 * Change event for watch callbacks
 */
export interface ChangeEvent {
  type: 'set' | 'delete';
  key: string;
  newValue?: any;
  oldValue?: any;
  timestamp: Date;
}

/**
 * Lifecycle callback for activation/deactivation hooks
 */
export type LifecycleCallback = (env: any) => void | Promise<void>;

/**
 * Error callback for error handling
 */
export type ErrorCallback = (error: Error, context: ErrorContext) => void | Promise<void>;

/**
 * Error context for error callbacks
 */
export interface ErrorContext {
  operation?: string;
  key?: string;
  phase?: 'activate' | 'deactivate' | 'set' | 'delete' | 'validate' | 'save' | 'load';
  [key: string]: any;
}
