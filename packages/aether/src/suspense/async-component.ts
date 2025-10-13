/**
 * Async Component Support
 *
 * Supports async components that can suspend during rendering.
 * Integrates with Suspense boundaries for loading states.
 */

import { getCurrentSuspenseContext } from './suspense.js';
import type { Component } from '../core/component/types.js';

/**
 * Async component state
 */
interface AsyncComponentState<T> {
  status: 'pending' | 'resolved' | 'error';
  value?: T;
  error?: Error;
  promise?: Promise<T>;
}

/**
 * Cache for async component results
 */
const asyncComponentCache = new Map<string, AsyncComponentState<any>>();

/**
 * Create an async component
 *
 * Wraps an async function that returns a component, making it suspense-compatible.
 *
 * @param fn - Async function that returns component
 * @param options - Options for caching and error handling
 * @returns Async component
 *
 * @example
 * ```typescript
 * const UserProfile = createAsyncComponent(async () => {
 *   const user = await fetchUser();
 *   return () => <div>{user.name}</div>;
 * });
 * ```
 */
export function createAsyncComponent<P = any>(
  fn: (props: P) => Promise<Component<P>>,
  options: {
    cacheKey?: (props: P) => string;
    onError?: (error: Error) => void;
  } = {}
): (props: P) => any {
  const { cacheKey, onError } = options;

  return (props: P) => {
    const key = cacheKey ? cacheKey(props) : 'default';
    const suspenseContext = getCurrentSuspenseContext();

    // Get or create cache entry
    let state = asyncComponentCache.get(key);

    if (!state) {
      // Create new cache entry
      const promise = fn(props);

      state = {
        status: 'pending',
        promise,
      };

      asyncComponentCache.set(key, state);

      // Register with suspense context
      if (suspenseContext) {
        suspenseContext.register(promise);
      }

      // Handle resolution
      promise
        .then((component) => {
          const entry = asyncComponentCache.get(key);
          if (entry) {
            entry.status = 'resolved';
            entry.value = component;
            delete entry.promise;
          }
        })
        .catch((error) => {
          const entry = asyncComponentCache.get(key);
          if (entry) {
            entry.status = 'error';
            entry.error = error;
            delete entry.promise;
          }

          if (onError) {
            onError(error);
          }
        });
    }

    // Return based on state
    if (state.status === 'pending') {
      if (suspenseContext && state.promise) {
        suspenseContext.register(state.promise);
      }
      throw state.promise;
    } else if (state.status === 'error') {
      throw state.error;
    } else {
      const Component = state.value;
      return Component ? Component(props) : null;
    }
  };
}

/**
 * Clear async component cache
 *
 * @param key - Optional key to clear specific entry
 */
export function clearAsyncComponentCache(key?: string): void {
  if (key) {
    asyncComponentCache.delete(key);
  } else {
    asyncComponentCache.clear();
  }
}

/**
 * Async component wrapper with automatic caching
 *
 * Higher-order component that makes any component async-compatible.
 *
 * @param Component - Component to wrap
 * @param dataFetcher - Async function to fetch data
 * @returns Async component
 *
 * @example
 * ```typescript
 * const UserProfile = asyncComponent(
 *   ({ userId }) => <div>User {userId}</div>,
 *   async ({ userId }) => {
 *     const user = await fetchUser(userId);
 *     return { user };
 *   }
 * );
 * ```
 */
export function asyncComponent<T, P = any>(
  Component: (props: P & T) => any,
  dataFetcher: (props: P) => Promise<T>,
  options: {
    cacheKey?: (props: P) => string;
    onError?: (error: Error) => void;
  } = {}
): (props: P) => any {
  const { cacheKey = (props) => JSON.stringify(props), onError } = options;

  return (props: P) => {
    const key = cacheKey(props);
    const suspenseContext = getCurrentSuspenseContext();

    // Get or create cache entry
    let state = asyncComponentCache.get(key);

    if (!state) {
      // Create new cache entry
      const promise = dataFetcher(props);

      state = {
        status: 'pending',
        promise,
      };

      asyncComponentCache.set(key, state);

      // Register with suspense context
      if (suspenseContext) {
        suspenseContext.register(promise);
      }

      // Handle resolution
      promise
        .then((data) => {
          const entry = asyncComponentCache.get(key);
          if (entry) {
            entry.status = 'resolved';
            entry.value = data;
            delete entry.promise;
          }
        })
        .catch((error) => {
          const entry = asyncComponentCache.get(key);
          if (entry) {
            entry.status = 'error';
            entry.error = error;
            delete entry.promise;
          }

          if (onError) {
            onError(error);
          }
        });
    }

    // Return based on state
    if (state.status === 'pending') {
      if (suspenseContext && state.promise) {
        suspenseContext.register(state.promise);
      }
      throw state.promise;
    } else if (state.status === 'error') {
      throw state.error;
    } else {
      return Component({ ...props, ...state.value });
    }
  };
}

/**
 * Use async data within a component
 *
 * Hook for fetching async data that integrates with Suspense.
 *
 * @param fetcher - Async data fetcher
 * @param deps - Dependencies that trigger refetch
 * @returns Data
 *
 * @example
 * ```typescript
 * function UserProfile({ userId }) {
 *   const user = useAsync(() => fetchUser(userId), [userId]);
 *   return <div>{user.name}</div>;
 * }
 * ```
 */
export function useAsync<T>(fetcher: () => Promise<T>, deps: any[] = []): T {
  const key = JSON.stringify(deps);
  const suspenseContext = getCurrentSuspenseContext();

  // Get or create cache entry
  let state = asyncComponentCache.get(key);

  if (!state) {
    // Create new cache entry
    const promise = fetcher();

    state = {
      status: 'pending',
      promise,
    };

    asyncComponentCache.set(key, state);

    // Register with suspense context
    if (suspenseContext) {
      suspenseContext.register(promise);
    }

    // Handle resolution
    promise
      .then((data) => {
        const entry = asyncComponentCache.get(key);
        if (entry) {
          entry.status = 'resolved';
          entry.value = data;
          delete entry.promise;
        }
      })
      .catch((error) => {
        const entry = asyncComponentCache.get(key);
        if (entry) {
          entry.status = 'error';
          entry.error = error;
          delete entry.promise;
        }
      });
  }

  // Return based on state
  if (state.status === 'pending') {
    if (suspenseContext && state.promise) {
      suspenseContext.register(state.promise);
    }
    throw state.promise;
  } else if (state.status === 'error') {
    throw state.error;
  } else {
    return state.value as T;
  }
}

/**
 * Prefetch async data
 *
 * Starts fetching data without suspending.
 *
 * @param fetcher - Async data fetcher
 * @param deps - Dependencies for cache key
 *
 * @example
 * ```typescript
 * // Prefetch on hover
 * <button onMouseEnter={() => prefetch(() => fetchUser(userId), [userId])}>
 *   View Profile
 * </button>
 * ```
 */
export function prefetch<T>(fetcher: () => Promise<T>, deps: any[] = []): Promise<T> {
  const key = JSON.stringify(deps);

  // Check if already cached
  const existing = asyncComponentCache.get(key);
  if (existing?.promise) {
    return existing.promise;
  }

  // Create new cache entry
  const promise = fetcher();

  const state: AsyncComponentState<T> = {
    status: 'pending',
    promise,
  };

  asyncComponentCache.set(key, state);

  // Handle resolution
  promise
    .then((data) => {
      const entry = asyncComponentCache.get(key);
      if (entry) {
        entry.status = 'resolved';
        entry.value = data;
        delete entry.promise;
      }
    })
    .catch((error) => {
      const entry = asyncComponentCache.get(key);
      if (entry) {
        entry.status = 'error';
        entry.error = error;
        delete entry.promise;
      }
    });

  return promise;
}

/**
 * Check if async data is cached
 *
 * @param deps - Dependencies for cache key
 * @returns True if cached and resolved
 */
export function isCached(deps: any[] = []): boolean {
  const key = JSON.stringify(deps);
  const state = asyncComponentCache.get(key);
  return state?.status === 'resolved';
}

/**
 * Get cached data without suspending
 *
 * @param deps - Dependencies for cache key
 * @returns Cached data or undefined
 */
export function getCached<T>(deps: any[] = []): T | undefined {
  const key = JSON.stringify(deps);
  const state = asyncComponentCache.get(key);
  return state?.status === 'resolved' ? state.value : undefined;
}

/**
 * Invalidate async data cache
 *
 * @param deps - Dependencies for cache key, or undefined to clear all
 */
export function invalidateAsync(deps?: any[]): void {
  if (deps === undefined) {
    asyncComponentCache.clear();
  } else {
    const key = JSON.stringify(deps);
    asyncComponentCache.delete(key);
  }
}
