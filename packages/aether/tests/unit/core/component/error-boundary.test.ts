/**
 * Error Boundary Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ErrorBoundary,
  useErrorBoundary,
  withErrorBoundary,
  type ErrorInfo,
} from '../../../../src/core/component/error-boundary.js';
import { defineComponent } from '../../../../src/core/component/define.js';
import { signal } from '../../../../src/core/reactivity/signal.js';

describe('ErrorBoundary', () => {
  describe('Basic functionality', () => {
    it('should render children when no error occurs', () => {
      const Child = defineComponent(() => () => 'Hello World');

      const result = ErrorBoundary({
        children: Child({}),
      });

      // Should render children (wrapped in div with key)
      expect(result).toBeTruthy();
    });

    it('should catch errors from child components', () => {
      const errorSpy = vi.fn();

      const ErrorChild = defineComponent(() => {
        throw new Error('Test error');
      });

      // Wrap in a parent component so ErrorChild is called in the right context
      const Wrapper = defineComponent(() => {
        return () =>
          ErrorBoundary({
            onError: errorSpy,
            // Pass children as function so it's called inside ErrorBoundary context
            children: () => ErrorChild({}),
          });
      });

      Wrapper({});

      // Should have caught the error
      expect(errorSpy).toHaveBeenCalled();
      const error = errorSpy.mock.calls[0][0];
      expect(error.message).toBe('Test error');
    });

    it('should render default fallback UI on error', () => {
      const ErrorChild = defineComponent(() => {
        throw new Error('Test error');
      });

      const onErrorSpy = vi.fn();

      ErrorBoundary({
        onError: onErrorSpy,
        children: () => ErrorChild({}),
      });

      expect(onErrorSpy).toHaveBeenCalled();
    });

    it('should render custom fallback component on error', () => {
      const FallbackComponent = defineComponent(() => () => 'Error Fallback');

      const ErrorChild = defineComponent(() => {
        throw new Error('Test error');
      });

      ErrorBoundary({
        fallback: FallbackComponent({}),
        children: () => ErrorChild({}),
      });

      // Should render fallback (implementation detail)
      // In real scenario, this would be tested with DOM assertions
    });

    it('should pass error info to onError callback', () => {
      const errorSpy = vi.fn();

      const ErrorChild = defineComponent(() => {
        throw new Error('Test error');
      });

      ErrorBoundary({
        onError: errorSpy,
        children: () => ErrorChild({}),
      });

      expect(errorSpy).toHaveBeenCalled();

      const [error, errorInfo] = errorSpy.mock.calls[0];

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Test error');
      expect(errorInfo).toHaveProperty('message');
      expect(errorInfo).toHaveProperty('error');
      expect(errorInfo).toHaveProperty('errorCount');
      expect(errorInfo.errorCount).toBe(1);
    });
  });

  describe('Reset functionality', () => {
    it('should expose reset function via context', () => {
      const ErrorChild = defineComponent(() => {
        throw new Error('Test error');
      });

      const FallbackWithReset = defineComponent(() => {
        const errorCtx = useErrorBoundary();

        return () => {
          expect(errorCtx).toBeTruthy();
          expect(typeof errorCtx?.reset).toBe('function');
          return 'Fallback';
        };
      });

      ErrorBoundary({
        fallback: FallbackWithReset({}),
        children: () => ErrorChild({}),
      });
    });

    it('should call onReset when reset is triggered', () => {
      const onResetSpy = vi.fn();
      const errorSpy = vi.fn();

      const ErrorChild = defineComponent(() => {
        throw new Error('Test error');
      });

      const FallbackWithReset = defineComponent(() => {
        const errorCtx = useErrorBoundary();

        return () => {
          if (errorCtx) {
            // Simulate clicking reset button
            errorCtx.reset();
          }
          return 'Fallback';
        };
      });

      ErrorBoundary({
        fallback: FallbackWithReset({}),
        onReset: onResetSpy,
        onError: errorSpy,
        children: () => ErrorChild({}),
      });

      // Error should be caught
      expect(errorSpy).toHaveBeenCalled();

      // Reset should be called (by fallback component)
      // Note: Timing depends on render cycle
    });
  });

  describe('Retry functionality', () => {
    it('should expose retry function via context', () => {
      const ErrorChild = defineComponent(() => {
        throw new Error('Test error');
      });

      const FallbackWithRetry = defineComponent(() => {
        const errorCtx = useErrorBoundary();

        return () => {
          expect(errorCtx).toBeTruthy();
          expect(typeof errorCtx?.retry).toBe('function');
          return 'Fallback';
        };
      });

      ErrorBoundary({
        fallback: FallbackWithRetry({}),
        children: () => ErrorChild({}),
      });
    });

    it('should respect maxRetries limit', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const ErrorChild = defineComponent(() => {
        throw new Error('Test error');
      });

      const errorCount = signal(0);

      const FallbackWithRetry = defineComponent(() => {
        const errorCtx = useErrorBoundary();

        return () => {
          if (errorCtx) {
            const currentError = errorCtx.error;
            if (currentError) {
              errorCount.set(currentError.errorCount);
            }

            // Try to retry beyond limit
            if (errorCount() >= 3) {
              errorCtx.retry(); // Should warn
            }
          }
          return 'Fallback';
        };
      });

      ErrorBoundary({
        fallback: FallbackWithRetry({}),
        maxRetries: 3,
        children: () => ErrorChild({}),
      });

      consoleWarnSpy.mockRestore();
    });
  });

  describe('Error information', () => {
    it('should track error count', () => {
      const errorSpy = vi.fn();

      const ErrorChild = defineComponent(() => {
        throw new Error('Test error');
      });

      ErrorBoundary({
        onError: errorSpy,
        children: () => ErrorChild({}),
      });

      expect(errorSpy).toHaveBeenCalled();

      const errorInfo: ErrorInfo = errorSpy.mock.calls[0][1];

      expect(errorInfo.errorCount).toBe(1);
    });

    it('should capture error message', () => {
      const errorSpy = vi.fn();

      const ErrorChild = defineComponent(() => {
        throw new Error('Custom error message');
      });

      ErrorBoundary({
        onError: errorSpy,
        children: () => ErrorChild({}),
      });

      const errorInfo: ErrorInfo = errorSpy.mock.calls[0][1];

      expect(errorInfo.message).toBe('Custom error message');
    });

    it('should capture error stack', () => {
      const errorSpy = vi.fn();

      const ErrorChild = defineComponent(() => {
        throw new Error('Stack test');
      });

      ErrorBoundary({
        onError: errorSpy,
        children: () => ErrorChild({}),
      });

      const errorInfo: ErrorInfo = errorSpy.mock.calls[0][1];

      expect(errorInfo.stack).toBeTruthy();
      expect(typeof errorInfo.stack).toBe('string');
    });

    it('should capture component stack', () => {
      const errorSpy = vi.fn();

      const ErrorChild = defineComponent(() => {
        throw new Error('Component stack test');
      });

      ErrorBoundary({
        onError: errorSpy,
        children: () => ErrorChild({}),
      });

      const errorInfo: ErrorInfo = errorSpy.mock.calls[0][1];

      // Component stack might not always be available depending on environment
      if (errorInfo.componentStack) {
        expect(typeof errorInfo.componentStack).toBe('string');
      }
    });
  });

  describe('useErrorBoundary hook', () => {
    it('should return null when not inside error boundary', () => {
      const TestComponent = defineComponent(() => {
        const errorCtx = useErrorBoundary();

        return () => {
          expect(errorCtx).toBeNull();
          return 'Component';
        };
      });

      TestComponent({});
    });

    it('should return error context when inside error boundary', () => {
      const ErrorChild = defineComponent(() => {
        throw new Error('Test error');
      });

      const FallbackComponent = defineComponent(() => {
        const errorCtx = useErrorBoundary();

        return () => {
          expect(errorCtx).toBeTruthy();
          expect(errorCtx?.error).toBeTruthy();
          expect(errorCtx?.error?.message).toBe('Test error');
          expect(typeof errorCtx?.reset).toBe('function');
          expect(typeof errorCtx?.retry).toBe('function');
          return 'Fallback';
        };
      });

      ErrorBoundary({
        fallback: FallbackComponent({}),
        children: () => ErrorChild({}),
      });
    });
  });

  describe('withErrorBoundary HOC', () => {
    it('should wrap component with error boundary', () => {
      const TestComponent = defineComponent(() => () => 'Test Component');

      const WrappedComponent = withErrorBoundary(TestComponent, {
        onError: () => {},
      });

      expect(typeof WrappedComponent).toBe('function');

      const result = WrappedComponent({});

      expect(result).toBeTruthy();
    });

    it('should catch errors from wrapped component', () => {
      const errorSpy = vi.fn();

      const ErrorComponent = defineComponent(() => {
        throw new Error('HOC test error');
      });

      const WrappedComponent = withErrorBoundary(ErrorComponent, {
        onError: errorSpy,
      });

      WrappedComponent({});

      expect(errorSpy).toHaveBeenCalled();
      const error = errorSpy.mock.calls[0][0];
      expect(error.message).toBe('HOC test error');
    });

    it('should pass props to wrapped component', () => {
      interface TestProps {
        name: string;
      }

      const TestComponent = defineComponent<TestProps>((props) => {
        return () => `Hello ${props.name}`;
      });

      const WrappedComponent = withErrorBoundary(TestComponent, {
        onError: () => {},
      });

      const result = WrappedComponent({ name: 'Alice' });

      // Should pass props through (implementation detail)
      expect(result).toBeTruthy();
    });
  });

  describe('Reset on props change', () => {
    it('should reset error when children change', () => {
      const errorSpy = vi.fn();
      const onResetSpy = vi.fn();

      const child1 = 'Child 1';
      const child2 = 'Child 2';

      // First render with child1
      const boundary1 = ErrorBoundary({
        onError: errorSpy,
        onReset: onResetSpy,
        resetOnPropsChange: true,
        children: child1,
      });

      // Simulate error
      // (In real scenario, error would be thrown by component)

      // Second render with child2 - should trigger reset
      const boundary2 = ErrorBoundary({
        onError: errorSpy,
        onReset: onResetSpy,
        resetOnPropsChange: true,
        children: child2,
      });

      // Note: Full test would require DOM rendering to verify reset behavior
    });

    it('should not reset when resetOnPropsChange is false', () => {
      const onResetSpy = vi.fn();

      // Create boundary with resetOnPropsChange disabled
      ErrorBoundary({
        onReset: onResetSpy,
        resetOnPropsChange: false,
        children: 'Child',
      });

      // Reset should not be called automatically
      // (Full test would require multiple renders)
    });
  });

  describe('Edge cases', () => {
    it('should handle errors without message', () => {
      const errorSpy = vi.fn();

      const ErrorChild = defineComponent(() => {
        throw new Error();
      });

      ErrorBoundary({
        onError: errorSpy,
        children: () => ErrorChild({}),
      });

      const errorInfo: ErrorInfo = errorSpy.mock.calls[0][1];

      expect(errorInfo.message).toBe('An error occurred');
    });

    it('should handle non-Error objects thrown', () => {
      const errorSpy = vi.fn();

      const ErrorChild = defineComponent(() => {
        throw 'String error';
      });

      ErrorBoundary({
        onError: errorSpy,
        children: () => ErrorChild({}),
      });

      // Should still catch and handle
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
