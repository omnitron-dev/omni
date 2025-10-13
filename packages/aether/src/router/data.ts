/**
 * Router - Data Loading System
 *
 * Loaders, actions, and data hooks for routes
 */

import { signal } from '../core/reactivity/signal.js';
import type { Signal } from '../core/reactivity/types.js';
import { effect } from '../core/reactivity/effect.js';
import { onCleanup } from '../core/reactivity/context.js';
import { useRouter } from './hooks.js';
import type { LoaderContext, ActionContext, RouteLoader, RouteAction } from './types.js';

/**
 * Global loader data storage
 */
const loaderDataMap = new Map<string, any>();

/**
 * Global action data storage
 */
const actionDataMap = new Map<string, any>();

/**
 * Navigation state signal
 */
const navigationState = signal<{
  state: 'idle' | 'loading' | 'submitting';
  location?: string;
}>({ state: 'idle' });

/**
 * Set loader data for a route
 */
export function setLoaderData(path: string, data: any): void {
  loaderDataMap.set(path, data);
}

/**
 * Set action data for a route
 */
export function setActionData(path: string, data: any): void {
  actionDataMap.set(path, data);
}

/**
 * Set navigation state
 */
export function setNavigationState(state: 'idle' | 'loading' | 'submitting', location?: string): void {
  navigationState.set({ state, location });
}

/**
 * Execute loader for a route
 *
 * @param loader - Loader function
 * @param context - Loader context
 * @returns Loader result
 */
export async function executeLoader(loader: RouteLoader, context: LoaderContext): Promise<any> {
  try {
    return await loader(context);
  } catch (error) {
    console.error('Loader error:', error);
    throw error;
  }
}

/**
 * Execute action for a route
 *
 * @param action - Action function
 * @param context - Action context
 * @returns Action result
 */
export async function executeAction(action: RouteAction, context: ActionContext): Promise<any> {
  try {
    return await action(context);
  } catch (error) {
    console.error('Action error:', error);
    throw error;
  }
}

/**
 * Hook to access loader data for current route
 *
 * @returns Signal with loader data
 *
 * @example
 * ```typescript
 * const Component = defineComponent(() => {
 *   const user = useLoaderData<User>();
 *
 *   return () => <div>{user()?.name}</div>;
 * });
 * ```
 */
export function useLoaderData<T = any>(): Signal<T | undefined> {
  const router = useRouter();
  const dataSignal = signal<T | undefined>(undefined);

  // Get data for current route
  const updateData = () => {
    const currentPath = router.current.pathname;
    const data = loaderDataMap.get(currentPath);
    if (data !== dataSignal()) {
      dataSignal.set(data);
    }
  };

  // Update initially
  updateData();

  // Subscribe to route changes
  // Router.current is reactive (signal), so effect will re-run on navigation
  const disposable = effect(() => {
    // Access router.current to create reactivity dependency
    const _current = router.current;
    void _current; // Suppress unused var warning

    // Update data when route changes
    updateData();
  });

  // Cleanup subscription on component unmount
  onCleanup(() => {
    disposable.dispose();
  });

  return dataSignal;
}

/**
 * Hook to access action data for current route
 *
 * @returns Signal with action data
 *
 * @example
 * ```typescript
 * const Component = defineComponent(() => {
 *   const actionData = useActionData();
 *
 *   return () => (
 *     <div>
 *       {actionData()?.success && <div>Success!</div>}
 *     </div>
 *   );
 * });
 * ```
 */
export function useActionData<T = any>(): Signal<T | undefined> {
  const router = useRouter();
  const dataSignal = signal<T | undefined>(undefined);

  // Get data for current route
  const updateData = () => {
    const currentPath = router.current.pathname;
    const data = actionDataMap.get(currentPath);
    if (data !== dataSignal()) {
      dataSignal.set(data);
    }
  };

  // Update initially
  updateData();

  // Subscribe to route changes
  // Router.current is reactive (signal), so effect will re-run on navigation
  const disposable = effect(() => {
    // Access router.current to create reactivity dependency
    const _current = router.current;
    void _current; // Suppress unused var warning

    // Update data when route changes
    updateData();
  });

  // Cleanup subscription on component unmount
  onCleanup(() => {
    disposable.dispose();
  });

  return dataSignal;
}

/**
 * Hook to access navigation state
 *
 * @returns Navigation state signal
 *
 * @example
 * ```typescript
 * const Component = defineComponent(() => {
 *   const navigation = useNavigation();
 *
 *   return () => (
 *     <div>
 *       {navigation().state === 'loading' && <Spinner />}
 *     </div>
 *   );
 * });
 * ```
 */
export function useNavigation(): Signal<{ state: 'idle' | 'loading' | 'submitting'; location?: string }> {
  return navigationState;
}

/**
 * Fetcher for programmatic mutations
 */
export interface Fetcher {
  /** Current fetcher state */
  state: 'idle' | 'submitting' | 'loading';
  /** Fetcher data */
  data: any;
  /** Submit data to action */
  submit: (data: any, options?: { method?: string; action?: string }) => Promise<void>;
  /** Load data from loader */
  load: (href: string) => Promise<void>;
}

/**
 * Hook to create a fetcher for programmatic mutations
 *
 * @returns Fetcher object
 *
 * @example
 * ```typescript
 * const Component = defineComponent(() => {
 *   const fetcher = useFetcher();
 *
 *   const handleLike = () => {
 *     fetcher.submit({ action: 'like', postId: '123' }, {
 *       method: 'post',
 *       action: '/api/like'
 *     });
 *   };
 *
 *   return () => (
 *     <button on:click={handleLike} disabled={fetcher.state === 'submitting'}>
 *       Like
 *     </button>
 *   );
 * });
 * ```
 */
export function useFetcher(): Fetcher {
  const stateSignal = signal<'idle' | 'submitting' | 'loading'>('idle');
  const dataSignal = signal<any>(undefined);

  return {
    get state() {
      return stateSignal();
    },
    get data() {
      return dataSignal();
    },
    async submit(data: any, options = {}) {
      const { method = 'post', action: actionPath } = options;

      stateSignal.set('submitting');

      try {
        // Determine target URL
        // If action path is provided, use it; otherwise use current route
        const router = useRouter();
        const targetPath = actionPath || router.current.pathname;

        // Create fetch request to action endpoint
        // Actions are handled at /_aether/action?path={route}
        const url = new URL('/_aether/action', window.location.origin);
        url.searchParams.set('path', targetPath);

        // Prepare request body
        let body: BodyInit;
        let contentType: string;

        if (data instanceof FormData) {
          // Send FormData as-is
          body = data;
          contentType = 'multipart/form-data';
        } else {
          // Send JSON for object data
          body = JSON.stringify(data);
          contentType = 'application/json';
        }

        // Execute fetch request
        const response = await fetch(url.toString(), {
          method: method.toUpperCase(),
          headers:
            data instanceof FormData
              ? {} // Let browser set Content-Type with boundary for FormData
              : {
                  'Content-Type': contentType,
                },
          body,
          credentials: 'same-origin',
        });

        // Parse response
        if (!response.ok) {
          throw new Error(`Action failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        dataSignal.set(result);

        // Update action data map for this route
        setActionData(targetPath, result);
      } catch (error) {
        console.error('Fetcher submit error:', error);
        dataSignal.set({ error: error instanceof Error ? error.message : String(error) });
      } finally {
        stateSignal.set('idle');
      }
    },
    async load(href: string) {
      stateSignal.set('loading');

      try {
        // Parse the href to extract pathname
        const url = new URL(href, window.location.origin);
        const pathname = url.pathname;

        // Create fetch request to loader endpoint
        // Loaders are handled at /_aether/loader?path={route}
        const loaderUrl = new URL('/_aether/loader', window.location.origin);
        loaderUrl.searchParams.set('path', pathname);

        // Preserve search params from the original href
        for (const [key, value] of url.searchParams.entries()) {
          loaderUrl.searchParams.set(key, value);
        }

        // Execute fetch request
        const response = await fetch(loaderUrl.toString(), {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
          credentials: 'same-origin',
        });

        // Parse response
        if (!response.ok) {
          throw new Error(`Loader failed: ${response.status} ${response.statusText}`);
        }

        const result = await response.json();
        dataSignal.set(result);

        // Update loader data map for this route
        setLoaderData(pathname, result);
      } catch (error) {
        console.error('Fetcher load error:', error);
        dataSignal.set({ error: error instanceof Error ? error.message : String(error) });
      } finally {
        stateSignal.set('idle');
      }
    },
  };
}
