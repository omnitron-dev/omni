'use client';

/**
 * usePrevious Hook
 *
 * Tracks the previous value of a state or prop.
 *
 * @module @omnitron/prism/core/hooks
 */

import { useRef, useEffect } from 'react';

/**
 * Hook to track the previous value.
 *
 * @template T - Type of the value
 * @param {T} value - Current value to track
 * @returns {T | undefined} Previous value (undefined on first render)
 *
 * @example
 * ```tsx
 * function Counter() {
 *   const [count, setCount] = useState(0);
 *   const prevCount = usePrevious(count);
 *
 *   return (
 *     <div>
 *       Current: {count}, Previous: {prevCount ?? 'N/A'}
 *     </div>
 *   );
 * }
 * ```
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}
