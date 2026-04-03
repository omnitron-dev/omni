'use client';

/**
 * useWindowSize Hook
 *
 * Tracks window dimensions with responsive breakpoint utilities.
 *
 * @module @omnitron/prism/hooks
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

/**
 * Window size data.
 */
export interface WindowSize {
  /** Window width */
  width: number;
  /** Window height */
  height: number;
  /** Is mobile (< 600px) */
  isMobile: boolean;
  /** Is tablet (600px - 960px) */
  isTablet: boolean;
  /** Is desktop (>= 960px) */
  isDesktop: boolean;
  /** Is large desktop (>= 1280px) */
  isLargeDesktop: boolean;
}

/**
 * Breakpoint definitions (following MUI defaults).
 */
export interface Breakpoints {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

/**
 * Default breakpoints (MUI defaults).
 */
const defaultBreakpoints: Breakpoints = {
  xs: 0,
  sm: 600,
  md: 900,
  lg: 1200,
  xl: 1536,
};

/**
 * Options for useWindowSize hook.
 */
export interface UseWindowSizeOptions {
  /** Custom breakpoints */
  breakpoints?: Partial<Breakpoints>;
  /** Debounce delay in ms (default: 100) */
  debounce?: number;
  /** Initial width for SSR (default: 1200) */
  initialWidth?: number;
  /** Initial height for SSR (default: 800) */
  initialHeight?: number;
}

/**
 * useWindowSize - Hook for tracking window dimensions.
 *
 * @example
 * ```tsx
 * // Basic usage
 * const { width, height, isMobile, isDesktop } = useWindowSize();
 *
 * // Responsive rendering
 * if (isMobile) {
 *   return <MobileLayout />;
 * }
 * return <DesktopLayout />;
 *
 * // Responsive columns
 * const columns = isMobile ? 1 : isTablet ? 2 : 4;
 *
 * // Custom breakpoints
 * const { isMobile } = useWindowSize({
 *   breakpoints: { sm: 768 }
 * });
 * ```
 */
export function useWindowSize(options: UseWindowSizeOptions = {}): WindowSize {
  const { breakpoints: customBreakpoints, debounce = 100, initialWidth = 1200, initialHeight = 800 } = options;

  const breakpoints = { ...defaultBreakpoints, ...customBreakpoints };

  const getSize = useCallback((): WindowSize => {
    if (typeof window === 'undefined') {
      return {
        width: initialWidth,
        height: initialHeight,
        isMobile: initialWidth < breakpoints.sm,
        isTablet: initialWidth >= breakpoints.sm && initialWidth < breakpoints.md,
        isDesktop: initialWidth >= breakpoints.md,
        isLargeDesktop: initialWidth >= breakpoints.lg,
      };
    }

    const width = window.innerWidth;
    const height = window.innerHeight;

    return {
      width,
      height,
      isMobile: width < breakpoints.sm,
      isTablet: width >= breakpoints.sm && width < breakpoints.md,
      isDesktop: width >= breakpoints.md,
      isLargeDesktop: width >= breakpoints.lg,
    };
  }, [breakpoints.sm, breakpoints.md, breakpoints.lg, initialWidth, initialHeight]);

  const [size, setSize] = useState<WindowSize>(getSize);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleResize = () => {
      if (debounce > 0) {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          setSize(getSize());
        }, debounce);
      } else {
        setSize(getSize());
      }
    };

    // Set initial size
    setSize(getSize());

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [debounce, getSize]);

  return size;
}

/**
 * Return type for useResponsiveQuery hook.
 */
export type UseResponsiveQueryReturn = boolean;

/**
 * useResponsiveQuery - Hook for CSS media query matching.
 *
 * Note: For the simpler MUI-style useMediaQuery, see @omnitron/prism/core.
 * This hook provides a standalone implementation without MUI dependency.
 *
 * @example
 * ```tsx
 * // Direct media query
 * const prefersDark = useResponsiveQuery('(prefers-color-scheme: dark)');
 * const isRetina = useResponsiveQuery('(min-resolution: 2dppx)');
 *
 * // Responsive
 * const isLargeScreen = useResponsiveQuery('(min-width: 1200px)');
 * ```
 */
export function useResponsiveQuery(query: string): UseResponsiveQueryReturn {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const mediaQuery = window.matchMedia(query);

    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    // Set initial value
    setMatches(mediaQuery.matches);

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    // Fallback for older browsers
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [query]);

  return matches;
}

/**
 * useBreakpoint - Hook for checking current breakpoint.
 *
 * @example
 * ```tsx
 * const breakpoint = useBreakpoint();
 *
 * // Current breakpoint name
 * console.log(breakpoint); // 'md'
 *
 * // Check specific breakpoint
 * const { isUp, isDown, isOnly, isBetween } = useBreakpointChecks();
 *
 * if (isUp('md')) {
 *   // Screen is md or larger
 * }
 * ```
 */
export function useBreakpoint(customBreakpoints?: Partial<Breakpoints>): 'xs' | 'sm' | 'md' | 'lg' | 'xl' {
  const breakpoints = { ...defaultBreakpoints, ...customBreakpoints };
  const { width } = useWindowSize({ breakpoints: customBreakpoints });

  if (width >= breakpoints.xl) return 'xl';
  if (width >= breakpoints.lg) return 'lg';
  if (width >= breakpoints.md) return 'md';
  if (width >= breakpoints.sm) return 'sm';
  return 'xs';
}

/**
 * Return type for useBreakpointChecks hook.
 */
export interface BreakpointChecks {
  /** Check if width is >= breakpoint */
  isUp: (breakpoint: keyof Breakpoints) => boolean;
  /** Check if width is < breakpoint */
  isDown: (breakpoint: keyof Breakpoints) => boolean;
  /** Check if width is within breakpoint range */
  isOnly: (breakpoint: keyof Breakpoints) => boolean;
  /** Check if width is between two breakpoints */
  isBetween: (start: keyof Breakpoints, end: keyof Breakpoints) => boolean;
}

/**
 * useBreakpointChecks - Hook for advanced breakpoint checking.
 *
 * @example
 * ```tsx
 * const { isUp, isDown, isOnly, isBetween } = useBreakpointChecks();
 *
 * isUp('md');           // true if >= 900px
 * isDown('lg');         // true if < 1200px
 * isOnly('md');         // true if 900px - 1199px
 * isBetween('sm', 'lg'); // true if 600px - 1199px
 * ```
 */
export function useBreakpointChecks(customBreakpoints?: Partial<Breakpoints>): BreakpointChecks {
  // Memoize breakpoints to prevent callback recreation on every render
  const breakpoints = useMemo(() => ({ ...defaultBreakpoints, ...customBreakpoints }), [customBreakpoints]);
  const { width } = useWindowSize({ breakpoints: customBreakpoints });

  const orderedBreakpoints: (keyof Breakpoints)[] = ['xs', 'sm', 'md', 'lg', 'xl'];

  const getNextBreakpoint = (bp: keyof Breakpoints): keyof Breakpoints | null => {
    const index = orderedBreakpoints.indexOf(bp);
    return index < orderedBreakpoints.length - 1 ? orderedBreakpoints[index + 1] : null;
  };

  const isUp = useCallback(
    (breakpoint: keyof Breakpoints): boolean => width >= breakpoints[breakpoint],
    [width, breakpoints]
  );

  const isDown = useCallback(
    (breakpoint: keyof Breakpoints): boolean => width < breakpoints[breakpoint],
    [width, breakpoints]
  );

  const isOnly = useCallback(
    (breakpoint: keyof Breakpoints): boolean => {
      const next = getNextBreakpoint(breakpoint);
      const min = breakpoints[breakpoint];
      const max = next ? breakpoints[next] : Infinity;
      return width >= min && width < max;
    },
    [width, breakpoints]
  );

  const isBetween = useCallback(
    (start: keyof Breakpoints, end: keyof Breakpoints): boolean =>
      width >= breakpoints[start] && width < breakpoints[end],
    [width, breakpoints]
  );

  return { isUp, isDown, isOnly, isBetween };
}
