'use client';

/**
 * useLocalStorage Hook
 *
 * A hook for persisting state to localStorage.
 *
 * @module @omnitron/prism/core/hooks/use-local-storage
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

/**
 * Check if localStorage is available.
 */
function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__prism_test__';
    localStorage.setItem(testKey, testKey);
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Serialize value to JSON string.
 */
function serialize<T>(value: T): string {
  return JSON.stringify(value);
}

/**
 * Deserialize JSON string to value.
 */
function deserialize<T>(value: string | null, fallback: T): T {
  if (value === null) return fallback;

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Return type for useLocalStorage hook.
 */
export type UseLocalStorageReturn<T> = [
  /** Current value */
  T,
  /** Set value (accepts value or updater function) */
  (value: T | ((prev: T) => T)) => void,
  /** Remove value from storage */
  () => void,
];

/**
 * Hook for persisting state to localStorage.
 *
 * @param key - Storage key
 * @param initialValue - Initial value (used if no stored value exists)
 * @returns Tuple of [value, setValue, removeValue]
 *
 * @example
 * ```tsx
 * function Settings() {
 *   const [theme, setTheme] = useLocalStorage('theme', 'light');
 *
 *   return (
 *     <Select
 *       value={theme}
 *       onChange={(e) => setTheme(e.target.value)}
 *     >
 *       <MenuItem value="light">Light</MenuItem>
 *       <MenuItem value="dark">Dark</MenuItem>
 *     </Select>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * function Counter() {
 *   const [count, setCount] = useLocalStorage('counter', 0);
 *
 *   return (
 *     <>
 *       <span>{count}</span>
 *       <Button onClick={() => setCount((prev) => prev + 1)}>
 *         Increment
 *       </Button>
 *     </>
 *   );
 * }
 * ```
 */
export function useLocalStorage<T>(key: string, initialValue: T): UseLocalStorageReturn<T> {
  const storageAvailable = useMemo(() => isLocalStorageAvailable(), []);

  // Get initial state from localStorage or use initialValue
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (!storageAvailable) return initialValue;

    try {
      const item = localStorage.getItem(key);
      return deserialize(item, initialValue);
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  // Update localStorage when state changes
  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) => {
        const newValue = value instanceof Function ? value(prev) : value;

        if (storageAvailable) {
          try {
            localStorage.setItem(key, serialize(newValue));
          } catch (error) {
            console.warn(`Error setting localStorage key "${key}":`, error);
          }
        }

        return newValue;
      });
    },
    [key, storageAvailable]
  );

  // Remove value from storage
  const removeValue = useCallback(() => {
    setStoredValue(initialValue);

    if (storageAvailable) {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        console.warn(`Error removing localStorage key "${key}":`, error);
      }
    }
  }, [key, initialValue, storageAvailable]);

  // Sync with other tabs/windows
  useEffect(() => {
    if (!storageAvailable) {
      return undefined;
    }

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === key && event.newValue !== null) {
        setStoredValue(deserialize(event.newValue, initialValue));
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [key, initialValue, storageAvailable]);

  return [storedValue, setValue, removeValue];
}

/**
 * Hook for reading localStorage value (read-only).
 *
 * @param key - Storage key
 * @param fallback - Fallback value if key doesn't exist
 * @returns Current stored value
 */
export function useReadLocalStorage<T>(key: string, fallback: T): T {
  const [value, setValue] = useState<T>(() => {
    if (!isLocalStorageAvailable()) return fallback;

    try {
      const item = localStorage.getItem(key);
      return deserialize(item, fallback);
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    // SSR guard
    if (typeof window === 'undefined') return undefined;

    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === key) {
        setValue(deserialize(event.newValue, fallback));
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [key, fallback]);

  return value;
}
