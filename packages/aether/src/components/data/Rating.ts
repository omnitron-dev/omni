/**
 * Rating Component (Styled)
 *
 * A styled rating component for displaying and capturing user ratings:
 * - Multiple size variants
 * - Color schemes
 * - Read-only and interactive modes
 * - Half ratings support
 */

import { styled } from '../../styling/styled.js';
import {
  Rating as RatingPrimitive,
  RatingItem as RatingItemPrimitive,
  type RatingProps as RatingPrimitiveProps,
  type RatingItemProps,
} from '../../primitives/Rating.js';

// ============================================================================
// Styled Components
// ============================================================================

/**
 * Rating Root - Styled rating container
 * Type parameters omitted - TypeScript will infer from styleConfig
 */
export const Rating = styled(RatingPrimitive as any, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
  },
  variants: {
    size: {
      sm: {
        gap: '0.125rem',
      },
      md: {
        gap: '0.25rem',
      },
      lg: {
        gap: '0.375rem',
      },
      xl: {
        gap: '0.5rem',
      },
    },
    colorScheme: {
      yellow: {},
      red: {},
      orange: {},
      blue: {},
      green: {},
    },
  },
  defaultVariants: {
    size: 'md',
    colorScheme: 'yellow',
  },
});

/**
 * Rating Item - Styled rating item (star)
 * Type parameters omitted - TypeScript will infer from styleConfig
 */
export const RatingItem = styled(RatingItemPrimitive as any, {
  base: {
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    color: '#d1d5db',
  },
  variants: {
    size: {
      sm: {
        fontSize: '1rem',
        width: '1rem',
        height: '1rem',
      },
      md: {
        fontSize: '1.25rem',
        width: '1.25rem',
        height: '1.25rem',
      },
      lg: {
        fontSize: '1.5rem',
        width: '1.5rem',
        height: '1.5rem',
      },
      xl: {
        fontSize: '2rem',
        width: '2rem',
        height: '2rem',
      },
    },
    colorScheme: {
      yellow: {},
      red: {},
      orange: {},
      blue: {},
      green: {},
    },
  },
  defaultVariants: {
    size: 'md',
    colorScheme: 'yellow',
  },
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Rating as any).Item = RatingItem;

// ============================================================================
// Display names
// ============================================================================

Rating.displayName = 'Rating';
RatingItem.displayName = 'Rating.Item';

// ============================================================================
// Type exports
// ============================================================================

export type { RatingPrimitiveProps as RatingProps, RatingItemProps };
