'use client';

/**
 * useScrollOffsetTop Hook
 *
 * Manages offset top state based on scroll position.
 * Can track against window or a specific element's offset.
 *
 * This hook is SSR-safe - scroll tracking only runs on the client.
 *
 * Ported from minimal-shared for Prism design system.
 *
 * @module @omnitron-dev/prism/hooks/use-scroll-offset-top
 */

import type { RefObject } from 'react';
import { useRef, useState, useEffect, useCallback, useMemo } from 'react';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Return type for useScrollOffsetTop hook.
 */
export type UseScrollOffsetTopReturn<T extends HTMLElement = HTMLElement> = {
  /** Whether the scroll position is past the offset threshold */
  offsetTop: boolean;
  /** Ref to attach to element for tracking its offset (optional) */
  elementRef: RefObject<T | null>;
};

// =============================================================================
// HOOK
// =============================================================================

/**
 * Custom hook to manage the offset top state based on scroll position.
 *
 * Can be used in two ways:
 * 1. Track against a fixed pixel value (window scroll)
 * 2. Track against an element's offset (using returned ref)
 *
 * @param defaultValue - The offset value at which the state changes (default: 0)
 *
 * @returns An object containing offsetTop boolean and elementRef
 *
 * @example
 * ```tsx
 * // Track window scroll against fixed value
 * function StickyHeader() {
 *   const { offsetTop } = useScrollOffsetTop(80);
 *
 *   return (
 *     <AppBar position={offsetTop ? 'fixed' : 'static'}>
 *       <Toolbar>Header</Toolbar>
 *     </AppBar>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Track scroll against element offset
 * function HeaderWithBanner() {
 *   const { offsetTop, elementRef } = useScrollOffsetTop<HTMLDivElement>();
 *
 *   return (
 *     <>
 *       <div ref={elementRef}>Banner Content</div>
 *       <AppBar
 *         position={offsetTop ? 'fixed' : 'static'}
 *         sx={{ top: offsetTop ? 0 : 'auto' }}
 *       >
 *         <Toolbar>Header</Toolbar>
 *       </AppBar>
 *     </>
 *   );
 * }
 * ```
 */
export function useScrollOffsetTop<T extends HTMLElement = HTMLElement>(
  defaultValue: number = 0
): UseScrollOffsetTopReturn<T> {
  const elementRef = useRef<T | null>(null);
  const [offsetTop, setOffsetTop] = useState<boolean>(false);

  const handleScroll = useCallback(() => {
    // SSR guard - only run on client
    if (typeof window === 'undefined') return;

    const windowScrollY = window.scrollY;

    if (elementRef.current) {
      // Track element offset top
      const elementOffsetTop = elementRef.current.offsetTop;
      setOffsetTop(windowScrollY > elementOffsetTop - defaultValue);
    } else {
      // Track window offset top
      setOffsetTop(windowScrollY > defaultValue);
    }
  }, [defaultValue]);

  useEffect(() => {
    // SSR guard
    if (typeof window === 'undefined') return undefined;

    // Initial check
    handleScroll();

    // Add scroll listener with passive for better performance
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll]);

  // Memoize return object to prevent unnecessary re-renders
  return useMemo(
    () => ({
      elementRef,
      offsetTop,
    }),
    [offsetTop]
  );
}
