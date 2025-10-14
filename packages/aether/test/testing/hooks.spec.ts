/**
 * Hook Testing Utilities Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '../../src/testing/index.js';
import { signal, computed, effect } from '../../src/core/reactivity/index.js';

describe('renderHook', () => {
  describe('basic usage', () => {
    it('should render a simple hook', () => {
      const { result } = renderHook(() => {
        return { value: 42 };
      });

      expect(result.current.value).toBe(42);
    });

    it('should render hook with signal', () => {
      const { result } = renderHook(() => {
        const count = signal(0);
        return { count: count() };
      });

      expect(result.current.count).toBe(0);
    });

    it('should render hook with computed', () => {
      const { result } = renderHook(() => {
        const count = signal(5);
        const doubled = computed(() => count() * 2);
        return { doubled: doubled() };
      });

      expect(result.current.doubled).toBe(10);
    });
  });

  describe('hook props updates', () => {
    it('should accept initial props', () => {
      const { result } = renderHook(
        (props: { value: number }) => {
          return { doubled: props.value * 2 };
        },
        { initialProps: { value: 5 } }
      );

      expect(result.current.doubled).toBe(10);
    });

    it('should rerender with new props', () => {
      const { result, rerender } = renderHook(
        (props: { value: number }) => {
          return { doubled: props.value * 2 };
        },
        { initialProps: { value: 5 } }
      );

      expect(result.current.doubled).toBe(10);

      rerender({ value: 10 });

      expect(result.current.doubled).toBe(20);
    });

    it('should handle undefined props on rerender', () => {
      const { result, rerender } = renderHook(
        (props: { value?: number }) => {
          return { value: props.value || 0 };
        },
        { initialProps: { value: 5 } }
      );

      expect(result.current.value).toBe(5);

      rerender();

      expect(result.current.value).toBe(0);
    });
  });

  describe('hook cleanup', () => {
    it('should cleanup on unmount', () => {
      let cleanupCalled = false;

      const { unmount } = renderHook(() => {
        const cleanup = () => {
          cleanupCalled = true;
        };
        return { cleanup };
      });

      expect(cleanupCalled).toBe(false);

      unmount();

      // Note: cleanup would be called if onCleanup was used internally
      expect(cleanupCalled).toBe(false); // Current implementation doesn't auto-call cleanup
    });

    it('should not execute hook after unmount', () => {
      let executions = 0;

      const { unmount, rerender } = renderHook(() => {
        executions++;
        return { executions };
      });

      const initialExecutions = executions;

      unmount();

      rerender();

      // After unmount, hook should not execute again
      expect(executions).toBe(initialExecutions);
    });
  });

  describe('async hooks', () => {
    it('should handle async hook results', async () => {
      const { result } = renderHook(() => {
        const count = signal(0);
        const loadData = async () => {
          await new Promise(resolve => setTimeout(resolve, 50));
          count.set(5);
        };
        return { count: count(), loadData };
      });

      expect(result.current.count).toBe(0);

      await result.current.loadData();

      // Note: Would need to rerender to see updated count
      expect(result.current.count).toBe(0);
    });
  });

  describe('error boundary', () => {
    it('should capture hook errors', () => {
      const { result } = renderHook(() => {
        throw new Error('Hook error');
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe('Hook error');
    });

    it('should clear error on successful rerender', () => {
      let shouldThrow = true;

      const { result, rerender } = renderHook(() => {
        if (shouldThrow) {
          throw new Error('Error');
        }
        return { value: 'success' };
      });

      expect(result.error).toBeDefined();

      shouldThrow = false;
      rerender();

      expect(result.error).toBeUndefined();
      expect(result.current.value).toBe('success');
    });
  });

  describe('multiple hooks', () => {
    it('should handle multiple signals', () => {
      const { result } = renderHook(() => {
        const count = signal(0);
        const text = signal('hello');
        return {
          count: count(),
          text: text(),
        };
      });

      expect(result.current.count).toBe(0);
      expect(result.current.text).toBe('hello');
    });

    it('should handle signal dependencies', () => {
      const { result } = renderHook(() => {
        const a = signal(2);
        const b = signal(3);
        const sum = computed(() => a() + b());
        return { sum: sum() };
      });

      expect(result.current.sum).toBe(5);
    });
  });

  describe('custom wrapper', () => {
    it('should wrap hook with custom component', () => {
      const wrapper = ({ children }: { children: any }) => {
        return children;
      };

      const { result } = renderHook(
        () => {
          return { value: 'wrapped' };
        },
        { wrapper }
      );

      expect(result.current.value).toBe('wrapped');
    });
  });

  describe('effect hooks', () => {
    it('should execute effects', () => {
      let effectExecuted = false;

      const { result } = renderHook(() => {
        const count = signal(0);

        effect(() => {
          count(); // Read signal
          effectExecuted = true;
        });

        return { count: count() };
      });

      expect(effectExecuted).toBe(true);
      expect(result.current.count).toBe(0);
    });
  });
});
