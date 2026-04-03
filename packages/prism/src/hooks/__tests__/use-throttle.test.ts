/**
 * useThrottle Hook Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useThrottle, useThrottleCallback } from '../use-throttle.js';

describe('useThrottle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return initial value immediately', () => {
    const { result } = renderHook(() => useThrottle('initial', 100));
    expect(result.current).toBe('initial');
  });

  it('should throttle rapid value changes', () => {
    const { result, rerender } = renderHook(({ value }) => useThrottle(value, 100), { initialProps: { value: 0 } });

    expect(result.current).toBe(0);

    // Rapid updates
    rerender({ value: 1 });
    rerender({ value: 2 });
    rerender({ value: 3 });

    // Should still be 0 (throttled)
    expect(result.current).toBe(0);

    // After delay, should update to latest value
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current).toBe(3);
  });

  it('should not update with leading: false', () => {
    const { result, rerender } = renderHook(
      ({ value }) => useThrottle(value, 100, { leading: false, trailing: true }),
      { initialProps: { value: 0 } }
    );

    // Initial value
    expect(result.current).toBe(0);

    // Update should NOT happen immediately (no leading)
    rerender({ value: 1 });
    expect(result.current).toBe(0);

    // After delay, trailing should fire
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current).toBe(1);
  });
});

describe('useThrottleCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should throttle callback execution', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useThrottleCallback(callback, 100));

    // Call multiple times rapidly
    act(() => {
      result.current();
      result.current();
      result.current();
    });

    // Should only be called once initially
    expect(callback).toHaveBeenCalledTimes(1);

    // After delay
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Should execute trailing call
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('should pass arguments to callback', () => {
    const callback = vi.fn();
    const { result } = renderHook(() => useThrottleCallback(callback, 100));

    act(() => {
      result.current('arg1', 'arg2');
    });

    expect(callback).toHaveBeenCalledWith('arg1', 'arg2');
  });
});
