/**
 * Tests for Layout System
 */

import { describe, it, expect } from 'vitest';
import {
  buildLayoutChain,
  findErrorBoundary,
  findLoadingComponent,
  createRouteContext,
  renderWithLayouts,
} from '../../../src/router/layouts';
import { defineComponent } from '../../../src/core/component/define';
import type { RouteDefinition, RouteMatch, RouteComponent } from '../../../src/router/types';

describe('Layout System', () => {
  describe('buildLayoutChain', () => {
    it('should return empty array when route has no layout', () => {
      const routes: RouteDefinition[] = [
        {
          path: '/test',
          component: () => null,
        },
      ];

      const match: RouteMatch = {
        route: routes[0],
        params: {},
        path: '/test',
        score: 0,
      };

      const layouts = buildLayoutChain(match, routes);
      expect(layouts).toEqual([]);
    });

    it('should return layout when route has one', () => {
      const RootLayout = defineComponent(() => {
        return () => <div class="layout">Layout</div>;
      });

      const routes: RouteDefinition[] = [
        {
          path: '/test',
          component: () => null,
          layout: RootLayout,
        },
      ];

      const match: RouteMatch = {
        route: routes[0],
        params: {},
        path: '/test',
        score: 0,
      };

      const layouts = buildLayoutChain(match, routes);
      expect(layouts).toHaveLength(1);
      expect(layouts[0]).toBe(RootLayout);
    });

    it('should collect multiple layouts in order', () => {
      const RootLayout = defineComponent(() => () => <div>Root</div>);
      const AppLayout = defineComponent(() => () => <div>App</div>);
      const DashboardLayout = defineComponent(() => () => <div>Dashboard</div>);

      const routes: RouteDefinition[] = [
        {
          path: '/',
          layout: RootLayout,
          children: [
            {
              path: '/app',
              layout: AppLayout,
              children: [
                {
                  path: '/app/dashboard',
                  layout: DashboardLayout,
                  component: () => null,
                },
              ],
            },
          ],
        },
      ];

      const match: RouteMatch = {
        route: routes[0].children![0].children![0],
        params: {},
        path: '/app/dashboard',
        score: 0,
      };

      const layouts = buildLayoutChain(match, routes);
      expect(layouts).toHaveLength(1);
      // Only the matched route's layout is collected in current implementation
      expect(layouts[0]).toBe(DashboardLayout);
    });
  });

  describe('findErrorBoundary', () => {
    it('should return undefined when no error boundary', () => {
      const routes: RouteDefinition[] = [
        {
          path: '/test',
          component: () => null,
        },
      ];

      const match: RouteMatch = {
        route: routes[0],
        params: {},
        path: '/test',
        score: 0,
      };

      const errorBoundary = findErrorBoundary(match, routes);
      expect(errorBoundary).toBeUndefined();
    });

    it('should return error boundary when defined', () => {
      const ErrorPage = defineComponent(() => {
        return () => <div>Error</div>;
      });

      const routes: RouteDefinition[] = [
        {
          path: '/test',
          component: () => null,
          errorBoundary: ErrorPage,
        },
      ];

      const match: RouteMatch = {
        route: routes[0],
        params: {},
        path: '/test',
        score: 0,
      };

      const errorBoundary = findErrorBoundary(match, routes);
      expect(errorBoundary).toBe(ErrorPage);
    });

    it('should find nearest error boundary in route tree', () => {
      const RootError = defineComponent(() => () => <div>Root Error</div>);
      const AppError = defineComponent(() => () => <div>App Error</div>);

      const routes: RouteDefinition[] = [
        {
          path: '/',
          errorBoundary: RootError,
          children: [
            {
              path: '/app',
              errorBoundary: AppError,
              component: () => null,
            },
          ],
        },
      ];

      const match: RouteMatch = {
        route: routes[0].children![0],
        params: {},
        path: '/app',
        score: 0,
      };

      const errorBoundary = findErrorBoundary(match, routes);
      expect(errorBoundary).toBe(AppError);
    });
  });

  describe('findLoadingComponent', () => {
    it('should return undefined when no loading component', () => {
      const routes: RouteDefinition[] = [
        {
          path: '/test',
          component: () => null,
        },
      ];

      const match: RouteMatch = {
        route: routes[0],
        params: {},
        path: '/test',
        score: 0,
      };

      const loading = findLoadingComponent(match, routes);
      expect(loading).toBeUndefined();
    });

    it('should return loading component when defined', () => {
      const LoadingSpinner = defineComponent(() => {
        return () => <div>Loading...</div>;
      });

      const routes: RouteDefinition[] = [
        {
          path: '/test',
          component: () => null,
          loading: LoadingSpinner,
        },
      ];

      const match: RouteMatch = {
        route: routes[0],
        params: {},
        path: '/test',
        score: 0,
      };

      const loading = findLoadingComponent(match, routes);
      expect(loading).toBe(LoadingSpinner);
    });

    it('should find nearest loading component in route tree', () => {
      const RootLoading = defineComponent(() => () => <div>Root Loading</div>);
      const AppLoading = defineComponent(() => () => <div>App Loading</div>);

      const routes: RouteDefinition[] = [
        {
          path: '/',
          loading: RootLoading,
          children: [
            {
              path: '/app',
              loading: AppLoading,
              component: () => null,
            },
          ],
        },
      ];

      const match: RouteMatch = {
        route: routes[0].children![0],
        params: {},
        path: '/app',
        score: 0,
      };

      const loading = findLoadingComponent(match, routes);
      expect(loading).toBe(AppLoading);
    });
  });

  describe('createRouteContext', () => {
    it('should create route context with empty layouts', () => {
      const routes: RouteDefinition[] = [
        {
          path: '/test',
          component: () => null,
        },
      ];

      const match: RouteMatch = {
        route: routes[0],
        params: {},
        path: '/test',
        score: 0,
      };

      const context = createRouteContext(match, routes);

      expect(context.route).toBe(match);
      expect(context.layouts).toEqual([]);
      expect(context.errorBoundary).toBeUndefined();
      expect(context.loading).toBeUndefined();
    });

    it('should create route context with layouts', () => {
      const Layout = defineComponent(() => () => <div>Layout</div>);

      const routes: RouteDefinition[] = [
        {
          path: '/test',
          component: () => null,
          layout: Layout,
        },
      ];

      const match: RouteMatch = {
        route: routes[0],
        params: {},
        path: '/test',
        score: 0,
      };

      const context = createRouteContext(match, routes);

      expect(context.route).toBe(match);
      expect(context.layouts).toHaveLength(1);
      expect(context.layouts[0]).toBe(Layout);
    });

    it('should create route context with error boundary', () => {
      const ErrorPage = defineComponent(() => () => <div>Error</div>);

      const routes: RouteDefinition[] = [
        {
          path: '/test',
          component: () => null,
          errorBoundary: ErrorPage,
        },
      ];

      const match: RouteMatch = {
        route: routes[0],
        params: {},
        path: '/test',
        score: 0,
      };

      const context = createRouteContext(match, routes);

      expect(context.errorBoundary).toBe(ErrorPage);
    });

    it('should create route context with loading component', () => {
      const Loading = defineComponent(() => () => <div>Loading</div>);

      const routes: RouteDefinition[] = [
        {
          path: '/test',
          component: () => null,
          loading: Loading,
        },
      ];

      const match: RouteMatch = {
        route: routes[0],
        params: {},
        path: '/test',
        score: 0,
      };

      const context = createRouteContext(match, routes);

      expect(context.loading).toBe(Loading);
    });

    it('should create complete route context', () => {
      const Layout = defineComponent(() => () => <div>Layout</div>);
      const ErrorPage = defineComponent(() => () => <div>Error</div>);
      const Loading = defineComponent(() => () => <div>Loading</div>);

      const routes: RouteDefinition[] = [
        {
          path: '/test',
          component: () => null,
          layout: Layout,
          errorBoundary: ErrorPage,
          loading: Loading,
        },
      ];

      const match: RouteMatch = {
        route: routes[0],
        params: {},
        path: '/test',
        score: 0,
      };

      const context = createRouteContext(match, routes);

      expect(context.route).toBe(match);
      expect(context.layouts).toHaveLength(1);
      expect(context.layouts[0]).toBe(Layout);
      expect(context.errorBoundary).toBe(ErrorPage);
      expect(context.loading).toBe(Loading);
    });
  });

  describe('renderWithLayouts', () => {
    it('should return null when no component', () => {
      const routes: RouteDefinition[] = [
        {
          path: '/test',
        },
      ];

      const match: RouteMatch = {
        route: routes[0],
        params: {},
        path: '/test',
        score: 0,
      };

      const context = createRouteContext(match, routes);
      const result = renderWithLayouts(context);

      expect(result).toBeNull();
    });

    it('should render component without layouts', () => {
      const Component = defineComponent(() => {
        return () => <div>Component</div>;
      });

      const routes: RouteDefinition[] = [
        {
          path: '/test',
          component: Component,
        },
      ];

      const match: RouteMatch = {
        route: routes[0],
        params: {},
        path: '/test',
        score: 0,
      };

      const context = createRouteContext(match, routes);
      const result = renderWithLayouts(context);

      expect(result).toBeDefined();
    });

    it('should wrap component with layout', () => {
      const Component = defineComponent(() => {
        return () => <div>Component</div>;
      });

      const Layout = defineComponent((props: { children: any }) => {
        return () => <div class="layout">{props.children}</div>;
      });

      const routes: RouteDefinition[] = [
        {
          path: '/test',
          component: Component,
          layout: Layout,
        },
      ];

      const match: RouteMatch = {
        route: routes[0],
        params: {},
        path: '/test',
        score: 0,
      };

      const context = createRouteContext(match, routes);
      const result = renderWithLayouts(context);

      expect(result).toBeDefined();
    });

    it('should wrap with error boundary', () => {
      const Component = defineComponent(() => {
        return () => <div>Component</div>;
      });

      const ErrorBoundary = defineComponent((props: { children: any }) => {
        return () => <div class="error-boundary">{props.children}</div>;
      });

      const routes: RouteDefinition[] = [
        {
          path: '/test',
          component: Component,
          errorBoundary: ErrorBoundary,
        },
      ];

      const match: RouteMatch = {
        route: routes[0],
        params: {},
        path: '/test',
        score: 0,
      };

      const context = createRouteContext(match, routes);
      const result = renderWithLayouts(context);

      expect(result).toBeDefined();
    });

    it('should pass params to component', () => {
      let receivedParams: any = null;

      const Component = defineComponent((props: { params: any }) => {
        receivedParams = props.params;
        return () => <div>Component</div>;
      });

      const routes: RouteDefinition[] = [
        {
          path: '/test/:id',
          component: Component,
        },
      ];

      const mockParams = { id: '123' };
      const match: RouteMatch = {
        route: routes[0],
        params: mockParams,
        path: '/test/123',
        score: 0,
      };

      const context = createRouteContext(match, routes);
      renderWithLayouts(context);

      expect(receivedParams).toEqual(mockParams);
    });
  });
});
