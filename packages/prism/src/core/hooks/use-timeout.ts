'use client';

/**
 * useTimeout Hook
 *
 * Declarative timeout hook with automatic cleanup.
 *
 * @module @omnitron/prism/core/hooks
 */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';

/**
 * Return type for useTimeout hook.
 */
export interface UseTimeoutReturn {
  /** Reset the timeout */
  reset: () => void;
  /** Clear the timeout */
  clear: () => void;
  /** Whether the timeout is active */
  isActive: boolean;
}

/**
 * Hook to run a callback after a specified delay.
 *
 * @param {function} callback - Function to call after delay
 * @param {number} delay - Delay in milliseconds
 * @returns {UseTimeoutReturn} Timeout controls
 *
 * @example
 * ```tsx
 * function AutoSave() {
 *   const [content, setContent] = useState('');
 *   const { reset } = useTimeout(() => {
 *     saveContent(content);
 *   }, 3000);
 *
 *   const handleChange = (value: string) => {
 *     setContent(value);
 *     reset(); // Reset timer on each change
 *   };
 *
 *   return <textarea value={content} onChange={(e) => handleChange(e.target.value)} />;
 * }
 * ```
 */
export function useTimeout(callback: () => void, delay: number): UseTimeoutReturn {
  const savedCallback = useRef(callback);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isActive, setIsActive] = useState(true);

  // Remember the latest callback
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  const clear = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      setIsActive(false);
    }
  }, []);

  const reset = useCallback(() => {
    clear();
    timeoutRef.current = setTimeout(() => {
      savedCallback.current();
      setIsActive(false);
    }, delay);
    setIsActive(true);
  }, [clear, delay]);

  // Set up the timeout
  useEffect(() => {
    reset();
    return clear;
  }, [reset, clear]);

  // Memoize return object to prevent unnecessary re-renders in consumers
  return useMemo(() => ({ reset, clear, isActive }), [reset, clear, isActive]);
}
