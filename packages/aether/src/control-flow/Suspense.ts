/**
 * Suspense - Handle async rendering with fallback
 *
 * Shows fallback while async components/resources are loading
 */

import { defineComponent } from '../core/component/define.js';
import { signal } from '../core/reactivity/signal.js';

export interface SuspenseProps {
  /**
   * Fallback to show while loading
   */
  fallback: any;

  /**
   * Children (potentially async)
   */
  children: any;
}

/**
 * Track pending promises for Suspense
 */
const suspenseContext = new WeakMap<any, Set<Promise<any>>>();

/**
 * Register a promise with current Suspense boundary
 */
export function trackPromise(promise: Promise<any>, boundary: any): void {
  if (!suspenseContext.has(boundary)) {
    suspenseContext.set(boundary, new Set());
  }
  const promises = suspenseContext.get(boundary)!;
  promises.add(promise);

  promise.finally(() => {
    promises.delete(promise);
  });
}

/**
 * Suspense component
 *
 * Displays fallback while async operations are pending
 *
 * @example
 * ```tsx
 * <Suspense fallback={<LoadingSpinner />}>
 *   <AsyncComponent />
 * </Suspense>
 * ```
 *
 * @example
 * ```tsx
 * const UserProfile = defineComponent(() => {
 *   const user = resource(() => fetchUser());
 *
 *   return () => (
 *     <Suspense fallback={<div>Loading user...</div>}>
 *       <div>{user().name}</div>
 *     </Suspense>
 *   );
 * });
 * ```
 */
export const Suspense = defineComponent<SuspenseProps>((props) => {
  const isLoading = signal(false);
  const error = signal<Error | null>(null);
  const boundary = {};

  // Track if children threw a promise
  let pendingPromise: Promise<any> | null = null;

  // Render function
  return () => {
    // Reset error
    error.set(null);

    try {
      // Try to render children
      const children = props.children;

      // If we have a pending promise, show fallback
      if (pendingPromise && isLoading()) {
        return props.fallback;
      }

      // Check if there are any pending promises in context
      const promises = suspenseContext.get(boundary);
      if (promises && promises.size > 0) {
        isLoading.set(true);

        // Wait for all promises
        Promise.all(Array.from(promises))
          .then(() => {
            isLoading.set(false);
          })
          .catch((err) => {
            error.set(err);
            isLoading.set(false);
          });

        return props.fallback;
      }

      isLoading.set(false);
      return children;
    } catch (err) {
      // If error is a promise (thrown by async component), handle it
      if (err instanceof Promise) {
        isLoading.set(true);
        pendingPromise = err;

        err
          .then(() => {
            isLoading.set(false);
            pendingPromise = null;
          })
          .catch((e) => {
            error.set(e);
            isLoading.set(false);
            pendingPromise = null;
          });

        return props.fallback;
      }

      // Re-throw other errors
      throw err;
    }
  };
});
