/**
 * Space - Styled spacing component for inline elements
 *
 * A styled version of the Space primitive with built-in
 * size and alignment variants.
 */

import { styled } from '../../styling/styled.js';
import { Space as SpacePrimitive } from '../../primitives/Space.js';

/**
 * Styled Space component with spacing variants
 *
 * @example
 * ```tsx
 * // Horizontal spacing (default)
 * <Space size="md">
 *   <button>Button 1</button>
 *   <button>Button 2</button>
 * </Space>
 *
 * // Vertical spacing
 * <Space direction="vertical" size="lg">
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 * </Space>
 *
 * // Custom spacing with wrapping
 * <Space spacing={12} wrap>
 *   <Tag>Tag 1</Tag>
 *   <Tag>Tag 2</Tag>
 * </Space>
 * ```
 */
export const Space = styled(SpacePrimitive, {
  base: {
    display: 'inline-flex',
    boxSizing: 'border-box',
  },
  variants: {
    size: {
      xs: { gap: '0.25rem' },
      sm: { gap: '0.5rem' },
      md: { gap: '1rem' },
      lg: { gap: '1.5rem' },
      xl: { gap: '2rem' },
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
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

export type { SpaceProps } from '../../primitives/Space.js';
