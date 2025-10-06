/**
 * Router - Data Loading System
 *
 * Loaders, actions, and data hooks for routes
 */

import { signal } from '../core/reactivity/signal.js';
import type { Signal } from '../core/reactivity/types.js';
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
export async function executeLoader(
  loader: RouteLoader,
  context: LoaderContext
): Promise<any> {
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
export async function executeAction(
  action: RouteAction,
  context: ActionContext
): Promise<any> {
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

  // TODO: Subscribe to route changes
  // This would require router to expose an observable for route changes

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
        // TODO: Implement actual fetch to action endpoint
        console.debug('Fetcher submit:', { data, method, actionPath });

        // Simulate action call
        await new Promise(resolve => setTimeout(resolve, 100));

        dataSignal.set({ success: true });
      } catch (error) {
        console.error('Fetcher submit error:', error);
        dataSignal.set({ error });
      } finally {
        stateSignal.set('idle');
      }
    },
    async load(href: string) {
      stateSignal.set('loading');

      try {
        // TODO: Implement actual fetch to loader endpoint
        console.debug('Fetcher load:', href);

        // Simulate loader call
        await new Promise(resolve => setTimeout(resolve, 100));

        dataSignal.set({ loaded: true });
      } catch (error) {
        console.error('Fetcher load error:', error);
        dataSignal.set({ error });
      } finally {
        stateSignal.set('idle');
      }
    },
  };
}
