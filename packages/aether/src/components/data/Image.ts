/**
 * Image Component (Styled)
 *
 * A styled image component with advanced features:
 * - Lazy loading support
 * - Placeholder and fallback states
 * - Object fit variants
 * - Border radius options
 * - Aspect ratio support
 */

import { styled } from '../../styling/styled.js';
import { Image as ImagePrimitive, type ImageProps as ImagePrimitiveProps } from '../../primitives/Image.js';

// ============================================================================
// Styled Component
// ============================================================================

/**
 * Image - Styled image component
 */
export const Image = styled<
  {
    fit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
    rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
    bordered?: boolean;
  },
  ImagePrimitiveProps
>(ImagePrimitive, {
  base: {
    display: 'block',
    maxWidth: '100%',
    height: 'auto',
  },
  variants: {
    fit: {
      contain: {
        objectFit: 'contain',
      },
      cover: {
        objectFit: 'cover',
      },
      fill: {
        objectFit: 'fill',
      },
      none: {
        objectFit: 'none',
      },
      'scale-down': {
        objectFit: 'scale-down',
      },
    },
    rounded: {
      none: {
        borderRadius: '0',
      },
      sm: {
        borderRadius: '0.125rem',
      },
      md: {
        borderRadius: '0.375rem',
      },
      lg: {
        borderRadius: '0.5rem',
      },
      full: {
        borderRadius: '9999px',
      },
    },
    bordered: {
      true: {
        border: '1px solid #e5e7eb',
      },
      false: {},
    },
  },
  defaultVariants: {
    fit: 'cover',
    rounded: 'none',
    bordered: false,
  },
});

// ============================================================================
// Display name
// ============================================================================

Image.displayName = 'Image';

// ============================================================================
// Type exports
// ============================================================================

export type { ImagePrimitiveProps as ImageProps };
