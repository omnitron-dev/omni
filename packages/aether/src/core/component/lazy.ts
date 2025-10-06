/**
 * Lazy Component Loading
 *
 * Utilities for code-splitting and lazy loading components
 */

import type { Component } from './types.js';

/**
 * Component loader function type
 */
export type ComponentLoader<P = {}> = () => Promise<{
  default: Component<P>;
}>;

/**
 * Lazy load a component
 *
 * Creates a component that loads its implementation on demand.
 * Works with Suspense to show fallback UI while loading.
 *
 * @param loader - Function that returns a promise resolving to component module
 * @returns Lazy component
 *
 * @example
 * ```typescript
 * // Define lazy component
 * const HeavyComponent = lazy(() => import('./HeavyComponent'));
 *
 * // Use with Suspense
 * const App = defineComponent(() => {
 *   return () => (
 *     <Suspense fallback={<div>Loading...</div>}>
 *       <HeavyComponent />
 *     </Suspense>
 *   );
 * });
 * ```
 */
export function lazy<P = {}>(loader: ComponentLoader<P>): Component<P> {
  // Cache for loaded component
  let loadedComponent: Component<P> | null = null;
  let loadingPromise: Promise<Component<P>> | null = null;
  let loadError: Error | null = null;

  const LazyComponent: Component<P> = (props: P): any => {
    // If already loaded, use cached component
    if (loadedComponent) {
      return loadedComponent(props);
    }

    // If loading failed, throw error (caught by ErrorBoundary)
    if (loadError) {
      throw loadError;
    }

    // If not loading yet, start loading
    if (!loadingPromise) {
      loadingPromise = loader()
        .then((module) => {
          loadedComponent = module.default;
          return loadedComponent;
        })
        .catch((error) => {
          loadError = error;
          loadingPromise = null; // Allow retry
          throw error;
        });
    }

    // Throw promise (caught by Suspense)
    throw loadingPromise;
  };

  // Set display name for debugging
  LazyComponent.displayName = 'Lazy';

  return LazyComponent;
}

/**
 * Preload a lazy component
 *
 * Starts loading the component without rendering it.
 * Useful for prefetching on route enter or hover.
 *
 * @param lazyComponent - Lazy component to preload
 * @returns Promise that resolves when component is loaded
 *
 * @example
 * ```typescript
 * const HeavyComponent = lazy(() => import('./HeavyComponent'));
 *
 * // Preload on route enter
 * router.onBeforeEnter('/heavy', async () => {
 *   await preloadComponent(HeavyComponent);
 * });
 *
 * // Preload on hover
 * <Link href="/heavy" onMouseEnter={() => preloadComponent(HeavyComponent)}>
 *   Go to heavy page
 * </Link>
 * ```
 */
export function preloadComponent<P>(
  lazyComponent: Component<P>
): Promise<void> {
  // Try to trigger component loading by calling it
  // The promise will be thrown, which we catch
  try {
    lazyComponent({} as P);
  } catch (promise) {
    if (promise instanceof Promise) {
      return promise.then(() => {});
    }
  }

  // Already loaded
  return Promise.resolve();
}
