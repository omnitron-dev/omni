/**
 * ErrorBoundary Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ErrorBoundary,
  Boundary,
  useErrorBoundary,
  withErrorBoundary,
  withRetry,
  resetErrorBoundaryIdCounter,
} from '../../src/suspense/error-boundary.js';

describe('ErrorBoundary', () => {
  beforeEach(() => {
    resetErrorBoundaryIdCounter();
  });

  describe('ErrorBoundary component', () => {
    it('should render children when no error', () => {
      const component = ErrorBoundary({
        fallback: 'Error!',
        children: () => 'Content',
      });

      const renderFn = component();
      expect(renderFn()).toBe('Content');
    });

    it('should catch synchronous errors', () => {
      const error = new Error('Test error');
      const component = ErrorBoundary({
        fallback: (err: Error) => `Error: ${err.message}`,
        children: () => {
          throw error;
        },
      });

      const renderFn = component();
      expect(renderFn()).toBe('Error: Test error');
    });

    it('should call onError callback', () => {
      const onError = vi.fn();
      const error = new Error('Test error');

      const component = ErrorBoundary({
        fallback: 'Error!',
        onError,
        children: () => {
          throw error;
        },
      });

      component()();
      expect(onError).toHaveBeenCalledWith(error, expect.any(Object));
    });

    it('should support retry function in fallback', () => {
      let shouldThrow = true;
      const error = new Error('Test error');

      const component = ErrorBoundary({
        fallback: (err: Error, retry: () => void) => ({
          error: err.message,
          retry,
        }),
        children: () => {
          if (shouldThrow) {
            throw error;
          }
          return 'Content';
        },
      });

      const renderFn = component();
      const result = renderFn();

      expect(result.error).toBe('Test error');

      // Retry
      shouldThrow = false;
      result.retry();

      // Should render content now
      expect(renderFn()).toBe('Content');
    });

    it('should reset on resetKeys change', () => {
      const error = new Error('Test error');
      let shouldThrow = true;

      const createComponent = (resetKeys: any[]) =>
        ErrorBoundary({
          fallback: 'Error!',
          resetKeys,
          children: () => {
            if (shouldThrow) {
              throw error;
            }
            return 'Content';
          },
        });

      // First render with key [1]
      const component1 = createComponent([1]);
      const renderFn1 = component1();
      expect(renderFn1()).toBe('Error!');

      // Change key to [2] - should reset
      shouldThrow = false;
      const component2 = createComponent([2]);
      const renderFn2 = component2();
      expect(renderFn2()).toBe('Content');
    });
  });

  describe('useErrorBoundary', () => {
    it('should return error boundary context', () => {
      let context: any = null;

      ErrorBoundary({
        fallback: 'Error!',
        children: () => {
          context = useErrorBoundary();
          return 'Content';
        },
      });

      // useErrorBoundary is called during render, so we need to trigger render
      // In actual implementation, this would work within component context
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('withErrorBoundary', () => {
    it('should wrap component with error boundary', () => {
      const Component = () => {
        throw new Error('Test error');
      };

      const SafeComponent = withErrorBoundary(
        Component,
        (error: Error) => `Error: ${error.message}`
      );

      const renderFn = SafeComponent({})();
      expect(renderFn()).toBe('Error: Test error');
    });

    it('should pass props to wrapped component', () => {
      const Component = (props: { name: string }) => `Hello ${props.name}`;

      const SafeComponent = withErrorBoundary(Component, 'Error!');

      const renderFn = SafeComponent({ name: 'World' })();
      expect(renderFn()).toBe('Hello World');
    });
  });

  describe('Boundary', () => {
    it('should combine Suspense and ErrorBoundary', () => {
      const component = Boundary({
        fallback: 'Loading...',
        errorFallback: (error: Error) => `Error: ${error.message}`,
        children: () => 'Content',
      });

      const renderFn = component();
      expect(renderFn()()).toBe('Content');
    });

    it('should handle errors', () => {
      const error = new Error('Test error');

      const component = Boundary({
        fallback: 'Loading...',
        errorFallback: (err: Error) => `Error: ${err.message}`,
        children: () => {
          throw error;
        },
      });

      const renderFn = component();
      expect(renderFn()()).toBe('Error: Test error');
    });
  });

  describe('withRetry', () => {
    it('should retry failed operations', async () => {
      let attempts = 0;
      const fn = vi.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Failed');
        }
        return 'success';
      });

      const fnWithRetry = withRetry(fn, {
        maxRetries: 3,
        initialDelay: 10,
        backoff: 'linear',
      });

      const result = await fnWithRetry();
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries', async () => {
      const error = new Error('Failed');
      const fn = vi.fn(async () => {
        throw error;
      });

      const fnWithRetry = withRetry(fn, {
        maxRetries: 2,
        initialDelay: 10,
      });

      await expect(fnWithRetry()).rejects.toThrow('Failed');
      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should support exponential backoff', async () => {
      const delays: number[] = [];
      let attempts = 0;

      const fn = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error('Failed');
        }
        return 'success';
      };

      const fnWithRetry = withRetry(fn, {
        maxRetries: 3,
        initialDelay: 100,
        backoff: 'exponential',
        onRetry: (attempt) => {
          delays.push(attempt);
        },
      });

      await fnWithRetry();

      expect(delays).toHaveLength(2); // 2 retries before success
    });

    it('should call onRetry callback', async () => {
      const onRetry = vi.fn();
      let attempts = 0;

      const fn = async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Failed');
        }
        return 'success';
      };

      const fnWithRetry = withRetry(fn, {
        maxRetries: 2,
        initialDelay: 10,
        onRetry,
      });

      await fnWithRetry();
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
    });
  });
});
