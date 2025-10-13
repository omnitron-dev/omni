/**
 * Styled Popover Component
 *
 * Non-modal floating content panel.
 * Built on top of the Popover primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Popover as PopoverPrimitive,
  PopoverTrigger as PopoverTriggerPrimitive,
  PopoverContent as PopoverContentPrimitive,
  PopoverArrow as PopoverArrowPrimitive,
  PopoverAnchor as PopoverAnchorPrimitive,
  PopoverClose as PopoverClosePrimitive,
  type PopoverProps as PopoverPrimitiveProps,
} from '../../primitives/Popover.js';

/**
 * Popover - Root component
 */
export const Popover = PopoverPrimitive;

/**
 * PopoverTrigger - Trigger button
 */
export const PopoverTrigger = PopoverTriggerPrimitive;

/**
 * PopoverAnchor - Position anchor
 */
export const PopoverAnchor = PopoverAnchorPrimitive;

/**
 * PopoverContent - Content container
 */
export const PopoverContent = styled<{
  size?: 'sm' | 'md' | 'lg';
}>(PopoverContentPrimitive, {
  base: {
    backgroundColor: '#ffffff',
    borderRadius: '0.5rem',
    border: '1px solid #e5e7eb',
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    padding: '1rem',
    zIndex: '50',
    animation: 'popover-show 0.15s ease-out',
    '&[data-state="closed"]': {
      animation: 'popover-hide 0.1s ease-in',
    },
    '&:focus': {
      outline: 'none',
    },
  },
  variants: {
    size: {
      sm: {
        width: '200px',
        padding: '0.75rem',
      },
      md: {
        width: '300px',
        padding: '1rem',
      },
      lg: {
        width: '400px',
        padding: '1.25rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * PopoverArrow - Arrow indicator
 */
export const PopoverArrow = styled(PopoverArrowPrimitive, {
  base: {
    fill: '#ffffff',
    stroke: '#e5e7eb',
    strokeWidth: '1px',
  },
});

/**
 * PopoverClose - Close button
 */
export const PopoverClose = styled(PopoverClosePrimitive, {
  base: {
    position: 'absolute',
    top: '0.5rem',
    right: '0.5rem',
    width: '1.5rem',
    height: '1.5rem',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0.25rem',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: '1rem',
    lineHeight: '1',
    transition: 'all 0.15s ease',
    '&:hover': {
      backgroundColor: '#f3f4f6',
      color: '#111827',
    },
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 2px #3b82f6',
    },
  },
});

// Attach sub-components
(Popover as any).Trigger = PopoverTrigger;
(Popover as any).Anchor = PopoverAnchor;
(Popover as any).Content = PopoverContent;
(Popover as any).Arrow = PopoverArrow;
(Popover as any).Close = PopoverClose;

// Display names
Popover.displayName = 'Popover';
PopoverTrigger.displayName = 'PopoverTrigger';
PopoverAnchor.displayName = 'PopoverAnchor';
PopoverContent.displayName = 'PopoverContent';
PopoverArrow.displayName = 'PopoverArrow';
PopoverClose.displayName = 'PopoverClose';

// Type exports
export type { PopoverPrimitiveProps as PopoverProps };
