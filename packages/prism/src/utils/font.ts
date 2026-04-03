/**
 * Font Utilities
 *
 * Font family and unit conversion helpers.
 *
 * @module @omnitron-dev/prism/utils
 */

/**
 * Default system font stack.
 */
const DEFAULT_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"';

/**
 * Create a font family string with fallback stack.
 *
 * @param {string} [fontName] - Primary font name
 * @returns {string} Font family with fallbacks
 *
 * @example
 * ```ts
 * setFont('Inter'); // '"Inter", -apple-system, ...'
 * setFont();        // Default system font stack
 * ```
 */
export function setFont(fontName?: string): string {
  if (!fontName) {
    return DEFAULT_FONT_STACK;
  }

  return `"${fontName}", ${DEFAULT_FONT_STACK}`;
}

/**
 * Convert rem to pixels.
 *
 * @param {string | number} value - Rem value (number or string like '1rem')
 * @returns {number} Value in pixels
 *
 * @example
 * ```ts
 * remToPx(1);      // 16
 * remToPx('1rem'); // 16
 * remToPx(1.5);    // 24
 * ```
 */
export function remToPx(value: string | number): number {
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  return Math.round(numValue * 16 * 100) / 100;
}

/**
 * Convert pixels to rem.
 *
 * @param {string | number} value - Pixel value (number or string like '16px')
 * @returns {string} Value in rem with unit
 *
 * @example
 * ```ts
 * pxToRem(16);      // '1rem'
 * pxToRem('16px');  // '1rem'
 * pxToRem(24);      // '1.5rem'
 * ```
 */
export function pxToRem(value: string | number): string {
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  return `${Math.round((numValue / 16) * 10000) / 10000}rem`;
}

/**
 * Create responsive font size based on viewport.
 *
 * @param {number} minSize - Minimum font size in px
 * @param {number} maxSize - Maximum font size in px
 * @param {number} [minWidth=320] - Minimum viewport width in px
 * @param {number} [maxWidth=1200] - Maximum viewport width in px
 * @returns {string} CSS clamp() value
 *
 * @example
 * ```ts
 * responsiveFontSize(14, 18);
 * // 'clamp(0.875rem, 0.7955rem + 0.3977vw, 1.125rem)'
 * ```
 */
export function responsiveFontSize(minSize: number, maxSize: number, minWidth = 320, maxWidth = 1200): string {
  const minRem = pxToRem(minSize);
  const maxRem = pxToRem(maxSize);

  const slope = (maxSize - minSize) / (maxWidth - minWidth);
  const intercept = minSize - slope * minWidth;

  const slopeVw = Math.round(slope * 100 * 10000) / 10000;
  const interceptRem = pxToRem(intercept);

  return `clamp(${minRem}, ${interceptRem} + ${slopeVw}vw, ${maxRem})`;
}
