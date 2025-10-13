/**
 * Flex - Styled flexbox layout container
 *
 * A styled version of the Flex primitive with built-in
 * gap, alignment, and direction variants.
 */

import { styled } from '../../styling/styled.js';
import { Flex as FlexPrimitive } from '../../primitives/Flex.js';

/**
 * Styled Flex component with layout variants
 *
 * @example
 * ```tsx
 * // Horizontal flex with gap
 * <Flex gap="md" align="center">
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 * </Flex>
 *
 * // Vertical flex with spacing
 * <Flex direction="column" gap="lg">
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 * </Flex>
 *
 * // Centered content
 * <Flex justify="center" align="center">
 *   <div>Centered</div>
 * </Flex>
 * ```
 */
export const Flex = styled(FlexPrimitive, {
  base: {
    display: 'flex',
    boxSizing: 'border-box',
  },
  variants: {
    gap: {
      none: { gap: '0' },
      xs: { gap: '0.25rem' },
      sm: { gap: '0.5rem' },
      md: { gap: '1rem' },
      lg: { gap: '1.5rem' },
      xl: { gap: '2rem' },
      '2xl': { gap: '3rem' },
    },
    padding: {
      none: { padding: '0' },
      xs: { padding: '0.25rem' },
      sm: { padding: '0.5rem' },
      md: { padding: '1rem' },
      lg: { padding: '1.5rem' },
      xl: { padding: '2rem' },
      '2xl': { padding: '3rem' },
    },
    wrap: {
      nowrap: { flexWrap: 'nowrap' },
      wrap: { flexWrap: 'wrap' },
      'wrap-reverse': { flexWrap: 'wrap-reverse' },
    },
    bg: {
      transparent: { backgroundColor: 'transparent' },
      white: { backgroundColor: '#ffffff' },
      gray: { backgroundColor: '#f3f4f6' },
      primary: { backgroundColor: '#3b82f6' },
    },
    rounded: {
      none: { borderRadius: '0' },
      sm: { borderRadius: '0.125rem' },
      md: { borderRadius: '0.375rem' },
      lg: { borderRadius: '0.5rem' },
      xl: { borderRadius: '0.75rem' },
      full: { borderRadius: '9999px' },
    },
  },
});

export type { FlexProps } from '../../primitives/Flex.js';
