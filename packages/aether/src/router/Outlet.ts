/**
 * Outlet Component
 *
 * Renders the matched child route within a layout
 */

import { defineComponent } from '../core/component/define.js';
import { createContext, useContext } from '../core/component/context.js';
import type { RouteContext } from './types.js';

/**
 * Route context - provides current route information to nested components
 */
export const RouteContextSymbol = createContext<RouteContext | null>(null, 'route-context');

/**
 * Get current route context
 */
export function useRouteContext(): RouteContext | null {
  return useContext(RouteContextSymbol);
}

/**
 * Outlet Component
 *
 * Renders the child route component within a layout.
 * Must be used inside a layout component.
 *
 * @example
 * ```tsx
 * // Layout component
 * const Layout = defineComponent(() => {
 *   return () => (
 *     <div class="layout">
 *       <header>Header</header>
 *       <main>
 *         <Outlet />
 *       </main>
 *       <footer>Footer</footer>
 *     </div>
 *   );
 * });
 * ```
 */
export const Outlet = defineComponent(() => {
  const routeContext = useRouteContext();

  return () => {
    if (!routeContext) {
      console.warn('Outlet: No route context found. Outlet must be used inside a route layout.');
      return null;
    }

    const { route } = routeContext;
    const Component = route.route.component;

    if (!Component) {
      return null;
    }

    return Component({ params: route.params });
  };
});
