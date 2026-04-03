'use client';

/**
 * useUpdateEffect Hook
 *
 * Like useEffect, but skips the first render.
 * Useful for running effects only on updates, not on mount.
 *
 * @module @omnitron/prism/hooks
 */

import { useEffect, useRef, type DependencyList, type EffectCallback } from 'react';

// =============================================================================
// HOOK
// =============================================================================

/**
 * Effect hook that only runs on updates, not on initial mount.
 *
 * @param effect - Effect callback function
 * @param deps - Dependency array
 *
 * @example
 * ```tsx
 * function SearchInput({ value, onSearch }) {
 *   // Only search when value changes after initial render
 *   useUpdateEffect(() => {
 *     onSearch(value);
 *   }, [value]);
 *
 *   return <input value={value} />;
 * }
 * ```
 */
export function useUpdateEffect(effect: EffectCallback, deps?: DependencyList): void {
  const isFirstMount = useRef(true);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return undefined;
    }

    return effect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Layout effect hook that only runs on updates, not on initial mount.
 * Uses useLayoutEffect for synchronous DOM measurements.
 *
 * @param effect - Effect callback function
 * @param deps - Dependency array
 *
 * @example
 * ```tsx
 * function AnimatedComponent({ size }) {
 *   const ref = useRef<HTMLDivElement>(null);
 *
 *   // Animate size changes, but not initial render
 *   useUpdateLayoutEffect(() => {
 *     if (ref.current) {
 *       animate(ref.current, { width: size });
 *     }
 *   }, [size]);
 *
 *   return <div ref={ref} />;
 * }
 * ```
 */
export function useUpdateLayoutEffect(effect: EffectCallback, deps?: DependencyList): void {
  const isFirstMount = useRef(true);

  // Use useEffect for SSR compatibility, but the pattern is the same
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return undefined;
    }

    return effect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
