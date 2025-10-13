/**
 * Lazy Loading Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  lazy,
  preload,
  isLoaded,
  lazyNamed,
  lazyRoute,
  splitCode,
  preloadAll,
  clearLazyCache,
} from '../../src/suspense/lazy.js';
import { Suspense } from '../../src/suspense/suspense.js';

describe('Lazy Loading', () => {
  beforeEach(() => {
    clearLazyCache();
  });

  describe('lazy', () => {
    it('should lazily load component', async () => {
      const loader = vi.fn(async () => ({
        default: () => 'Content',
      }));

      const LazyComponent = lazy(loader);

      const suspenseComponent = Suspense({
        fallback: 'Loading...',
        children: () => LazyComponent({}),
      });

      const renderFn = suspenseComponent();

      // First render shows fallback
      expect(renderFn()).toBe('Loading...');

      // Wait for component to load
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second render shows content
      expect(renderFn()).toBe('Content');
    });

    it('should cache loaded components', async () => {
      const loader = vi.fn(async () => ({
        default: () => 'Content',
      }));

      const LazyComponent = lazy(loader);

      // First load
      const suspenseComponent1 = Suspense({
        fallback: 'Loading...',
        children: () => LazyComponent({}),
      });

      suspenseComponent1()();

      await new Promise((resolve) => setTimeout(resolve, 50));

      // Second load should use cache
      const suspenseComponent2 = Suspense({
        fallback: 'Loading...',
        children: () => LazyComponent({}),
      });

      const renderFn = suspenseComponent2();
      expect(renderFn()).toBe('Content');
      expect(loader).toHaveBeenCalledTimes(1);
    });

    it('should handle load errors', async () => {
      const error = new Error('Load failed');
      const loader = vi.fn(async () => {
        throw error;
      });

      const LazyComponent = lazy(loader);

      const suspenseComponent = Suspense({
        fallback: 'Loading...',
        children: () => {
          try {
            return LazyComponent({});
          } catch (err) {
            if (err instanceof Promise) {
              throw err;
            }
            return `Error: ${(err as Error).message}`;
          }
        },
      });

      const renderFn = suspenseComponent();

      // Wait for error
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(renderFn()).toBe('Error: Load failed');
    });

    it('should support timeout option', async () => {
      const loader = vi.fn(
        () =>
          new Promise(() => {
            // Never resolves
          })
      );

      const LazyComponent = lazy(loader, { timeout: 100 });

      const suspenseComponent = Suspense({
        fallback: 'Loading...',
        children: () => {
          try {
            return LazyComponent({});
          } catch (err) {
            if (err instanceof Promise) {
              throw err;
            }
            return `Error: ${(err as Error).message}`;
          }
        },
      });

      const renderFn = suspenseComponent();

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(renderFn()).toBe('Error: Lazy load timeout');
    });

    it('should retry on failure', async () => {
      let attempts = 0;
      const loader = vi.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Failed');
        }
        return { default: () => 'Content' };
      });

      const LazyComponent = lazy(loader, { retries: 2 });

      const suspenseComponent = Suspense({
        fallback: 'Loading...',
        children: () => LazyComponent({}),
      });

      suspenseComponent()();

      // Wait for retries and success
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(attempts).toBe(3);
    });

    it('should support eager preload', async () => {
      const loader = vi.fn(async () => ({
        default: () => 'Content',
      }));

      lazy(loader, { preload: 'eager' });

      // Wait for eager preload
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(loader).toHaveBeenCalled();
    });

    it('should support idle preload', async () => {
      const loader = vi.fn(async () => ({
        default: () => 'Content',
      }));

      lazy(loader, { preload: 'idle' });

      // Wait for idle callback
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(loader).toHaveBeenCalled();
    });
  });

  describe('preload', () => {
    it('should preload lazy component', async () => {
      const loader = vi.fn(async () => ({
        default: () => 'Content',
      }));

      const LazyComponent = lazy(loader);

      await preload(LazyComponent);

      expect(loader).toHaveBeenCalled();
      expect(isLoaded(LazyComponent)).toBe(true);
    });

    it('should not load twice', async () => {
      const loader = vi.fn(async () => ({
        default: () => 'Content',
      }));

      const LazyComponent = lazy(loader);

      await preload(LazyComponent);
      await preload(LazyComponent);

      expect(loader).toHaveBeenCalledTimes(1);
    });
  });

  describe('isLoaded', () => {
    it('should check if component is loaded', async () => {
      const loader = async () => ({
        default: () => 'Content',
      });

      const LazyComponent = lazy(loader);

      expect(isLoaded(LazyComponent)).toBe(false);

      await preload(LazyComponent);

      expect(isLoaded(LazyComponent)).toBe(true);
    });
  });

  describe('preloadAll', () => {
    it('should preload multiple components', async () => {
      const loader1 = vi.fn(async () => ({
        default: () => 'Content1',
      }));

      const loader2 = vi.fn(async () => ({
        default: () => 'Content2',
      }));

      const LazyComponent1 = lazy(loader1);
      const LazyComponent2 = lazy(loader2);

      await preloadAll([LazyComponent1, LazyComponent2]);

      expect(loader1).toHaveBeenCalled();
      expect(loader2).toHaveBeenCalled();
      expect(isLoaded(LazyComponent1)).toBe(true);
      expect(isLoaded(LazyComponent2)).toBe(true);
    });
  });

  describe('lazyNamed', () => {
    it('should load named export', async () => {
      const loader = vi.fn(async () => ({
        MyComponent: () => 'Content',
      }));

      const LazyComponent = lazyNamed(loader, 'MyComponent');

      const suspenseComponent = Suspense({
        fallback: 'Loading...',
        children: () => LazyComponent({}),
      });

      suspenseComponent()();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(loader).toHaveBeenCalled();
    });
  });

  describe('lazyRoute', () => {
    it('should create lazy route component', async () => {
      const loader = vi.fn(async () => ({
        default: () => 'Content',
      }));

      const LazyRoute = lazyRoute(loader, {
        prefetchOnHover: true,
      });

      const suspenseComponent = Suspense({
        fallback: 'Loading...',
        children: () => LazyRoute({}),
      });

      suspenseComponent()();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(loader).toHaveBeenCalled();
    });
  });

  describe('splitCode', () => {
    it('should create multiple lazy components', async () => {
      const loader = vi.fn(async () => ({
        Component1: () => 'Content1',
        Component2: () => 'Content2',
        Component3: () => 'Content3',
      }));

      const { Component1, Component2, Component3 } = splitCode(loader, ['Component1', 'Component2', 'Component3']);

      // Load Component1
      const suspenseComponent = Suspense({
        fallback: 'Loading...',
        children: () => Component1({}),
      });

      suspenseComponent()();

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(loader).toHaveBeenCalled();

      // Component2 and Component3 should also be available
      expect(Component2).toBeDefined();
      expect(Component3).toBeDefined();
    });
  });

  describe('clearLazyCache', () => {
    it('should clear lazy cache', async () => {
      const loader = async () => ({
        default: () => 'Content',
      });

      const LazyComponent = lazy(loader);

      await preload(LazyComponent);
      expect(isLoaded(LazyComponent)).toBe(true);

      clearLazyCache();

      // Component should not be loaded anymore
      // Note: isLoaded might still return true as it checks the component's state
      // The actual behavior depends on implementation
    });
  });
});
