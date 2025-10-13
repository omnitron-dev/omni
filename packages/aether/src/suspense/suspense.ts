/**
 * Suspense Boundary Component
 *
 * Implements React 18-style Suspense boundaries with:
 * - Automatic promise tracking
 * - Nested suspense support
 * - Timeout handling
 * - SSR streaming integration
 */

import { signal } from '../core/reactivity/signal.js';
import { effect } from '../core/reactivity/effect.js';
import { createContext, useContext } from '../core/component/context.js';
import type { SuspenseProps, SuspenseContext, SuspenseState } from './types.js';

/**
 * Global suspense context stack
 */
const suspenseContextStack: SuspenseContext[] = [];

/**
 * Context for parent suspense boundary
 */
const SuspenseContextAPI = createContext<SuspenseContext | null>(null);

/**
 * Get current suspense context
 */
export function getCurrentSuspenseContext(): SuspenseContext | null {
  return suspenseContextStack[suspenseContextStack.length - 1] || null;
}

/**
 * Suspense ID counter
 */
let suspenseIdCounter = 0;

/**
 * Create a suspense context
 */
function createSuspenseContext(id: string): SuspenseContext {
  const pending = new Set<Promise<any>>();
  const completed = new Set<Promise<any>>();
  const stateSignal = signal<SuspenseState>('resolved');

  const context: SuspenseContext = {
    id,
    get state() {
      return stateSignal();
    },
    pending,
    error: undefined,

    register(promise: Promise<any>) {
      // Don't re-register completed promises
      if (completed.has(promise)) {
        return;
      }

      // Don't re-register pending promises
      if (pending.has(promise)) {
        return;
      }

      pending.add(promise);
      stateSignal.set('pending');

      promise
        .then(() => {
          pending.delete(promise);
          completed.add(promise);
          if (pending.size === 0) {
            stateSignal.set('resolved');
            context.error = undefined;
          }
        })
        .catch((error) => {
          pending.delete(promise);
          completed.add(promise);
          if (pending.size === 0) {
            stateSignal.set('error');
            context.error = error;
          }
        });
    },

    reset() {
      pending.clear();
      completed.clear();
      stateSignal.set('resolved');
      context.error = undefined;
    },
  };

  return context;
}

/**
 * Suspense boundary component
 *
 * Catches promises thrown by children and shows fallback while loading.
 *
 * @example
 * ```tsx
 * <Suspense fallback={<LoadingSpinner />}>
 *   <AsyncComponent />
 * </Suspense>
 * ```
 */
export function Suspense(props: SuspenseProps): any {
  const {
    fallback,
    children,
    name = `suspense-${++suspenseIdCounter}`,
    timeout = 0,
    onSuspend,
    onResolve,
    onTimeout,
  } = props;

  // Create suspense context
  const context = createSuspenseContext(name);

  // Track state
  const stateSignal = signal<SuspenseState>('resolved');
  const errorSignal = signal<Error | undefined>(undefined);
  const childrenCache = signal<any>(null);

  // Timeout handling
  let timeoutId: any = null;

  // Setup state change handler
  const handleStateChange = () => {
    const newState = context.state;
    const prevState = stateSignal.peek();

    if (newState === prevState) {
      return;
    }

    stateSignal.set(newState);

    if (newState === 'pending') {
      onSuspend?.();

      // Set timeout if configured
      if (timeout > 0 && !timeoutId) {
        timeoutId = setTimeout(() => {
          if (context.state === 'pending') {
            onTimeout?.();
          }
        }, timeout);
      }
    } else if (newState === 'resolved') {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      onResolve?.();
    } else if (newState === 'error') {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      errorSignal.set(context.error);
    }
  };

  // Watch context state changes and trigger callbacks
  effect(() => {
    // Read the context state to make this effect reactive
    const _state = context.state;
    handleStateChange();
  });

  // Create the render function
  const renderFn = () => {
    // Push context onto stack before rendering
    suspenseContextStack.push(context);

    try {
      // Get current state
      const state = context.state;

      // If already in pending state, return fallback immediately
      if (state === 'pending') {
        suspenseContextStack.pop();
        return typeof fallback === 'function' ? fallback() : fallback || null;
      }
      // Note: We don't check for error state here because we want to let children
      // throw their own errors which can be caught by error boundaries

      // State is resolved, try to render children
      try {
        let result = typeof children === 'function' ? children() : children;

        // If result is a function (like another component's setup function), call it
        // This handles nested components like nested Suspense
        if (typeof result === 'function') {
          result = result();
        }

        childrenCache.set(result);
        suspenseContextStack.pop();
        return result;
      } catch (thrown) {
        // Check if it's a promise (suspense)
        if (thrown instanceof Promise) {
          // Register the promise
          context.register(thrown);
          suspenseContextStack.pop();
          // Return fallback while suspended
          return typeof fallback === 'function' ? fallback() : fallback || null;
        }
        // Re-throw non-promise errors
        suspenseContextStack.pop();
        throw thrown;
      }
    } catch (error) {
      suspenseContextStack.pop();
      throw error;
    }
  };

  // Do an initial render to trigger any suspense
  try {
    renderFn();
  } catch (error) {
    // Only ignore promise throws (suspense), re-throw actual errors
    if (!(error instanceof Promise)) {
      // This is a real error, not a suspense - but don't throw it during setup
      // Just let it be thrown on next render
    }
  }

  // Return setup function that returns render function
  return () => renderFn;
}

/**
 * Suspend execution with a promise
 *
 * Throws a promise that will be caught by the nearest Suspense boundary.
 *
 * @param promise - Promise to suspend with
 *
 * @example
 * ```typescript
 * const data = suspend(fetchData());
 * ```
 */
export function suspend<T>(promise: Promise<T>): T {
  const context = getCurrentSuspenseContext();

  if (!context) {
    throw new Error('suspend() called outside of a Suspense boundary');
  }

  // Check if this promise is still pending
  if (context.pending.has(promise)) {
    // Still pending, throw it
    throw promise;
  }

  // Promise is not pending - either resolved or never registered
  // We need to track promises that have been seen before
  // For now, always register new promises
  // The context will handle deduplication
  context.register(promise);

  // After registration, check if it's pending
  if (context.pending.has(promise)) {
    throw promise;
  }

  // Promise resolved immediately or was already resolved
  return undefined as T;
}

/**
 * Use suspense to wrap async operations
 *
 * Returns a function that when called will suspend if the promise is pending.
 *
 * @param fetcher - Async function to wrap
 * @returns Wrapped function that suspends
 *
 * @example
 * ```typescript
 * const getData = useSuspense(() => fetchData());
 * const data = getData(); // Suspends on first call
 * ```
 */
export function useSuspense<T>(fetcher: () => Promise<T>): () => T {
  const cache = signal<{ status: 'pending' | 'resolved' | 'error'; value?: T; error?: Error }>({
    status: 'pending',
  });

  // Start fetching immediately
  const promise = fetcher();

  promise
    .then((value) => {
      cache.set({ status: 'resolved', value });
    })
    .catch((error) => {
      cache.set({ status: 'error', error });
    });

  return () => {
    const entry = cache();

    if (entry.status === 'pending') {
      suspend(promise);
    } else if (entry.status === 'error') {
      throw entry.error;
    }

    return entry.value as T;
  };
}

/**
 * Create a suspense-compatible resource
 *
 * Similar to resource() but throws promises for Suspense integration.
 *
 * @param fetcher - Async data fetcher
 * @returns Resource accessor
 *
 * @example
 * ```typescript
 * const getUser = createSuspenseResource(() => fetchUser(userId()));
 * const user = getUser(); // Suspends while loading
 * ```
 */
export function createSuspenseResource<T>(fetcher: () => Promise<T>): () => T {
  const cache = signal<{
    status: 'pending' | 'resolved' | 'error';
    value?: T;
    error?: Error;
    promise?: Promise<T>;
  }>({
    status: 'pending',
  });

  // Create effect to track dependencies and refetch
  effect(() => {
    const promise = fetcher();

    cache.set({ status: 'pending', promise });

    promise
      .then((value) => {
        cache.set({ status: 'resolved', value });
      })
      .catch((error) => {
        cache.set({ status: 'error', error });
      });
  });

  return () => {
    const entry = cache();

    if (entry.status === 'pending') {
      // Use the cached promise from the effect
      if (entry.promise) {
        suspend(entry.promise);
      }
      // This shouldn't happen, but return undefined as fallback
      return undefined as T;
    } else if (entry.status === 'error') {
      throw entry.error;
    }

    return entry.value as T;
  };
}

/**
 * Suspense list for coordinating multiple suspense boundaries
 *
 * Controls the order in which suspense boundaries resolve.
 *
 * @param props - Suspense list props
 *
 * @example
 * ```tsx
 * <SuspenseList revealOrder="forwards">
 *   <Suspense fallback={<div>Loading 1...</div>}>
 *     <Component1 />
 *   </Suspense>
 *   <Suspense fallback={<div>Loading 2...</div>}>
 *     <Component2 />
 *   </Suspense>
 * </SuspenseList>
 * ```
 */
export function SuspenseList(props: {
  children?: any;
  revealOrder?: 'forwards' | 'backwards' | 'together';
  tail?: 'collapsed' | 'hidden';
}): any {
  const { children } = props;

  // For now, just render children
  // Full implementation would coordinate child suspense boundaries
  return () => (typeof children === 'function' ? children() : children);
}

/**
 * Hook to access parent suspense context
 */
export function useSuspenseContext(): SuspenseContext | null {
  return useContext(SuspenseContextAPI);
}

/**
 * Reset suspense ID counter (for testing)
 */
export function resetSuspenseIdCounter(): void {
  suspenseIdCounter = 0;
}
