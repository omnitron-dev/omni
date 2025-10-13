/**
 * Suspense Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Suspense,
  suspend,
  useSuspense,
  createSuspenseResource,
  getCurrentSuspenseContext,
  resetSuspenseIdCounter,
} from '../../src/suspense/suspense.js';
import { signal } from '../../src/core/reactivity/signal.js';

describe('Suspense', () => {
  beforeEach(() => {
    resetSuspenseIdCounter();
  });

  describe('Suspense component', () => {
    it('should render fallback while loading', async () => {
      let resolvePromise: (value: string) => void;
      const promise = new Promise<string>((resolve) => {
        resolvePromise = resolve;
      });

      const fallback = 'Loading...';
      const component = Suspense({
        fallback,
        children: () => {
          suspend(promise);
          return 'Content';
        },
      });

      const renderFn = component();
      expect(renderFn()).toBe(fallback);

      // Resolve promise
      resolvePromise!('data');
      await promise;

      // Wait for state update
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(renderFn()).toBe('Content');
    });

    it('should render children when resolved', () => {
      const component = Suspense({
        fallback: 'Loading...',
        children: () => 'Content',
      });

      const renderFn = component();
      expect(renderFn()).toBe('Content');
    });

    it('should call lifecycle callbacks', async () => {
      const onSuspend = vi.fn();
      const onResolve = vi.fn();

      let resolvePromise: (value: string) => void;
      const promise = new Promise<string>((resolve) => {
        resolvePromise = resolve;
      });

      Suspense({
        fallback: 'Loading...',
        onSuspend,
        onResolve,
        children: () => {
          suspend(promise);
          return 'Content';
        },
      });

      // Wait for suspend callback
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onSuspend).toHaveBeenCalled();

      resolvePromise!('data');
      await promise;

      // Wait for resolve callback
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(onResolve).toHaveBeenCalled();
    });

    it('should handle timeout', async () => {
      const onTimeout = vi.fn();

      const promise = new Promise(() => {
        // Never resolves
      });

      Suspense({
        fallback: 'Loading...',
        timeout: 100,
        onTimeout,
        children: () => {
          suspend(promise);
          return 'Content';
        },
      });

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(onTimeout).toHaveBeenCalled();
    });
  });

  describe('suspend', () => {
    it('should throw promise to trigger suspense', () => {
      const promise = Promise.resolve('data');

      // Create suspense context first
      const component = Suspense({
        fallback: 'Loading...',
        children: () => {
          try {
            suspend(promise);
            return 'Content';
          } catch (thrown) {
            expect(thrown).toBe(promise);
            return 'Loading...';
          }
        },
      });

      component()();
    });

    it('should throw error when called outside suspense boundary', () => {
      const promise = Promise.resolve('data');

      expect(() => suspend(promise)).toThrow('suspend() called outside of a Suspense boundary');
    });
  });

  describe('useSuspense', () => {
    it('should suspend on first call', async () => {
      const fetcher = vi.fn(() => Promise.resolve('data'));
      const getData = useSuspense(fetcher);

      const component = Suspense({
        fallback: 'Loading...',
        children: () => {
          const data = getData();
          return `Content: ${data}`;
        },
      });

      const renderFn = component();

      // First render shows fallback
      expect(renderFn()).toBe('Loading...');

      // Wait for data to load
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second render shows content
      expect(renderFn()).toContain('Content: data');
    });

    it('should throw error on fetch failure', async () => {
      const error = new Error('Fetch failed');
      const fetcher = vi.fn(() => Promise.reject(error));
      const getData = useSuspense(fetcher);

      const component = Suspense({
        fallback: 'Loading...',
        children: () => {
          try {
            getData();
            return 'Content';
          } catch (err) {
            if (err instanceof Promise) {
              return 'Loading...';
            }
            throw err;
          }
        },
      });

      const renderFn = component();

      // Wait for error
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should throw error
      expect(() => renderFn()).toThrow(error);
    });
  });

  describe('createSuspenseResource', () => {
    it('should create reactive resource that suspends', async () => {
      const count = signal(1);
      const fetcher = vi.fn(() => Promise.resolve(`data-${count()}`));
      const getResource = createSuspenseResource(fetcher);

      const component = Suspense({
        fallback: 'Loading...',
        children: () => {
          const data = getResource();
          return `Content: ${data}`;
        },
      });

      const renderFn = component();

      // First render shows fallback
      expect(renderFn()).toBe('Loading...');

      // Wait for data to load
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second render shows content
      expect(renderFn()).toContain('Content: data-1');

      // Change dependency
      count.set(2);

      // Wait for refetch
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should have fetched new data
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCurrentSuspenseContext', () => {
    it('should return current suspense context', () => {
      let context: any = null;

      const component = Suspense({
        fallback: 'Loading...',
        children: () => {
          context = getCurrentSuspenseContext();
          return 'Content';
        },
      });

      component()();

      expect(context).toBeTruthy();
      expect(context).toHaveProperty('id');
      expect(context).toHaveProperty('state');
      expect(context).toHaveProperty('pending');
    });

    it('should return null outside suspense boundary', () => {
      const context = getCurrentSuspenseContext();
      expect(context).toBeNull();
    });
  });

  describe('nested suspense', () => {
    it('should support nested suspense boundaries', async () => {
      let resolveOuter: (value: string) => void;
      let resolveInner: (value: string) => void;

      const outerPromise = new Promise<string>((resolve) => {
        resolveOuter = resolve;
      });

      const innerPromise = new Promise<string>((resolve) => {
        resolveInner = resolve;
      });

      const innerComponent = Suspense({
        fallback: 'Loading inner...',
        children: () => {
          suspend(innerPromise);
          return 'Inner content';
        },
      });

      const outerComponent = Suspense({
        fallback: 'Loading outer...',
        children: () => {
          suspend(outerPromise);
          return innerComponent;
        },
      });

      const outerRenderFn = outerComponent();

      // Outer shows fallback
      expect(outerRenderFn()).toBe('Loading outer...');

      // Resolve outer
      resolveOuter!('outer data');
      await outerPromise;
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Now inner should show fallback
      const innerRenderFn = outerRenderFn();
      expect(innerRenderFn()).toBe('Loading inner...');

      // Resolve inner
      resolveInner!('inner data');
      await innerPromise;
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Both should be resolved
      expect(innerRenderFn()).toBe('Inner content');
    });
  });
});
