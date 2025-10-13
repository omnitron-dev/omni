/**
 * Card Component (Styled)
 *
 * A styled card component for grouping related content:
 * - Multiple visual variants (elevated, outline, filled)
 * - Flexible padding options
 * - Hover states and animations
 * - Interactive card support
 */

import { styled } from '../../styling/styled.js';
import {
  Card as CardPrimitive,
  CardHeader as CardHeaderPrimitive,
  CardTitle as CardTitlePrimitive,
  CardDescription as CardDescriptionPrimitive,
  CardContent as CardContentPrimitive,
  CardFooter as CardFooterPrimitive,
  type CardProps as CardPrimitiveProps,
  type CardHeaderProps,
  type CardTitleProps,
  type CardDescriptionProps,
  type CardContentProps,
  type CardFooterProps,
} from '../../primitives/Card.js';

// ============================================================================
// Styled Components
// ============================================================================

/**
 * Card Root - Styled card container
 */
export const Card = styled<CardPrimitiveProps>(CardPrimitive, {
  base: {
    backgroundColor: '#ffffff',
    borderRadius: '0.5rem',
    overflow: 'hidden',
    transition: 'all 0.2s ease',
  },
  variants: {
    padding: {
      none: {
        padding: '0',
      },
      sm: {
        padding: '1rem',
      },
      md: {
        padding: '1.5rem',
      },
      lg: {
        padding: '2rem',
      },
    },
    variant: {
      elevated: {
        boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
      },
      outline: {
        border: '1px solid #e5e7eb',
        boxShadow: 'none',
      },
      filled: {
        backgroundColor: '#f9fafb',
        boxShadow: 'none',
      },
      unstyled: {
        boxShadow: 'none',
        backgroundColor: 'transparent',
      },
    },
    hoverable: {
      true: {
        cursor: 'pointer',
      },
      false: {},
    },
  },
  compoundVariants: [
    {
      variant: 'elevated',
      hoverable: true,
      css: {
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
      },
    },
    {
      variant: 'outline',
      hoverable: true,
      css: {
        borderColor: '#d1d5db',
      },
    },
  ],
  defaultVariants: {
    padding: 'md',
    variant: 'elevated',
    hoverable: 'false',
  },
});

/**
 * Card Header - Styled card header section
 */
export const CardHeader = styled<CardHeaderProps>(CardHeaderPrimitive, {
  base: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
  },
  variants: {
    padding: {
      none: {
        padding: '0',
      },
      sm: {
        padding: '1rem',
      },
      md: {
        padding: '1.5rem',
      },
      lg: {
        padding: '2rem',
      },
    },
  },
  defaultVariants: {
    padding: 'md',
  },
});

/**
 * Card Title - Styled card title
 */
export const CardTitle = styled<CardTitleProps>(CardTitlePrimitive, {
  base: {
    fontWeight: '600',
    color: '#111827',
    lineHeight: '1.25',
  },
  variants: {
    size: {
      sm: {
        fontSize: '1rem',
      },
      md: {
        fontSize: '1.125rem',
      },
      lg: {
        fontSize: '1.25rem',
      },
      xl: {
        fontSize: '1.5rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * Card Description - Styled card description
 */
export const CardDescription = styled<CardDescriptionProps>(CardDescriptionPrimitive, {
  base: {
    color: '#6b7280',
    lineHeight: '1.5',
    marginTop: '0.25rem',
  },
  variants: {
    size: {
      sm: {
        fontSize: '0.75rem',
      },
      md: {
        fontSize: '0.875rem',
      },
      lg: {
        fontSize: '1rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * Card Content - Styled card content section
 */
export const CardContent = styled<CardContentProps>(CardContentPrimitive, {
  base: {},
  variants: {
    padding: {
      none: {
        padding: '0',
      },
      sm: {
        padding: '1rem',
      },
      md: {
        padding: '1.5rem',
      },
      lg: {
        padding: '2rem',
      },
    },
  },
  defaultVariants: {
    padding: 'md',
  },
});

/**
 * Card Footer - Styled card footer section
 */
export const CardFooter = styled<CardFooterProps>(CardFooterPrimitive, {
  base: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  variants: {
    padding: {
      none: {
        padding: '0',
      },
      sm: {
        padding: '1rem',
      },
      md: {
        padding: '1.5rem',
      },
      lg: {
        padding: '2rem',
      },
    },
    align: {
      left: {
        justifyContent: 'flex-start',
      },
      center: {
        justifyContent: 'center',
      },
      right: {
        justifyContent: 'flex-end',
      },
      between: {
        justifyContent: 'space-between',
      },
    },
  },
  defaultVariants: {
    padding: 'md',
    align: 'left',
  },
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Card as any).Header = CardHeader;
(Card as any).Title = CardTitle;
(Card as any).Description = CardDescription;
(Card as any).Content = CardContent;
(Card as any).Footer = CardFooter;

// ============================================================================
// Display names
// ============================================================================

Card.displayName = 'Card';
CardHeader.displayName = 'Card.Header';
CardTitle.displayName = 'Card.Title';
CardDescription.displayName = 'Card.Description';
CardContent.displayName = 'Card.Content';
CardFooter.displayName = 'Card.Footer';

// ============================================================================
// Type exports
// ============================================================================

export type {
  CardPrimitiveProps as CardProps,
  CardHeaderProps,
  CardTitleProps,
  CardDescriptionProps,
  CardContentProps,
  CardFooterProps,
};
