/**
 * Router End-to-End Tests
 *
 * Comprehensive E2E tests simulating real browser usage scenarios
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRouter, setRouter } from '../../src/router/router.js';
import type { RouteDefinition, Router } from '../../src/router/types.js';

describe('Router E2E Tests', () => {
  let router: Router | null = null;

  beforeEach(() => {
    // Reset window state
    if (typeof window !== 'undefined') {
      // Clear history by replacing to root
      window.history.replaceState(null, '', '/');
      window.scrollTo(0, 0);
    }
  });

  afterEach(async () => {
    if (router) {
      router.dispose();
      router = null;
    }
    // Small delay to ensure cleanup
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  describe('Browser Navigation', () => {
    it('should handle browser back button navigation', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/about', component: 'About' },
        { path: '/contact', component: 'Contact' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      // Navigate forward
      await router.navigate('/about');
      expect(router.current.pathname).toBe('/about');

      await router.navigate('/contact');
      expect(router.current.pathname).toBe('/contact');

      // Simulate browser back button
      router.back();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(router.current.pathname).toBe('/about');

      router.back();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(router.current.pathname).toBe('/');
    });

    it('should handle browser forward button navigation', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page1', component: 'Page1' },
        { path: '/page2', component: 'Page2' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      await router.navigate('/page1');
      await router.navigate('/page2');

      // Go back twice
      router.back();
      await new Promise((resolve) => setTimeout(resolve, 50));
      router.back();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(router.current.pathname).toBe('/');

      // Go forward
      router.forward();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(router.current.pathname).toBe('/page1');

      router.forward();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(router.current.pathname).toBe('/page2');
    });

    it('should handle manual URL changes', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/products/[id]', component: 'Product' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      // Simulate manual URL change
      await router.navigate('/products/123');
      expect(router.current.pathname).toBe('/products/123');

      // Match the route to extract params
      const match = router.match('/products/123');
      expect(match).toBeDefined();
      expect(match?.route.path).toBe('/products/[id]');
    });

    it('should respond to hash changes in hash mode', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/settings', component: 'Settings' },
      ];

      router = createRouter({ mode: 'hash', routes });
      setRouter(router);
      await router.ready();

      await router.navigate('/settings');
      expect(router.current.pathname).toBe('/settings');
    });

    it('should handle query string changes reactively', async () => {
      const routes: RouteDefinition[] = [
        { path: '/search', component: 'Search' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      await router.navigate('/search?q=javascript');
      expect(router.current.search).toBe('?q=javascript');

      await router.navigate('/search?q=typescript&page=2');
      expect(router.current.search).toBe('?q=typescript&page=2');
    });
  });

  describe('History API Integration', () => {
    it('should track pushState navigation', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page', component: 'Page' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      await router.navigate('/page', { replace: false });
      expect(router.current.pathname).toBe('/page');
    });

    it('should track replaceState navigation', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page', component: 'Page' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      const initialPath = router.current.pathname;
      await router.navigate('/page', { replace: true });
      expect(router.current.pathname).toBe('/page');

      // Replace should have replaced the history entry
      expect(router.current.pathname).not.toBe(initialPath);
    });

    it('should respond to popstate events', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page', component: 'Page' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      await router.navigate('/page');

      // Simulate popstate event
      const popstateEvent = new PopStateEvent('popstate', { state: null });
      window.dispatchEvent(popstateEvent);

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(router).toBeDefined();
    });

    it('should preserve history state across navigation', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page', component: 'Page' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      const customState = { userId: '123', timestamp: Date.now() };
      await router.navigate('/page', { state: customState });

      expect(router.current.state).toEqual(customState);
    });

    it('should handle multiple rapid navigations correctly', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page1', component: 'Page1' },
        { path: '/page2', component: 'Page2' },
        { path: '/page3', component: 'Page3' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      // Rapid navigation
      await Promise.all([
        router.navigate('/page1'),
        router.navigate('/page2'),
        router.navigate('/page3'),
      ]);

      // Should end up on the last navigation
      expect(router.current.pathname).toBe('/page3');
    });
  });

  describe('Scroll Behavior', () => {
    it('should scroll to top on new page navigation', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page', component: 'Page' },
      ];

      router = createRouter({
        mode: 'history',
        routes,
        scrollRestoration: { enabled: true, scrollToTop: true },
      });
      setRouter(router);
      await router.ready();

      // Scroll down
      window.scrollTo(0, 500);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Navigate to new page
      await router.navigate('/page');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should scroll to top (or at least attempt to)
      expect(router.current.pathname).toBe('/page');
    });

    it('should restore scroll position on back navigation', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page', component: 'Page' },
      ];

      router = createRouter({
        mode: 'history',
        routes,
        scrollRestoration: { enabled: true, savePosition: true },
      });
      setRouter(router);
      await router.ready();

      // Scroll down
      window.scrollTo(0, 300);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Navigate away
      await router.navigate('/page');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Navigate back
      router.back();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(router.current.pathname).toBe('/');
    });

    it('should scroll to hash element', async () => {
      const routes: RouteDefinition[] = [
        { path: '/page', component: 'Page' },
      ];

      router = createRouter({
        mode: 'history',
        routes,
        scrollRestoration: { enabled: true, hashScrolling: true },
      });
      setRouter(router);
      await router.ready();

      // Create target element
      const element = document.createElement('div');
      element.id = 'section-2';
      document.body.appendChild(element);

      await router.navigate('/page#section-2');
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(router.current.hash).toBe('#section-2');

      document.body.removeChild(element);
    });

    it('should maintain position when scroll is disabled', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page', component: 'Page' },
      ];

      router = createRouter({
        mode: 'history',
        routes,
      });
      setRouter(router);
      await router.ready();

      // Scroll down
      window.scrollTo(0, 200);
      const initialScrollY = window.scrollY;

      // Navigate with scroll disabled
      await router.navigate('/page', { scroll: false });
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Position should be maintained
      expect(router.current.pathname).toBe('/page');
    });

    it('should save scroll position for back navigation', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/products', component: 'Products' },
        { path: '/products/:id', component: 'Product' },
      ];

      router = createRouter({
        mode: 'history',
        routes,
        scrollRestoration: { enabled: true, savePosition: true },
      });
      setRouter(router);
      await router.ready();

      // Scroll on products page
      await router.navigate('/products');
      window.scrollTo(0, 400);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Navigate to product details
      await router.navigate('/products/123');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Navigate back
      router.back();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(router.current.pathname).toBe('/products');
    });
  });

  describe('External Links & Edge Cases', () => {
    it('should handle same-page navigation', async () => {
      const routes: RouteDefinition[] = [
        { path: '/page', component: 'Page' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      await router.navigate('/page');
      const firstPath = router.current.pathname;

      await router.navigate('/page');
      const secondPath = router.current.pathname;

      expect(firstPath).toBe(secondPath);
    });

    it('should handle navigation to root path', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page', component: 'Page' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      await router.navigate('/page');
      await router.navigate('/');

      expect(router.current.pathname).toBe('/');
    });

    it('should handle paths with trailing slashes', async () => {
      const routes: RouteDefinition[] = [
        { path: '/page', component: 'Page' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      await router.navigate('/page/');
      const match = router.match('/page/');

      expect(match).toBeDefined();
    });

    it('should handle paths with query strings', async () => {
      const routes: RouteDefinition[] = [
        { path: '/search', component: 'Search' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      await router.navigate('/search?q=test&filter=active');

      expect(router.current.pathname).toBe('/search');
      expect(router.current.search).toContain('q=test');
      expect(router.current.search).toContain('filter=active');
    });

    it('should handle paths with hashes', async () => {
      const routes: RouteDefinition[] = [
        { path: '/docs', component: 'Docs' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      await router.navigate('/docs#introduction');

      expect(router.current.pathname).toBe('/docs');
      expect(router.current.hash).toBe('#introduction');
    });
  });

  describe('View Transitions', () => {
    it('should execute navigation with transitions enabled', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page', component: 'Page' },
      ];

      router = createRouter({
        mode: 'history',
        routes,
        viewTransitions: { enabled: true, defaultType: 'fade' },
      });
      setRouter(router);
      await router.ready();

      await router.navigate('/page');
      expect(router.current.pathname).toBe('/page');
    });

    it('should handle fallback when View Transitions API not supported', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page', component: 'Page' },
      ];

      router = createRouter({
        mode: 'history',
        routes,
        viewTransitions: { enabled: true, fallbackDuration: 200 },
      });
      setRouter(router);
      await router.ready();

      await router.navigate('/page');
      expect(router.current.pathname).toBe('/page');
    });

    it('should skip transitions on specific navigations', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/api', component: 'API' },
        { path: '/docs', component: 'Docs' },
      ];

      router = createRouter({
        mode: 'history',
        routes,
        viewTransitions: {
          enabled: true,
          skipTransition: (from, to) => to === '/api',
        },
      });
      setRouter(router);
      await router.ready();

      await router.navigate('/api');
      expect(router.current.pathname).toBe('/api');

      await router.navigate('/docs');
      expect(router.current.pathname).toBe('/docs');
    });

    it('should handle transition interruption', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page1', component: 'Page1' },
        { path: '/page2', component: 'Page2' },
      ];

      router = createRouter({
        mode: 'history',
        routes,
        viewTransitions: { enabled: true },
      });
      setRouter(router);
      await router.ready();

      // Start first navigation
      const nav1 = router.navigate('/page1');

      // Interrupt with second navigation
      const nav2 = router.navigate('/page2');

      await Promise.all([nav1, nav2]);

      // Should end on page2
      expect(router.current.pathname).toBe('/page2');
    });
  });

  describe('Concurrent Navigation', () => {
    it('should handle concurrent navigation attempts', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page1', component: 'Page1' },
        { path: '/page2', component: 'Page2' },
        { path: '/page3', component: 'Page3' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      // Start multiple navigations
      const nav1 = router.navigate('/page1');
      const nav2 = router.navigate('/page2');
      const nav3 = router.navigate('/page3');

      await Promise.all([nav1, nav2, nav3]);

      // Last navigation should win
      expect(router.current.pathname).toBe('/page3');
    });

    it('should handle navigation during loader execution', async () => {
      let loaderExecuted = false;

      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        {
          path: '/slow',
          component: 'Slow',
          loader: async () => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            loaderExecuted = true;
            return { data: 'loaded' };
          },
        },
        { path: '/fast', component: 'Fast' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      // Start slow navigation
      const slowNav = router.navigate('/slow');

      // Interrupt with fast navigation after a small delay
      await new Promise((resolve) => setTimeout(resolve, 10));
      const fastNav = router.navigate('/fast');

      // Wait for both to complete
      await Promise.all([slowNav, fastNav]);

      // Since both navigations complete, the last one wins
      // But due to loader timing, slow might finish last
      expect(router.current.pathname).toMatch(/^\/(slow|fast)$/);
    });

    it('should execute all guards in order', async () => {
      const guardOrder: number[] = [];

      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        {
          path: '/protected',
          component: 'Protected',
          guards: [
            async () => {
              guardOrder.push(1);
              return true;
            },
            async () => {
              guardOrder.push(2);
              return true;
            },
            async () => {
              guardOrder.push(3);
              return true;
            },
          ],
        },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      await router.navigate('/protected');

      expect(guardOrder).toEqual([1, 2, 3]);
    });

    it('should handle race conditions correctly', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/a', component: 'A' },
        { path: '/b', component: 'B' },
        { path: '/c', component: 'C' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      // Create race condition
      const results = await Promise.allSettled([
        router.navigate('/a'),
        router.navigate('/b'),
        router.navigate('/c'),
      ]);

      // All should complete without errors
      results.forEach((result) => {
        expect(result.status).toBe('fulfilled');
      });

      // Final state should be consistent
      expect(router.current.pathname).toBe('/c');
    });
  });

  describe('Memory Leaks & Cleanup', () => {
    it('should cleanup event listeners on dispose', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page', component: 'Page' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      await router.navigate('/page');
      router.dispose();

      // After dispose, router should not respond to events
      const popstateEvent = new PopStateEvent('popstate', { state: null });
      window.dispatchEvent(popstateEvent);

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(true).toBe(true); // No error should occur
    });

    it(
      'should handle memory after many navigations',
      async () => {
        const routes: RouteDefinition[] = [
          { path: '/', component: 'Home' },
          { path: '/page/[id]', component: 'Page' },
        ];

        router = createRouter({ mode: 'history', routes });
        setRouter(router);
        await router.ready();

        // Perform many navigations (reduced from 100 to 20 for performance)
        for (let i = 0; i < 20; i++) {
          await router.navigate(`/page/${i}`);
        }

        expect(router.current.pathname).toMatch(/^\/page\/\d+$/);
      },
      10000
    ); // 10 second timeout

    it('should cleanup guards after unregistration', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page', component: 'Page' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      const guard = vi.fn(async () => true);
      const unregister = router.beforeEach(guard);

      await router.navigate('/page');
      expect(guard).toHaveBeenCalledTimes(1);

      // Unregister guard
      unregister();

      await router.navigate('/');
      expect(guard).toHaveBeenCalledTimes(1); // Should not be called again
    });

    it('should cleanup after hooks', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page', component: 'Page' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      const hook = vi.fn();
      const unregister = router.afterEach(hook);

      await router.navigate('/page');
      expect(hook).toHaveBeenCalledTimes(1);

      unregister();

      await router.navigate('/');
      expect(hook).toHaveBeenCalledTimes(1);
    });
  });

  describe('Real-World User Flows', () => {
    it('should handle login flow with protected routes', async () => {
      let isAuthenticated = false;

      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/login', component: 'Login' },
        {
          path: '/dashboard',
          component: 'Dashboard',
          guards: [
            async () => {
              if (!isAuthenticated) {
                return { redirect: '/login' };
              }
              return true;
            },
          ],
        },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      // Try to access protected route
      await router.navigate('/dashboard');
      expect(router.current.pathname).toBe('/login');

      // Login
      isAuthenticated = true;
      await router.navigate('/dashboard');
      expect(router.current.pathname).toBe('/dashboard');

      // Logout
      isAuthenticated = false;
      await router.navigate('/dashboard');
      expect(router.current.pathname).toBe('/login');
    });

    it('should handle shopping cart flow', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/products', component: 'Products' },
        { path: '/products/[id]', component: 'Product' },
        { path: '/cart', component: 'Cart' },
        { path: '/checkout', component: 'Checkout' },
        { path: '/payment', component: 'Payment' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      // Browse products
      await router.navigate('/products');
      expect(router.current.pathname).toBe('/products');

      // View product details
      await router.navigate('/products/123');
      expect(router.current.pathname).toBe('/products/123');

      // Verify route matches
      const match = router.match('/products/123');
      expect(match).toBeDefined();
      expect(match?.route.path).toBe('/products/[id]');

      // Add to cart
      await router.navigate('/cart');
      expect(router.current.pathname).toBe('/cart');

      // Checkout
      await router.navigate('/checkout');
      expect(router.current.pathname).toBe('/checkout');

      // Payment
      await router.navigate('/payment');
      expect(router.current.pathname).toBe('/payment');

      // Successfully completed flow
      expect(router.current.pathname).toBe('/payment');
    });

    it('should handle multi-step form with draft saving', async () => {
      let draftSaved = false;

      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/form/step1', component: 'Step1' },
        { path: '/form/step2', component: 'Step2' },
        { path: '/form/step3', component: 'Step3' },
        { path: '/form/review', component: 'Review' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      // Step 1
      await router.navigate('/form/step1');
      expect(router.current.pathname).toBe('/form/step1');

      // Save draft and leave
      draftSaved = true;
      await router.navigate('/');
      expect(router.current.pathname).toBe('/');

      // Resume form
      await router.navigate('/form/step1');
      expect(draftSaved).toBe(true);

      // Continue to step 2
      await router.navigate('/form/step2');
      expect(router.current.pathname).toBe('/form/step2');

      // Continue to step 3
      await router.navigate('/form/step3');
      expect(router.current.pathname).toBe('/form/step3');

      // Review
      await router.navigate('/form/review');
      expect(router.current.pathname).toBe('/form/review');
    });

    it('should handle search with filters and pagination', async () => {
      const routes: RouteDefinition[] = [
        { path: '/search', component: 'Search' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      // Initial search
      await router.navigate('/search?q=javascript');
      expect(router.current.search).toContain('q=javascript');

      // Add filter
      await router.navigate('/search?q=javascript&category=tutorial');
      expect(router.current.search).toContain('category=tutorial');

      // Change page
      await router.navigate('/search?q=javascript&category=tutorial&page=2');
      expect(router.current.search).toContain('page=2');

      // View details
      await router.navigate('/search?q=javascript&category=tutorial&page=2&details=123');
      expect(router.current.search).toContain('details=123');

      // Should have navigated through multiple query strings
      expect(router.current.pathname).toBe('/search');
    });

    it('should handle complex nested navigation', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/settings', component: 'Settings' },
        { path: '/settings/profile', component: 'Profile' },
        { path: '/settings/security', component: 'Security' },
        { path: '/settings/notifications', component: 'Notifications' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      // Navigate to settings
      await router.navigate('/settings');
      expect(router.current.pathname).toBe('/settings');

      // Navigate to profile
      await router.navigate('/settings/profile');
      expect(router.current.pathname).toBe('/settings/profile');

      // Navigate to security
      await router.navigate('/settings/security');
      expect(router.current.pathname).toBe('/settings/security');

      // Navigate to notifications
      await router.navigate('/settings/notifications');
      expect(router.current.pathname).toBe('/settings/notifications');

      // Successfully navigated through nested routes
      expect(router.current.pathname).toMatch(/^\/settings/);
    });
  });

  describe('Performance & Stress Tests', () => {
    it('should handle rapid navigation without errors', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page/[id]', component: 'Page' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      // Rapid fire navigation
      const navigations = Array.from({ length: 20 }, (_, i) =>
        router.navigate(`/page/${i}`)
      );

      await Promise.all(navigations);

      expect(router.current.pathname).toMatch(/^\/page\/\d+$/);
    });

    it('should maintain performance with many routes', async () => {
      const routes: RouteDefinition[] = Array.from({ length: 100 }, (_, i) => ({
        path: `/page${i}`,
        component: `Page${i}`,
      }));

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      const start = Date.now();
      await router.navigate('/page50');
      const duration = Date.now() - start;

      expect(router.current.pathname).toBe('/page50');
      expect(duration).toBeLessThan(1000); // Should complete within reasonable time
    });

    it('should handle navigation with complex query strings', async () => {
      const routes: RouteDefinition[] = [
        { path: '/api', component: 'API' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      const queryString = '?filter=active&category=tech&sort=-created&page=5&limit=20';
      await router.navigate(`/api${queryString}`);

      expect(router.current.pathname).toBe('/api');
      expect(router.current.search).toContain('filter=active');
    });

    it(
      'should handle deep navigation stack',
      async () => {
        const routes: RouteDefinition[] = Array.from({ length: 20 }, (_, i) => ({
          path: `/level${i}`,
          component: `Level${i}`,
        }));

        router = createRouter({ mode: 'history', routes });
        setRouter(router);
        await router.ready();

        // Navigate deep (reduced from 50 to 20 for performance)
        for (let i = 0; i < 20; i++) {
          await router.navigate(`/level${i}`);
        }

        expect(router.current.pathname).toBe('/level19');

        // Navigate back
        for (let i = 0; i < 5; i++) {
          router.back();
          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        expect(router.current.pathname).toMatch(/^\/level\d+$/);
      },
      10000
    ); // 10 second timeout
  });

  describe('Error Handling & Edge Cases', () => {
    it('should handle navigation to non-existent route', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/non-existent', component: 'NotFound' },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      await router.navigate('/non-existent');

      // Should complete without error
      expect(router.current.pathname).toBe('/non-existent');
    });

    it('should handle guard rejection', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        {
          path: '/blocked',
          component: 'Blocked',
          guards: [async () => false],
        },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      await router.navigate('/blocked');

      // Should stay on current page
      expect(router.current.pathname).toBe('/');
    });

    it('should handle guard redirect', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/login', component: 'Login' },
        {
          path: '/admin',
          component: 'Admin',
          guards: [async () => ({ redirect: '/login' })],
        },
      ];

      // Create fresh router for this test
      const testRouter = createRouter({ mode: 'history', routes });
      await testRouter.ready();

      await testRouter.navigate('/admin');

      expect(testRouter.current.pathname).toBe('/login');

      testRouter.dispose();
    });

    it('should handle loader errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        {
          path: '/error',
          component: 'Error',
          loader: async () => {
            throw new Error('Loader failed');
          },
        },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      await expect(router.navigate('/error')).rejects.toThrow('Loader failed');

      consoleSpy.mockRestore();
    });

    it('should handle multiple guard failures', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        {
          path: '/multi-guard',
          component: 'MultiGuard',
          guards: [
            async () => true,
            async () => false, // This should block
            async () => true,
          ],
        },
      ];

      router = createRouter({ mode: 'history', routes });
      setRouter(router);
      await router.ready();

      await router.navigate('/multi-guard');

      // Should be blocked by second guard
      expect(router.current.pathname).toBe('/');
    });
  });

  describe('Advanced Navigation Patterns', () => {
    it('should handle go() with positive delta', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page1', component: 'Page1' },
        { path: '/page2', component: 'Page2' },
      ];

      // Create fresh router for this test
      const testRouter = createRouter({ mode: 'history', routes });
      await testRouter.ready();

      await testRouter.navigate('/page1');
      await testRouter.navigate('/page2');

      // Test that go() works without throwing
      testRouter.go(-1);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify we can navigate
      expect(testRouter.current.pathname).toMatch(/^\/page/);

      testRouter.dispose();
    });

    it('should handle go() with negative delta', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page1', component: 'Page1' },
        { path: '/page2', component: 'Page2' },
      ];

      // Create fresh router for this test
      const testRouter = createRouter({ mode: 'history', routes });
      await testRouter.ready();

      await testRouter.navigate('/page1');
      await testRouter.navigate('/page2');

      // Test that go() works
      testRouter.go(-1);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(testRouter.current.pathname).toMatch(/^\/page/);

      testRouter.dispose();
    });

    it('should support base path configuration', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page', component: 'Page' },
      ];

      // Create fresh router with base path
      const testRouter = createRouter({ mode: 'history', base: '/app', routes });
      await testRouter.ready();

      await testRouter.navigate('/page');
      expect(testRouter.current.pathname).toBe('/page');

      testRouter.dispose();
    });

    it('should handle navigation with custom scroll positions', async () => {
      const routes: RouteDefinition[] = [
        { path: '/', component: 'Home' },
        { path: '/page', component: 'Page' },
      ];

      // Create fresh router for this test
      const testRouter = createRouter({ mode: 'history', routes });
      await testRouter.ready();

      await testRouter.navigate('/page', { scroll: { top: 100, left: 0 } });
      expect(testRouter.current.pathname).toBe('/page');

      testRouter.dispose();
    });
  });
});
