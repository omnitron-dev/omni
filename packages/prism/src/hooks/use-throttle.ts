'use client';

/**
 * useThrottle Hook
 *
 * Throttles a value or callback, limiting how often it can update.
 *
 * @module @omnitron-dev/prism/hooks/use-throttle
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// =============================================================================
// TYPES
// =============================================================================

export interface UseThrottleOptions {
  /** Whether to invoke on the leading edge (default: true) */
  leading?: boolean;
  /** Whether to invoke on the trailing edge (default: true) */
  trailing?: boolean;
}

// =============================================================================
// USE THROTTLE VALUE
// =============================================================================

/**
 * useThrottle - Throttle a value.
 *
 * Returns a throttled version of the value that only updates
 * at most once per specified interval.
 *
 * @example
 * ```tsx
 * function SearchComponent() {
 *   const [search, setSearch] = useState('');
 *   const throttledSearch = useThrottle(search, 300);
 *
 *   // API call only triggers when throttledSearch changes
 *   useEffect(() => {
 *     if (throttledSearch) {
 *       searchApi(throttledSearch);
 *     }
 *   }, [throttledSearch]);
 *
 *   return <input value={search} onChange={(e) => setSearch(e.target.value)} />;
 * }
 * ```
 *
 * @param value - Value to throttle
 * @param delay - Throttle delay in milliseconds
 * @param options - Throttle options
 * @returns Throttled value
 */
export function useThrottle<T>(value: T, delay: number, options: UseThrottleOptions = {}): T {
  const { leading = true, trailing = true } = options;

  const [throttledValue, setThrottledValue] = useState(value);
  const lastExecuted = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastValue = useRef(value);

  useEffect(() => {
    lastValue.current = value;
    const now = Date.now();
    const elapsed = now - lastExecuted.current;

    const execute = () => {
      lastExecuted.current = Date.now();
      setThrottledValue(lastValue.current);
    };

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (elapsed >= delay) {
      // Enough time has passed
      if (leading) {
        execute();
      } else if (trailing) {
        timeoutRef.current = setTimeout(execute, delay);
      }
    } else if (trailing) {
      // Schedule trailing call
      timeoutRef.current = setTimeout(execute, delay - elapsed);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, delay, leading, trailing]);

  return throttledValue;
}

// =============================================================================
// USE THROTTLE CALLBACK
// =============================================================================

/**
 * useThrottleCallback - Create a throttled callback function.
 *
 * Returns a memoized throttled version of the callback that only
 * invokes at most once per specified interval.
 *
 * @example
 * ```tsx
 * function ScrollTracker() {
 *   const handleScroll = useThrottleCallback(
 *     (e: Event) => {
 *       console.log('Scroll position:', window.scrollY);
 *     },
 *     100
 *   );
 *
 *   useEffect(() => {
 *     window.addEventListener('scroll', handleScroll);
 *     return () => window.removeEventListener('scroll', handleScroll);
 *   }, [handleScroll]);
 *
 *   return <div>Scroll me!</div>;
 * }
 * ```
 *
 * @param callback - Callback to throttle
 * @param delay - Throttle delay in milliseconds
 * @param options - Throttle options
 * @returns Throttled callback
 */
export function useThrottleCallback<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number,
  options: UseThrottleOptions = {}
): T {
  const { leading = true, trailing = true } = options;

  const lastExecuted = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastArgs = useRef<Parameters<T> | null>(null);
  const callbackRef = useRef(callback);

  // Update callback ref on each render
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Cleanup on unmount
  useEffect(
    () => () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    },
    []
  );

  return useCallback(
    ((...args: Parameters<T>) => {
      lastArgs.current = args;
      const now = Date.now();
      const elapsed = now - lastExecuted.current;

      const execute = () => {
        lastExecuted.current = Date.now();
        if (lastArgs.current) {
          callbackRef.current(...lastArgs.current);
        }
      };

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      if (elapsed >= delay) {
        if (leading) {
          execute();
        } else if (trailing) {
          timeoutRef.current = setTimeout(execute, delay);
        }
      } else if (trailing) {
        timeoutRef.current = setTimeout(execute, delay - elapsed);
      }
    }) as T,
    [delay, leading, trailing]
  );
}
