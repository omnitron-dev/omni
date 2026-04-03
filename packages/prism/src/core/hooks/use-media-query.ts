'use client';

/**
 * useMediaQuery Hook
 *
 * Re-export and extension of MUI's useMediaQuery.
 *
 * @module @omnitron-dev/prism/core/hooks/use-media-query
 */

import { useMediaQuery as useMuiMediaQuery } from '@mui/material';
import type { UseMediaQueryOptions } from '@mui/material';

export { useMuiMediaQuery as useMediaQuery };
export type { UseMediaQueryOptions };

/**
 * Hook for detecting system color scheme preference.
 *
 * @returns true if user prefers dark mode
 *
 * @example
 * ```tsx
 * function ThemeToggle() {
 *   const prefersDark = usePrefersDarkMode();
 *   const { setMode } = usePrismContext();
 *
 *   useEffect(() => {
 *     setMode(prefersDark ? 'dark' : 'light');
 *   }, [prefersDark, setMode]);
 *
 *   return null;
 * }
 * ```
 */
export function usePrefersDarkMode(): boolean {
  return useMuiMediaQuery('(prefers-color-scheme: dark)');
}

/**
 * Hook for detecting reduced motion preference.
 *
 * @returns true if user prefers reduced motion
 *
 * @example
 * ```tsx
 * function AnimatedComponent() {
 *   const prefersReducedMotion = usePrefersReducedMotion();
 *
 *   return (
 *     <motion.div
 *       animate={{ x: 100 }}
 *       transition={{
 *         duration: prefersReducedMotion ? 0 : 0.3,
 *       }}
 *     />
 *   );
 * }
 * ```
 */
export function usePrefersReducedMotion(): boolean {
  return useMuiMediaQuery('(prefers-reduced-motion: reduce)');
}

/**
 * Hook for detecting high contrast preference.
 *
 * @returns true if user prefers high contrast
 */
export function usePrefersHighContrast(): boolean {
  return useMuiMediaQuery('(prefers-contrast: more)');
}

/**
 * Hook for detecting touch device.
 *
 * @returns true if device supports hover (likely not touch)
 *
 * @example
 * ```tsx
 * function Tooltip() {
 *   const canHover = useCanHover();
 *
 *   // Only show hover tooltips on non-touch devices
 *   if (!canHover) {
 *     return <TouchTooltip />;
 *   }
 *
 *   return <HoverTooltip />;
 * }
 * ```
 */
export function useCanHover(): boolean {
  return useMuiMediaQuery('(hover: hover) and (pointer: fine)');
}

/**
 * Hook for detecting print mode.
 *
 * @returns true if currently printing
 */
export function useIsPrinting(): boolean {
  return useMuiMediaQuery('print');
}

/**
 * Hook that resolves 'system' mode to actual 'light' or 'dark' based on system preference.
 * If mode is already 'light' or 'dark', returns it unchanged.
 *
 * @param mode - The theme mode ('light' | 'dark' | 'system')
 * @returns Resolved mode ('light' | 'dark')
 *
 * @example
 * ```tsx
 * function ThemeProvider({ mode, children }) {
 *   const resolvedMode = useResolvedMode(mode);
 *
 *   return (
 *     <MuiThemeProvider theme={createTheme({ mode: resolvedMode })}>
 *       {children}
 *     </MuiThemeProvider>
 *   );
 * }
 * ```
 */
export function useResolvedMode(mode: 'light' | 'dark' | 'system'): 'light' | 'dark' {
  const prefersDark = usePrefersDarkMode();

  if (mode === 'system') {
    return prefersDark ? 'dark' : 'light';
  }

  return mode;
}
