/**
 * Tests for Router
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRouter } from '../../../src/router/router.js';
import type { RouteDefinition } from '../../../src/router/types.js';

describe('Router', () => {
  const routes: RouteDefinition[] = [
    { path: '/' },
    { path: '/about' },
    { path: '/users/[id]' },
    { path: '/docs/[...path]' },
  ];

  beforeEach(() => {
    // Mock window.history if needed
    if (typeof window !== 'undefined') {
      vi.clearAllMocks();
    }
  });

  describe('createRouter', () => {
    it('should create router with config', () => {
      const router = createRouter({
        mode: 'history',
        base: '/',
        routes,
      });

      expect(router).toBeDefined();
      expect(router.config.mode).toBe('history');
      expect(router.config.routes).toBe(routes);

      router.dispose();
    });

    it('should use default config', () => {
      const router = createRouter();

      expect(router.config.mode).toBe('history');
      expect(router.config.base).toBe('/');

      router.dispose();
    });
  });

  describe('match', () => {
    it('should match static route', () => {
      const router = createRouter({ routes });

      const match = router.match('/about');

      expect(match).toBeTruthy();
      expect(match?.route.path).toBe('/about');

      router.dispose();
    });

    it('should match dynamic route', () => {
      const router = createRouter({ routes });

      const match = router.match('/users/123');

      expect(match).toBeTruthy();
      expect(match?.route.path).toBe('/users/[id]');
      expect(match?.params).toEqual({ id: '123' });

      router.dispose();
    });

    it('should match catch-all route', () => {
      const router = createRouter({ routes });

      const match = router.match('/docs/guide/intro');

      expect(match).toBeTruthy();
      expect(match?.route.path).toBe('/docs/[...path]');
      expect(match?.params).toEqual({ path: ['guide', 'intro'] });

      router.dispose();
    });

    it('should return null for no match', () => {
      const router = createRouter({ routes });

      const match = router.match('/unknown');

      expect(match).toBeNull();

      router.dispose();
    });
  });

  describe('beforeEach', () => {
    it('should register before guard', () => {
      const router = createRouter({ routes });
      const guard = vi.fn(() => true);

      const unregister = router.beforeEach(guard);

      expect(typeof unregister).toBe('function');

      unregister();
      router.dispose();
    });

    it('should unregister guard', () => {
      const router = createRouter({ routes });
      const guard = vi.fn(() => true);

      const unregister = router.beforeEach(guard);
      unregister();

      router.dispose();
    });
  });

  describe('afterEach', () => {
    it('should register after hook', () => {
      const router = createRouter({ routes });
      const hook = vi.fn();

      const unregister = router.afterEach(hook);

      expect(typeof unregister).toBe('function');

      unregister();
      router.dispose();
    });

    it('should unregister hook', () => {
      const router = createRouter({ routes });
      const hook = vi.fn();

      const unregister = router.afterEach(hook);
      unregister();

      router.dispose();
    });
  });

  describe('dispose', () => {
    it('should clean up router', () => {
      const router = createRouter({ routes });

      expect(() => router.dispose()).not.toThrow();
    });
  });
});
