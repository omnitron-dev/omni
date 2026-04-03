'use client';

/**
 * useCookies Hook
 *
 * Manages state with cookies. Supports both primitive values
 * and objects with partial updates.
 *
 * @module @omnitron-dev/prism/hooks
 */

import { useMemo, useState, useEffect, useCallback } from 'react';
import type { CookieOptions } from '../utils/cookies.js';
import { setCookie, getCookie, removeCookie } from '../utils/cookies.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Options for useCookies hook.
 */
export interface UseCookiesOptions extends CookieOptions {
  /**
   * If true, initializes the cookie with the initial value if not set.
   * @default true
   */
  initializeWithValue?: boolean;
}

/**
 * Return type for useCookies hook.
 */
export interface UseCookiesReturn<T> {
  /** Current state value */
  state: T;
  /** Reset state to initial value and remove cookie */
  resetState: (defaultState?: T) => void;
  /** Update the entire state or merge partial state (for objects) */
  setState: (updateState: T | Partial<T>) => void;
  /** Update a specific field in an object state */
  setField: <K extends keyof T>(name: K, updateValue: T[K]) => void;
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to manage state with cookies.
 *
 * Automatically syncs state with cookies and supports:
 * - Primitive values (string, number, boolean)
 * - Object values with partial updates
 * - Type-safe field updates
 *
 * @template T - Type of the state value
 * @param key - Cookie name
 * @param initialState - Initial state value
 * @param options - Cookie options
 * @returns State and update functions
 *
 * @example
 * ```tsx
 * // Primitive value
 * const { state, setState, resetState } = useCookies('theme', 'light');
 *
 * // Object value with partial updates
 * const { state, setState, setField, resetState } = useCookies('user', {
 *   name: '',
 *   age: 0,
 *   preferences: { notifications: true },
 * });
 *
 * // Update single field
 * setField('name', 'John');
 *
 * // Partial update
 * setState({ age: 25 });
 *
 * // Reset to initial value
 * resetState();
 * ```
 */
export function useCookies<T>(key: string, initialState: T, options?: UseCookiesOptions): UseCookiesReturn<T> {
  const { initializeWithValue = true, ...cookieOptions } = options ?? {};
  const [state, setStateInternal] = useState<T>(initialState);

  // Initialize from cookie on mount
  useEffect(() => {
    const storedValue = getCookie<T>(key);
    const isObject = initialState !== null && typeof initialState === 'object';

    if (storedValue !== null) {
      if (isObject) {
        // Merge stored value with initial state for object types
        setStateInternal((prev) => ({ ...prev, ...storedValue }));
      } else {
        setStateInternal(storedValue);
      }
    } else if (initializeWithValue) {
      // Initialize cookie with initial value if not set
      setCookie(key, initialState, cookieOptions);
    }
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isObjectState = initialState !== null && typeof initialState === 'object';

  const updateState = useCallback(
    (newState: T | Partial<T>) => {
      if (isObjectState) {
        setStateInternal((prev) => {
          const updatedState = { ...prev, ...newState } as T;
          setCookie(key, updatedState, cookieOptions);
          return updatedState;
        });
      } else {
        setCookie(key, newState as T, cookieOptions);
        setStateInternal(newState as T);
      }
    },
    [cookieOptions, isObjectState, key]
  );

  const updateField = useCallback(
    <K extends keyof T>(fieldName: K, updateValue: T[K]) => {
      if (isObjectState) {
        updateState({ [fieldName]: updateValue } as unknown as Partial<T>);
      } else {
        console.warn('[useCookies] setField is only available for object states. Use setState instead.');
      }
    },
    [isObjectState, updateState]
  );

  const resetState = useCallback(
    (defaultState?: T) => {
      setStateInternal(defaultState ?? initialState);
      removeCookie(key, { path: cookieOptions.path, domain: cookieOptions.domain });
    },
    [initialState, key, cookieOptions.path, cookieOptions.domain]
  );

  return useMemo(
    () => ({
      state,
      setState: updateState,
      setField: updateField,
      resetState,
    }),
    [state, updateState, updateField, resetState]
  );
}
