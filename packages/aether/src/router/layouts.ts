/**
 * Layout System
 *
 * Utilities for building and rendering nested layouts
 */

import type { RouteDefinition, RouteMatch, RouteComponent, RouteContext } from './types.js';

/**
 * Build layout chain for a route match
 *
 * Walks up the route tree collecting layouts from root to leaf
 *
 * @param match - The matched route
 * @param routes - All route definitions
 * @returns Array of layouts in order (root → leaf)
 */
export function buildLayoutChain(match: RouteMatch, routes: RouteDefinition[]): RouteComponent[] {
  const layouts: RouteComponent[] = [];

  // Helper to find route definition by path
  function findRouteByPath(path: string, routeList: RouteDefinition[]): RouteDefinition | null {
    for (const route of routeList) {
      if (route.path === path) {
        return route;
      }
      if (route.children) {
        const found = findRouteByPath(path, route.children);
        if (found) return found;
      }
    }
    return null;
  }

  // Helper to collect layouts from route ancestors
  function collectLayouts(route: RouteDefinition | null) {
    if (!route) return;

    // Add layout if present
    if (route.layout) {
      layouts.push(route.layout);
    }
  }

  // Collect layouts from matched route
  const routeDef = findRouteByPath(match.path, routes) || match.route;
  collectLayouts(routeDef);

  return layouts;
}

/**
 * Build error boundary for a route match
 *
 * Finds the nearest error boundary in the route tree
 *
 * @param match - The matched route
 * @param routes - All route definitions
 * @returns Error boundary component or undefined
 */
export function findErrorBoundary(match: RouteMatch, routes: RouteDefinition[]): RouteComponent | undefined {
  // Helper to find route definition by path
  function findRouteByPath(path: string, routeList: RouteDefinition[]): RouteDefinition | null {
    for (const route of routeList) {
      if (route.path === path) {
        return route;
      }
      if (route.children) {
        const found = findRouteByPath(path, route.children);
        if (found) return found;
      }
    }
    return null;
  }

  // Find route definition
  const routeDef = findRouteByPath(match.path, routes) || match.route;

  // Return error boundary if present
  return routeDef.errorBoundary;
}

/**
 * Build loading component for a route match
 *
 * Finds the nearest loading component in the route tree
 *
 * @param match - The matched route
 * @param routes - All route definitions
 * @returns Loading component or undefined
 */
export function findLoadingComponent(match: RouteMatch, routes: RouteDefinition[]): RouteComponent | undefined {
  // Helper to find route definition by path
  function findRouteByPath(path: string, routeList: RouteDefinition[]): RouteDefinition | null {
    for (const route of routeList) {
      if (route.path === path) {
        return route;
      }
      if (route.children) {
        const found = findRouteByPath(path, route.children);
        if (found) return found;
      }
    }
    return null;
  }

  // Find route definition
  const routeDef = findRouteByPath(match.path, routes) || match.route;

  // Return loading component if present
  return routeDef.loading;
}

/**
 * Create route context with layout chain
 *
 * @param match - The matched route
 * @param routes - All route definitions
 * @returns Route context with layouts, error boundary, and loading
 */
export function createRouteContext(match: RouteMatch, routes: RouteDefinition[]): RouteContext {
  return {
    route: match,
    layouts: buildLayoutChain(match, routes),
    errorBoundary: findErrorBoundary(match, routes),
    loading: findLoadingComponent(match, routes),
  };
}

/**
 * Render route with layouts
 *
 * Wraps the route component with all layouts in the chain
 *
 * @param context - Route context with layouts
 * @returns Rendered component tree with nested layouts
 */
export function renderWithLayouts(context: RouteContext): any {
  const { route, layouts, errorBoundary } = context;
  const Component = route.route.component;

  if (!Component) {
    return null;
  }

  // Start with the route component
  let rendered = Component({ params: route.params });

  // Wrap with layouts in reverse order (leaf → root)
  if (layouts && layouts.length > 0) {
    for (let i = layouts.length - 1; i >= 0; i--) {
      const Layout = layouts[i];
      if (Layout) {
        rendered = Layout({ children: rendered });
      }
    }
  }

  // Wrap with error boundary if present
  if (errorBoundary) {
    const ErrorBoundary = errorBoundary;
    rendered = ErrorBoundary({ children: rendered });
  }

  return rendered;
}
