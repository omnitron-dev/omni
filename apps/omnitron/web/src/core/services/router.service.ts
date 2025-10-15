/**
 * Core Module - Router Service
 *
 * Router management and navigation service
 */

import { Injectable, inject } from '@omnitron-dev/aether/di';
import { signal, type Signal } from '@omnitron-dev/aether';
import type { Router, Route, NavigationGuard } from '@omnitron-dev/aether/router';
import { EventBusService } from './event-bus.service';
import { EVENTS } from '../constants';

/**
 * Router Service
 *
 * Provides a high-level API for router management and navigation:
 * - Route navigation
 * - Navigation guards
 * - Current route tracking
 * - Route metadata access
 *
 * @example
 * ```typescript
 * const routerService = inject(RouterService);
 *
 * // Navigate to a route
 * routerService.navigate('/editor');
 *
 * // Navigate with query params
 * routerService.navigate('/editor', { query: { file: 'app.ts' } });
 *
 * // Go back
 * routerService.back();
 *
 * // Get current route
 * const currentRoute = routerService.currentRoute();
 * ```
 */
@Injectable({ scope: 'singleton', providedIn: 'root' })
export class RouterService {
  private eventBus = inject(EventBusService);
  private _router: Router | null = null;

  // Reactive state
  private _currentRoute = signal<Route | null>(null);
  private _isNavigating = signal(false);

  /**
   * Current route (reactive)
   */
  readonly currentRoute: Signal<Route | null> = this._currentRoute;

  /**
   * Is navigation in progress (reactive)
   */
  readonly isNavigating: Signal<boolean> = this._isNavigating;

  /**
   * Initialize router service with router instance
   *
   * @param router - Router instance
   */
  setRouter(router: Router): void {
    if (this._router) {
      console.warn('[RouterService] Router already set');
      return;
    }

    this._router = router;

    // Listen to route changes
    this.setupRouteTracking();
  }

  /**
   * Get router instance
   */
  getRouter(): Router | null {
    return this._router;
  }

  /**
   * Setup route tracking
   */
  private setupRouteTracking(): void {
    if (!this._router) return;

    // Track current route
    this._router.afterEach((to, from) => {
      this._currentRoute.set(to);
      this._isNavigating.set(false);

      // Emit route changed event
      this.eventBus.emit(EVENTS.ROUTE_CHANGED, {
        to,
        from,
      });
    });

    // Track navigation start
    this._router.beforeEach((to, from, next) => {
      this._isNavigating.set(true);
      next();
    });
  }

  /**
   * Navigate to a route
   *
   * @param path - Route path
   * @param options - Navigation options
   */
  navigate(path: string, options?: { query?: Record<string, string>; hash?: string; replace?: boolean }): void {
    if (!this._router) {
      console.error('[RouterService] Router not initialized');
      return;
    }

    try {
      const { query, hash, replace } = options || {};

      let fullPath = path;

      // Add query params
      if (query) {
        const queryString = new URLSearchParams(query).toString();
        fullPath += `?${queryString}`;
      }

      // Add hash
      if (hash) {
        fullPath += `#${hash}`;
      }

      // Navigate
      if (replace) {
        this._router.replace(fullPath);
      } else {
        this._router.push(fullPath);
      }
    } catch (error) {
      console.error('[RouterService] Navigation error:', error);
      this.eventBus.emit(EVENTS.ROUTE_ERROR, { path, error });
    }
  }

  /**
   * Navigate to a route and replace current history entry
   *
   * @param path - Route path
   * @param options - Navigation options
   */
  replace(path: string, options?: { query?: Record<string, string>; hash?: string }): void {
    this.navigate(path, { ...options, replace: true });
  }

  /**
   * Go back in history
   */
  back(): void {
    if (!this._router) {
      console.error('[RouterService] Router not initialized');
      return;
    }

    this._router.back();
  }

  /**
   * Go forward in history
   */
  forward(): void {
    if (!this._router) {
      console.error('[RouterService] Router not initialized');
      return;
    }

    this._router.forward();
  }

  /**
   * Go to a specific history entry
   *
   * @param delta - Number of entries to go (negative to go back, positive to go forward)
   */
  go(delta: number): void {
    if (!this._router) {
      console.error('[RouterService] Router not initialized');
      return;
    }

    this._router.go(delta);
  }

  /**
   * Add a navigation guard
   *
   * @param guard - Navigation guard function
   * @returns Function to remove the guard
   */
  beforeEach(guard: NavigationGuard): () => void {
    if (!this._router) {
      console.error('[RouterService] Router not initialized');
      return () => {};
    }

    return this._router.beforeEach(guard);
  }

  /**
   * Add an after navigation hook
   *
   * @param hook - After navigation hook
   * @returns Function to remove the hook
   */
  afterEach(hook: (to: Route, from: Route) => void): () => void {
    if (!this._router) {
      console.error('[RouterService] Router not initialized');
      return () => {};
    }

    return this._router.afterEach(hook);
  }

  /**
   * Get current route path
   */
  getCurrentPath(): string {
    const route = this._currentRoute();
    return route?.path || '/';
  }

  /**
   * Get current route meta
   */
  getCurrentMeta(): Record<string, any> | undefined {
    const route = this._currentRoute();
    return route?.meta;
  }

  /**
   * Check if a route is active
   *
   * @param path - Route path to check
   * @returns True if route is active
   */
  isActive(path: string): boolean {
    const currentPath = this.getCurrentPath();
    return currentPath === path;
  }

  /**
   * Check if a route or its children are active
   *
   * @param path - Route path to check
   * @returns True if route or its children are active
   */
  isActiveOrChild(path: string): boolean {
    const currentPath = this.getCurrentPath();
    return currentPath.startsWith(path);
  }
}
