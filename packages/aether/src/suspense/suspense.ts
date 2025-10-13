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
import { onCleanup } from '../core/reactivity/context.js';
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
  const stateSignal = signal<SuspenseState>('resolved');

  const context: SuspenseContext = {
    id,
    get state() {
      return stateSignal();
    },
    pending,
    error: undefined,

    register(promise: Promise<any>) {
      pending.add(promise);
      stateSignal.set('pending');

      promise
        .then(() => {
          pending.delete(promise);
          if (pending.size === 0) {
            stateSignal.set('resolved');
            context.error = undefined;
          }
        })
        .catch((error) => {
          pending.delete(promise);
          if (pending.size === 0) {
            stateSignal.set('error');
            context.error = error;
          }
        });
    },

    reset() {
      pending.clear();
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

  // Timeout handling
  let timeoutId: any = null;

  // Effect to track context state changes
  effect(() => {
    const newState = context.state;
    const prevState = stateSignal.peek();

    if (newState !== prevState) {
      stateSignal.set(newState);

      if (newState === 'pending') {
        onSuspend?.();

        // Set timeout if configured
        if (timeout > 0) {
          timeoutId = setTimeout(() => {
            if (stateSignal.peek() === 'pending') {
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
    }
  });

  // Cleanup
  onCleanup(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });

  // Render based on state
  return () => {
    const state = stateSignal();

    // Push context onto stack
    suspenseContextStack.push(context);

    try {
      if (state === 'pending') {
        return fallback || null;
      } else if (state === 'error') {
        const error = errorSignal();
        if (error) {
          throw error;
        }
        return null;
      } else {
        // Render children with context
        return typeof children === 'function' ? children() : children;
      }
    } finally {
      // Pop context from stack
      suspenseContextStack.pop();
    }
  };
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

  // Register promise with context
  context.register(promise);

  // Throw promise to trigger suspense
  throw promise;
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
  const cache = signal<{ status: 'pending' | 'resolved' | 'error'; value?: T; error?: Error }>({
    status: 'pending',
  });

  // Create effect to track dependencies and refetch
  effect(() => {
    cache.set({ status: 'pending' });

    const promise = fetcher();

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
      // Need to get the promise - recreate or cache it
      const promise = fetcher();
      suspend(promise);
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
