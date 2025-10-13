/**
 * @fileoverview Outlet component for nested routing
 * @module @omnitron-dev/aether/router
 */

import { defineComponent } from '../core/component/define.js';
import { createContext, useContext } from '../core/component/context.js';
import { signal, computed, effect } from '../core/index.js';
import type { RouteContext, RouteDefinition } from './types.js';
import type { VNode } from '../reconciler/vnode.js';
import { jsx } from '../jsx-runtime.js';

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
 * Props for the Outlet component
 */
export interface OutletProps {
  /**
   * Name of the outlet (for named outlets)
   * @default 'default'
   */
  name?: string;

  /**
   * Fallback content to show while loading
   */
  fallback?: () => VNode;

  /**
   * Error fallback component
   */
  errorFallback?: (error: Error) => VNode;

  /**
   * Pass-through props to the rendered component
   */
  props?: Record<string, any>;
}

/**
 * Outlet Component
 *
 * Renders the child route component within a layout.
 * Must be used inside a layout component.
 *
 * @example
 * ```tsx
 * // Basic layout component
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
 *
 * // With named outlets
 * const DashboardLayout = defineComponent(() => {
 *   return () => (
 *     <div class="dashboard">
 *       <aside>
 *         <Outlet name="sidebar" />
 *       </aside>
 *       <main>
 *         <Outlet name="content" />
 *       </main>
 *     </div>
 *   );
 * });
 *
 * // With error handling
 * const SafeLayout = defineComponent(() => {
 *   return () => (
 *     <div>
 *       <Outlet
 *         fallback={() => <div>Loading...</div>}
 *         errorFallback={(error) => <div>Error: {error.message}</div>}
 *       />
 *     </div>
 *   );
 * });
 * ```
 */
export const Outlet = defineComponent<OutletProps>((props = {}) => {
  const routeContext = useRouteContext();
  const outletName = () => props.name || 'default';

  // Track component loading state
  const loading = signal(false);
  const error = signal<Error | null>(null);
  const childComponent = signal<any>(null);

  // Compute the child route to render
  const childRoute = computed(() => {
    if (!routeContext) return null;

    const { route } = routeContext;
    if (!route.route.children || route.route.children.length === 0) {
      return null;
    }

    // Find the child route for this outlet
    const name = outletName();

    for (const child of route.route.children) {
      // Check if child matches the outlet name
      const childOutlet = (child.meta?.outlet as string) || 'default';
      if (childOutlet === name) {
        return child;
      }
    }

    // If no named outlet found and looking for default, return first child
    if (name === 'default' && route.route.children.length > 0) {
      return route.route.children[0];
    }

    return null;
  });

  // Load the component when child route changes
  effect(() => {
    const child = childRoute();
    if (!child) {
      childComponent.set(null);
      return;
    }

    // Handle lazy-loaded components
    if (child.lazy) {
      loading.set(true);
      error.set(null);

      const loadComponent = async () => {
        try {
          const module = await child.lazy!();
          const Component = module.default || module;
          childComponent.set(Component);
        } catch (err) {
          error.set(err as Error);
          console.error('Failed to load lazy component:', err);
        } finally {
          loading.set(false);
        }
      };

      loadComponent();
    } else if (child.component) {
      childComponent.set(child.component);
      loading.set(false);
      error.set(null);
    }
  });

  return () => {
    if (!routeContext) {
      console.warn('Outlet: No route context found. Outlet must be used inside a route layout.');
      return null;
    }

    // Handle error state
    const err = error();
    if (err && props.errorFallback) {
      return props.errorFallback(err);
    }

    // Handle loading state
    if (loading() && props.fallback) {
      return props.fallback();
    }

    // Get the component to render
    const Component = childComponent();
    if (!Component) {
      return null;
    }

    // Prepare props to pass to the component
    const { route } = routeContext;
    const componentProps = {
      ...props.props,
      params: route.params,
      query: route.query || {},
      data: route.data || {},
    };

    // Create a new route context for nested outlets
    const childRouteDefinition = childRoute();
    if (childRouteDefinition) {
      const childContext: RouteContext = {
        route: {
          ...route,
          route: childRouteDefinition,
        },
      };

      // Render with nested context
      return jsx(RouteContextSymbol.Provider, { value: childContext, children: jsx(Component, componentProps) });
    }

    // Render without nested context
    return jsx(Component, componentProps);
  };
});

/**
 * Helper function to create named outlets configuration
 *
 * @example
 * ```typescript
 * const route: RouteDefinition = {
 *   path: '/dashboard',
 *   component: DashboardLayout,
 *   children: createNamedOutlets({
 *     sidebar: {
 *       component: SidebarComponent,
 *       loader: async () => ({ sidebarData: await fetchSidebar() }),
 *     },
 *     content: {
 *       component: ContentComponent,
 *       loader: async () => ({ content: await fetchContent() }),
 *     },
 *   })
 * };
 * ```
 */
export function createNamedOutlets(
  outlets: Record<string, Partial<RouteDefinition>>
): RouteDefinition[] {
  return Object.entries(outlets).map(([name, config]) => ({
    path: '',
    ...config,
    meta: {
      ...config.meta,
      outlet: name,
    },
  }));
}

/**
 * Helper hook to get current outlet context
 * Useful in child components to access outlet data
 *
 * @example
 * ```tsx
 * const MyComponent = defineComponent(() => {
 *   const outlet = useOutlet();
 *
 *   return () => (
 *     <div>
 *       <h1>Params: {JSON.stringify(outlet.params)}</h1>
 *       <p>Query: {JSON.stringify(outlet.query)}</p>
 *       <p>Data: {JSON.stringify(outlet.data)}</p>
 *     </div>
 *   );
 * });
 * ```
 */
export function useOutlet(): {
  params: Record<string, string | string[]>;
  query: Record<string, string>;
  data: any;
} {
  const context = useRouteContext();

  if (!context) {
    return {
      params: {},
      query: {},
      data: {},
    };
  }

  return {
    params: context.route.params || {},
    query: context.route.query || {},
    data: context.route.data || {},
  };
}

/**
 * Layout helper components for common patterns
 */

/**
 * Root layout wrapper
 */
export const LayoutRoot = defineComponent<{ class?: string; children?: any }>((props) => {
  return () => jsx('div', {
    class: ['layout-root', props.class].filter(Boolean).join(' '),
    children: props.children
  });
});

/**
 * Layout header
 */
export const LayoutHeader = defineComponent<{ class?: string; children?: any }>((props) => {
  return () => jsx('header', {
    class: ['layout-header', props.class].filter(Boolean).join(' '),
    children: props.children
  });
});

/**
 * Layout main content area
 */
export const LayoutMain = defineComponent<{ class?: string; children?: any }>((props) => {
  return () => jsx('main', {
    class: ['layout-main', props.class].filter(Boolean).join(' '),
    children: props.children
  });
});

/**
 * Layout sidebar
 */
export const LayoutSidebar = defineComponent<{ class?: string; children?: any }>((props) => {
  return () => jsx('aside', {
    class: ['layout-sidebar', props.class].filter(Boolean).join(' '),
    children: props.children
  });
});

/**
 * Layout footer
 */
export const LayoutFooter = defineComponent<{ class?: string; children?: any }>((props) => {
  return () => jsx('footer', {
    class: ['layout-footer', props.class].filter(Boolean).join(' '),
    children: props.children
  });
});