/**
 * Store Composition Helpers
 * @module store/composition
 *
 * Provides helper functions for store composition and usage.
 * Includes useStore, readonly, batch, and store inheritance patterns.
 */

import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import type { StoreFactory, UseStoreOptions } from './types.js';
import { readonly as makeReadonly } from '../core/reactivity/signal.js';
import { batch as reactivityBatch } from '../core/reactivity/batch.js';

/**
 * Global store registry
 */
const storeRegistry = new Map<string, StoreFactory<any>>();

/**
 * Register a store factory
 */
export function registerStore<T>(id: string, factory: StoreFactory<T>): void {
  if (storeRegistry.has(id)) {
    console.warn(`Store '${id}' is already registered. Replacing existing store.`);
  }
  storeRegistry.set(id, factory);
}

/**
 * Unregister a store factory
 */
export function unregisterStore(id: string): boolean {
  return storeRegistry.delete(id);
}

/**
 * Get registered store factory
 */
export function getStoreFactory<T>(id: string): StoreFactory<T> | undefined {
  return storeRegistry.get(id);
}

/**
 * Check if store is registered
 */
export function hasStore(id: string): boolean {
  return storeRegistry.has(id);
}

/**
 * Get all registered store IDs
 */
export function getAllStoreIds(): string[] {
  return Array.from(storeRegistry.keys());
}

/**
 * Clear all registered stores
 */
export function clearAllStores(): void {
  // Dispose all stores
  for (const factory of storeRegistry.values()) {
    try {
      factory.dispose();
    } catch (error) {
      console.error('Error disposing store:', error);
    }
  }
  storeRegistry.clear();
}

/**
 * Use a store by ID
 *
 * Returns the store instance. If store doesn't exist, behavior depends on options.
 *
 * @param id - Store ID
 * @param options - Usage options
 * @returns Store instance
 * @throws Error if store not found and throwIfNotFound is true
 *
 * @example
 * ```typescript
 * // Get existing store
 * const userStore = useStore('user');
 *
 * // Get store or throw
 * const userStore = useStore('user', { throwIfNotFound: true });
 *
 * // Check if store exists first
 * if (hasStore('user')) {
 *   const userStore = useStore('user');
 * }
 * ```
 */
export function useStore<T = any>(id: string, options?: UseStoreOptions): T {
  const factory = storeRegistry.get(id);

  if (!factory) {
    if (options?.throwIfNotFound) {
      throw new Error(`Store '${id}' not found. Make sure it's defined with defineStore() and registered.`);
    }
    throw new Error(
      `Store '${id}' not found. Did you forget to call the store factory at least once to initialize it?`
    );
  }

  return factory();
}

/**
 * Create a read-only signal from a writable signal
 *
 * Prevents external modifications while allowing reads and subscriptions.
 *
 * @param writable - Writable signal
 * @returns Read-only signal
 *
 * @example
 * ```typescript
 * const count = signal(0);
 * const readonlyCount = readonly(count);
 *
 * console.log(readonlyCount()); // Works
 * readonlyCount.set(1); // Error: set doesn't exist
 * ```
 */
export function readonly<T>(writable: WritableSignal<T>): Signal<T> {
  return makeReadonly(writable);
}

/**
 * Batch multiple signal updates
 *
 * Groups multiple signal updates into a single update cycle.
 * Dependent computations and effects only run once after all updates complete.
 *
 * @param fn - Function containing signal updates
 *
 * @example
 * ```typescript
 * const x = signal(0);
 * const y = signal(0);
 * const sum = computed(() => x() + y());
 *
 * // Without batch: sum computed twice
 * x.set(1);
 * y.set(2);
 *
 * // With batch: sum computed once
 * batch(() => {
 *   x.set(1);
 *   y.set(2);
 * });
 * ```
 */
export function batch(fn: () => void): void {
  reactivityBatch(fn);
}

/**
 * Create a derived store from multiple stores
 *
 * Composes multiple stores into a single derived store.
 *
 * @param stores - Record of store IDs to use
 * @param deriveFn - Function to derive new store state
 * @returns Derived state
 *
 * @example
 * ```typescript
 * const derived = deriveStore(
 *   {
 *     user: 'user',
 *     settings: 'settings'
 *   },
 *   ({ user, settings }) => ({
 *     displayName: user.users().find(u => u.id === user.currentUserId())?.name,
 *     theme: settings.theme()
 *   })
 * );
 * ```
 */
export function deriveStore<T extends Record<string, string>, R>(
  stores: T,
  deriveFn: (stores: { [K in keyof T]: any }) => R
): R {
  const storeInstances: any = {};

  for (const [key, storeId] of Object.entries(stores)) {
    storeInstances[key] = useStore(storeId);
  }

  return deriveFn(storeInstances);
}

/**
 * Create a store that extends another store
 *
 * Allows store inheritance/composition patterns.
 *
 * @param baseStoreId - Base store ID to extend
 * @param extendFn - Function that receives base store and returns extended store
 * @returns Extended store
 *
 * @example
 * ```typescript
 * // Base store
 * const useBaseStore = defineStore('base', (netron) => {
 *   const count = signal(0);
 *   return { count };
 * });
 *
 * // Extended store
 * const useExtendedStore = defineStore('extended', (netron) => {
 *   const base = extendStore('base', (baseStore) => {
 *     const doubled = computed(() => baseStore.count() * 2);
 *     return { ...baseStore, doubled };
 *   });
 *   return base;
 * });
 * ```
 */
export function extendStore<T, R>(baseStoreId: string, extendFn: (base: T) => R): R {
  const base = useStore<T>(baseStoreId);
  return extendFn(base);
}

/**
 * Reset a store to its initial state
 *
 * @param id - Store ID to reset
 *
 * @example
 * ```typescript
 * resetStore('user'); // Resets user store to initial state
 * ```
 */
export function resetStore(id: string): void {
  const factory = storeRegistry.get(id);
  if (!factory) {
    throw new Error(`Store '${id}' not found`);
  }
  factory.reset();
}

/**
 * Dispose a store and cleanup resources
 *
 * @param id - Store ID to dispose
 *
 * @example
 * ```typescript
 * disposeStore('user'); // Disposes user store and cleans up resources
 * ```
 */
export function disposeStore(id: string): void {
  const factory = storeRegistry.get(id);
  if (!factory) {
    throw new Error(`Store '${id}' not found`);
  }
  factory.dispose();
  storeRegistry.delete(id);
}

/**
 * Get store metadata
 *
 * @param id - Store ID
 * @returns Store metadata
 */
export function getStoreMetadata(id: string): { id: string; name?: string } | undefined {
  const factory = storeRegistry.get(id);
  if (!factory) {
    return undefined;
  }

  return {
    id: factory.id,
    name: factory.name,
  };
}

/**
 * Check if a store is initialized
 *
 * @param id - Store ID
 * @returns True if store is initialized
 */
export function isStoreInitialized(id: string): boolean {
  const factory = storeRegistry.get(id);
  if (!factory) {
    return false;
  }

  // Try to get the store instance without creating it
  try {
    factory();
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a store composition helper
 *
 * Helper for composing multiple stores into a single namespace.
 *
 * @param stores - Store IDs to compose
 * @returns Composed stores
 *
 * @example
 * ```typescript
 * const stores = composeStores({
 *   user: 'user',
 *   settings: 'settings',
 *   notifications: 'notifications'
 * });
 *
 * // Access stores
 * stores.user.loadUsers();
 * stores.settings.updateTheme('dark');
 * ```
 */
export function composeStores<T extends Record<string, string>>(
  stores: T
): { [K in keyof T]: ReturnType<typeof useStore> } {
  const composed: any = {};

  for (const [key, storeId] of Object.entries(stores)) {
    Object.defineProperty(composed, key, {
      get() {
        return useStore(storeId);
      },
      enumerable: true,
    });
  }

  return composed;
}
