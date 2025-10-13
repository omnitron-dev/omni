/**
 * Store Pattern Type Definitions
 * @module store/types
 *
 * Type definitions for Aether's store pattern implementation.
 * Provides structured state management with netron integration.
 */

import type { NetronClient } from '../netron/client.js';

/**
 * Storage backend type
 */
export type StorageType = 'local' | 'session' | 'memory';

/**
 * Storage backend interface
 */
export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

/**
 * Persistence configuration options
 */
export interface PersistOptions {
  /**
   * Storage key for persistence
   */
  key: string;

  /**
   * Storage type or custom storage backend
   * @default 'local'
   */
  storage?: StorageType | StorageBackend;

  /**
   * Fields to exclude from persistence
   */
  exclude?: string[];

  /**
   * Fields to include in persistence (if specified, only these are persisted)
   */
  include?: string[];

  /**
   * Custom serialization function
   * @default JSON.stringify
   */
  serialize?: (value: any) => string;

  /**
   * Custom deserialization function
   * @default JSON.parse
   */
  deserialize?: (value: string) => any;

  /**
   * Schema version for migration support
   */
  version?: number;

  /**
   * Migration function for schema changes
   * @param stored - Stored data
   * @param fromVersion - Version of stored data
   * @param toVersion - Current version
   * @returns Migrated data
   */
  migrate?: (stored: any, fromVersion: number, toVersion: number) => any;

  /**
   * Debounce time for persistence (ms)
   * @default 0 (no debounce)
   */
  debounce?: number;

  /**
   * Error handler for persistence failures
   */
  onError?: (error: Error) => void;
}

/**
 * Optimistic update configuration
 */
export interface OptimisticOptions<TArgs extends any[], TResult, TSnapshot = any> {
  /**
   * Function to apply optimistic update before mutation
   */
  update: (...args: TArgs) => void;

  /**
   * Function to rollback on error
   * @param snapshot - Snapshot taken before update
   */
  rollback: (snapshot: TSnapshot) => void;

  /**
   * Custom snapshot function
   * @default () => signal.peek()
   */
  snapshot?: () => TSnapshot;

  /**
   * Conflict resolution strategy
   * @param localData - Current local state
   * @param serverData - Data from server
   * @returns Resolved data
   */
  onConflict?: (localData: TSnapshot, serverData: TResult) => void;

  /**
   * Called on successful mutation
   * @param result - Result from server
   */
  onSuccess?: (result: TResult) => void;

  /**
   * Called on error (before rollback)
   * @param error - Error that occurred
   * @param snapshot - Snapshot before update
   */
  onError?: (error: Error, snapshot: TSnapshot) => void;

  /**
   * Retry configuration
   */
  retry?: {
    attempts: number;
    delay?: number | ((attempt: number) => number);
  };
}

/**
 * Store options
 */
export interface StoreOptions {
  /**
   * Store ID (must be unique)
   */
  id: string;

  /**
   * Debug name for DevTools
   */
  name?: string;

  /**
   * Enable persistence
   */
  persist?: PersistOptions;

  /**
   * Initial hydration data
   */
  initialData?: any;
}

/**
 * Store lifecycle hook names
 */
export type StoreLifecycleHook = 'onStoreInit' | 'onStoreDestroy' | 'onStoreHydrate';

/**
 * Store lifecycle handlers
 */
export interface StoreLifecycleHandlers {
  /**
   * Called when store is initialized
   */
  onStoreInit?: () => void | Promise<void>;

  /**
   * Called when store is destroyed
   */
  onStoreDestroy?: () => void | Promise<void>;

  /**
   * Called when store is hydrated from storage
   * @param data - Hydrated data
   */
  onStoreHydrate?: (data: any) => void | Promise<void>;
}

/**
 * Store setup function
 * @param netron - Netron client for backend communication
 * @returns Store state and actions
 */
export type StoreSetup<T = any> = (netron: NetronClient) => T;

/**
 * Store factory function returned by defineStore
 */
export interface StoreFactory<T = any> {
  /**
   * Get store instance (singleton per ID)
   */
  (): T;

  /**
   * Store ID
   */
  readonly id: string;

  /**
   * Store name
   */
  readonly name?: string;

  /**
   * Reset store to initial state
   */
  reset(): void;

  /**
   * Dispose store and cleanup resources
   */
  dispose(): void;
}

/**
 * Internal store instance
 */
export interface StoreInstance<T = any> {
  /**
   * Store ID
   */
  readonly id: string;

  /**
   * Store name
   */
  readonly name?: string;

  /**
   * Store state
   */
  readonly state: T;

  /**
   * Lifecycle handlers
   */
  readonly lifecycle: StoreLifecycleHandlers;

  /**
   * Persistence manager
   */
  readonly persist?: PersistManager;

  /**
   * Initialization promise
   */
  readonly initialized: Promise<void>;

  /**
   * Whether store is disposed
   */
  readonly disposed: boolean;

  /**
   * Reset store
   */
  reset(): void;

  /**
   * Dispose store
   */
  dispose(): void;
}

/**
 * Persist manager interface
 */
export interface PersistManager {
  /**
   * Hydrate state from storage
   */
  hydrate(): Promise<any>;

  /**
   * Persist state to storage
   */
  persist(state: any): Promise<void>;

  /**
   * Clear persisted state
   */
  clear(): Promise<void>;

  /**
   * Dispose and cleanup
   */
  dispose(): void;
}

/**
 * Optimistic mutation wrapper
 */
export interface OptimisticMutation<TArgs extends any[], TResult> {
  /**
   * Execute mutation with optimistic update
   */
  (...args: TArgs): Promise<TResult>;

  /**
   * Check if mutation is in progress
   */
  isPending(): boolean;

  /**
   * Get last error
   */
  getError(): Error | undefined;

  /**
   * Clear error
   */
  clearError(): void;
}

/**
 * Store composition options
 */
export interface UseStoreOptions {
  /**
   * Whether to create store if it doesn't exist
   * @default true
   */
  create?: boolean;

  /**
   * Whether to throw if store not found
   * @default false
   */
  throwIfNotFound?: boolean;
}
