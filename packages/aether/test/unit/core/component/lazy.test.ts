/**
 * Lazy Component Loading Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { lazy, preloadComponent } from '../../../../src/core/component/lazy.js';
import { defineComponent } from '../../../../src/core/component/define.js';
import { signal } from '../../../../src/core/reactivity/signal.js';

describe('lazy', () => {
  describe('Basic functionality', () => {
    it('should create a lazy component', () => {
      const LazyComponent = lazy(() =>
        Promise.resolve({
          default: defineComponent(() => () => 'Hello'),
        })
      );

      expect(typeof LazyComponent).toBe('function');
    });

    it('should have displayName set to "Lazy"', () => {
      const LazyComponent = lazy(() =>
        Promise.resolve({
          default: defineComponent(() => () => 'Hello'),
        })
      );

      expect(LazyComponent.displayName).toBe('Lazy');
    });

    it('should throw promise on first render (for Suspense)', async () => {
      let resolveLoader: any;
      const loaderPromise = new Promise<{ default: any }>((resolve) => {
        resolveLoader = resolve;
      });

      const LazyComponent = lazy(() => loaderPromise);

      // First call should throw promise
      expect(() => LazyComponent({})).toThrow();

      // Resolve the loader
      resolveLoader({
        default: defineComponent(() => () => 'Loaded'),
      });

      // Wait for promise to resolve
      await loaderPromise;

      // Second call should return component result
      const result = LazyComponent({});
      expect(result).toBe('Loaded');
    });

    it('should cache loaded component', async () => {
      const loaderSpy = vi.fn(() =>
        Promise.resolve({
          default: defineComponent(() => () => 'Component'),
        })
      );

      const LazyComponent = lazy(loaderSpy);

      try {
        LazyComponent({});
      } catch (promise) {
        await promise;
      }

      // First render after loading
      const result1 = LazyComponent({});

      // Second render - loader should NOT be called again
      const result2 = LazyComponent({});

      expect(loaderSpy).toHaveBeenCalledTimes(1);
      expect(result1).toBe('Component');
      expect(result2).toBe('Component');
    });

    it('should pass props to loaded component', async () => {
      interface TestProps {
        name: string;
      }

      const TestComponent = defineComponent<TestProps>((props) => () => `Hello ${props.name}`);

      const LazyComponent = lazy<TestProps>(() => Promise.resolve({ default: TestComponent }));

      try {
        LazyComponent({ name: 'Alice' });
      } catch (promise) {
        await promise;
      }

      const result = LazyComponent({ name: 'Alice' });

      expect(result).toBe('Hello Alice');
    });
  });

  describe('Error handling', () => {
    it('should throw error when loader fails', async () => {
      const error = new Error('Load failed');
      const LazyComponent = lazy(() => Promise.reject(error));

      // First call throws promise
      try {
        LazyComponent({});
      } catch (promise) {
        // Wait for promise to reject
        await expect(promise).rejects.toThrow('Load failed');
      }

      // Second call should throw the error
      expect(() => LazyComponent({})).toThrow('Load failed');
    });

    it('should persistently throw error after load failure', async () => {
      const error = new Error('Failed');
      const loader = vi.fn(() => Promise.reject(error));

      const LazyComponent = lazy(loader);

      // First attempt - should fail
      try {
        LazyComponent({});
      } catch (promise) {
        await expect(promise).rejects.toThrow('Failed');
      }

      // Second call should throw the same error
      expect(() => LazyComponent({})).toThrow('Failed');

      // Third call should still throw the error (no auto-retry)
      expect(() => LazyComponent({})).toThrow('Failed');

      // Loader should only be called once (no automatic retry)
      expect(loader).toHaveBeenCalledTimes(1);

      // Note: Retry should be handled at a higher level (e.g., ErrorBoundary with reset button)
    });
  });

  describe('Integration with Suspense', () => {
    it('should work with Suspense boundary', async () => {
      // This is a conceptual test - actual Suspense integration
      // would be tested in integration tests with real DOM
      const LazyComponent = lazy(() =>
        Promise.resolve({
          default: defineComponent(() => () => 'Loaded Content'),
        })
      );

      let thrownPromise: any;

      try {
        LazyComponent({});
      } catch (promise) {
        thrownPromise = promise;
      }

      expect(thrownPromise).toBeInstanceOf(Promise);

      await thrownPromise;

      const result = LazyComponent({});

      expect(result).toBe('Loaded Content');
    });
  });

  describe('Dynamic imports', () => {
    it('should work with dynamic import syntax', async () => {
      // Simulate dynamic import
      const LazyComponent = lazy(() =>
        Promise.resolve({
          default: defineComponent(() => () => 'Dynamic Import'),
        })
      );

      try {
        LazyComponent({});
      } catch (promise) {
        await promise;
      }

      const result = LazyComponent({});

      expect(result).toBe('Dynamic Import');
    });
  });
});

describe('preloadComponent', () => {
  it('should preload a lazy component', async () => {
    const loaderSpy = vi.fn(() =>
      Promise.resolve({
        default: defineComponent(() => () => 'Preloaded'),
      })
    );

    const LazyComponent = lazy(loaderSpy);

    // Preload the component
    await preloadComponent(LazyComponent);

    // Component should be loaded, so calling it won't throw
    const result = LazyComponent({});

    expect(result).toBe('Preloaded');
    expect(loaderSpy).toHaveBeenCalledTimes(1);
  });

  it('should return immediately if component is already loaded', async () => {
    const LazyComponent = lazy(() =>
      Promise.resolve({
        default: defineComponent(() => () => 'Already Loaded'),
      })
    );

    // Load the component first
    try {
      LazyComponent({});
    } catch (promise) {
      await promise;
    }

    // Preload should return immediately
    await preloadComponent(LazyComponent);

    // Should work fine
    const result = LazyComponent({});

    expect(result).toBe('Already Loaded');
  });

  it('should handle preload errors gracefully', async () => {
    const error = new Error('Preload failed');
    const LazyComponent = lazy(() => Promise.reject(error));

    // Preload should handle the error
    await expect(preloadComponent(LazyComponent)).rejects.toThrow('Preload failed');
  });

  it('should be useful for route preloading', async () => {
    const loaderSpy = vi.fn(() =>
      Promise.resolve({
        default: defineComponent(() => () => 'Route Component'),
      })
    );

    const RouteComponent = lazy(loaderSpy);

    // Simulate onBeforeEnter hook
    const onBeforeEnter = async () => {
      await preloadComponent(RouteComponent);
    };

    // Preload on route enter
    await onBeforeEnter();

    // Component should be ready
    const result = RouteComponent({});

    expect(result).toBe('Route Component');
    expect(loaderSpy).toHaveBeenCalledTimes(1);
  });

  it('should be useful for hover preloading', async () => {
    const loaderSpy = vi.fn(() =>
      Promise.resolve({
        default: defineComponent(() => () => 'Hover Component'),
      })
    );

    const HoverComponent = lazy(loaderSpy);

    // Simulate onMouseEnter
    const onMouseEnter = () => {
      // Don't await - just start preloading
      void preloadComponent(HoverComponent);
    };

    onMouseEnter();

    // Wait a bit for preload to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Component should be loaded
    const result = HoverComponent({});

    expect(result).toBe('Hover Component');
  });
});

describe('Lazy component with state', () => {
  it('should preserve state across renders', async () => {
    const Counter = defineComponent(() => {
      const count = signal(0);

      return () => count();
    });

    const LazyCounter = lazy(() => Promise.resolve({ default: Counter }));

    try {
      LazyCounter({});
    } catch (promise) {
      await promise;
    }

    // First render
    const result1 = LazyCounter({});
    expect(result1).toBe(0);

    // Note: In real implementation, state would be managed by the component instance
    // This test shows that the component function is cached
  });
});

describe('Edge cases', () => {
  it('should handle loader returning module without default export', async () => {
    const LazyComponent = lazy(() => Promise.resolve({} as any));

    try {
      LazyComponent({});
    } catch (promise) {
      await promise;
    }

    // Should not crash, but calling undefined
    expect(() => LazyComponent({})).toThrow();
  });

  it('should handle very slow loaders', async () => {
    const slowLoader = () =>
      new Promise<{ default: any }>((resolve) => {
        setTimeout(() => {
          resolve({
            default: defineComponent(() => () => 'Slow Component'),
          });
        }, 100);
      });

    const LazyComponent = lazy(slowLoader);

    let thrownPromise: any;

    try {
      LazyComponent({});
    } catch (promise) {
      thrownPromise = promise;
    }

    expect(thrownPromise).toBeInstanceOf(Promise);

    await thrownPromise;

    const result = LazyComponent({});

    expect(result).toBe('Slow Component');
  });

  it('should handle multiple simultaneous calls during loading', async () => {
    let resolveLoader: any;
    const loaderPromise = new Promise<{ default: any }>((resolve) => {
      resolveLoader = resolve;
    });

    const loaderSpy = vi.fn(() => loaderPromise);
    const LazyComponent = lazy(loaderSpy);

    // Call component multiple times before it loads
    const calls = [() => LazyComponent({}), () => LazyComponent({}), () => LazyComponent({})];

    const promises: any[] = [];

    calls.forEach((call) => {
      try {
        call();
      } catch (promise) {
        promises.push(promise);
      }
    });

    // All should throw the same promise
    expect(promises.length).toBe(3);
    expect(promises[0]).toBe(promises[1]);
    expect(promises[1]).toBe(promises[2]);

    // Loader should only be called once
    expect(loaderSpy).toHaveBeenCalledTimes(1);

    // Resolve the loader
    resolveLoader({
      default: defineComponent(() => () => 'Multi-call Component'),
    });

    await loaderPromise;

    // All calls should now work
    expect(LazyComponent({})).toBe('Multi-call Component');
  });
});
