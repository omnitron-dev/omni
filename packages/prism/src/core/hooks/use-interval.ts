'use client';

/**
 * useInterval Hook
 *
 * Declarative interval hook with automatic cleanup.
 *
 * @module @omnitron/prism/core/hooks
 */

import { useEffect, useRef } from 'react';

/**
 * Hook to run a callback at a specified interval.
 *
 * @param {function} callback - Function to call on each interval
 * @param {number | null} delay - Interval delay in ms (null to pause)
 *
 * @example
 * ```tsx
 * function Timer() {
 *   const [seconds, setSeconds] = useState(0);
 *   const [isRunning, setIsRunning] = useState(true);
 *
 *   useInterval(
 *     () => setSeconds((s) => s + 1),
 *     isRunning ? 1000 : null
 *   );
 *
 *   return (
 *     <div>
 *       <p>Seconds: {seconds}</p>
 *       <button onClick={() => setIsRunning(!isRunning)}>
 *         {isRunning ? 'Pause' : 'Resume'}
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useInterval(callback: () => void, delay: number | null): void {
  const savedCallback = useRef(callback);

  // Remember the latest callback
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  // Set up the interval
  useEffect(() => {
    if (delay === null) {
      return undefined;
    }

    const tick = () => savedCallback.current();
    const id = setInterval(tick, delay);

    return () => clearInterval(id);
  }, [delay]);
}
