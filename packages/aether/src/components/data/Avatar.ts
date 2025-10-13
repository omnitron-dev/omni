/**
 * Avatar Component (Styled)
 *
 * A styled avatar component for displaying user profile images:
 * - Multiple size variants
 * - Shape options (circle, square, rounded)
 * - Image with fallback support
 * - Ring/border variants
 */

import { styled } from '../../styling/styled.js';
import {
  Avatar as AvatarPrimitive,
  AvatarImage as AvatarImagePrimitive,
  AvatarFallback as AvatarFallbackPrimitive,
  type AvatarProps as AvatarPrimitiveProps,
  type AvatarImageProps,
  type AvatarFallbackProps,
} from '../../primitives/Avatar.js';

// ============================================================================
// Styled Components
// ============================================================================

/**
 * Avatar Root - Styled avatar container
 */
export const Avatar = styled<AvatarPrimitiveProps>(AvatarPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
    color: '#374151',
    fontWeight: '500',
    flexShrink: '0',
  },
  variants: {
    size: {
      xs: {
        width: '1.5rem',
        height: '1.5rem',
        fontSize: '0.625rem',
      },
      sm: {
        width: '2rem',
        height: '2rem',
        fontSize: '0.75rem',
      },
      md: {
        width: '2.5rem',
        height: '2.5rem',
        fontSize: '0.875rem',
      },
      lg: {
        width: '3rem',
        height: '3rem',
        fontSize: '1rem',
      },
      xl: {
        width: '4rem',
        height: '4rem',
        fontSize: '1.25rem',
      },
      '2xl': {
        width: '5rem',
        height: '5rem',
        fontSize: '1.5rem',
      },
    },
    shape: {
      circle: {
        borderRadius: '9999px',
      },
      square: {
        borderRadius: '0',
      },
      rounded: {
        borderRadius: '0.375rem',
      },
    },
    ring: {
      true: {
        boxShadow: '0 0 0 2px #ffffff, 0 0 0 4px #3b82f6',
      },
      false: {},
    },
  },
  defaultVariants: {
    size: 'md',
    shape: 'circle',
    ring: 'false',
  },
});

/**
 * Avatar Image - Styled avatar image
 */
export const AvatarImage = styled(AvatarImagePrimitive, {
  base: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
});

/**
 * Avatar Fallback - Styled avatar fallback
 */
export const AvatarFallback = styled(AvatarFallbackPrimitive, {
  base: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    backgroundColor: '#e5e7eb',
    color: '#374151',
    fontWeight: '500',
    textTransform: 'uppercase',
  },
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Avatar as any).Image = AvatarImage;
(Avatar as any).Fallback = AvatarFallback;

// ============================================================================
// Display names
// ============================================================================

Avatar.displayName = 'Avatar';
AvatarImage.displayName = 'Avatar.Image';
AvatarFallback.displayName = 'Avatar.Fallback';

// ============================================================================
// Type exports
// ============================================================================

export type { AvatarPrimitiveProps as AvatarProps, AvatarImageProps, AvatarFallbackProps };
