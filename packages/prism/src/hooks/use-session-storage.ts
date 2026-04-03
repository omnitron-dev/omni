'use client';

/**
 * useSessionStorage Hook
 *
 * A hook for persisting state in sessionStorage with automatic serialization.
 *
 * @module @omnitron/prism/hooks/use-session-storage
 */

import { useState, useCallback, useEffect } from 'react';
import { useIsClient } from '../core/hooks/use-is-client.js';

/**
 * Return type for useSessionStorage hook.
 */
export interface UseSessionStorageReturn<T> {
  /** Current state value */
  state: T;
  /** Update state and sessionStorage */
  setState: (value: T | ((prev: T) => T)) => void;
  /** Remove item from sessionStorage and reset to default */
  remove: () => void;
  /** Check if sessionStorage has the key */
  hasValue: boolean;
}

/**
 * Options for useSessionStorage hook.
 */
export interface UseSessionStorageOptions<T> {
  /** Serializer function (default: JSON.stringify) */
  serializer?: (value: T) => string;
  /** Deserializer function (default: JSON.parse) */
  deserializer?: (value: string) => T;
}

/**
 * Get sessionStorage value with fallback.
 */
function getStorageValue<T>(key: string, defaultValue: T, deserializer: (value: string) => T): T {
  if (typeof window === 'undefined') {
    return defaultValue;
  }

  try {
    const item = window.sessionStorage.getItem(key);
    if (item === null) {
      return defaultValue;
    }
    return deserializer(item);
  } catch (error) {
    console.warn(`Error reading sessionStorage key "${key}":`, error);
    return defaultValue;
  }
}

/**
 * Hook for persisting state in sessionStorage.
 *
 * @param key - Storage key
 * @param defaultValue - Default value when key is not found
 * @param options - Configuration options
 * @returns State value and control methods
 *
 * @example
 * ```tsx
 * function SearchFilters() {
 *   const { state: filters, setState: setFilters, remove } = useSessionStorage(
 *     'search-filters',
 *     { query: '', category: 'all' }
 *   );
 *
 *   return (
 *     <>
 *       <input
 *         value={filters.query}
 *         onChange={(e) => setFilters({ ...filters, query: e.target.value })}
 *       />
 *       <button onClick={remove}>Clear Filters</button>
 *     </>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // With functional updates
 * function Counter() {
 *   const { state: count, setState: setCount } = useSessionStorage('counter', 0);
 *
 *   return (
 *     <button onClick={() => setCount((prev) => prev + 1)}>
 *       Count: {count}
 *     </button>
 *   );
 * }
 * ```
 */
export function useSessionStorage<T>(
  key: string,
  defaultValue: T,
  options: UseSessionStorageOptions<T> = {}
): UseSessionStorageReturn<T> {
  const { serializer = JSON.stringify, deserializer = JSON.parse } = options;

  const isClient = useIsClient();

  // Initialize state from sessionStorage
  const [state, setStateInternal] = useState<T>(() => {
    if (typeof window === 'undefined') {
      return defaultValue;
    }
    return getStorageValue(key, defaultValue, deserializer);
  });

  // Track if sessionStorage has the key
  const [hasValue, setHasValue] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.sessionStorage.getItem(key) !== null;
  });

  // Update sessionStorage when state changes
  const setState = useCallback(
    (value: T | ((prev: T) => T)) => {
      try {
        const newValue = value instanceof Function ? value(state) : value;
        window.sessionStorage.setItem(key, serializer(newValue));
        setStateInternal(newValue);
        setHasValue(true);

        // Dispatch storage event for other tabs/windows
        window.dispatchEvent(
          new StorageEvent('storage', {
            key,
            newValue: serializer(newValue),
            storageArea: window.sessionStorage,
          })
        );
      } catch (error) {
        console.warn(`Error setting sessionStorage key "${key}":`, error);
      }
    },
    [key, serializer, state]
  );

  // Remove from sessionStorage
  const remove = useCallback(() => {
    try {
      window.sessionStorage.removeItem(key);
      setStateInternal(defaultValue);
      setHasValue(false);

      // Dispatch storage event for other tabs/windows
      window.dispatchEvent(
        new StorageEvent('storage', {
          key,
          newValue: null,
          storageArea: window.sessionStorage,
        })
      );
    } catch (error) {
      console.warn(`Error removing sessionStorage key "${key}":`, error);
    }
  }, [key, defaultValue]);

  // Sync state from sessionStorage on mount and key change
  useEffect(() => {
    if (!isClient) return undefined;

    const value = getStorageValue(key, defaultValue, deserializer);
    setStateInternal(value);
    setHasValue(window.sessionStorage.getItem(key) !== null);
    return undefined;
  }, [key, isClient, defaultValue, deserializer]);

  // Listen for storage events from other tabs/windows
  useEffect(() => {
    if (!isClient) return undefined;

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === key && event.storageArea === window.sessionStorage) {
        if (event.newValue === null) {
          setStateInternal(defaultValue);
          setHasValue(false);
        } else {
          try {
            setStateInternal(deserializer(event.newValue));
            setHasValue(true);
          } catch {
            // Ignore parse errors
          }
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [key, isClient, defaultValue, deserializer]);

  return {
    state,
    setState,
    remove,
    hasValue,
  };
}
