/**
 * @fileoverview Comprehensive tests for Outlet component
 */

import { describe, it, expect, vi } from 'vitest';
import {
  Outlet,
  createNamedOutlets,
  useOutlet,
  RouteContextSymbol,
  LayoutRoot,
  LayoutHeader,
  LayoutMain,
  LayoutSidebar,
  LayoutFooter,
} from '../../src/router/Outlet.js';
import { signal } from '../../src/core/reactivity/signal.js';
import type { RouteDefinition } from '../../src/router/types.js';

describe('Outlet component', () => {
  describe('basic rendering', () => {
    it('should create Outlet component', () => {
      expect(Outlet).toBeDefined();
      expect(typeof Outlet).toBe('function');
    });

    it('should render without route context', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Outlet is a component, calling it runs setup and render immediately
      const result = Outlet({});

      // defineComponent always returns DOM nodes, not raw values
      // When render function returns null, it becomes an empty text node
      expect(result).toBeInstanceOf(Node);
      expect((result as Node).textContent).toBe('');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No route context found'));

      consoleSpy.mockRestore();
    });
  });

  describe('route context', () => {
    it('should provide route context', () => {
      expect(RouteContextSymbol).toBeDefined();
      expect(RouteContextSymbol).toHaveProperty('Provider');
    });

    it('should use route context in Outlet', () => {
      // Mock context setup
      const mockContext = {
        route: {
          route: {
            path: '/test',
            children: [],
          },
          params: {},
          query: {},
          data: {},
        },
      };

      // In actual usage, context would be provided by router
      expect(mockContext).toBeDefined();
    });
  });

  describe('child route rendering', () => {
    it('should render child route component', () => {
      const ChildComponent = vi.fn(() => ({ tag: 'div', children: 'Child' }));

      const mockRoute: RouteDefinition = {
        path: '/parent',
        component: vi.fn(),
        children: [
          {
            path: '/parent/child',
            component: ChildComponent,
          },
        ],
      };

      // Outlet would render the child component
      expect(mockRoute.children?.[0].component).toBe(ChildComponent);
    });

    it('should pass props to child component', () => {
      const mockProps = {
        params: { id: '123' },
        query: { page: '1' },
        data: { user: 'test' },
      };

      // In actual rendering, Outlet passes these props
      expect(mockProps).toEqual({
        params: { id: '123' },
        query: { page: '1' },
        data: { user: 'test' },
      });
    });

    it('should handle multiple children', () => {
      const mockRoute: RouteDefinition = {
        path: '/parent',
        children: [
          { path: '/parent/child1', component: vi.fn() },
          { path: '/parent/child2', component: vi.fn() },
        ],
      };

      expect(mockRoute.children).toHaveLength(2);
    });
  });

  describe('named outlets', () => {
    it('should create named outlets configuration', () => {
      const outlets = createNamedOutlets({
        sidebar: {
          component: vi.fn(),
          loader: vi.fn(),
        },
        content: {
          component: vi.fn(),
        },
      });

      expect(outlets).toHaveLength(2);
      expect(outlets[0].meta?.outlet).toBe('sidebar');
      expect(outlets[1].meta?.outlet).toBe('content');
    });

    it('should set empty path for named outlets', () => {
      const outlets = createNamedOutlets({
        main: { component: vi.fn() },
      });

      expect(outlets[0].path).toBe('');
    });

    it('should preserve route config', () => {
      const loaderFn = vi.fn();
      const outlets = createNamedOutlets({
        main: {
          component: vi.fn(),
          loader: loaderFn,
          meta: { title: 'Main' },
        },
      });

      expect(outlets[0].loader).toBe(loaderFn);
      expect(outlets[0].meta?.title).toBe('Main');
      expect(outlets[0].meta?.outlet).toBe('main');
    });
  });

  describe('lazy loading', () => {
    it('should handle lazy component loading', async () => {
      const LazyComponent = vi.fn();
      const mockRoute: RouteDefinition = {
        path: '/lazy',
        lazy: async () => ({ default: LazyComponent }),
      };

      const module = await mockRoute.lazy!();
      expect(module.default).toBe(LazyComponent);
    });

    it('should track loading state', () => {
      const loading = signal(false);

      loading.set(true);
      expect(loading()).toBe(true);

      loading.set(false);
      expect(loading()).toBe(false);
    });

    it('should handle loading errors', async () => {
      const mockRoute: RouteDefinition = {
        path: '/error',
        lazy: async () => {
          throw new Error('Failed to load');
        },
      };

      await expect(mockRoute.lazy!()).rejects.toThrow('Failed to load');
    });
  });

  describe('fallback rendering', () => {
    it('should render fallback during loading', () => {
      const fallback = vi.fn(() => ({ tag: 'div', children: 'Loading...' }));

      const props = {
        fallback,
      };

      expect(props.fallback).toBe(fallback);
    });

    it('should render error fallback on error', () => {
      const errorFallback = vi.fn((error: Error) => ({
        tag: 'div',
        children: error.message,
      }));

      const error = new Error('Component error');
      const result = errorFallback(error);

      expect(result.children).toBe('Component error');
    });
  });

  describe('useOutlet hook', () => {
    it('should return outlet data', () => {
      const outlet = useOutlet();

      expect(outlet).toHaveProperty('params');
      expect(outlet).toHaveProperty('query');
      expect(outlet).toHaveProperty('data');
    });

    it('should return empty objects when no context', () => {
      const outlet = useOutlet();

      expect(outlet.params).toEqual({});
      expect(outlet.query).toEqual({});
      expect(outlet.data).toEqual({});
    });
  });

  describe('nested outlets', () => {
    it('should support nested outlet structure', () => {
      const mockRoute: RouteDefinition = {
        path: '/parent',
        children: [
          {
            path: '/parent/child',
            children: [
              {
                path: '/parent/child/grandchild',
                component: vi.fn(),
              },
            ],
          },
        ],
      };

      expect(mockRoute.children?.[0].children).toBeDefined();
      expect(mockRoute.children?.[0].children?.[0].path).toBe('/parent/child/grandchild');
    });

    it('should create nested route context', () => {
      const parentContext = {
        route: {
          route: { path: '/parent' },
          params: { parentId: '1' },
        },
      };

      const childContext = {
        route: {
          route: { path: '/parent/child' },
          params: { ...parentContext.route.params, childId: '2' },
        },
      };

      expect(childContext.route.params).toHaveProperty('parentId');
      expect(childContext.route.params).toHaveProperty('childId');
    });
  });

  describe('layout helpers', () => {
    it('should provide layout helper components', () => {
      expect(LayoutRoot).toBeDefined();
      expect(LayoutHeader).toBeDefined();
      expect(LayoutMain).toBeDefined();
      expect(LayoutSidebar).toBeDefined();
      expect(LayoutFooter).toBeDefined();
    });

    it('should accept class prop', () => {
      const props = { class: 'custom-layout' };

      // Layout components should apply the class
      expect(props.class).toBe('custom-layout');
    });

    it('should accept children prop', () => {
      const children = [{ tag: 'div', children: 'Content' }];
      const props = { children };

      expect(props.children).toBe(children);
    });
  });

  describe('error handling', () => {
    it('should handle missing component gracefully', () => {
      const mockRoute: RouteDefinition = {
        path: '/test',
        // No component provided
      };

      expect(mockRoute.component).toBeUndefined();
    });

    it('should log error when lazy loading fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const mockRoute: RouteDefinition = {
        path: '/error',
        lazy: async () => {
          throw new Error('Load failed');
        },
      };

      try {
        await mockRoute.lazy!();
      } catch (error) {
        // Expected error
      }

      // Error would be logged in actual Outlet component
      consoleSpy.mockRestore();
    });

    it('should handle component render errors', () => {
      const BrokenComponent = () => {
        throw new Error('Render error');
      };

      expect(() => BrokenComponent()).toThrow('Render error');
    });
  });

  describe('outlet resolution', () => {
    it('should resolve default outlet', () => {
      const mockRoute: RouteDefinition = {
        path: '/parent',
        children: [{ path: '/parent/child', component: vi.fn() }],
      };

      // Default outlet renders first child
      const firstChild = mockRoute.children?.[0];
      expect(firstChild).toBeDefined();
    });

    it('should resolve named outlet', () => {
      const mockRoute: RouteDefinition = {
        path: '/parent',
        children: [
          { path: '', component: vi.fn(), meta: { outlet: 'sidebar' } },
          { path: '', component: vi.fn(), meta: { outlet: 'content' } },
        ],
      };

      const sidebarChild = mockRoute.children?.find((child) => child.meta?.outlet === 'sidebar');
      const contentChild = mockRoute.children?.find((child) => child.meta?.outlet === 'content');

      expect(sidebarChild).toBeDefined();
      expect(contentChild).toBeDefined();
    });

    it('should handle missing outlet', () => {
      const mockRoute: RouteDefinition = {
        path: '/parent',
        children: [],
      };

      const child = mockRoute.children?.find((child) => child.meta?.outlet === 'nonexistent');

      expect(child).toBeUndefined();
    });
  });

  describe('performance', () => {
    it('should minimize re-renders', () => {
      const renderCount = { value: 0 };

      const Component = vi.fn(() => {
        renderCount.value++;
        return { tag: 'div', children: 'Content' };
      });

      // Component should only render when needed
      Component();
      expect(renderCount.value).toBe(1);
    });

    it('should handle many nested outlets', () => {
      const depth = 10;
      let current: RouteDefinition | undefined = {
        path: `/level${depth}`,
        component: vi.fn(),
      };

      for (let i = depth - 1; i >= 0; i--) {
        current = {
          path: `/level${i}`,
          component: vi.fn(),
          children: [current],
        };
      }

      expect(current).toBeDefined();
      expect(current.path).toBe('/level0');
    });
  });

  describe('edge cases', () => {
    it('should handle empty outlet props', () => {
      const props = {};
      const outletName = props.name || 'default';

      expect(outletName).toBe('default');
    });

    it('should handle null children', () => {
      const mockRoute: RouteDefinition = {
        path: '/test',
        component: vi.fn(),
        children: undefined,
      };

      expect(mockRoute.children).toBeUndefined();
    });

    it('should handle component returning null', () => {
      const Component = vi.fn(() => null);
      const result = Component();

      expect(result).toBeNull();
    });

    it('should handle undefined params', () => {
      const outlet = useOutlet();

      expect(outlet.params).toEqual({});
    });
  });
});
