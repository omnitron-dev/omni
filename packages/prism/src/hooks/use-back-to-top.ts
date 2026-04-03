'use client';

/**
 * useBackToTop Hook
 *
 * Manages visibility of a "Back to Top" button based on scroll position.
 * Supports both percentage-based and pixel-based visibility thresholds.
 *
 * @module @omnitron/prism/hooks
 */

import type { Dispatch, SetStateAction } from 'react';
import { useMemo, useState, useEffect, useCallback, useRef } from 'react';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Return type for useBackToTop hook.
 */
export interface UseBackToTopReturn {
  /** Whether the "Back to Top" button should be visible */
  isVisible: boolean;
  /** Function to scroll smoothly to top */
  onBackToTop: () => void;
  /** Manual visibility control */
  setIsVisible: Dispatch<SetStateAction<boolean>>;
}

/**
 * Parsed threshold value.
 */
interface ParsedThreshold {
  value: number;
  type: 'percentage' | 'pixels';
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Parse threshold input value.
 *
 * @param input - Percentage string (e.g., '90%') or pixel number
 * @returns Parsed threshold with type
 * @throws Error if invalid percentage string
 */
function parseThreshold(input: string | number): ParsedThreshold {
  if (typeof input === 'string') {
    if (!input.endsWith('%')) {
      throw new Error('[useBackToTop] String threshold must end with % (e.g., "90%")');
    }
    const value = Number(input.slice(0, -1));
    if (isNaN(value)) {
      throw new Error('[useBackToTop] Invalid percentage value');
    }
    return { value, type: 'percentage' };
  }

  return { value: input, type: 'pixels' };
}

// =============================================================================
// HOOK
// =============================================================================

/**
 * Hook to manage the visibility of a "Back to Top" button based on scroll position.
 *
 * Two modes are supported:
 * - **Percentage mode**: Button becomes visible when scrolled past N% of the page.
 *   Pass a string like '90%' as the threshold.
 * - **Pixel mode**: Button becomes visible when within N pixels of the bottom.
 *   Pass a number like 80 as the threshold.
 *
 * @param threshold - Visibility threshold
 *   - String with '%' (e.g., '90%'): Show when scroll progress >= this percentage
 *   - Number (e.g., 80): Show when within this many pixels from bottom
 * @param debounce - Whether to debounce the scroll handler (100ms)
 * @returns Visibility state and scroll control functions
 *
 * @example
 * ```tsx
 * // Show when scrolled 90% down the page
 * const { isVisible, onBackToTop } = useBackToTop('90%');
 *
 * // Show when within 80px of the bottom
 * const { isVisible, onBackToTop } = useBackToTop(80);
 *
 * // With debouncing for better performance
 * const { isVisible, onBackToTop } = useBackToTop('85%', true);
 *
 * return (
 *   <Fade in={isVisible}>
 *     <Fab onClick={onBackToTop} sx={{ position: 'fixed', bottom: 16, right: 16 }}>
 *       <KeyboardArrowUpIcon />
 *     </Fab>
 *   </Fade>
 * );
 * ```
 */
export function useBackToTop(threshold: string | number = '90%', debounce: boolean = false): UseBackToTopReturn {
  const [isVisible, setIsVisible] = useState(false);

  const parsedThreshold = useMemo(() => parseThreshold(threshold), [threshold]);

  const handleScroll = useCallback(() => {
    // SSR guard - only run on client
    if (typeof window === 'undefined') return;

    const windowHeight = window.innerHeight;
    const scrollY = Math.round(window.scrollY);
    const documentHeight = document.body.offsetHeight;

    // Calculate scroll progress (0-100)
    const maxScroll = documentHeight - windowHeight;
    const scrollProgress = maxScroll > 0 ? Math.round((scrollY / maxScroll) * 100) : 0;

    if (parsedThreshold.type === 'percentage') {
      // Percentage mode: visible when scroll progress >= threshold
      setIsVisible(scrollProgress >= parsedThreshold.value);
    } else {
      // Pixel mode: visible when within threshold pixels from bottom
      const distanceFromBottom = documentHeight - windowHeight - scrollY;
      setIsVisible(distanceFromBottom <= parsedThreshold.value);
    }
  }, [parsedThreshold]);

  // Debounced scroll handler with cleanup support
  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedHandleScroll = useCallback(() => {
    if (debounceTimeoutRef.current !== null) clearTimeout(debounceTimeoutRef.current);
    debounceTimeoutRef.current = setTimeout(handleScroll, 100);
  }, [handleScroll]);

  useEffect(() => {
    // SSR guard
    if (typeof window === 'undefined') return undefined;

    const scrollHandler = debounce ? debouncedHandleScroll : handleScroll;

    // Check initial position
    handleScroll();

    window.addEventListener('scroll', scrollHandler, { passive: true });

    return () => {
      window.removeEventListener('scroll', scrollHandler);
      if (debounceTimeoutRef.current !== null) clearTimeout(debounceTimeoutRef.current);
    };
  }, [debounce, debouncedHandleScroll, handleScroll]);

  const onBackToTop = useCallback(() => {
    // SSR guard
    if (typeof window === 'undefined') return;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return { isVisible, onBackToTop, setIsVisible };
}
