/**
 * AspectRatio - Styled aspect ratio container
 *
 * A styled version of the AspectRatio primitive with built-in
 * border and background variants.
 */

import { styled } from '../../styling/styled.js';
import { AspectRatio as AspectRatioPrimitive } from '../../primitives/AspectRatio.js';

/**
 * Styled AspectRatio component with visual variants
 *
 * @example
 * ```tsx
 * // 16:9 video with rounded corners
 * <AspectRatio ratio={16/9} rounded="md">
 *   <video src="/video.mp4" />
 * </AspectRatio>
 *
 * // Square image with shadow
 * <AspectRatio ratio={1} shadow="md" rounded="lg">
 *   <img src="/image.jpg" alt="..." />
 * </AspectRatio>
 *
 * // 4:3 standard with background
 * <AspectRatio ratio={4/3} bg="gray">
 *   <iframe src="..." />
 * </AspectRatio>
 * ```
 */
export const AspectRatio = styled(AspectRatioPrimitive, {
  base: {
    position: 'relative',
    width: '100%',
    boxSizing: 'border-box',
  },
  variants: {
    bg: {
      transparent: { backgroundColor: 'transparent' },
      white: { backgroundColor: '#ffffff' },
      gray: { backgroundColor: '#f3f4f6' },
      black: { backgroundColor: '#000000' },
    },
    rounded: {
      none: { borderRadius: '0' },
      sm: { borderRadius: '0.125rem' },
      md: { borderRadius: '0.375rem' },
      lg: { borderRadius: '0.5rem' },
      xl: { borderRadius: '0.75rem' },
      '2xl': { borderRadius: '1rem' },
    },
    shadow: {
      none: { boxShadow: 'none' },
      sm: { boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)' },
      md: { boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)' },
      lg: { boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)' },
    },
    border: {
      none: { border: 'none' },
      default: { border: '1px solid #e5e7eb' },
      thick: { border: '2px solid #e5e7eb' },
    },
  },
});

export type { AspectRatioProps } from '../../primitives/AspectRatio.js';
