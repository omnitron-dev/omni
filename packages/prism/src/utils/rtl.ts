/**
 * RTL (Right-to-Left) Utilities
 *
 * Helpers for RTL layout support and CSS transformation control.
 *
 * @module @omnitron-dev/prism/utils
 */

/**
 * Prevents automatic RTL (right-to-left) flipping of a CSS declaration.
 *
 * Many CSS-in-JS libraries and RTL plugins automatically flip directional
 * CSS properties (like margin-left → margin-right) for RTL layouts.
 * Use this function to prevent that behavior for specific declarations.
 *
 * Appends the `\/* @noflip *\/` comment which is recognized by:
 * - stylis (used by Emotion/styled-components)
 * - rtlcss
 * - cssjanus
 *
 * @param cssValue - A CSS declaration string (e.g., "margin-left: 10px")
 * @returns The same declaration with `\/* @noflip *\/` appended
 *
 * @example
 * ```tsx
 * import { noRtlFlip } from '@omnitron-dev/prism/utils';
 *
 * // In sx prop or styled components
 * const styles = {
 *   // This margin-left will stay as margin-left even in RTL
 *   marginLeft: noRtlFlip('10px'),
 *
 *   // Or for full declarations
 *   transform: noRtlFlip('translateX(100px)'),
 * };
 *
 * // Common use case: icons that shouldn't flip
 * <ChevronIcon sx={{ transform: noRtlFlip('rotate(0deg)') }} />
 *
 * // Progress indicators that fill from left regardless of RTL
 * <ProgressBar sx={{ left: noRtlFlip('0'), right: 'auto' }} />
 * ```
 */
export function noRtlFlip(cssValue: unknown): string {
  if (typeof cssValue !== 'string') {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[noRtlFlip] Invalid CSS value provided:', cssValue);
    }
    return '';
  }

  const trimmed = cssValue.trim();

  if (!trimmed) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[noRtlFlip] Empty CSS value provided');
    }
    return '';
  }

  // Already has the noflip comment
  if (trimmed.includes('/* @noflip */')) {
    return trimmed;
  }

  return `${trimmed} /* @noflip */`;
}

/**
 * Check if the current document direction is RTL.
 *
 * @returns True if the document direction is RTL
 *
 * @example
 * ```tsx
 * const isRtl = isRtlDirection();
 *
 * // Conditional styling
 * const style = {
 *   marginLeft: isRtl ? '0' : '10px',
 *   marginRight: isRtl ? '10px' : '0',
 * };
 * ```
 */
export function isRtlDirection(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  return (
    document.documentElement.dir === 'rtl' ||
    document.body.dir === 'rtl' ||
    document.documentElement.getAttribute('dir') === 'rtl'
  );
}

/**
 * Get the appropriate directional property name based on RTL state.
 *
 * @param property - Base property name (e.g., 'left', 'marginLeft')
 * @param isRtl - Whether the layout is RTL
 * @returns The appropriate property name
 *
 * @example
 * ```tsx
 * const prop = getDirectionalProperty('left', isRtl);
 * // Returns 'right' if isRtl, 'left' otherwise
 * ```
 */
export function getDirectionalProperty(
  property: 'left' | 'right' | 'marginLeft' | 'marginRight' | 'paddingLeft' | 'paddingRight',
  isRtl: boolean
): string {
  const mappings: Record<string, string> = {
    left: isRtl ? 'right' : 'left',
    right: isRtl ? 'left' : 'right',
    marginLeft: isRtl ? 'marginRight' : 'marginLeft',
    marginRight: isRtl ? 'marginLeft' : 'marginRight',
    paddingLeft: isRtl ? 'paddingRight' : 'paddingLeft',
    paddingRight: isRtl ? 'paddingLeft' : 'paddingRight',
  };

  return mappings[property] ?? property;
}
