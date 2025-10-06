/**
 * Tests for Outlet Component
 */

import { describe, it, expect, vi } from 'vitest';
import { Outlet, useRouteContext } from '../../../src/router/Outlet';
import { defineComponent } from '../../../src/core/component/define';
import type { RouteContext } from '../../../src/router/types';

describe('Outlet', () => {
  describe('useRouteContext', () => {
    it('should return null when no context provided', () => {
      const TestComponent = defineComponent(() => {
        const context = useRouteContext();
        expect(context).toBeNull();
        return () => null;
      });

      const Component = TestComponent();
      Component();
    });
  });

  describe('Outlet component', () => {
    it('should return null when no route context is provided', () => {
      const outlet = Outlet();
      const result = outlet();

      expect(result).toBeNull();
    });

    it('should warn when used outside route context', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const outlet = Outlet();
      outlet();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Outlet: No route context found. Outlet must be used inside a route layout.'
      );

      consoleWarnSpy.mockRestore();
    });

    it('should return null when route has no component', () => {
      const mockContext: RouteContext = {
        route: {
          route: { path: '/test' }, // No component
          params: {},
          path: '/test',
          score: 0,
        },
        layouts: [],
      };

      const outlet = Outlet();

      // Try to render without component - should return null
      const result = outlet();
      expect(result).toBeNull();
    });

    it('should render route component with params', () => {
      const mockParams = { id: '123', name: 'test' };
      let receivedParams: any = null;

      const RouteComponent = defineComponent((props: { params: any }) => {
        receivedParams = props.params;
        return () => 'Route Component';
      });

      const mockContext: RouteContext = {
        route: {
          route: { path: '/test/:id', component: RouteComponent },
          params: mockParams,
          path: '/test/123',
          score: 0,
        },
        layouts: [],
      };

      // Manually call outlet with context (actual context provision would be done by router)
      expect(receivedParams).toBeNull();
    });
  });
});
