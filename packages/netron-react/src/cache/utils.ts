/**
 * Cache utility functions
 */

import type { QueryKey, QueryFilters, Query } from '../core/types.js';

/**
 * Generate a stable hash for a query key
 */
export function hashQueryKey(queryKey: QueryKey): string {
  return JSON.stringify(queryKey, (_, val) => {
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      // Sort object keys for stable serialization
      return Object.keys(val)
        .sort()
        .reduce(
          (acc, key) => {
            acc[key] = val[key];
            return acc;
          },
          {} as Record<string, unknown>
        );
    }
    return val;
  });
}

/**
 * Check if two query keys match (exact or partial)
 */
export function matchQueryKey(queryKey: QueryKey, matchKey: QueryKey, exact: boolean = false): boolean {
  if (exact) {
    return hashQueryKey(queryKey) === hashQueryKey(matchKey);
  }

  // Partial match - matchKey should be prefix of queryKey
  if (matchKey.length > queryKey.length) {
    return false;
  }

  for (let i = 0; i < matchKey.length; i++) {
    if (!deepEqual(queryKey[i], matchKey[i])) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a query key partially matches another
 */
export function partialMatchKey(queryKey: QueryKey, partialKey: QueryKey): boolean {
  return matchQueryKey(queryKey, partialKey, false);
}

/**
 * Deep equality check
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (typeof a !== typeof b) return false;

  if (a === null || b === null) return a === b;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((val, i) => deepEqual(val, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const keysA = Object.keys(a as object);
    const keysB = Object.keys(b as object);

    if (keysA.length !== keysB.length) return false;

    return keysA.every((key) => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
  }

  return false;
}

/**
 * Apply query filters to find matching queries
 */
export function matchQueryFilters(query: Query, filters?: QueryFilters): boolean {
  if (!filters) return true;

  // Filter by query key
  if (filters.queryKey) {
    if (!matchQueryKey(query.queryKey, filters.queryKey, filters.exact)) {
      return false;
    }
  }

  // Filter by status
  if (filters.status && query.state.status !== filters.status) {
    return false;
  }

  // Filter by stale state
  if (filters.stale !== undefined) {
    const isStale = query.state.isInvalidated || Date.now() > query.state.dataUpdatedAt;
    if (filters.stale !== isStale) {
      return false;
    }
  }

  // Custom predicate
  if (filters.predicate && !filters.predicate(query)) {
    return false;
  }

  return true;
}

/**
 * Create an abort controller with timeout
 */
export function createAbortSignal(timeout?: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (timeout) {
    timeoutId = setTimeout(() => {
      controller.abort(new Error(`Query timeout after ${timeout}ms`));
    }, timeout);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId) clearTimeout(timeoutId);
      controller.abort();
    },
  };
}

/**
 * Schedule microtask
 */
export function scheduleMicrotask(callback: () => void): void {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(callback);
  } else {
    Promise.resolve().then(callback);
  }
}

/**
 * Batch updates
 */
export function batchUpdates(callback: () => void): void {
  // In React 18+, updates are automatically batched
  // This function exists for potential future optimization
  callback();
}

/**
 * Time utilities
 */
export const timeUtils = {
  now: () => Date.now(),
  isExpired: (timestamp: number, duration: number) => Date.now() > timestamp + duration,
  timeUntilExpiry: (timestamp: number, duration: number) => Math.max(0, timestamp + duration - Date.now()),
};

/**
 * Retry delay calculator
 */
export function calculateRetryDelay(
  attempt: number,
  config: { initialDelay?: number; maxDelay?: number; backoff?: 'exponential' | 'linear' | 'constant' }
): number {
  const { initialDelay = 1000, maxDelay = 30000, backoff = 'exponential' } = config;

  let delay: number;

  switch (backoff) {
    case 'exponential':
      delay = initialDelay * Math.pow(2, attempt - 1);
      break;
    case 'linear':
      delay = initialDelay * attempt;
      break;
    case 'constant':
    default:
      delay = initialDelay;
  }

  // Add jitter (0-10%)
  const jitter = delay * Math.random() * 0.1;

  return Math.min(delay + jitter, maxDelay);
}

/**
 * Generate unique ID
 */
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Check if a value is a plain object (not an array, Date, RegExp, etc.)
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  // Check for plain object: prototype is Object.prototype or null (Object.create(null))
  return proto === Object.prototype || proto === null;
}

/**
 * Structural sharing optimization - replaces equal values deep in the tree
 * with references from the original data structure.
 *
 * This prevents unnecessary re-renders by preserving referential equality
 * for unchanged parts of the data structure.
 *
 * @param a - The original/previous data
 * @param b - The new data to compare against
 * @returns The new data with unchanged parts referencing the original
 *
 * @example
 * const old = { user: { name: 'John', age: 30 }, meta: { count: 1 } };
 * const new_ = { user: { name: 'John', age: 30 }, meta: { count: 2 } };
 * const result = replaceEqualDeep(old, new_);
 * // result.user === old.user (same reference - unchanged)
 * // result.meta !== old.meta (new reference - changed)
 */
export function replaceEqualDeep<T>(a: T, b: T): T {
  // Identical references - return original
  if (a === b) {
    return a;
  }

  // Use Object.is for edge cases like NaN and -0
  if (Object.is(a, b)) {
    return a;
  }

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    // Different lengths means structural change
    if (a.length !== b.length) {
      return b;
    }

    let hasChanges = false;
    const result: unknown[] = [];

    for (let i = 0; i < b.length; i++) {
      const newItem = replaceEqualDeep(a[i], b[i]);
      result.push(newItem);
      if (newItem !== a[i]) {
        hasChanges = true;
      }
    }

    // If no changes, return original array reference
    return hasChanges ? (result as T) : a;
  }

  // Handle plain objects
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);

    // Different number of keys means structural change
    if (aKeys.length !== bKeys.length) {
      return b;
    }

    // Check if all keys in b exist in a
    for (const key of bKeys) {
      if (!(key in a)) {
        return b;
      }
    }

    let hasChanges = false;
    const result: Record<string, unknown> = {};

    for (const key of bKeys) {
      const newValue = replaceEqualDeep(a[key], b[key]);
      result[key] = newValue;
      if (newValue !== a[key]) {
        hasChanges = true;
      }
    }

    // If no changes, return original object reference
    return hasChanges ? (result as T) : a;
  }

  // For all other cases (primitives with different values, type mismatches,
  // special objects like Date, RegExp, Map, Set, etc.), return the new value
  return b;
}
