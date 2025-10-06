/**
 * Router - Core Router Implementation
 *
 * Manages routing, navigation, and browser history
 */

import { signal } from '../core/reactivity/signal.js';
import { findBestMatch, normalizePath } from './route-matcher.js';
import type {
  Router,
  RouterConfig,
  RouteMatch,
  Location,
  NavigationOptions,
  RouteGuard,
} from './types.js';

/**
 * Create a new Router instance
 */
export function createRouter(config: RouterConfig = {}): Router {
  const {
    mode = 'history',
    base = '/',
    routes = [],
    scrollBehavior,
  } = config;

  // Current location (reactive)
  const currentLocation = signal<Location>(getCurrentLocation());

  // Current matched route
  const currentMatch = signal<RouteMatch | null>(null);

  // Before navigation guards
  const beforeGuards: RouteGuard[] = [];

  // After navigation hooks
  const afterHooks: Array<(to: RouteMatch, from: RouteMatch | null) => void> = [];

  /**
   * Get current location from browser
   */
  function getCurrentLocation(): Location {
    if (typeof window === 'undefined') {
      return {
        pathname: base,
        search: '',
        hash: '',
        state: null,
      };
    }

    if (mode === 'hash') {
      const hash = window.location.hash.slice(1) || '/';
      const parts = hash.split('?');
      const pathname = parts[0] || '/';
      const search = parts[1] || '';
      return {
        pathname,
        search: search ? `?${search}` : '',
        hash: '',
        state: window.history.state,
      };
    }

    return {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
      state: window.history.state,
    };
  }

  /**
   * Match current pathname against routes
   */
  function matchCurrentPath(): RouteMatch | null {
    const location = currentLocation();
    const pathname = normalizePath(location.pathname);
    return findBestMatch(pathname, routes);
  }

  /**
   * Navigate to a new location
   */
  async function navigate(to: string, options: NavigationOptions = {}): Promise<void> {
    const { replace = false, state = null, scroll = true } = options;

    // Parse the target URL
    const url = new URL(to, window.location.origin);
    const pathname = normalizePath(url.pathname);

    // Find matching route
    const match = findBestMatch(pathname, routes);

    // Run before guards
    const previousMatch = currentMatch();
    for (const guard of beforeGuards) {
      if (match) {
        const result = await guard({
          params: match.params,
          url,
          from: previousMatch?.path,
        });

        if (result === false) {
          return; // Navigation cancelled
        }

        if (typeof result === 'object' && 'redirect' in result) {
          // Redirect to different location
          return navigate(result.redirect, { replace: true });
        }
      }
    }

    // Update browser history
    if (typeof window !== 'undefined') {
      const newUrl = url.pathname + url.search + url.hash;

      if (mode === 'hash') {
        const hashUrl = `#${newUrl}`;
        if (replace) {
          window.history.replaceState(state, '', hashUrl);
        } else {
          window.history.pushState(state, '', hashUrl);
        }
      } else if (mode === 'history') {
        if (replace) {
          window.history.replaceState(state, '', newUrl);
        } else {
          window.history.pushState(state, '', newUrl);
        }
      }
    }

    // Update current location
    currentLocation.set({
      pathname,
      search: url.search,
      hash: url.hash,
      state,
    });

    // Update current match
    currentMatch.set(match);

    // Handle scroll behavior
    if (scroll && typeof window !== 'undefined') {
      if (typeof scroll === 'object') {
        window.scrollTo(scroll.left ?? 0, scroll.top ?? 0);
      } else if (scrollBehavior && match) {
        const position = scrollBehavior(match, previousMatch, null);
        if (position) {
          window.scrollTo(position.left ?? 0, position.top ?? 0);
        }
      } else {
        window.scrollTo(0, 0);
      }
    }

    // Run after hooks
    if (match) {
      for (const hook of afterHooks) {
        hook(match, previousMatch);
      }
    }
  }

  /**
   * Go back in history
   */
  function back(): void {
    if (typeof window !== 'undefined') {
      window.history.back();
    }
  }

  /**
   * Go forward in history
   */
  function forward(): void {
    if (typeof window !== 'undefined') {
      window.history.forward();
    }
  }

  /**
   * Go to specific history entry
   */
  function go(delta: number): void {
    if (typeof window !== 'undefined') {
      window.history.go(delta);
    }
  }

  /**
   * Register before navigation guard
   */
  function beforeEach(guard: RouteGuard): () => void {
    beforeGuards.push(guard);
    return () => {
      const index = beforeGuards.indexOf(guard);
      if (index > -1) {
        beforeGuards.splice(index, 1);
      }
    };
  }

  /**
   * Register after navigation hook
   */
  function afterEach(hook: (to: RouteMatch, from: RouteMatch | null) => void): () => void {
    afterHooks.push(hook);
    return () => {
      const index = afterHooks.indexOf(hook);
      if (index > -1) {
        afterHooks.splice(index, 1);
      }
    };
  }

  /**
   * Handle popstate events (browser back/forward)
   */
  function handlePopState(): void {
    const location = getCurrentLocation();
    currentLocation.set(location);

    const match = matchCurrentPath();
    const previousMatch = currentMatch();
    currentMatch.set(match);

    // Run after hooks
    if (match) {
      for (const hook of afterHooks) {
        hook(match, previousMatch);
      }
    }
  }

  /**
   * Initialize router
   */
  function init(): void {
    if (typeof window !== 'undefined') {
      // Listen to popstate events
      window.addEventListener('popstate', handlePopState);

      // Initial route match
      const initialMatch = matchCurrentPath();
      currentMatch.set(initialMatch);
    }
  }

  /**
   * Dispose router (cleanup)
   */
  function dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('popstate', handlePopState);
    }
  }

  // Initialize on creation
  init();

  return {
    config: {
      mode,
      base,
      routes,
      scrollBehavior,
    },
    get current() {
      return currentLocation();
    },
    match: (pathname: string) => {
      const normalized = normalizePath(pathname);
      return findBestMatch(normalized, routes);
    },
    navigate,
    back,
    forward,
    go,
    beforeEach,
    afterEach,
    dispose,
  };
}

/**
 * Global router instance
 */
let globalRouter: Router | null = null;

/**
 * Get global router instance
 */
export function getRouter(): Router {
  if (!globalRouter) {
    throw new Error('Router not initialized. Call createRouter() first.');
  }
  return globalRouter;
}

/**
 * Set global router instance
 */
export function setRouter(router: Router): void {
  if (globalRouter) {
    globalRouter.dispose();
  }
  globalRouter = router;
}
