/**
 * Styled ToggleGroup Component
 *
 * Group of toggle buttons with single or multiple selection.
 * Built on top of the ToggleGroup primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  ToggleGroup as ToggleGroupPrimitive,
  ToggleGroupItem as ToggleGroupItemPrimitive,
  type ToggleGroupProps as ToggleGroupPrimitiveProps,
} from '../../primitives/ToggleGroup.js';

/**
 * ToggleGroup - Root component
 */
export const ToggleGroup = styled<{
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'outline';
}>(ToggleGroupPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
  },
  variants: {
    size: {
      sm: {},
      md: {},
      lg: {},
    },
    variant: {
      default: {},
      outline: {
        backgroundColor: '#f3f4f6',
        padding: '0.25rem',
        borderRadius: '0.5rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
    variant: 'default',
  },
});

/**
 * ToggleGroupItem - Individual toggle item
 */
export const ToggleGroupItem = styled<{
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'outline';
}>(ToggleGroupItemPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0.375rem',
    fontWeight: '500',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#111827',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    '&:hover:not([data-state="on"]):not([data-disabled])': {
      backgroundColor: '#f3f4f6',
    },
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 2px #3b82f6',
    },
    '&[data-state="on"]': {
      backgroundColor: '#eff6ff',
      color: '#1e40af',
    },
    '&[data-disabled]': {
      opacity: '0.5',
      pointerEvents: 'none',
    },
  },
  variants: {
    size: {
      sm: {
        height: '2rem',
        padding: '0 0.5rem',
        fontSize: '0.8125rem',
      },
      md: {
        height: '2.5rem',
        padding: '0 0.75rem',
        fontSize: '0.875rem',
      },
      lg: {
        height: '3rem',
        padding: '0 1rem',
        fontSize: '1rem',
      },
    },
    variant: {
      default: {},
      outline: {
        '&[data-state="on"]': {
          backgroundColor: '#ffffff',
          color: '#111827',
          boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        },
      },
    },
  },
  defaultVariants: {
    size: 'md',
    variant: 'default',
  },
});

// Attach sub-components
(ToggleGroup as any).Item = ToggleGroupItem;

// Display names
ToggleGroup.displayName = 'ToggleGroup';
ToggleGroupItem.displayName = 'ToggleGroupItem';

// Type exports
export type { ToggleGroupPrimitiveProps as ToggleGroupProps };
