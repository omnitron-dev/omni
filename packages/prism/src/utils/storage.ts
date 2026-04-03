/**
 * LocalStorage Utilities
 *
 * SSR-safe localStorage utilities with JSON serialization support.
 * Inspired by minimal-shared/utils/local-storage pattern.
 *
 * @module @omnitron-dev/prism/utils/storage
 */

// =============================================================================
// TYPES
// =============================================================================

export interface StorageOptions {
  /** Storage to use (default: localStorage) */
  storage?: Storage;
  /** Serialize function (default: JSON.stringify) */
  serialize?: (value: unknown) => string;
  /** Deserialize function (default: JSON.parse) */
  deserialize?: (value: string) => unknown;
}

// =============================================================================
// AVAILABILITY CHECK
// =============================================================================

/**
 * Check if localStorage is available in the current environment.
 * Handles SSR, private browsing, and quota exceeded scenarios.
 *
 * @example
 * ```ts
 * if (localStorageAvailable()) {
 *   localStorage.setItem('key', 'value');
 * }
 * ```
 */
export function localStorageAvailable(): boolean {
  try {
    if (typeof window === 'undefined') {
      return false;
    }

    const testKey = '__storage_test__';
    window.localStorage.setItem(testKey, testKey);
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if sessionStorage is available in the current environment.
 *
 * @example
 * ```ts
 * if (sessionStorageAvailable()) {
 *   sessionStorage.setItem('key', 'value');
 * }
 * ```
 */
export function sessionStorageAvailable(): boolean {
  try {
    if (typeof window === 'undefined') {
      return false;
    }

    const testKey = '__storage_test__';
    window.sessionStorage.setItem(testKey, testKey);
    window.sessionStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// GET STORAGE
// =============================================================================

/**
 * Get a value from localStorage with automatic JSON parsing.
 * Returns defaultValue if key doesn't exist, parsing fails, or storage is unavailable.
 *
 * @param key - Storage key
 * @param defaultValue - Value to return if key doesn't exist or parsing fails
 * @param options - Storage options
 * @returns Parsed value or defaultValue
 *
 * @example
 * ```ts
 * // Simple value
 * const count = getStorage('count', 0);
 *
 * // Object value
 * const user = getStorage<User>('user', null);
 *
 * // With sessionStorage
 * const session = getStorage('session', null, {
 *   storage: sessionStorage,
 * });
 * ```
 */
export function getStorage<T>(key: string, defaultValue: T, options: StorageOptions = {}): T {
  const { storage = typeof window !== 'undefined' ? window.localStorage : undefined, deserialize = JSON.parse } =
    options;

  try {
    if (!storage) {
      return defaultValue;
    }

    const value = storage.getItem(key);

    if (value === null) {
      return defaultValue;
    }

    return deserialize(value) as T;
  } catch {
    return defaultValue;
  }
}

// =============================================================================
// SET STORAGE
// =============================================================================

/**
 * Set a value in localStorage with automatic JSON serialization.
 * Silently fails if storage is unavailable.
 *
 * @param key - Storage key
 * @param value - Value to store (will be JSON serialized)
 * @param options - Storage options
 * @returns true if successful, false otherwise
 *
 * @example
 * ```ts
 * // Simple value
 * setStorage('count', 42);
 *
 * // Object value
 * setStorage('user', { id: 1, name: 'John' });
 *
 * // With sessionStorage
 * setStorage('session', sessionData, {
 *   storage: sessionStorage,
 * });
 * ```
 */
export function setStorage<T>(key: string, value: T, options: StorageOptions = {}): boolean {
  const { storage = typeof window !== 'undefined' ? window.localStorage : undefined, serialize = JSON.stringify } =
    options;

  try {
    if (!storage) {
      return false;
    }

    storage.setItem(key, serialize(value));
    return true;
  } catch {
    // Quota exceeded or other storage error
    return false;
  }
}

// =============================================================================
// REMOVE STORAGE
// =============================================================================

/**
 * Remove a value from localStorage.
 * Silently fails if storage is unavailable.
 *
 * @param key - Storage key to remove
 * @param options - Storage options
 * @returns true if successful, false otherwise
 *
 * @example
 * ```ts
 * removeStorage('user');
 *
 * // From sessionStorage
 * removeStorage('session', { storage: sessionStorage });
 * ```
 */
export function removeStorage(key: string, options: Pick<StorageOptions, 'storage'> = {}): boolean {
  const { storage = typeof window !== 'undefined' ? window.localStorage : undefined } = options;

  try {
    if (!storage) {
      return false;
    }

    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// CLEAR STORAGE
// =============================================================================

/**
 * Clear all items from localStorage.
 * Silently fails if storage is unavailable.
 *
 * @param options - Storage options
 * @returns true if successful, false otherwise
 *
 * @example
 * ```ts
 * clearStorage();
 *
 * // Clear sessionStorage
 * clearStorage({ storage: sessionStorage });
 * ```
 */
export function clearStorage(options: Pick<StorageOptions, 'storage'> = {}): boolean {
  const { storage = typeof window !== 'undefined' ? window.localStorage : undefined } = options;

  try {
    if (!storage) {
      return false;
    }

    storage.clear();
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// STORAGE KEYS
// =============================================================================

/**
 * Get all keys from localStorage.
 *
 * @param options - Storage options
 * @returns Array of storage keys
 *
 * @example
 * ```ts
 * const keys = getStorageKeys();
 * // => ['user', 'settings', 'cart']
 * ```
 */
export function getStorageKeys(options: Pick<StorageOptions, 'storage'> = {}): string[] {
  const { storage = typeof window !== 'undefined' ? window.localStorage : undefined } = options;

  try {
    if (!storage) {
      return [];
    }

    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null) {
        keys.push(key);
      }
    }
    return keys;
  } catch {
    return [];
  }
}

// =============================================================================
// STORAGE SIZE
// =============================================================================

/**
 * Get approximate size of localStorage in bytes.
 *
 * @param options - Storage options
 * @returns Size in bytes
 *
 * @example
 * ```ts
 * const sizeBytes = getStorageSize();
 * console.log(`Using ${sizeBytes} bytes of localStorage`);
 * ```
 */
export function getStorageSize(options: Pick<StorageOptions, 'storage'> = {}): number {
  const { storage = typeof window !== 'undefined' ? window.localStorage : undefined } = options;

  try {
    if (!storage) {
      return 0;
    }

    let total = 0;
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null) {
        const value = storage.getItem(key) ?? '';
        // Each character is 2 bytes in JavaScript
        total += (key.length + value.length) * 2;
      }
    }
    return total;
  } catch {
    return 0;
  }
}

// =============================================================================
// STORAGE WITH EXPIRY
// =============================================================================

export interface StorageWithExpiryOptions extends StorageOptions {
  /** Time to live in milliseconds */
  ttl: number;
}

interface StoredWithExpiry<T> {
  value: T;
  expiry: number;
}

/**
 * Set a value with expiration time.
 *
 * @param key - Storage key
 * @param value - Value to store
 * @param options - Options with TTL in milliseconds
 *
 * @example
 * ```ts
 * // Store for 1 hour
 * setStorageWithExpiry('session', sessionData, {
 *   ttl: 60 * 60 * 1000,
 * });
 *
 * // Store for 24 hours
 * setStorageWithExpiry('cache', cacheData, {
 *   ttl: 24 * 60 * 60 * 1000,
 * });
 * ```
 */
export function setStorageWithExpiry<T>(key: string, value: T, options: StorageWithExpiryOptions): boolean {
  const { ttl, ...storageOptions } = options;

  const item: StoredWithExpiry<T> = {
    value,
    expiry: Date.now() + ttl,
  };

  return setStorage(key, item, storageOptions);
}

/**
 * Get a value that was stored with expiration.
 * Returns defaultValue if expired or not found.
 *
 * @param key - Storage key
 * @param defaultValue - Value to return if expired or not found
 * @param options - Storage options
 *
 * @example
 * ```ts
 * const session = getStorageWithExpiry<Session>('session', null);
 * if (!session) {
 *   // Session expired or doesn't exist
 *   redirectToLogin();
 * }
 * ```
 */
export function getStorageWithExpiry<T>(key: string, defaultValue: T, options: StorageOptions = {}): T {
  const item = getStorage<StoredWithExpiry<T> | null>(key, null, options);

  if (!item) {
    return defaultValue;
  }

  if (Date.now() > item.expiry) {
    // Expired - remove the item
    removeStorage(key, options);
    return defaultValue;
  }

  return item.value;
}
