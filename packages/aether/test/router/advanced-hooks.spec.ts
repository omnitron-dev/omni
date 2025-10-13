/**
 * Advanced Router Hooks Tests
 *
 * Tests for useMatches, useRevalidator, useSubmit, useFormAction,
 * useBlocker, and usePrompt hooks
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Window } from 'happy-dom';
import { createRouter, setRouter } from '../../src/router/router.js';
import {
  useMatches,
  useRevalidator,
  useSubmit,
  useFormAction,
  useBlocker,
  usePrompt,
} from '../../src/router/hooks.js';
import { setLoaderData } from '../../src/router/data.js';
import type { RouteDefinition } from '../../src/router/types.js';

describe('Advanced Router Hooks', () => {
  let window: Window;

  beforeEach(() => {
    window = new Window({ url: 'http://localhost:3000/' });
    global.window = window as any;
    global.document = window.document as any;
    global.location = window.location as any;
    global.history = window.history as any;
    global.CustomEvent = window.CustomEvent as any;

    // Mock window.confirm for usePrompt tests
    if (!window.confirm) {
      (window as any).confirm = () => true;
    }

    // Reset router
    const routes: RouteDefinition[] = [
      { path: '/' },
      { path: '/about' },
      { path: '/users/[id]' },
    ];

    const router = createRouter({
      mode: 'memory',
      routes,
    });

    setRouter(router);
  });

  afterEach(() => {
    setRouter(null as any);
  });

  describe('useMatches', () => {
    it('should return empty array when no match', () => {
      const router = createRouter({
        mode: 'memory',
        routes: [{ path: '/test' }],
      });
      setRouter(router);

      window.history.pushState({}, '', '/no-match');

      const matches = useMatches();
      expect(matches()).toEqual([]);
    });

    it('should return current route match', async () => {
      const router = createRouter({
        mode: 'memory',
        routes: [{ path: '/users/[id]' }],
      });
      setRouter(router);

      await router.navigate('/users/123');

      const matches = useMatches();
      const result = matches();

      expect(result).toHaveLength(1);
      expect(result[0]?.path).toBe('/users/[id]');
      expect(result[0]?.params).toEqual({ id: '123' });
    });

    it('should update when route changes', async () => {
      const router = createRouter({
        mode: 'memory',
        routes: [
          { path: '/home' },
          { path: '/about' },
          { path: '/contact' },
        ],
      });
      setRouter(router);

      // Navigate to establish a known state
      await router.navigate('/home');

      const matches = useMatches();

      // Check that it shows /home
      expect(matches()[0]?.path).toBe('/home');

      await router.navigate('/about');
      expect(matches()[0]?.path).toBe('/about');

      await router.navigate('/contact');
      expect(matches()[0]?.path).toBe('/contact');
    });
  });

  describe('useRevalidator', () => {
    it('should start in idle state', () => {
      const revalidator = useRevalidator();
      expect(revalidator.state).toBe('idle');
    });

    it('should revalidate loader data', async () => {
      let callCount = 0;
      const loader = vi.fn(async () => {
        callCount++;
        return { data: `test-${callCount}` };
      });

      const routes: RouteDefinition[] = [
        {
          path: '/test',
          loader,
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.navigate('/test');
      expect(callCount).toBe(1);

      const revalidator = useRevalidator();
      await revalidator.revalidate();

      expect(callCount).toBe(2);
      expect(revalidator.state).toBe('idle');
    });

    it('should handle routes without loaders', async () => {
      const routes: RouteDefinition[] = [{ path: '/test' }];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.navigate('/test');

      const revalidator = useRevalidator();
      await revalidator.revalidate();

      expect(revalidator.state).toBe('idle');
    });

    it('should update loader data after revalidation', async () => {
      let value = 'initial';
      const loader = vi.fn(async () => {
        return { value };
      });

      const routes: RouteDefinition[] = [
        {
          path: '/test',
          loader,
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.navigate('/test');

      value = 'updated';
      const revalidator = useRevalidator();
      await revalidator.revalidate();

      expect(loader).toHaveBeenCalledTimes(2);
    });
  });

  describe('useSubmit', () => {
    it('should submit data to route action', async () => {
      const action = vi.fn(async ({ formData }) => {
        return { success: true, data: formData.get('name') };
      });

      const routes: RouteDefinition[] = [
        {
          path: '/test',
          action,
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.navigate('/test');

      const submit = useSubmit();
      await submit({ name: 'John' }, { action: '/test' });

      expect(action).toHaveBeenCalled();
      const context = action.mock.calls[0]?.[0];
      expect(context?.formData.get('name')).toBe('John');
    });

    it('should handle FormData input', async () => {
      const action = vi.fn(async ({ formData }) => {
        return { name: formData.get('name') };
      });

      const routes: RouteDefinition[] = [
        {
          path: '/test',
          action,
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.navigate('/test');

      const submit = useSubmit();
      const formData = new FormData();
      formData.append('name', 'Jane');

      await submit(formData, { action: '/test' });

      expect(action).toHaveBeenCalled();
      const context = action.mock.calls[0]?.[0];
      expect(context?.formData.get('name')).toBe('Jane');
    });

    it('should navigate after submit if replace option is true', async () => {
      const action = vi.fn(async () => ({ success: true }));

      const routes: RouteDefinition[] = [
        {
          path: '/test',
          action,
        },
      ];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      const submit = useSubmit();
      await submit({ data: 'test' }, {
        action: '/test',
        replace: true,
      });

      expect(router.current.pathname).toBe('/test');
    });

    it('should warn if no action found', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const routes: RouteDefinition[] = [{ path: '/test' }];

      const router = createRouter({
        mode: 'memory',
        routes,
      });
      setRouter(router);

      await router.navigate('/test');

      const submit = useSubmit();
      await submit({ data: 'test' }, { action: '/test' });

      expect(consoleSpy).toHaveBeenCalledWith('No action found for /test');
      consoleSpy.mockRestore();
    });
  });

  describe('useFormAction', () => {
    it('should return current pathname by default', async () => {
      const router = createRouter({
        mode: 'memory',
        routes: [{ path: '/test' }],
      });
      setRouter(router);

      await router.navigate('/test');

      const action = useFormAction();
      expect(action()).toBe('/test');
    });

    it('should return custom action when provided', async () => {
      const router = createRouter({
        mode: 'memory',
        routes: [{ path: '/test' }],
      });
      setRouter(router);

      await router.navigate('/test');

      const action = useFormAction('/custom');
      expect(action()).toBe('/custom');
    });

    it('should update when route changes', async () => {
      const router = createRouter({
        mode: 'memory',
        routes: [
          { path: '/page1' },
          { path: '/page2' },
        ],
      });
      setRouter(router);

      await router.navigate('/page1');
      const action = useFormAction();

      expect(action()).toBe('/page1');

      await router.navigate('/page2');
      expect(action()).toBe('/page2');
    });
  });

  describe('useBlocker', () => {
    it('should start in unblocked state', () => {
      const blocker = useBlocker(false);
      expect(blocker.state).toBe('unblocked');
    });

    it('should block navigation when condition is true', async () => {
      const router = createRouter({
        mode: 'memory',
        routes: [
          { path: '/' },
          { path: '/about' },
        ],
      });
      setRouter(router);

      const blocker = useBlocker(true);

      await router.navigate('/');

      // Try to navigate away
      const navigatePromise = router.navigate('/about');
      await navigatePromise;

      // Should be blocked
      expect(blocker.state).toBe('blocked');
      expect(router.current.pathname).toBe('/');
    });

    it('should proceed with navigation when proceed is called', async () => {
      const router = createRouter({
        mode: 'memory',
        routes: [
          { path: '/' },
          { path: '/about' },
        ],
      });
      setRouter(router);

      await router.ready();

      const blocker = useBlocker(true);

      await router.navigate('/');

      // Try to navigate - should be blocked
      await router.navigate('/about');
      expect(blocker.state).toBe('blocked');

      // Proceed with navigation
      await blocker.proceed();

      expect(router.current.pathname).toBe('/about');
      expect(blocker.state).toBe('unblocked');
    });

    it('should reset blocker state', async () => {
      const router = createRouter({
        mode: 'memory',
        routes: [
          { path: '/' },
          { path: '/about' },
        ],
      });
      setRouter(router);

      await router.navigate('/');

      const blocker = useBlocker(true);

      await router.navigate('/about');
      expect(blocker.state).toBe('blocked');

      blocker.reset();
      expect(blocker.state).toBe('unblocked');
    });

    it('should support function-based blocking', async () => {
      const router = createRouter({
        mode: 'memory',
        routes: [
          { path: '/' },
          { path: '/about' },
        ],
      });
      setRouter(router);

      await router.ready();

      let shouldBlock = false;
      const blocker = useBlocker(({ currentLocation, nextLocation }) => {
        return shouldBlock && currentLocation.pathname !== nextLocation.pathname;
      });

      // First navigation to /about - not blocked
      shouldBlock = false;
      await router.navigate('/about');
      expect(blocker.state).toBe('unblocked');

      // Go back to / first so we have a different starting point
      await router.navigate('/');
      expect(blocker.state).toBe('unblocked');

      // Second navigation back to /about - blocked
      shouldBlock = true;
      await router.navigate('/about');
      expect(blocker.state).toBe('blocked');
    });
  });

  describe('usePrompt', () => {
    it('should not prompt when condition is false', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm');

      const router = createRouter({
        mode: 'memory',
        routes: [
          { path: '/' },
          { path: '/about' },
        ],
      });
      setRouter(router);

      await router.navigate('/');

      usePrompt({ when: false });

      await router.navigate('/about');

      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('should prompt when condition is true', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      const router = createRouter({
        mode: 'memory',
        routes: [
          { path: '/' },
          { path: '/about' },
        ],
      });
      setRouter(router);

      await router.navigate('/');

      usePrompt({ when: true, message: 'Are you sure?' });

      await router.navigate('/about');

      // Wait for effect to run
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(confirmSpy).toHaveBeenCalled();
      confirmSpy.mockRestore();
    });

    it('should support function-based condition', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

      const router = createRouter({
        mode: 'memory',
        routes: [
          { path: '/home' },
          { path: '/about' },
        ],
      });
      setRouter(router);

      await router.navigate('/home');

      let hasUnsavedChanges = false;
      usePrompt({
        when: () => hasUnsavedChanges,
        message: 'Discard changes?',
      });

      // No unsaved changes - should not prompt
      hasUnsavedChanges = false;
      await router.navigate('/about');
      expect(confirmSpy).not.toHaveBeenCalled();

      // Has unsaved changes - should prompt
      hasUnsavedChanges = true;
      await router.navigate('/home');

      // Wait for blocker state change and effect to execute
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(confirmSpy).toHaveBeenCalled();
      confirmSpy.mockRestore();
    });
  });
});
