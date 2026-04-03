/**
 * useDebounce Hook Tests
 *
 * Tests for debouncing value and callback hooks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebounce, useDebounceCallback } from './use-debounce.js';

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('hello', 500));
    expect(result.current).toBe('hello');
  });

  it('should debounce value changes', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 500), {
      initialProps: { value: 'hello' },
    });

    expect(result.current).toBe('hello');

    // Update the value
    rerender({ value: 'world' });
    expect(result.current).toBe('hello'); // Still old value

    // Fast-forward time
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current).toBe('world'); // Now updated
  });

  it('should cancel pending update when value changes', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 500), { initialProps: { value: 'a' } });

    rerender({ value: 'b' });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    rerender({ value: 'c' });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Should still be 'a' because timer keeps getting reset
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Now should be 'c' (the last value)
    expect(result.current).toBe('c');
  });

  it('should use default delay of 500ms', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value), { initialProps: { value: 'initial' } });

    rerender({ value: 'updated' });

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current).toBe('initial');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('updated');
  });

  it('should work with objects', () => {
    const initial = { count: 1 };
    const updated = { count: 2 };

    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 500), {
      initialProps: { value: initial },
    });

    expect(result.current).toBe(initial);

    rerender({ value: updated });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current).toBe(updated);
  });
});

describe('useDebounceCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should debounce callback execution', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebounceCallback(callback, 500));

    act(() => {
      result.current.debouncedCallback('arg1');
    });

    expect(callback).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('arg1');
  });

  it('should cancel pending callback when called again', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebounceCallback(callback, 500));

    act(() => {
      result.current.debouncedCallback('first');
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    act(() => {
      result.current.debouncedCallback('second');
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('second');
  });

  it('should cancel pending callback with cancel()', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebounceCallback(callback, 500));

    act(() => {
      result.current.debouncedCallback('arg');
    });

    act(() => {
      result.current.cancel();
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('should execute immediately with flush()', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebounceCallback(callback, 500));

    act(() => {
      result.current.debouncedCallback('arg');
    });

    expect(callback).not.toHaveBeenCalled();

    act(() => {
      result.current.flush();
    });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith('arg');
  });

  it('should not call callback on flush if nothing pending', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useDebounceCallback(callback, 500));

    act(() => {
      result.current.flush();
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('should maintain stable function references', () => {
    const callback = vi.fn();
    const { result, rerender } = renderHook(() => useDebounceCallback(callback, 500));

    const initialDebouncedCallback = result.current.debouncedCallback;
    const initialCancel = result.current.cancel;
    const initialFlush = result.current.flush;

    rerender();

    expect(result.current.debouncedCallback).toBe(initialDebouncedCallback);
    expect(result.current.cancel).toBe(initialCancel);
    expect(result.current.flush).toBe(initialFlush);
  });
});
