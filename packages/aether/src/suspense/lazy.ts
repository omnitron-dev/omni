/**
 * Lazy Component Loading
 *
 * Dynamic imports and code splitting with Suspense integration.
 * Supports preloading, error handling, and retry mechanisms.
 */

import { getCurrentSuspenseContext } from './suspense.js';
import type { Component } from '../core/component/types.js';
import type { AsyncComponentLoader, LazyComponent, LazyOptions } from './types.js';

/**
 * Lazy component state
 */
interface LazyComponentState<T = any> {
  status: 'pending' | 'resolved' | 'error';
  component?: Component<T>;
  error?: Error;
  promise?: Promise<Component<T>>;
}

/**
 * Cache for lazy components
 */
const lazyComponentCache = new Map<AsyncComponentLoader, LazyComponentState>();

/**
 * Create a lazy-loaded component
 *
 * Wraps a dynamic import with Suspense integration and error handling.
 *
 * @param loader - Dynamic import function
 * @param options - Lazy loading options
 * @returns Lazy component with preload support
 *
 * @example
 * ```typescript
 * const UserProfile = lazy(() => import('./UserProfile.js'));
 *
 * // With preload
 * const Dashboard = lazy(
 *   () => import('./Dashboard.js'),
 *   { preload: 'idle' }
 * );
 * ```
 */
export function lazy<T = any>(
  loader: AsyncComponentLoader<T>,
  options: LazyOptions = {}
): LazyComponent<T> {
  const {
    preload: preloadStrategy,
    timeout = 0,
    retries = 0,
    onError,
  } = options;

  // Get or create cache entry
  const getState = (): LazyComponentState<T> => {
    let state = lazyComponentCache.get(loader);

    if (!state) {
      state = {
        status: 'pending',
      };
      lazyComponentCache.set(loader, state);
    }

    return state;
  };

  // Load component with retries
  const loadComponent = async (attempt = 0): Promise<Component<T>> => {
    try {
      let loadPromise = loader();

      // Apply timeout if configured
      if (timeout > 0) {
        loadPromise = Promise.race([
          loadPromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Lazy load timeout')), timeout)
          ),
        ]);
      }

      const module = await loadPromise;
      return module.default;
    } catch (error) {
      // Retry logic
      if (attempt < retries) {
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return loadComponent(attempt + 1);
      }

      throw error;
    }
  };

  // Preload function
  const preloadFn = async (): Promise<Component<T> | void> => {
    const state = getState();

    // Already loaded or loading
    if (state.status === 'resolved' || state.promise) {
      return state.promise;
    }

    // Start loading
    const promise = loadComponent();
    state.promise = promise;

    try {
      const component = await promise;
      state.status = 'resolved';
      state.component = component;
      delete state.promise;
    } catch (error) {
      state.status = 'error';
      state.error = error as Error;
      delete state.promise;

      if (onError) {
        onError(error as Error);
      }

      throw error;
    }
  };

  // Auto-preload based on strategy
  if (preloadStrategy === 'eager') {
    preloadFn().catch(() => {
      // Ignore preload errors
    });
  } else if (preloadStrategy === 'idle') {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => {
        preloadFn().catch(() => {
          // Ignore preload errors
        });
      });
    } else {
      setTimeout(() => {
        preloadFn().catch(() => {
          // Ignore preload errors
        });
      }, 1);
    }
  }

  // Create lazy component
  const lazyComponent = ((props: T) => {
    const state = getState();
    const suspenseContext = getCurrentSuspenseContext();

    // Start loading if not started
    if (!state.promise && state.status === 'pending') {
      const promise = loadComponent();
      state.promise = promise;

      // Register with suspense
      if (suspenseContext) {
        suspenseContext.register(promise);
      }

      // Handle resolution
      promise
        .then((component) => {
          state.status = 'resolved';
          state.component = component;
          delete state.promise;
        })
        .catch((error) => {
          state.status = 'error';
          state.error = error;
          delete state.promise;

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
      const Component = state.component;
      return Component ? Component(props) : null;
    }
  }) as LazyComponent<T>;

  // Add utility methods
  lazyComponent.preload = async () => {
    await preloadFn();
  };
  lazyComponent.isLoaded = () => getState().status === 'resolved';

  return lazyComponent;
}

/**
 * Preload a lazy component
 *
 * Starts loading a lazy component without rendering it.
 *
 * @param component - Lazy component to preload
 *
 * @example
 * ```typescript
 * const UserProfile = lazy(() => import('./UserProfile.js'));
 *
 * // Preload on hover
 * <button onMouseEnter={() => preload(UserProfile)}>
 *   View Profile
 * </button>
 * ```
 */
export function preload<T>(component: LazyComponent<T>): Promise<void> {
  return component.preload();
}

/**
 * Check if lazy component is loaded
 *
 * @param component - Lazy component to check
 * @returns True if loaded
 */
export function isLoaded<T>(component: LazyComponent<T>): boolean {
  return component.isLoaded();
}

/**
 * Preload multiple lazy components
 *
 * @param components - Array of lazy components
 * @returns Promise that resolves when all are loaded
 *
 * @example
 * ```typescript
 * await preloadAll([Dashboard, UserProfile, Settings]);
 * ```
 */
export function preloadAll(components: LazyComponent[]): Promise<void[]> {
  return Promise.all(components.map((c) => c.preload()));
}

/**
 * Clear lazy component cache
 *
 * @param loader - Optional loader to clear specific entry
 */
export function clearLazyCache(loader?: AsyncComponentLoader): void {
  if (loader) {
    lazyComponentCache.delete(loader);
  } else {
    lazyComponentCache.clear();
  }
}

/**
 * Lazy load with named exports
 *
 * For importing specific named exports from a module.
 *
 * @param loader - Dynamic import function
 * @param exportName - Name of the export to use
 * @param options - Lazy loading options
 * @returns Lazy component
 *
 * @example
 * ```typescript
 * const UserAvatar = lazyNamed(
 *   () => import('./components.js'),
 *   'Avatar'
 * );
 * ```
 */
export function lazyNamed<T = any>(
  loader: () => Promise<Record<string, any>>,
  exportName: string,
  options: LazyOptions = {}
): LazyComponent<T> {
  const wrappedLoader: AsyncComponentLoader<T> = async () => {
    const module = await loader();
    return { default: module[exportName] };
  };

  return lazy(wrappedLoader, options);
}

/**
 * Create a lazy route component
 *
 * Specialized lazy loader for route components with route-specific options.
 *
 * @param loader - Dynamic import function
 * @param options - Route-specific options
 * @returns Lazy route component
 *
 * @example
 * ```typescript
 * const routes = [
 *   {
 *     path: '/dashboard',
 *     component: lazyRoute(() => import('./Dashboard.js')),
 *   },
 * ];
 * ```
 */
export function lazyRoute<T = any>(
  loader: AsyncComponentLoader<T>,
  options: LazyOptions & {
    prefetchOnHover?: boolean;
    prefetchOnVisible?: boolean;
  } = {}
): LazyComponent<T> {
  const { prefetchOnHover, prefetchOnVisible, ...lazyOptions } = options;

  const component = lazy(loader, lazyOptions);

  // Add route-specific preloading strategies
  if (prefetchOnHover || prefetchOnVisible) {
    // These would be implemented in the router
    // For now, just return the component
  }

  return component;
}

/**
 * Code splitting helper
 *
 * Creates multiple lazy components from a single module with named exports.
 *
 * @param loader - Dynamic import function
 * @param exports - Array of export names to lazily load
 * @returns Object with lazy components
 *
 * @example
 * ```typescript
 * const { UserCard, UserList, UserProfile } = splitCode(
 *   () => import('./user-components.js'),
 *   ['UserCard', 'UserList', 'UserProfile']
 * );
 * ```
 */
export function splitCode<T extends string>(
  loader: () => Promise<Record<string, any>>,
  exports: T[],
  options: LazyOptions = {}
): Record<T, LazyComponent> {
  const result: Record<string, LazyComponent> = {};

  for (const exportName of exports) {
    result[exportName] = lazyNamed(loader, exportName, options);
  }

  return result as Record<T, LazyComponent>;
}

/**
 * Retry failed lazy loads
 *
 * Clears the cache and retries loading a failed lazy component.
 *
 * @param component - Lazy component to retry
 */
export function retryLazy<T>(component: LazyComponent<T>): void {
  // Find the loader in the cache
  for (const [loader, state] of lazyComponentCache.entries()) {
    if (state.status === 'error') {
      // Clear the error state
      lazyComponentCache.delete(loader);
    }
  }

  // Trigger a re-render by calling preload
  component.preload().catch(() => {
    // Error will be thrown on next render
  });
}
