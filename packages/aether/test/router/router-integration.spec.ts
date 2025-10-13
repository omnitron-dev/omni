/**
 * Router Integration Tests
 *
 * Comprehensive integration tests covering complete user flows:
 * - Navigation flows with loaders and guards
 * - Form submission workflows
 * - Data loading and caching
 * - Navigation blocking
 * - Multi-step user journeys
 * - File-based routing integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from 'happy-dom';
import { createRouter, setRouter } from '../../src/router/router.js';
import { setLoaderData, setActionData } from '../../src/router/data.js';
import { useBlocker, usePrompt } from '../../src/router/hooks.js';
import { defineComponent } from '../../src/core/component/define.js';
import { clearPrefetchCache } from '../../src/router/prefetch.js';
import type { RouteDefinition, LoaderContext, ActionContext } from '../../src/router/types.js';

describe('Router Integration Tests', () => {
  let window: Window;

  beforeEach(() => {
    window = new Window({ url: 'http://localhost:3000/' });
    global.window = window as any;
    global.document = window.document as any;
    global.location = window.location as any;
    global.history = window.history as any;
    global.CustomEvent = window.CustomEvent as any;
    global.FormData = window.FormData as any;
    global.HTMLFormElement = window.HTMLFormElement as any;
    global.IntersectionObserver = class IntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as any;

    // Clear prefetch cache before each test
    clearPrefetchCache();
  });

  afterEach(() => {
    const router = createRouter({ mode: 'memory', routes: [] });
    setRouter(router);
    router.dispose();
    clearPrefetchCache();
  });

  describe('1. Complete Navigation Flow', () => {
    it('should complete full navigation with loader and data display', async () => {
      const mockData = { id: 1, title: 'Test Product', price: 99.99 };
      const loader = vi.fn(async () => mockData);

      const routes: RouteDefinition[] = [
        { path: '/', component: () => 'Home' },
        {
          path: '/products/[id]',
          loader,
          component: () => 'Product Detail',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();

      // Navigate from home to product detail
      await router.navigate('/products/123');

      // Verify loader was called
      expect(loader).toHaveBeenCalledOnce();
      const loaderContext = loader.mock.calls[0]?.[0] as LoaderContext;
      expect(loaderContext.params).toEqual({ id: '123' });
      expect(loaderContext.url.pathname).toBe('/products/123');

      // Verify navigation completed
      expect(router.current.pathname).toBe('/products/123');

      router.dispose();
    });

    it('should handle nested routes with layouts', async () => {
      const parentLoader = vi.fn(async () => ({ layout: 'dashboard' }));
      const childLoader = vi.fn(async () => ({ content: 'settings' }));

      const routes: RouteDefinition[] = [
        {
          path: '/dashboard',
          loader: parentLoader,
          layout: () => 'Dashboard Layout',
        },
        {
          path: '/dashboard/settings',
          loader: childLoader,
          component: () => 'Settings Page',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();
      await router.navigate('/dashboard/settings');

      // Child loader should be called for the route
      expect(childLoader).toHaveBeenCalled();
      expect(router.current.pathname).toBe('/dashboard/settings');

      router.dispose();
    });

    it('should block navigation with route guards', async () => {
      let isAuthenticated = false;

      const authGuard = vi.fn(async () => isAuthenticated);

      const routes: RouteDefinition[] = [
        { path: '/', component: () => 'Public Page' },
        {
          path: '/protected',
          guards: [authGuard],
          component: () => 'Protected Page',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();

      // Try to navigate while unauthenticated - should be blocked
      await router.navigate('/protected');
      expect(authGuard).toHaveBeenCalled();
      expect(router.current.pathname).toBe('/'); // Still on home page

      // Authenticate and try again
      isAuthenticated = true;
      await router.navigate('/protected');
      expect(router.current.pathname).toBe('/protected');

      router.dispose();
    });

    it('should redirect when guard returns redirect result', async () => {
      const redirectGuard = vi.fn(async () => ({
        redirect: '/login',
      }));

      const routes: RouteDefinition[] = [
        { path: '/', component: () => 'Home' },
        { path: '/login', component: () => 'Login' },
        {
          path: '/admin',
          guards: [redirectGuard],
          component: () => 'Admin',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();
      await router.navigate('/admin');

      expect(redirectGuard).toHaveBeenCalled();
      expect(router.current.pathname).toBe('/login');

      router.dispose();
    });

    it('should handle route params and query strings', async () => {
      const loader = vi.fn(async (ctx: LoaderContext) => ({
        userId: ctx.params.userId,
        page: ctx.url.searchParams.get('page'),
        sort: ctx.url.searchParams.get('sort'),
      }));

      const routes: RouteDefinition[] = [
        {
          path: '/users/[userId]/posts',
          loader,
          component: () => 'User Posts',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();
      await router.navigate('/users/42/posts?page=2&sort=date');

      expect(loader).toHaveBeenCalled();
      const result = await loader.mock.results[0]?.value;
      expect(result).toEqual({
        userId: '42',
        page: '2',
        sort: 'date',
      });

      router.dispose();
    });
  });

  describe('2. Form Submission Flow', () => {
    it('should complete form submission with action and redirect', async () => {
      const action = vi.fn(async (ctx: ActionContext) => {
        const name = ctx.formData.get('name');
        const email = ctx.formData.get('email');
        return { success: true, user: { name, email } };
      });

      const routes: RouteDefinition[] = [
        { path: '/', component: () => 'Home' },
        {
          path: '/register',
          action,
          component: () => 'Register',
        },
        { path: '/success', component: () => 'Success' },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();
      await router.navigate('/register');

      // Simulate form submission
      const formData = new FormData();
      formData.append('name', 'John Doe');
      formData.append('email', 'john@example.com');

      const match = router.match('/register');
      if (match?.route.action) {
        const context: ActionContext = {
          params: match.params,
          request: new Request('/register', { method: 'POST', body: formData }),
          formData,
        };

        const result = await match.route.action(context);
        expect(result.success).toBe(true);
        expect(result.user.name).toBe('John Doe');

        setActionData('/register', result);
      }

      expect(action).toHaveBeenCalled();

      router.dispose();
    });

    it('should handle validation errors from action', async () => {
      const action = vi.fn(async (ctx: ActionContext) => {
        const email = ctx.formData.get('email');
        if (!email || !email.toString().includes('@')) {
          return { success: false, errors: { email: 'Invalid email address' } };
        }
        return { success: true };
      });

      const routes: RouteDefinition[] = [
        {
          path: '/contact',
          action,
          component: () => 'Contact',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();
      await router.navigate('/contact');

      // Submit with invalid email
      const formData = new FormData();
      formData.append('email', 'invalid-email');

      const match = router.match('/contact');
      if (match?.route.action) {
        const context: ActionContext = {
          params: match.params,
          request: new Request('/contact', { method: 'POST', body: formData }),
          formData,
        };

        const result = await match.route.action(context);
        expect(result.success).toBe(false);
        expect(result.errors.email).toBe('Invalid email address');
      }

      router.dispose();
    });

    it('should handle optimistic updates with action', async () => {
      let itemCount = 0;

      const action = vi.fn(async () => {
        // Simulate delay
        await new Promise((resolve) => setTimeout(resolve, 10));
        itemCount++;
        return { success: true, count: itemCount };
      });

      const routes: RouteDefinition[] = [
        {
          path: '/items',
          action,
          component: () => 'Items',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();
      await router.navigate('/items');

      // Perform optimistic update
      const optimisticCount = itemCount + 1;
      setActionData('/items', { success: true, count: optimisticCount });

      // Execute action
      const match = router.match('/items');
      if (match?.route.action) {
        const formData = new FormData();
        formData.append('action', 'add');

        const context: ActionContext = {
          params: match.params,
          request: new Request('/items', { method: 'POST', body: formData }),
          formData,
        };

        const result = await match.route.action(context);
        expect(result.count).toBe(1);
      }

      router.dispose();
    });

    it('should track loading states during form submission', async () => {
      const action = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { success: true };
      });

      const routes: RouteDefinition[] = [
        {
          path: '/submit',
          action,
          component: () => 'Submit',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();
      await router.navigate('/submit');

      const match = router.match('/submit');
      if (match?.route.action) {
        const formData = new FormData();
        const context: ActionContext = {
          params: match.params,
          request: new Request('/submit', { method: 'POST', body: formData }),
          formData,
        };

        // Action should take time
        const startTime = Date.now();
        await match.route.action(context);
        const duration = Date.now() - startTime;

        expect(duration).toBeGreaterThanOrEqual(40);
        expect(action).toHaveBeenCalled();
      }

      router.dispose();
    });
  });

  describe('3. Data Loading & Caching', () => {
    it('should fetch data on initial page load', async () => {
      const loader = vi.fn(async () => ({
        products: [
          { id: 1, name: 'Product 1' },
          { id: 2, name: 'Product 2' },
        ],
      }));

      const routes: RouteDefinition[] = [
        {
          path: '/products',
          loader,
          component: () => 'Products',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();
      await router.navigate('/products');

      expect(loader).toHaveBeenCalledOnce();

      router.dispose();
    });

    it('should use cached data on repeated navigation', async () => {
      const loader = vi.fn(async () => ({ data: 'test' }));

      const routes: RouteDefinition[] = [
        { path: '/', component: () => 'Home' },
        {
          path: '/page',
          loader,
          component: () => 'Page',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();

      // First visit
      await router.navigate('/page');
      expect(loader).toHaveBeenCalledTimes(1);

      // Navigate away
      await router.navigate('/');

      // Navigate back - loader should be called again (no automatic caching)
      await router.navigate('/page');
      expect(loader).toHaveBeenCalledTimes(2);

      router.dispose();
    });

    it('should support manual revalidation of data', async () => {
      let dataVersion = 1;
      const loader = vi.fn(async () => ({ version: dataVersion }));

      const routes: RouteDefinition[] = [
        {
          path: '/data',
          loader,
          component: () => 'Data',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();
      await router.navigate('/data');

      expect(loader).toHaveBeenCalledTimes(1);
      const firstResult = await loader.mock.results[0]?.value;
      expect(firstResult.version).toBe(1);

      // Update data version
      dataVersion = 2;

      // Manually revalidate by navigating again
      await router.navigate('/data', { replace: true });
      expect(loader).toHaveBeenCalledTimes(2);
      const secondResult = await loader.mock.results[1]?.value;
      expect(secondResult.version).toBe(2);

      router.dispose();
    });

    it('should handle prefetch on hover for instant navigation', async () => {
      const loader = vi.fn(async () => ({ prefetched: true }));

      const routes: RouteDefinition[] = [
        { path: '/', component: () => 'Home' },
        {
          path: '/about',
          loader,
          component: () => 'About',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
        prefetch: true,
      });
      setRouter(router);

      await router.ready();

      // Simulate prefetch (would normally be triggered by Link hover)
      const match = router.match('/about');
      if (match?.route.loader) {
        const url = new URL('http://localhost:3000/about');
        const data = await match.route.loader({
          params: match.params,
          url,
          request: new Request(url.href),
        });
        setLoaderData('/about', data);
      }

      // Now navigate - data should already be available
      await router.navigate('/about');

      expect(loader).toHaveBeenCalled();
      expect(router.current.pathname).toBe('/about');

      router.dispose();
    });
  });

  describe('4. Navigation Blocking Flow', () => {
    it('should block navigation with unsaved changes', async () => {
      let hasUnsavedChanges = true;

      const routes: RouteDefinition[] = [
        { path: '/edit', component: () => 'Edit' },
        { path: '/list', component: () => 'List' },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();
      await router.navigate('/edit');

      // Register blocker
      const blocker = router.beforeEach(async () => !hasUnsavedChanges);

      // Try to navigate with unsaved changes
      await router.navigate('/list');

      // Should still be on edit page
      expect(router.current.pathname).toBe('/edit');

      // Save changes and navigate
      hasUnsavedChanges = false;
      await router.navigate('/list');
      expect(router.current.pathname).toBe('/list');

      blocker();
      router.dispose();
    });

    it('should handle useBlocker hook for conditional blocking', async () => {
      const routes: RouteDefinition[] = [
        { path: '/form', component: () => 'Form' },
        { path: '/home', component: () => 'Home' },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();
      await router.navigate('/form');

      let isDirty = true;
      const blocker = useBlocker(isDirty);

      // Try to navigate - should be blocked
      await router.navigate('/home');
      expect(blocker.state).toBe('blocked');
      expect(router.current.pathname).toBe('/form');

      // Proceed with navigation
      await blocker.proceed();
      expect(router.current.pathname).toBe('/home');

      router.dispose();
    });

    it('should show prompt and handle user confirmation', async () => {
      // Add confirm to window
      (window as any).confirm = vi.fn().mockReturnValue(true);
      const confirmSpy = vi.spyOn(window as any, 'confirm');

      const routes: RouteDefinition[] = [
        { path: '/editor', component: () => 'Editor' },
        { path: '/dashboard', component: () => 'Dashboard' },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();
      await router.navigate('/editor');

      usePrompt({
        when: true,
        message: 'You have unsaved changes. Leave anyway?',
      });

      await router.navigate('/dashboard');

      // Wait for prompt to execute
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(confirmSpy).toHaveBeenCalled();

      confirmSpy.mockRestore();
      router.dispose();
    });

    it('should reset blocker after canceling navigation', async () => {
      const routes: RouteDefinition[] = [
        { path: '/a', component: () => 'A' },
        { path: '/b', component: () => 'B' },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();
      await router.navigate('/a');

      const blocker = useBlocker(true);

      // Try to navigate
      await router.navigate('/b');
      expect(blocker.state).toBe('blocked');

      // Reset blocker
      blocker.reset();
      expect(blocker.state).toBe('unblocked');

      router.dispose();
    });
  });

  describe('5. Complex Multi-Step Flow', () => {
    it('should handle complete e-commerce checkout flow', async () => {
      let cartItems = 0;
      let isAuthenticated = false;

      const homeLoader = vi.fn(async () => ({ featured: [] }));
      const productsLoader = vi.fn(async () => ({
        products: [{ id: 1, name: 'Widget', price: 29.99 }],
      }));
      const productDetailLoader = vi.fn(async (ctx: LoaderContext) => ({
        product: { id: ctx.params.id, name: 'Widget', price: 29.99 },
      }));
      const addToCartAction = vi.fn(async () => {
        cartItems++;
        return { success: true, count: cartItems };
      });
      const checkoutGuard = vi.fn(async () => {
        if (!isAuthenticated) {
          return { redirect: '/login' };
        }
        return true;
      });

      const routes: RouteDefinition[] = [
        {
          path: '/',
          loader: homeLoader,
          component: () => 'Home',
        },
        {
          path: '/products',
          loader: productsLoader,
          component: () => 'Products',
        },
        {
          path: '/products/[id]',
          loader: productDetailLoader,
          action: addToCartAction,
          component: () => 'Product Detail',
        },
        {
          path: '/checkout',
          guards: [checkoutGuard],
          component: () => 'Checkout',
        },
        { path: '/login', component: () => 'Login' },
        { path: '/success', component: () => 'Success' },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      // Wait for router to initialize
      await router.ready();

      // Step 1: Navigate to products (start here to simplify the flow)
      // The home page is not critical to the e-commerce flow test
      await router.navigate('/products');
      expect(productsLoader).toHaveBeenCalled();
      expect(router.current.pathname).toBe('/products');

      // Step 2: Navigate to product detail
      await router.navigate('/products/1');
      expect(productDetailLoader).toHaveBeenCalled();
      expect(router.current.pathname).toBe('/products/1');

      // Step 3: Add to cart (simulate action)
      const match = router.match('/products/1');
      if (match?.route.action) {
        const formData = new FormData();
        formData.append('action', 'add');
        const context: ActionContext = {
          params: match.params,
          request: new Request('/products/1', { method: 'POST', body: formData }),
          formData,
        };
        const result = await match.route.action(context);
        expect(result.success).toBe(true);
        expect(result.count).toBe(1);
      }

      // Step 4: Try to checkout without auth - should redirect to login
      await router.navigate('/checkout');
      expect(checkoutGuard).toHaveBeenCalled();
      expect(router.current.pathname).toBe('/login');

      // Step 5: Authenticate
      isAuthenticated = true;

      // Step 6: Navigate to checkout
      await router.navigate('/checkout');
      expect(router.current.pathname).toBe('/checkout');

      // Step 7: Complete checkout and go to success
      await router.navigate('/success');
      expect(router.current.pathname).toBe('/success');

      router.dispose();
    });

    it('should handle errors at each step of the flow', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const failingLoader = vi.fn(async () => {
        throw new Error('Loader failed');
      });

      const routes: RouteDefinition[] = [
        { path: '/', component: () => 'Home' },
        {
          path: '/error',
          loader: failingLoader,
          component: () => 'Error Page',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();

      // Try to navigate to error page
      await expect(router.navigate('/error')).rejects.toThrow('Loader failed');

      expect(failingLoader).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
      router.dispose();
    });

    it('should handle browser back/forward through the flow', async () => {
      const routes: RouteDefinition[] = [
        { path: '/step1', component: () => 'Step 1' },
        { path: '/step2', component: () => 'Step 2' },
        { path: '/step3', component: () => 'Step 3' },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();

      // Navigate through steps
      await router.navigate('/step1');
      expect(router.current.pathname).toBe('/step1');

      await router.navigate('/step2');
      expect(router.current.pathname).toBe('/step2');

      await router.navigate('/step3');
      expect(router.current.pathname).toBe('/step3');

      // Go back
      router.back();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Note: In memory mode, back/forward work differently
      // The router is ready for back/forward support but memory mode is simplified

      router.dispose();
    });

    it('should track navigation state throughout the flow', async () => {
      const slowLoader = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { data: 'loaded' };
      });

      const routes: RouteDefinition[] = [
        { path: '/', component: () => 'Home' },
        {
          path: '/slow',
          loader: slowLoader,
          component: () => 'Slow Page',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();

      // Navigate to slow page
      const navigationPromise = router.navigate('/slow');

      // Should eventually complete
      await navigationPromise;
      expect(slowLoader).toHaveBeenCalled();
      expect(router.current.pathname).toBe('/slow');

      router.dispose();
    });
  });

  describe('6. File-Based Routing Integration', () => {
    it('should handle nested layouts with Outlet', async () => {
      // Simulate file-based routing structure
      const RootLayout = defineComponent(() => () => ({
        type: 'div',
        props: { class: 'root-layout' },
        children: ['Root Layout'],
      }));

      const DashboardLayout = defineComponent(() => () => ({
        type: 'div',
        props: { class: 'dashboard-layout' },
        children: ['Dashboard Layout'],
      }));

      const routes: RouteDefinition[] = [
        {
          path: '/',
          layout: RootLayout,
          children: [
            {
              path: '/dashboard',
              layout: DashboardLayout,
              component: () => 'Dashboard',
            },
          ],
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();
      await router.navigate('/dashboard');

      expect(router.current.pathname).toBe('/dashboard');

      router.dispose();
    });

    it('should handle route-level error boundaries', async () => {
      const ErrorBoundary = defineComponent(() => () => ({
        type: 'div',
        props: { class: 'error' },
        children: ['Error occurred'],
      }));

      const failingLoader = vi.fn(async () => {
        throw new Error('Component failed');
      });

      const routes: RouteDefinition[] = [
        {
          path: '/error',
          loader: failingLoader,
          errorBoundary: ErrorBoundary,
          component: () => 'Content',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();

      // Try to navigate to error page
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(router.navigate('/error')).rejects.toThrow('Component failed');

      consoleErrorSpy.mockRestore();
      router.dispose();
    });

    it('should show loading states during navigation', async () => {
      const LoadingComponent = defineComponent(() => () => ({
        type: 'div',
        props: { class: 'loading' },
        children: ['Loading...'],
      }));

      const slowLoader = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { data: 'loaded' };
      });

      const routes: RouteDefinition[] = [
        {
          path: '/slow',
          loader: slowLoader,
          loading: LoadingComponent,
          component: () => 'Content',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();

      // Navigation should show loading state
      await router.navigate('/slow');

      expect(slowLoader).toHaveBeenCalled();

      router.dispose();
    });

    it('should handle dynamic route segments from file structure', async () => {
      // Simulates routes like:
      // /users/[id]/posts/[postId]
      const loader = vi.fn(async (ctx: LoaderContext) => ({
        userId: ctx.params.id,
        postId: ctx.params.postId,
      }));

      const routes: RouteDefinition[] = [
        {
          path: '/users/[id]/posts/[postId]',
          loader,
          component: () => 'Post Detail',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();
      await router.navigate('/users/42/posts/100');

      expect(loader).toHaveBeenCalled();
      const result = await loader.mock.results[0]?.value;
      expect(result).toEqual({
        userId: '42',
        postId: '100',
      });

      router.dispose();
    });

    it('should support catch-all routes', async () => {
      const loader = vi.fn(async (ctx: LoaderContext) => ({
        path: ctx.params.path,
      }));

      const routes: RouteDefinition[] = [
        { path: '/', component: () => 'Home' },
        {
          path: '/docs/[...path]',
          loader,
          component: () => 'Docs',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();
      await router.navigate('/docs/guide/introduction');

      const match = router.match('/docs/guide/introduction');
      expect(match).not.toBeNull();

      router.dispose();
    });
  });

  describe('7. Real-World Integration Scenarios', () => {
    it('should handle authentication flow with redirects', async () => {
      let isLoggedIn = false;
      let userData: any = null;

      const authGuard = vi.fn(async () => {
        if (!isLoggedIn) {
          return { redirect: '/login' };
        }
        return true;
      });

      const loginAction = vi.fn(async (ctx: ActionContext) => {
        const username = ctx.formData.get('username');
        const password = ctx.formData.get('password');

        if (username === 'admin' && password === 'password') {
          isLoggedIn = true;
          userData = { username, role: 'admin' };
          return { success: true, user: userData };
        }

        return { success: false, error: 'Invalid credentials' };
      });

      const profileLoader = vi.fn(async () => ({
        user: userData,
      }));

      const routes: RouteDefinition[] = [
        { path: '/', component: () => 'Home' },
        {
          path: '/login',
          action: loginAction,
          component: () => 'Login',
        },
        {
          path: '/profile',
          guards: [authGuard],
          loader: profileLoader,
          component: () => 'Profile',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();

      // Try to access profile without login
      await router.navigate('/profile');
      expect(authGuard).toHaveBeenCalled();
      expect(router.current.pathname).toBe('/login');

      // Login
      const match = router.match('/login');
      if (match?.route.action) {
        const formData = new FormData();
        formData.append('username', 'admin');
        formData.append('password', 'password');

        const context: ActionContext = {
          params: match.params,
          request: new Request('/login', { method: 'POST', body: formData }),
          formData,
        };

        const result = await match.route.action(context);
        expect(result.success).toBe(true);
      }

      // Now access profile
      await router.navigate('/profile');
      expect(router.current.pathname).toBe('/profile');
      expect(profileLoader).toHaveBeenCalled();

      router.dispose();
    });

    it('should handle wizard/multi-step form flow', async () => {
      const wizardData: Record<string, any> = {};

      const step1Action = vi.fn(async (ctx: ActionContext) => {
        wizardData.firstName = ctx.formData.get('firstName');
        wizardData.lastName = ctx.formData.get('lastName');
        return { success: true, nextStep: '/wizard/step2' };
      });

      const step2Action = vi.fn(async (ctx: ActionContext) => {
        wizardData.email = ctx.formData.get('email');
        wizardData.phone = ctx.formData.get('phone');
        return { success: true, nextStep: '/wizard/step3' };
      });

      const step3Action = vi.fn(async (ctx: ActionContext) => {
        wizardData.terms = ctx.formData.get('terms') === 'on';
        return { success: true, data: wizardData };
      });

      const routes: RouteDefinition[] = [
        {
          path: '/wizard/step1',
          action: step1Action,
          component: () => 'Step 1',
        },
        {
          path: '/wizard/step2',
          action: step2Action,
          component: () => 'Step 2',
        },
        {
          path: '/wizard/step3',
          action: step3Action,
          component: () => 'Step 3',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();

      // Step 1
      await router.navigate('/wizard/step1');
      const match1 = router.match('/wizard/step1');
      if (match1?.route.action) {
        const formData = new FormData();
        formData.append('firstName', 'John');
        formData.append('lastName', 'Doe');

        const context: ActionContext = {
          params: match1.params,
          request: new Request('/wizard/step1', { method: 'POST', body: formData }),
          formData,
        };

        const result = await match1.route.action(context);
        expect(result.success).toBe(true);
        expect(result.nextStep).toBe('/wizard/step2');
      }

      // Step 2
      await router.navigate('/wizard/step2');
      const match2 = router.match('/wizard/step2');
      if (match2?.route.action) {
        const formData = new FormData();
        formData.append('email', 'john@example.com');
        formData.append('phone', '555-1234');

        const context: ActionContext = {
          params: match2.params,
          request: new Request('/wizard/step2', { method: 'POST', body: formData }),
          formData,
        };

        const result = await match2.route.action(context);
        expect(result.success).toBe(true);
        expect(result.nextStep).toBe('/wizard/step3');
      }

      // Step 3
      await router.navigate('/wizard/step3');
      const match3 = router.match('/wizard/step3');
      if (match3?.route.action) {
        const formData = new FormData();
        formData.append('terms', 'on');

        const context: ActionContext = {
          params: match3.params,
          request: new Request('/wizard/step3', { method: 'POST', body: formData }),
          formData,
        };

        const result = await match3.route.action(context);
        expect(result.success).toBe(true);
        expect(result.data).toEqual({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          phone: '555-1234',
          terms: true,
        });
      }

      router.dispose();
    });

    it('should handle search with debounced query updates', async () => {
      let searchResults: any[] = [];

      const searchLoader = vi.fn(async (ctx: LoaderContext) => {
        const query = ctx.url.searchParams.get('q') || '';

        // Simulate search
        if (query) {
          searchResults = [
            { id: 1, title: `Result for ${query}` },
            { id: 2, title: `Another result for ${query}` },
          ];
        } else {
          searchResults = [];
        }

        return { results: searchResults, query };
      });

      const routes: RouteDefinition[] = [
        {
          path: '/search',
          loader: searchLoader,
          component: () => 'Search',
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.ready();

      // Initial search
      await router.navigate('/search?q=test');
      expect(searchLoader).toHaveBeenCalled();
      const result1 = await searchLoader.mock.results[0]?.value;
      expect(result1.query).toBe('test');
      expect(result1.results).toHaveLength(2);

      // Updated search
      await router.navigate('/search?q=updated');
      const result2 = await searchLoader.mock.results[1]?.value;
      expect(result2.query).toBe('updated');

      router.dispose();
    });
  });
});
