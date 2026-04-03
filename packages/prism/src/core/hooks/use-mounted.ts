'use client';

/**
 * useMounted Hook
 *
 * Tracks component mount state for async operations.
 *
 * @module @omnitron-dev/prism/core/hooks
 */

import { useEffect, useRef, useCallback } from 'react';

/**
 * Return type for useMounted hook.
 */
export interface UseMountedReturn {
  /** Check if component is currently mounted */
  isMounted: () => boolean;
}

/**
 * Hook to check if a component is currently mounted.
 * Useful for preventing state updates on unmounted components.
 *
 * @returns {UseMountedReturn} Mount state checker
 *
 * @example
 * ```tsx
 * function AsyncComponent() {
 *   const [data, setData] = useState(null);
 *   const { isMounted } = useMounted();
 *
 *   useEffect(() => {
 *     fetchData().then((result) => {
 *       if (isMounted()) {
 *         setData(result);
 *       }
 *     });
 *   }, [isMounted]);
 *
 *   return <div>{data}</div>;
 * }
 * ```
 */
export function useMounted(): UseMountedReturn {
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isMounted = useCallback(() => mountedRef.current, []);

  return { isMounted };
}
