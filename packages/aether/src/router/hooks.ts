/**
 * Router - React Hooks for Router
 *
 * Composable hooks for accessing router state
 */

import { computed } from '../core/reactivity/computed.js';
import type { Computed } from '../core/reactivity/types.js';
import { getRouter } from './router.js';
import type { RouteParams, NavigationOptions } from './types.js';

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

  return (to: string, options?: NavigationOptions) => {
    return router.navigate(to, options);
  };
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

  return computed(() => {
    return new URLSearchParams(location().search);
  });
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
