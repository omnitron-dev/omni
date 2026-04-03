'use client';

/**
 * useDebounce Hook
 *
 * A hook for debouncing values.
 *
 * @module @omnitron-dev/prism/core/hooks/use-debounce
 */

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Hook for debouncing a value.
 *
 * @param value - Value to debounce
 * @param delay - Debounce delay in milliseconds (default: 500)
 * @returns Debounced value
 *
 * @example
 * ```tsx
 * function SearchInput() {
 *   const [query, setQuery] = useState('');
 *   const debouncedQuery = useDebounce(query, 300);
 *
 *   useEffect(() => {
 *     if (debouncedQuery) {
 *       search(debouncedQuery);
 *     }
 *   }, [debouncedQuery]);
 *
 *   return (
 *     <TextField
 *       value={query}
 *       onChange={(e) => setQuery(e.target.value)}
 *       placeholder="Search..."
 *     />
 *   );
 * }
 * ```
 */
export function useDebounce<T>(value: T, delay = 500): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Hook for debouncing a callback function.
 *
 * @param callback - Function to debounce
 * @param delay - Debounce delay in milliseconds (default: 500)
 * @returns Debounced callback and cancel function
 *
 * @example
 * ```tsx
 * function AutoSave() {
 *   const [content, setContent] = useState('');
 *
 *   const { debouncedCallback: save, cancel } = useDebounceCallback(
 *     async (text: string) => {
 *       await api.saveDocument(text);
 *     },
 *     1000
 *   );
 *
 *   const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
 *     setContent(e.target.value);
 *     save(e.target.value);
 *   };
 *
 *   return <textarea value={content} onChange={handleChange} />;
 * }
 * ```
 */
export function useDebounceCallback<T extends (...args: never[]) => unknown>(
  callback: T,
  delay = 500
): {
  debouncedCallback: (...args: Parameters<T>) => void;
  cancel: () => void;
  flush: () => void;
} {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbackRef = useRef<T>(callback);
  const argsRef = useRef<Parameters<T> | null>(null);

  // Update callback ref on each render
  callbackRef.current = callback;

  const cancel = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    argsRef.current = null;
  }, []);

  const flush = useCallback(() => {
    if (timeoutRef.current && argsRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      callbackRef.current(...(argsRef.current as Parameters<T>));
      argsRef.current = null;
    }
  }, []);

  const debouncedCallback = useCallback(
    (...args: Parameters<T>) => {
      argsRef.current = args;

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        callbackRef.current(...args);
        timeoutRef.current = null;
        argsRef.current = null;
      }, delay);
    },
    [delay]
  );

  // Cleanup on unmount
  useEffect(
    () => () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    },
    []
  );

  return { debouncedCallback, cancel, flush };
}
