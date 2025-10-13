/**
 * Styled HoverCard Component
 *
 * Hover-triggered card with rich content.
 * Built on top of the HoverCard primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  HoverCard as HoverCardPrimitive,
  HoverCardTrigger as HoverCardTriggerPrimitive,
  HoverCardContent as HoverCardContentPrimitive,
  HoverCardArrow as HoverCardArrowPrimitive,
  type HoverCardProps as HoverCardPrimitiveProps,
} from '../../primitives/HoverCard.js';

/**
 * HoverCard - Root component
 */
export const HoverCard = HoverCardPrimitive;

/**
 * HoverCardTrigger - Trigger element
 */
export const HoverCardTrigger = HoverCardTriggerPrimitive;

/**
 * HoverCardContent - Content container
 */
export const HoverCardContent = styled<{
  size?: 'sm' | 'md' | 'lg';
}>(HoverCardContentPrimitive, {
  base: {
    backgroundColor: '#ffffff',
    borderRadius: '0.5rem',
    border: '1px solid #e5e7eb',
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    padding: '1rem',
    zIndex: '50',
    animation: 'hovercard-show 0.2s ease-out',
    '&[data-state="closed"]': {
      animation: 'hovercard-hide 0.15s ease-in',
    },
    '&:focus': {
      outline: 'none',
    },
  },
  variants: {
    size: {
      sm: {
        width: '250px',
        padding: '0.75rem',
      },
      md: {
        width: '350px',
        padding: '1rem',
      },
      lg: {
        width: '450px',
        padding: '1.25rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * HoverCardArrow - Arrow indicator
 */
export const HoverCardArrow = styled(HoverCardArrowPrimitive, {
  base: {
    fill: '#ffffff',
    stroke: '#e5e7eb',
    strokeWidth: '1px',
  },
});

// Attach sub-components
(HoverCard as any).Trigger = HoverCardTrigger;
(HoverCard as any).Content = HoverCardContent;
(HoverCard as any).Arrow = HoverCardArrow;

// Display names
HoverCard.displayName = 'HoverCard';
HoverCardTrigger.displayName = 'HoverCardTrigger';
HoverCardContent.displayName = 'HoverCardContent';
HoverCardArrow.displayName = 'HoverCardArrow';

// Type exports
export type { HoverCardPrimitiveProps as HoverCardProps };
