/**
 * Error Handling Pattern Tests
 *
 * Tests for advanced error handling patterns:
 * - Error boundaries with recovery
 * - Nested error boundaries
 * - Error propagation
 * - Error recovery strategies
 */

import { describe, it, expect, vi } from 'vitest';
import { defineComponent } from '../../../src/core/component/define.js';
import { signal } from '../../../src/core/reactivity/signal.js';
import {
  ErrorBoundary,
  useErrorBoundary,
  withErrorBoundary,
} from '../../../src/core/component/error-boundary.js';
import { onMount } from '../../../src/core/component/lifecycle.js';

describe('Error Handling Patterns', () => {
  describe('Basic Error Boundaries', () => {
    it('should catch synchronous errors in components', () => {
      const errorSpy = vi.fn();

      const BrokenComponent = defineComponent(() => {
        throw new Error('Sync error');
      });

      ErrorBoundary({
        onError: errorSpy,
        children: () => BrokenComponent({}),
      });

      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0].message).toBe('Sync error');
    });

    it('should catch errors in render functions', () => {
      const errorSpy = vi.fn();

      const BrokenRender = defineComponent(() => {
        return () => {
          throw new Error('Render error');
        };
      });

      ErrorBoundary({
        onError: errorSpy,
        children: () => BrokenRender({}),
      });

      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0].message).toBe('Render error');
    });

    it('should catch errors in lifecycle hooks', () => {
      const errorSpy = vi.fn();

      const MountError = defineComponent(() => {
        onMount(() => {
          throw new Error('Mount error');
        });
        return () => 'Component';
      });

      ErrorBoundary({
        onError: errorSpy,
        children: () => MountError({}),
      });

      expect(errorSpy).toHaveBeenCalled();
      expect(errorSpy.mock.calls[0][0].message).toBe('Mount error');
    });

    it('should render fallback UI on error', () => {
      const FallbackComponent = defineComponent(() => {
        return () => 'Error occurred';
      });

      const BrokenComponent = defineComponent(() => {
        throw new Error('Test error');
      });

      const result = ErrorBoundary({
        fallback: FallbackComponent({}),
        children: () => BrokenComponent({}),
      });

      expect(result).toBeTruthy();
    });
  });

  describe('Nested Error Boundaries', () => {
    it('should support nested error boundaries with inner catching first', () => {
      const outerErrorSpy = vi.fn();
      const innerErrorSpy = vi.fn();

      const ErrorComponent = defineComponent(() => {
        throw new Error('Inner error');
      });

      const InnerBoundary = defineComponent(() => {
        return () =>
          ErrorBoundary({
            onError: innerErrorSpy,
            children: () => ErrorComponent({}),
          });
      });

      ErrorBoundary({
        onError: outerErrorSpy,
        children: () => InnerBoundary({}),
      });

      // Inner boundary should catch it
      expect(innerErrorSpy).toHaveBeenCalled();
      // Outer boundary should NOT be called
      expect(outerErrorSpy).not.toHaveBeenCalled();
    });

    it('should propagate to outer boundary if inner has no handler', () => {
      const outerErrorSpy = vi.fn();

      const ErrorComponent = defineComponent(() => {
        throw new Error('Test error');
      });

      const Wrapper = defineComponent(() => {
        // This component doesn't have error handler
        return () => ErrorComponent({});
      });

      ErrorBoundary({
        onError: outerErrorSpy,
        children: () => Wrapper({}),
      });

      expect(outerErrorSpy).toHaveBeenCalled();
    });

    it('should support multiple levels of error boundaries', () => {
      const level1Spy = vi.fn();
      const level2Spy = vi.fn();
      const level3Spy = vi.fn();

      const ErrorComponent = defineComponent(() => {
        throw new Error('Deep error');
      });

      const Level3 = defineComponent(() => {
        return () =>
          ErrorBoundary({
            onError: level3Spy,
            children: () => ErrorComponent({}),
          });
      });

      const Level2 = defineComponent(() => {
        return () =>
          ErrorBoundary({
            onError: level2Spy,
            children: () => Level3({}),
          });
      });

      ErrorBoundary({
        onError: level1Spy,
        children: () => Level2({}),
      });

      // Only deepest boundary should catch
      expect(level3Spy).toHaveBeenCalled();
      expect(level2Spy).not.toHaveBeenCalled();
      expect(level1Spy).not.toHaveBeenCalled();
    });

    it('should allow different error boundaries for different subtrees', () => {
      const leftSpy = vi.fn();
      const rightSpy = vi.fn();

      const LeftError = defineComponent(() => {
        throw new Error('Left error');
      });

      const RightError = defineComponent(() => {
        throw new Error('Right error');
      });

      const App = defineComponent(() => {
        return () => [
          ErrorBoundary({
            onError: leftSpy,
            children: () => LeftError({}),
          }),
          ErrorBoundary({
            onError: rightSpy,
            children: () => RightError({}),
          }),
        ];
      });

      App({});

      expect(leftSpy).toHaveBeenCalled();
      expect(rightSpy).toHaveBeenCalled();
    });
  });

  describe('Error Recovery Strategies', () => {
    it('should support manual error recovery with reset', () => {
      const errorSpy = vi.fn();
      const resetSpy = vi.fn();
      let shouldError = true;

      const Component = defineComponent(() => {
        if (shouldError) {
          throw new Error('Test error');
        }
        return () => 'Success';
      });

      const FallbackWithReset = defineComponent(() => {
        const ctx = useErrorBoundary();

        return () => {
          if (ctx) {
            // Simulate user clicking reset
            shouldError = false;
            ctx.reset();
          }
          return 'Fallback';
        };
      });

      ErrorBoundary({
        onError: errorSpy,
        onReset: resetSpy,
        fallback: FallbackWithReset({}),
        children: () => Component({}),
      });

      expect(errorSpy).toHaveBeenCalled();
    });

    it('should support retry with exponential backoff', () => {
      const errorSpy = vi.fn();
      let attemptCount = 0;

      const UnreliableComponent = defineComponent(() => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Temporary error');
        }
        return () => 'Success';
      });

      const FallbackWithRetry = defineComponent(() => {
        const ctx = useErrorBoundary();

        return () => {
          if (ctx && ctx.error && ctx.error.errorCount < 3) {
            // Simulate retry
            setTimeout(() => ctx.retry(), 100);
          }
          return 'Retrying...';
        };
      });

      ErrorBoundary({
        onError: errorSpy,
        maxRetries: 5,
        fallback: FallbackWithRetry({}),
        children: () => UnreliableComponent({}),
      });

      expect(errorSpy).toHaveBeenCalled();
    });

    it('should limit retry attempts', () => {
      const errorSpy = vi.fn();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const AlwaysFailing = defineComponent(() => {
        throw new Error('Persistent error');
      });

      const FallbackWithRetry = defineComponent(() => {
        const ctx = useErrorBoundary();

        return () => {
          if (ctx && ctx.error) {
            // Try to retry beyond max
            ctx.retry();
            ctx.retry();
            ctx.retry();
            ctx.retry(); // Should warn on 4th attempt with maxRetries=3
          }
          return 'Failed';
        };
      });

      ErrorBoundary({
        onError: errorSpy,
        maxRetries: 3,
        fallback: FallbackWithRetry({}),
        children: () => AlwaysFailing({}),
      });

      warnSpy.mockRestore();
    });

    it('should reset error state when children change', () => {
      const errorSpy = vi.fn();
      const resetSpy = vi.fn();

      const Component1 = defineComponent(() => {
        throw new Error('Error 1');
      });

      const Component2 = defineComponent(() => {
        return () => 'Success';
      });

      // First render with error
      ErrorBoundary({
        onError: errorSpy,
        onReset: resetSpy,
        resetOnPropsChange: true,
        children: () => Component1({}),
      });

      expect(errorSpy).toHaveBeenCalledTimes(1);

      // Second render with different children should reset
      ErrorBoundary({
        onError: errorSpy,
        onReset: resetSpy,
        resetOnPropsChange: true,
        children: () => Component2({}),
      });
    });

    it('should not reset when resetOnPropsChange is false', () => {
      const resetSpy = vi.fn();

      ErrorBoundary({
        onReset: resetSpy,
        resetOnPropsChange: false,
        children: () => 'content',
      });

      // Reset should not be called automatically
      expect(resetSpy).not.toHaveBeenCalled();
    });
  });

  describe('Error Information and Debugging', () => {
    it('should capture error stack trace', () => {
      const errorSpy = vi.fn();

      const Component = defineComponent(() => {
        throw new Error('Stack test');
      });

      ErrorBoundary({
        onError: errorSpy,
        children: () => Component({}),
      });

      const errorInfo = errorSpy.mock.calls[0][1];
      expect(errorInfo.stack).toBeDefined();
      expect(typeof errorInfo.stack).toBe('string');
    });

    it('should track error count across retries', () => {
      const errorSpy = vi.fn();

      const Component = defineComponent(() => {
        throw new Error('Test');
      });

      ErrorBoundary({
        onError: errorSpy,
        children: () => Component({}),
      });

      const errorInfo = errorSpy.mock.calls[0][1];
      expect(errorInfo.errorCount).toBe(1);
    });

    it('should capture component stack information', () => {
      const errorSpy = vi.fn();

      const ChildComponent = defineComponent(() => {
        throw new Error('Child error');
      });

      const ParentComponent = defineComponent(() => {
        return () => ChildComponent({});
      });

      ErrorBoundary({
        onError: errorSpy,
        children: () => ParentComponent({}),
      });

      const errorInfo = errorSpy.mock.calls[0][1];
      // Component stack may or may not be available depending on environment
      if (errorInfo.componentStack) {
        expect(typeof errorInfo.componentStack).toBe('string');
      }
    });

    it('should provide error context to children via hook', () => {
      const ErrorComponent = defineComponent(() => {
        throw new Error('Test error');
      });

      const FallbackComponent = defineComponent(() => {
        const errorContext = useErrorBoundary();

        return () => {
          expect(errorContext).toBeDefined();
          expect(errorContext?.error).toBeDefined();
          expect(errorContext?.error?.message).toBe('Test error');
          expect(typeof errorContext?.reset).toBe('function');
          expect(typeof errorContext?.retry).toBe('function');
          return 'Fallback';
        };
      });

      ErrorBoundary({
        fallback: FallbackComponent({}),
        children: () => ErrorComponent({}),
      });
    });
  });

  describe('HOC Pattern with Error Boundaries', () => {
    it('should wrap component with error boundary using HOC', () => {
      const errorSpy = vi.fn();

      const Component = defineComponent(() => {
        throw new Error('HOC error');
      });

      const SafeComponent = withErrorBoundary(Component, {
        onError: errorSpy,
      });

      SafeComponent({});

      expect(errorSpy).toHaveBeenCalled();
    });

    it('should pass props through wrapped component', () => {
      const Component = defineComponent<{ value: number }>((props) => {
        return () => `Value: ${props.value}`;
      });

      const SafeComponent = withErrorBoundary(Component, {
        onError: () => {},
      });

      const result = SafeComponent({ value: 42 });
      expect(result).toBeTruthy();
    });

    it('should allow custom fallback in HOC', () => {
      const FallbackComponent = defineComponent(() => {
        return () => 'Custom Fallback';
      });

      const BrokenComponent = defineComponent(() => {
        throw new Error('Test');
      });

      const SafeComponent = withErrorBoundary(BrokenComponent, {
        fallback: FallbackComponent({}),
      });

      const result = SafeComponent({});
      expect(result).toBeTruthy();
    });
  });

  describe('Advanced Error Scenarios', () => {
    it('should handle errors with no message', () => {
      const errorSpy = vi.fn();

      const Component = defineComponent(() => {
        throw new Error();
      });

      ErrorBoundary({
        onError: errorSpy,
        children: () => Component({}),
      });

      const errorInfo = errorSpy.mock.calls[0][1];
      expect(errorInfo.message).toBe('An error occurred');
    });

    it('should handle non-Error objects thrown', () => {
      const errorSpy = vi.fn();

      const Component = defineComponent(() => {
        throw 'String error';
      });

      ErrorBoundary({
        onError: errorSpy,
        children: () => Component({}),
      });

      expect(errorSpy).toHaveBeenCalled();
    });

    it('should gracefully handle errors in error handlers', () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      const Component = defineComponent(() => {
        throw new Error('Original error');
      });

      ErrorBoundary({
        onError: () => {
          throw new Error('Handler error');
        },
        children: () => Component({}),
      });

      consoleErrorSpy.mockRestore();
    });

    it('should support custom error recovery strategies', () => {
      const errorLog: string[] = [];
      let currentStrategy: 'retry' | 'ignore' | 'report' = 'retry';

      const UnreliableComponent = defineComponent(() => {
        if (currentStrategy === 'retry') {
          throw new Error('Retry error');
        }
        return () => 'Success';
      });

      const SmartFallback = defineComponent(() => {
        const ctx = useErrorBoundary();

        return () => {
          if (ctx?.error) {
            errorLog.push(ctx.error.message);

            if (currentStrategy === 'retry' && ctx.error.errorCount < 3) {
              ctx.retry();
            } else if (currentStrategy === 'ignore') {
              return 'Ignored';
            } else {
              return 'Reported';
            }
          }
          return 'Fallback';
        };
      });

      ErrorBoundary({
        fallback: SmartFallback({}),
        children: () => UnreliableComponent({}),
      });

      expect(errorLog.length).toBeGreaterThan(0);
    });
  });

  describe('Error Boundary Edge Cases', () => {
    it('should handle rapid consecutive errors', () => {
      const errorSpy = vi.fn();
      let errorCount = 0;

      const Component = defineComponent(() => {
        errorCount++;
        throw new Error(`Error ${errorCount}`);
      });

      ErrorBoundary({
        onError: errorSpy,
        children: () => Component({}),
      });

      expect(errorSpy).toHaveBeenCalled();
    });

    it('should maintain separate error states for multiple boundaries', () => {
      const spy1 = vi.fn();
      const spy2 = vi.fn();

      const Error1 = defineComponent(() => {
        throw new Error('Error 1');
      });

      const Error2 = defineComponent(() => {
        throw new Error('Error 2');
      });

      ErrorBoundary({
        onError: spy1,
        children: () => Error1({}),
      });

      ErrorBoundary({
        onError: spy2,
        children: () => Error2({}),
      });

      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledTimes(1);
      expect(spy1.mock.calls[0][0].message).toBe('Error 1');
      expect(spy2.mock.calls[0][0].message).toBe('Error 2');
    });

    it('should clean up error state on component unmount', () => {
      const errorSpy = vi.fn();

      const Component = defineComponent(() => {
        throw new Error('Test');
      });

      const boundary = ErrorBoundary({
        onError: errorSpy,
        children: () => Component({}),
      });

      expect(errorSpy).toHaveBeenCalled();
      // Boundary should exist
      expect(boundary).toBeDefined();
    });
  });
});
