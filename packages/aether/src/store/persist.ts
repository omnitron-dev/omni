/**
 * State Persistence Helper
 * @module store/persist
 *
 * Provides automatic persistence of signal state to localStorage/sessionStorage.
 * Supports selective field persistence, debouncing, and schema migrations.
 */

import type { WritableSignal, Signal } from '../core/reactivity/types.js';
import type { PersistOptions, StorageBackend, StorageType, PersistManager } from './types.js';
import { effect } from '../core/reactivity/effect.js';
import { onStoreDestroy } from './lifecycle.js';

/**
 * Get storage backend by type
 */
function getStorageBackend(type: StorageType): StorageBackend {
  if (typeof window === 'undefined') {
    // SSR environment - return memory storage
    return createMemoryStorage();
  }

  switch (type) {
    case 'local':
      return window.localStorage;
    case 'session':
      return window.sessionStorage;
    case 'memory':
      return createMemoryStorage();
    default:
      throw new Error(`Unknown storage type: ${type}`);
  }
}

/**
 * Create in-memory storage backend
 */
function createMemoryStorage(): StorageBackend {
  const storage = new Map<string, string>();

  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  };
}

/**
 * Check if a field should be persisted
 */
function shouldPersistField(field: string, options: PersistOptions): boolean {
  // If include list specified, only persist included fields
  if (options.include && options.include.length > 0) {
    return options.include.includes(field);
  }

  // If exclude list specified, don't persist excluded fields
  if (options.exclude && options.exclude.length > 0) {
    return !options.exclude.includes(field);
  }

  // By default, persist all fields
  return true;
}

/**
 * Filter state for persistence
 */
function filterState(state: any, options: PersistOptions): any {
  if (typeof state !== 'object' || state === null) {
    return state;
  }

  const filtered: any = Array.isArray(state) ? [] : {};

  for (const key in state) {
    if (Object.prototype.hasOwnProperty.call(state, key) && shouldPersistField(key, options)) {
      filtered[key] = state[key];
    }
  }

  return filtered;
}

/**
 * Create debounced function
 */
function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return ((...args: any[]) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      timeoutId = null;
      fn(...args);
    }, delay);
  }) as T;
}

/**
 * Persist manager implementation
 */
class PersistManagerImpl implements PersistManager {
  private storage: StorageBackend;
  private serialize: (value: any) => string;
  private deserialize: (value: string) => any;
  private disposeEffect?: { dispose: () => void };
  private disposed = false;

  constructor(
    private signal: WritableSignal<any>,
    private options: PersistOptions
  ) {
    this.storage =
      typeof options.storage === 'string' ? getStorageBackend(options.storage) : options.storage ?? getStorageBackend('local');

    this.serialize = options.serialize ?? JSON.stringify;
    this.deserialize = options.deserialize ?? JSON.parse;
  }

  /**
   * Hydrate state from storage
   */
  async hydrate(): Promise<any> {
    try {
      const stored = this.storage.getItem(this.options.key);
      if (!stored) {
        return undefined;
      }

      let data = this.deserialize(stored);

      // Handle versioning and migrations
      if (this.options.version !== undefined && data && typeof data === 'object') {
        const storedVersion = data.__version ?? 0;
        const currentVersion = this.options.version;

        if (storedVersion < currentVersion && this.options.migrate) {
          data = this.options.migrate(data, storedVersion, currentVersion);
        }

        // Add version to data
        data.__version = currentVersion;
      }

      return data;
    } catch (error) {
      if (this.options.onError) {
        this.options.onError(error as Error);
      } else {
        console.error('Failed to hydrate from storage:', error);
      }
      return undefined;
    }
  }

  /**
   * Persist state to storage
   */
  async persist(state: any): Promise<void> {
    if (this.disposed) return;

    try {
      // Filter state based on include/exclude
      const filtered = filterState(state, this.options);

      // Add version if specified
      const data =
        this.options.version !== undefined
          ? {
              ...filtered,
              __version: this.options.version,
            }
          : filtered;

      const serialized = this.serialize(data);
      this.storage.setItem(this.options.key, serialized);
    } catch (error) {
      if (this.options.onError) {
        this.options.onError(error as Error);
      } else {
        console.error('Failed to persist to storage:', error);
      }
    }
  }

  /**
   * Clear persisted state
   */
  async clear(): Promise<void> {
    try {
      this.storage.removeItem(this.options.key);
    } catch (error) {
      if (this.options.onError) {
        this.options.onError(error as Error);
      } else {
        console.error('Failed to clear storage:', error);
      }
    }
  }

  /**
   * Start watching signal for changes
   */
  startWatching(): void {
    const persistFn = this.options.debounce ? debounce(() => this.persist(this.signal.peek()), this.options.debounce) : () => this.persist(this.signal.peek());

    // Watch signal changes and persist
    this.disposeEffect = effect(() => {
      this.signal(); // Track dependency
      persistFn();
    });
  }

  /**
   * Dispose and cleanup
   */
  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;

    if (this.disposeEffect) {
      this.disposeEffect.dispose();
      this.disposeEffect = undefined;
    }
  }
}

/**
 * Persist a signal to storage
 *
 * Automatically saves signal value to storage on changes and
 * hydrates from storage on initialization.
 *
 * @param signal - Signal to persist
 * @param options - Persistence options
 * @returns Persist manager
 *
 * @example
 * ```typescript
 * const users = signal<User[]>([]);
 *
 * // Basic persistence
 * persist(users, { key: 'users-cache', storage: 'local' });
 *
 * // With selective fields
 * persist(users, {
 *   key: 'users-cache',
 *   storage: 'local',
 *   exclude: ['loading', 'error']
 * });
 *
 * // With versioning and migration
 * persist(users, {
 *   key: 'users-cache',
 *   storage: 'local',
 *   version: 2,
 *   migrate: (data, fromVersion, toVersion) => {
 *     if (fromVersion === 1 && toVersion === 2) {
 *       // Migrate from v1 to v2
 *       return data.map(user => ({ ...user, newField: 'default' }));
 *     }
 *     return data;
 *   }
 * });
 *
 * // With debouncing
 * persist(users, {
 *   key: 'users-cache',
 *   storage: 'local',
 *   debounce: 500 // Save after 500ms of no changes
 * });
 * ```
 */
export function persist<T>(signal: WritableSignal<T>, options: PersistOptions): PersistManager {
  const manager = new PersistManagerImpl(signal, options);

  // Hydrate from storage
  manager.hydrate().then((data) => {
    if (data !== undefined) {
      signal.set(data);
    }
  });

  // Start watching for changes
  manager.startWatching();

  // Auto-cleanup on store destroy if in store context
  try {
    onStoreDestroy(() => {
      manager.dispose();
    });
  } catch {
    // Not in store context, manual cleanup required
  }

  return manager;
}

/**
 * Create a persist manager without auto-initialization
 *
 * Useful when you need manual control over hydration timing.
 *
 * @param signal - Signal to persist
 * @param options - Persistence options
 * @returns Persist manager
 */
export function createPersistManager<T>(signal: WritableSignal<T>, options: PersistOptions): PersistManager {
  return new PersistManagerImpl(signal, options);
}

/**
 * Hydrate signal from storage without setting up persistence
 *
 * One-time hydration without watching for changes.
 *
 * @param signal - Signal to hydrate
 * @param options - Persistence options
 * @returns Hydrated value or undefined
 */
export async function hydrateSignal<T>(signal: WritableSignal<T>, options: PersistOptions): Promise<T | undefined> {
  const manager = new PersistManagerImpl(signal, options);
  const data = await manager.hydrate();
  manager.dispose();
  return data;
}

/**
 * Persist signal value once without setting up watching
 *
 * One-time persistence without watching for changes.
 *
 * @param signal - Signal to persist
 * @param options - Persistence options
 */
export async function persistSignal<T>(signal: Signal<T>, options: PersistOptions): Promise<void> {
  const manager = new PersistManagerImpl(signal as WritableSignal<T>, options);
  await manager.persist(signal.peek());
  manager.dispose();
}

/**
 * Clear persisted data from storage
 *
 * @param key - Storage key
 * @param storage - Storage type
 */
export async function clearPersistedData(key: string, storage: StorageType = 'local'): Promise<void> {
  const backend = getStorageBackend(storage);
  try {
    backend.removeItem(key);
  } catch (error) {
    console.error('Failed to clear persisted data:', error);
  }
}
