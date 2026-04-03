'use client';

/**
 * useIsomorphicLayoutEffect Hook
 *
 * SSR-safe version of useLayoutEffect.
 * Uses useLayoutEffect on client, useEffect on server.
 *
 * @module @omnitron-dev/prism/hooks
 */

import { useEffect, useLayoutEffect } from 'react';

// =============================================================================
// HOOK
// =============================================================================

/**
 * Isomorphic layout effect that works in both SSR and CSR environments.
 *
 * - On the client: Uses useLayoutEffect for synchronous DOM operations
 * - On the server: Uses useEffect to avoid SSR warnings
 *
 * @example
 * ```tsx
 * function Tooltip({ position }) {
 *   const ref = useRef<HTMLDivElement>(null);
 *
 *   // Synchronously measure and position on client
 *   useIsomorphicLayoutEffect(() => {
 *     if (ref.current) {
 *       const rect = ref.current.getBoundingClientRect();
 *       // Position tooltip based on measurements
 *     }
 *   }, [position]);
 *
 *   return <div ref={ref}>Tooltip</div>;
 * }
 * ```
 */
export const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
