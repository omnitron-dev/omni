/**
 * Store Definition Helper
 * @module store/defineStore
 *
 * Main store definition API for Aether framework.
 * Creates singleton stores with netron integration and lifecycle management.
 */

import type { StoreSetup, StoreFactory, StoreInstance, StoreOptions } from './types.js';
import { NetronClient } from '../netron/client.js';
import { inject } from '../di/inject.js';
import { LifecycleManager, runWithLifecycle, createLifecycleHandlers } from './lifecycle.js';
import { registerStore, useStore, markStoreInitialized, markStoreUninitialized } from './composition.js';
import { createRoot } from '../core/reactivity/batch.js';

/**
 * Store instances cache
 */
const storeInstances = new Map<
  string,
  {
    instance: any;
    root: () => void;
    lifecycle: LifecycleManager;
    dispose: () => void;
  }
>();

/**
 * Get or create NetronClient
 */
function getNetronClient(): NetronClient {
  try {
    // Try to inject NetronClient from DI
    return inject(NetronClient);
  } catch {
    // If not available, create a default instance
    // This allows stores to work without DI setup
    return new NetronClient({
      baseUrl: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
    });
  }
}

/**
 * Define a store
 *
 * Creates a store factory function that returns a singleton store instance.
 * The store is initialized on first access and provides lifecycle hooks.
 *
 * @param id - Unique store identifier
 * @param setup - Setup function that receives NetronClient and returns store state
 * @param options - Additional store options
 * @returns Store factory function
 *
 * @example
 * ```typescript
 * // Basic store
 * export const useUserStore = defineStore('user', (netron) => {
 *   const users = signal<User[]>([]);
 *   const loading = signal(false);
 *
 *   const activeUsers = computed(() => users().filter(u => u.active));
 *
 *   const loadUsers = async () => {
 *     loading.set(true);
 *     const service = await netron.service<IUserService>('users');
 *     const data = await service.getUsers();
 *     users.set(data);
 *     loading.set(false);
 *   };
 *
 *   return {
 *     users: readonly(users),
 *     activeUsers,
 *     loadUsers,
 *   };
 * });
 *
 * // With lifecycle hooks
 * export const useAppStore = defineStore('app', (netron) => {
 *   const initialized = signal(false);
 *
 *   onStoreInit(async () => {
 *     console.log('App store initializing...');
 *     await loadInitialData();
 *     initialized.set(true);
 *   });
 *
 *   onStoreDestroy(() => {
 *     console.log('App store destroyed');
 *   });
 *
 *   return { initialized };
 * });
 *
 * // With persistence
 * export const useSettingsStore = defineStore('settings', (netron) => {
 *   const theme = signal<'light' | 'dark'>('light');
 *
 *   persist(theme, {
 *     key: 'app-theme',
 *     storage: 'local'
 *   });
 *
 *   return { theme };
 * });
 * ```
 */
export function defineStore<T>(id: string, setup: StoreSetup<T>, options?: Partial<StoreOptions>): StoreFactory<T> {
  // Validate ID
  if (!id || typeof id !== 'string') {
    throw new Error('Store ID must be a non-empty string');
  }

  if (typeof setup !== 'function') {
    throw new Error('Store setup must be a function');
  }

  // Store metadata
  const storeName = options?.name ?? id;
  const initialSetup: StoreSetup<T> | null = setup;

  /**
   * Get or create store instance
   */
  const getStoreInstance = (): T => {
    // Check if store already exists
    let cached = storeInstances.get(id);

    if (cached) {
      return cached.instance;
    }

    // Create new store instance
    let storeState: T;
    const lifecycle = new LifecycleManager();

    // Create in reactive root for proper cleanup
    const disposeRoot = createRoot((dispose) => {
      // Get NetronClient
      const netron = getNetronClient();

      // Run setup with lifecycle context
      storeState = runWithLifecycle(lifecycle, () => {
        if (!initialSetup) {
          throw new Error(`Store '${id}' setup function is not available`);
        }
        return initialSetup(netron);
      });

      return dispose;
    });

    // Create store instance metadata
    const instance: StoreInstance<T> = {
      id,
      name: storeName,
      state: storeState!,
      lifecycle: createLifecycleHandlers(lifecycle),
      initialized: Promise.resolve(),
      disposed: false,
      reset: () => {
        // Dispose current instance
        instance.dispose();
        // Clear from cache
        storeInstances.delete(id);
        // Next access will create new instance
      },
      dispose: () => {
        if (instance.disposed) return;

        // Mark as disposed
        (instance as any).disposed = true;

        // Trigger destroy lifecycle
        lifecycle.trigger('onStoreDestroy').catch((error) => {
          console.error(`Error in onStoreDestroy for store '${id}':`, error);
        });

        // Dispose reactive root
        if (disposeRoot) {
          disposeRoot();
        }

        // Clear lifecycle handlers
        lifecycle.clear();
      },
    };

    // Cache instance with lifecycle and dispose method
    cached = {
      instance: storeState!,
      root: disposeRoot,
      lifecycle,
      dispose: instance.dispose,
    };
    storeInstances.set(id, cached);

    // Mark store as initialized
    markStoreInitialized(id);

    // Trigger init lifecycle
    lifecycle.trigger('onStoreInit').catch((error) => {
      console.error(`Error in onStoreInit for store '${id}':`, error);
    });

    return storeState!;
  };

  /**
   * Store factory function
   */
  const factory = (() => getStoreInstance()) as StoreFactory<T>;

  // Add factory metadata
  Object.defineProperty(factory, 'id', {
    value: id,
    writable: false,
    enumerable: true,
  });

  Object.defineProperty(factory, 'name', {
    value: storeName,
    writable: false,
    enumerable: true,
  });

  /**
   * Reset store to initial state
   */
  factory.reset = () => {
    const cached = storeInstances.get(id);
    if (cached) {
      // Trigger lifecycle destroy hooks
      cached.lifecycle.trigger('onStoreDestroy').catch((error) => {
        console.error(`Error in onStoreDestroy for store '${id}':`, error);
      });
      // Dispose current instance
      cached.root();
      storeInstances.delete(id);
      // Mark as uninitialized
      markStoreUninitialized(id);
    }
    // Next access will create new instance
  };

  /**
   * Dispose store and cleanup
   */
  factory.dispose = () => {
    const cached = storeInstances.get(id);
    if (!cached) return;

    // Call the dispose method which triggers lifecycle hooks
    cached.dispose();
    storeInstances.delete(id);
    // Mark as uninitialized
    markStoreUninitialized(id);
  };

  // Register store in global registry
  registerStore(id, factory);

  return factory;
}

/**
 * Define a store with explicit type
 *
 * Type-safe variant that enforces return type.
 *
 * @param id - Store ID
 * @param setup - Setup function
 * @param options - Store options
 * @returns Store factory
 *
 * @example
 * ```typescript
 * interface UserStoreState {
 *   users: Signal<User[]>;
 *   loadUsers: () => Promise<void>;
 * }
 *
 * export const useUserStore = defineStoreTyped<UserStoreState>(
 *   'user',
 *   (netron) => {
 *     const users = signal<User[]>([]);
 *     const loadUsers = async () => { ... };
 *     return { users, loadUsers };
 *   }
 * );
 * ```
 */
export function defineStoreTyped<T>(
  id: string,
  setup: StoreSetup<T>,
  options?: Partial<StoreOptions>
): StoreFactory<T> {
  return defineStore<T>(id, setup, options);
}

/**
 * Create a computed store that derives from other stores
 *
 * @param id - Store ID
 * @param dependencies - Store IDs to depend on
 * @param compute - Computation function
 * @param options - Store options
 * @returns Store factory
 *
 * @example
 * ```typescript
 * const useDerivedStore = defineComputedStore(
 *   'derived',
 *   ['user', 'settings'],
 *   (netron, [userStore, settingsStore]) => {
 *     const displayName = computed(() => {
 *       const user = userStore.currentUser();
 *       const settings = settingsStore.displaySettings();
 *       return formatDisplayName(user, settings);
 *     });
 *
 *     return { displayName };
 *   }
 * );
 * ```
 */
export function defineComputedStore<T>(
  id: string,
  dependencies: string[],
  compute: (netron: NetronClient, stores: any[]) => T,
  options?: Partial<StoreOptions>
): StoreFactory<T> {
  return defineStore(
    id,
    (netron) => {
      // Get dependent stores
      const stores = dependencies.map((depId) => useStore(depId));

      // Compute derived state
      return compute(netron, stores);
    },
    options
  );
}

/**
 * Clear all store instances
 *
 * Disposes all stores and clears the cache.
 * Useful for testing or full app reset.
 */
export function clearAllStoreInstances(): void {
  for (const [id, cached] of storeInstances.entries()) {
    try {
      cached.dispose();
      markStoreUninitialized(id);
    } catch (error) {
      console.error(`Error disposing store '${id}':`, error);
    }
  }
  storeInstances.clear();
}

/**
 * Get all active store IDs
 */
export function getActiveStoreIds(): string[] {
  return Array.from(storeInstances.keys());
}

/**
 * Check if store is active (instantiated)
 */
export function isStoreActive(id: string): boolean {
  return storeInstances.has(id);
}
