'use client';

/**
 * useBreakpoints Hook
 *
 * A hook for responsive breakpoint detection.
 *
 * @module @omnitron-dev/prism/core/hooks/use-breakpoints
 */

import { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { Breakpoint } from '@mui/material/styles';

/**
 * Breakpoint values in pixels.
 */
export interface BreakpointValues {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
}

/**
 * Breakpoint state.
 */
export interface BreakpointState {
  /** Current breakpoint name */
  current: Breakpoint;
  /** Is extra-small screen (< sm) */
  isXs: boolean;
  /** Is small screen (>= sm, < md) */
  isSm: boolean;
  /** Is medium screen (>= md, < lg) */
  isMd: boolean;
  /** Is large screen (>= lg, < xl) */
  isLg: boolean;
  /** Is extra-large screen (>= xl) */
  isXl: boolean;
  /** Is mobile (< md) */
  isMobile: boolean;
  /** Is tablet (>= md, < lg) */
  isTablet: boolean;
  /** Is desktop (>= lg) */
  isDesktop: boolean;
}

/**
 * Return type for useBreakpoints hook.
 */
export interface UseBreakpointsReturn extends BreakpointState {
  /** Check if viewport is >= breakpoint */
  up: (breakpoint: Breakpoint) => boolean;
  /** Check if viewport is < breakpoint */
  down: (breakpoint: Breakpoint) => boolean;
  /** Check if viewport is exactly at breakpoint range */
  only: (breakpoint: Breakpoint) => boolean;
  /** Check if viewport is between two breakpoints */
  between: (start: Breakpoint, end: Breakpoint) => boolean;
  /** Breakpoint values in pixels */
  values: BreakpointValues;
}

/**
 * Hook for responsive breakpoint detection.
 *
 * @returns Breakpoint state and helper functions
 *
 * @example
 * ```tsx
 * function ResponsiveLayout() {
 *   const { isMobile, isDesktop, up, current } = useBreakpoints();
 *
 *   return (
 *     <Box>
 *       {isMobile && <MobileNav />}
 *       {isDesktop && <DesktopSidebar />}
 *       <Typography>Current: {current}</Typography>
 *       {up('md') && <AdvancedFeatures />}
 *     </Box>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * function DataGrid() {
 *   const { between, only } = useBreakpoints();
 *
 *   const columns = useMemo(() => {
 *     if (only('xs')) return 1;
 *     if (between('sm', 'md')) return 2;
 *     return 3;
 *   }, [only, between]);
 *
 *   return <Grid columns={columns}>...</Grid>;
 * }
 * ```
 */
export function useBreakpoints(): UseBreakpointsReturn {
  const theme = useTheme();

  // Media queries for each breakpoint
  const isXsUp = useMediaQuery(theme.breakpoints.up('xs'));
  const isSmUp = useMediaQuery(theme.breakpoints.up('sm'));
  const isMdUp = useMediaQuery(theme.breakpoints.up('md'));
  const isLgUp = useMediaQuery(theme.breakpoints.up('lg'));
  const isXlUp = useMediaQuery(theme.breakpoints.up('xl'));

  // Derive current breakpoint and states
  const { current, isXs, isSm, isMd, isLg, isXl } = useMemo(() => {
    let currentBreakpoint: Breakpoint = 'xs';
    if (isXlUp) currentBreakpoint = 'xl';
    else if (isLgUp) currentBreakpoint = 'lg';
    else if (isMdUp) currentBreakpoint = 'md';
    else if (isSmUp) currentBreakpoint = 'sm';

    return {
      current: currentBreakpoint,
      isXs: !isSmUp,
      isSm: isSmUp && !isMdUp,
      isMd: isMdUp && !isLgUp,
      isLg: isLgUp && !isXlUp,
      isXl: isXlUp,
    };
  }, [isXsUp, isSmUp, isMdUp, isLgUp, isXlUp]);

  // Semantic breakpoints
  const isMobile = !isMdUp;
  const isTablet = isMdUp && !isLgUp;
  const isDesktop = isLgUp;

  // Helper functions
  const up = useMemo(
    () => (breakpoint: Breakpoint) => {
      switch (breakpoint) {
        case 'xs':
          return isXsUp;
        case 'sm':
          return isSmUp;
        case 'md':
          return isMdUp;
        case 'lg':
          return isLgUp;
        case 'xl':
          return isXlUp;
        default:
          return false;
      }
    },
    [isXsUp, isSmUp, isMdUp, isLgUp, isXlUp]
  );

  const down = useMemo(
    () => (breakpoint: Breakpoint) => {
      switch (breakpoint) {
        case 'xs':
          return false; // Nothing is below xs
        case 'sm':
          return !isSmUp;
        case 'md':
          return !isMdUp;
        case 'lg':
          return !isLgUp;
        case 'xl':
          return !isXlUp;
        default:
          return false;
      }
    },
    [isSmUp, isMdUp, isLgUp, isXlUp]
  );

  const only = useMemo(
    () => (breakpoint: Breakpoint) => {
      switch (breakpoint) {
        case 'xs':
          return isXs;
        case 'sm':
          return isSm;
        case 'md':
          return isMd;
        case 'lg':
          return isLg;
        case 'xl':
          return isXl;
        default:
          return false;
      }
    },
    [isXs, isSm, isMd, isLg, isXl]
  );

  const between = useMemo(
    () => (start: Breakpoint, end: Breakpoint) => {
      const breakpointOrder: Breakpoint[] = ['xs', 'sm', 'md', 'lg', 'xl'];
      const startIndex = breakpointOrder.indexOf(start);
      const endIndex = breakpointOrder.indexOf(end);
      const currentIndex = breakpointOrder.indexOf(current);

      return currentIndex >= startIndex && currentIndex <= endIndex;
    },
    [current]
  );

  // Breakpoint values
  const values = useMemo<BreakpointValues>(
    () => ({
      xs: theme.breakpoints.values.xs,
      sm: theme.breakpoints.values.sm,
      md: theme.breakpoints.values.md,
      lg: theme.breakpoints.values.lg,
      xl: theme.breakpoints.values.xl,
    }),
    [theme.breakpoints.values]
  );

  return {
    current,
    isXs,
    isSm,
    isMd,
    isLg,
    isXl,
    isMobile,
    isTablet,
    isDesktop,
    up,
    down,
    only,
    between,
    values,
  };
}
