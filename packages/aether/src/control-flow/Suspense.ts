/**
 * Suspense - Handle async rendering with fallback
 *
 * Shows fallback while async components/resources are loading
 */

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
 * Note: Suspense is a plain function, not a defineComponent, because it needs to
 * return children as-is without wrapping them in DOM nodes.
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
export function Suspense(props: SuspenseProps): any {
  try {
    // Try to render children
    const children = props.children;

    // For now, just return children directly
    // In a full implementation, this would check for pending promises
    // and show fallback while loading
    return children;
  } catch (err) {
    // If error is a promise (thrown by async component), return fallback
    if (err instanceof Promise) {
      // In a full implementation, we'd track this promise and re-render when it resolves
      return props.fallback;
    }

    // Re-throw other errors
    throw err;
  }
}
