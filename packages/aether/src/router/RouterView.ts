/**
 * Router Component
 *
 * Main router component that renders matched routes with layouts
 */

import { defineComponent } from '../core/component/define.js';
import { RouteContextSymbol } from './Outlet.js';
import { createRouteContext, renderWithLayouts } from './layouts.js';
import { useRouter } from './hooks.js';
import type { RouteDefinition } from './types.js';

export interface RouterProps {
  /**
   * Routes configuration
   */
  routes: RouteDefinition[];

  /**
   * Fallback component for no match
   */
  fallback?: () => any;
}

/**
 * RouterView Component
 *
 * Renders the matched route with layouts and provides route context
 *
 * @example
 * ```tsx
 * import { RouterView } from '@omnitron-dev/aether/router';
 *
 * const routes = [
 *   { path: '/', component: Home },
 *   { path: '/about', component: About, layout: MainLayout }
 * ];
 *
 * const App = () => (
 *   <RouterView routes={routes} />
 * );
 * ```
 */
export const RouterView = defineComponent<RouterProps>((props) => {
  const router = useRouter();

  return () => {
    // Get current location and match route
    const currentPath = router.current.pathname;
    const match = router.match(currentPath);

    // No match - render fallback
    if (!match) {
      return props.fallback ? props.fallback() : null;
    }

    // Create route context
    const routeContext = createRouteContext(match, props.routes);

    // Render with layouts
    const rendered = renderWithLayouts(routeContext);

    // Provide route context to children using createElement
    const Provider = RouteContextSymbol.Provider;
    return Provider({ value: routeContext, children: rendered });
  };
}, 'RouterView');
