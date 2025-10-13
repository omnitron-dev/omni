/**
 * Router - React Hooks for Router
 *
 * Composable hooks for accessing router state
 */

import { computed } from '../core/reactivity/computed.js';
import { signal } from '../core/reactivity/signal.js';
import { effect } from '../core/reactivity/effect.js';
import type { Computed } from '../core/reactivity/types.js';
import { getRouter } from './router.js';
import { setActionData } from './data.js';
import type {
  RouteParams,
  NavigationOptions,
  RouteMatch,
  Location as RouterLocation,
} from './types.js';

/**
 * Get the router instance
 */
export function useRouter() {
  return getRouter();
}

/**
 * Get current route parameters
 *
 * @example
 * ```typescript
 * // In route /users/[id]
 * const params = useParams<{ id: string }>();
 * console.log(params.id); // "123"
 * ```
 */
export function useParams<T extends RouteParams = RouteParams>(): Computed<T> {
  const router = getRouter();

  return computed(() => {
    const match = router.match(router.current.pathname);
    return (match?.params ?? {}) as T;
  });
}

/**
 * Get navigation function
 *
 * @example
 * ```typescript
 * const navigate = useNavigate();
 * navigate('/about');
 * navigate('/users/123', { replace: true });
 * ```
 */
export function useNavigate() {
  const router = getRouter();

  return (to: string, options?: NavigationOptions) => router.navigate(to, options);
}

/**
 * Get current location
 *
 * @example
 * ```typescript
 * const location = useLocation();
 * console.log(location().pathname); // "/users/123"
 * console.log(location().search); // "?page=2"
 * ```
 */
export function useLocation() {
  const router = getRouter();

  return computed(() => router.current);
}

/**
 * Get search params from URL
 *
 * @example
 * ```typescript
 * // URL: /search?q=test&page=2
 * const searchParams = useSearchParams();
 * console.log(searchParams().get('q')); // "test"
 * console.log(searchParams().get('page')); // "2"
 * ```
 */
export function useSearchParams(): Computed<URLSearchParams> {
  const location = useLocation();

  return computed(() => new URLSearchParams(location().search));
}

/**
 * Check if route is active
 *
 * @example
 * ```typescript
 * const isActive = useIsActive('/about');
 * <Link href="/about" class={isActive() ? 'active' : ''}>About</Link>
 * ```
 */
export function useIsActive(path: string, exact = false): Computed<boolean> {
  const location = useLocation();

  return computed(() => {
    const currentPath = location().pathname;

    if (exact) {
      return currentPath === path;
    }

    return currentPath.startsWith(path);
  });
}

/**
 * Get all matched routes in the current location
 *
 * @example
 * ```typescript
 * const matches = useMatches();
 * matches().forEach(match => {
 *   console.log(match.path, match.params);
 * });
 * ```
 */
export function useMatches(): Computed<RouteMatch[]> {
  const router = getRouter();
  const location = useLocation();

  return computed(() => {
    const pathname = location().pathname;
    const match = router.match(pathname);

    if (!match) {
      return [];
    }

    // Ensure match includes the route pattern path, not the matched path
    const normalizedMatch = {
      ...match,
      path: match.route.path, // Use route definition path, not matched pathname
    };

    // For nested routes, we would collect all parent matches
    // For now, return current match as array
    return [normalizedMatch];
  });
}

/**
 * Revalidator state
 */
export interface Revalidator {
  state: 'idle' | 'loading';
  revalidate: () => Promise<void>;
}

/**
 * Get revalidator for manual data revalidation
 *
 * @example
 * ```typescript
 * const revalidator = useRevalidator();
 *
 * const handleRefresh = async () => {
 *   await revalidator.revalidate();
 * };
 * ```
 */
export function useRevalidator(): Revalidator {
  const router = getRouter();
  const location = useLocation();
  const state = signal<'idle' | 'loading'>('idle');

  const revalidate = async () => {
    const match = router.match(location().pathname);
    if (!match || !match.route.loader) {
      return;
    }

    state.set('loading');
    try {
      // Re-execute loader and update data
      const context = {
        params: match.params,
        url: new URL(window.location.href),
        request: new Request(window.location.href),
      };

      const data = await match.route.loader(context);

      // Import setLoaderData dynamically to avoid circular dependency
      const { setLoaderData } = await import('./data.js');
      setLoaderData(match.path, data);
    } finally {
      state.set('idle');
    }
  };

  return {
    get state() {
      return state();
    },
    revalidate,
  };
}

/**
 * Submit options for useSubmit hook
 */
export interface SubmitOptions {
  method?: 'get' | 'post' | 'put' | 'patch' | 'delete';
  action?: string;
  replace?: boolean;
  encType?: 'application/x-www-form-urlencoded' | 'multipart/form-data';
}

/**
 * Get submit function for programmatic form submissions
 *
 * @example
 * ```typescript
 * const submit = useSubmit();
 *
 * const handleClick = () => {
 *   submit({ action: 'like' }, {
 *     method: 'post',
 *     action: '/api/like'
 *   });
 * };
 * ```
 */
export function useSubmit() {
  const router = getRouter();
  const location = useLocation();

  return async (
    data: Record<string, any> | FormData,
    options: SubmitOptions = {}
  ) => {
    const {
      method = 'post',
      action = location().pathname,
      replace = false,
      encType: _encType = 'application/x-www-form-urlencoded',
    } = options;

    // Convert data to FormData if needed
    let formData: FormData;
    if (data instanceof FormData) {
      formData = data;
    } else {
      formData = new FormData();
      Object.entries(data).forEach(([key, value]) => {
        formData.append(key, String(value));
      });
    }

    // Find route with action
    const match = router.match(action);
    if (!match || !match.route.action) {
      console.warn(`No action found for ${action}`);
      return;
    }

    // Execute action
    const context = {
      params: match.params,
      request: new Request(action, {
        method: method.toUpperCase(),
        body: formData,
      }),
      formData,
    };

    try {
      const result = await match.route.action(context);
      setActionData(action, result);

      // Navigate if needed
      if (replace) {
        await router.navigate(action, { replace: true });
      }
    } catch (error) {
      console.error('Action execution failed:', error);
      throw error;
    }
  };
}

/**
 * Get form action URL
 *
 * @example
 * ```typescript
 * const action = useFormAction();
 * // Returns current location pathname or specified action path
 * ```
 */
export function useFormAction(action?: string): Computed<string> {
  const location = useLocation();

  return computed(() => action ?? location().pathname);
}

/**
 * Blocker function type
 */
export type BlockerFunction = (args: {
  currentLocation: RouterLocation;
  nextLocation: RouterLocation;
}) => boolean | Promise<boolean>;

/**
 * Blocker state
 */
export interface Blocker {
  state: 'blocked' | 'proceeding' | 'unblocked';
  proceed: () => Promise<void>;
  reset: () => void;
}

/**
 * Block navigation with a condition
 *
 * @example
 * ```typescript
 * const blocker = useBlocker(
 *   ({ currentLocation, nextLocation }) => {
 *     return hasUnsavedChanges &&
 *            currentLocation.pathname !== nextLocation.pathname;
 *   }
 * );
 *
 * if (blocker.state === 'blocked') {
 *   // Show confirmation dialog
 *   if (confirm('Discard changes?')) {
 *     blocker.proceed();
 *   } else {
 *     blocker.reset();
 *   }
 * }
 * ```
 */
export function useBlocker(shouldBlock: boolean | BlockerFunction): Blocker {
  const router = getRouter();
  const state = signal<'blocked' | 'proceeding' | 'unblocked'>('unblocked');
  const nextLocation = signal<string | null>(null);

  // Register blocker with router
  const unregister = router.beforeEach(async (context) => {
    // Skip blocking if in proceeding state
    if (state() === 'proceeding') {
      return true;
    }

    const currentLocation = router.current;
    const next = {
      pathname: context.url.pathname,
      search: context.url.search,
      hash: context.url.hash,
      state: null,
    };

    // Check if should block
    const blocked =
      typeof shouldBlock === 'function'
        ? await shouldBlock({
            currentLocation,
            nextLocation: next,
          })
        : shouldBlock;

    if (blocked && state() === 'unblocked') {
      state.set('blocked');
      nextLocation.set(context.url.pathname);
      return false; // Block navigation
    }

    return true;
  });

  // Cleanup on component unmount
  effect(() => () => unregister());

  return {
    get state() {
      return state();
    },
    proceed: async () => {
      const next = nextLocation();
      if (next) {
        state.set('proceeding');
        await router.navigate(next);
        state.set('unblocked');
        nextLocation.set(null);
      }
    },
    reset: () => {
      state.set('unblocked');
      nextLocation.set(null);
    },
  };
}

/**
 * Prompt user before leaving with unsaved changes
 *
 * @example
 * ```typescript
 * const [hasUnsavedChanges, setHasUnsavedChanges] = useSignal(false);
 *
 * usePrompt({
 *   when: hasUnsavedChanges,
 *   message: 'You have unsaved changes. Are you sure you want to leave?'
 * });
 * ```
 */
export function usePrompt(options: {
  when: boolean | (() => boolean);
  message?: string;
}): void {
  const { when, message = 'Are you sure you want to leave?' } = options;

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    const shouldPrompt = typeof when === 'function' ? when() : when;
    return shouldPrompt && currentLocation.pathname !== nextLocation.pathname;
  });

  // Show native prompt when blocked
  effect(() => {
    if (blocker.state === 'blocked') {
      const confirmed = window.confirm(message);
      if (confirmed) {
        blocker.proceed();
      } else {
        blocker.reset();
      }
    }
  });
}
