/**
 * Styled Toolbar Component
 *
 * Toolbar for action buttons and controls.
 * Built on top of the Toolbar primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Toolbar as ToolbarPrimitive,
  ToolbarButton as ToolbarButtonPrimitive,
  ToolbarSeparator as ToolbarSeparatorPrimitive,
  ToolbarToggleGroup as ToolbarToggleGroupPrimitive,
  ToolbarToggleItem as ToolbarToggleItemPrimitive,
  type ToolbarProps as ToolbarPrimitiveProps,
} from '../../primitives/Toolbar.js';

/**
 * Toolbar - Root component
 */
export const Toolbar = styled<{
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'outline';
}>(ToolbarPrimitive, {
  base: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem',
  },
  variants: {
    size: {
      sm: {
        gap: '0.375rem',
        padding: '0.375rem',
      },
      md: {
        gap: '0.5rem',
        padding: '0.5rem',
      },
      lg: {
        gap: '0.625rem',
        padding: '0.625rem',
      },
    },
    variant: {
      default: {
        backgroundColor: '#f9fafb',
        borderRadius: '0.375rem',
      },
      outline: {
        border: '1px solid #e5e7eb',
        borderRadius: '0.375rem',
        backgroundColor: '#ffffff',
      },
    },
  },
  defaultVariants: {
    size: 'md',
    variant: 'default',
  },
});

/**
 * ToolbarButton - Toolbar button
 */
export const ToolbarButton = styled<{
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'ghost';
}>(ToolbarButtonPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0.25rem',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#111827',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    '&:hover': {
      backgroundColor: '#f3f4f6',
    },
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 2px #3b82f6',
    },
    '&[data-disabled]': {
      opacity: '0.5',
      pointerEvents: 'none',
    },
  },
  variants: {
    size: {
      sm: {
        width: '2rem',
        height: '2rem',
        fontSize: '0.875rem',
      },
      md: {
        width: '2.5rem',
        height: '2.5rem',
        fontSize: '1rem',
      },
      lg: {
        width: '3rem',
        height: '3rem',
        fontSize: '1.125rem',
      },
    },
    variant: {
      default: {},
      ghost: {
        backgroundColor: 'transparent',
        '&:hover': {
          backgroundColor: 'rgba(0, 0, 0, 0.05)',
        },
      },
    },
  },
  defaultVariants: {
    size: 'md',
    variant: 'default',
  },
});

/**
 * ToolbarSeparator - Visual separator
 */
export const ToolbarSeparator = styled(ToolbarSeparatorPrimitive, {
  base: {
    width: '1px',
    backgroundColor: '#e5e7eb',
    alignSelf: 'stretch',
    margin: '0 0.25rem',
  },
});

/**
 * ToolbarToggleGroup - Toggle group container
 */
export const ToolbarToggleGroup = ToolbarToggleGroupPrimitive;

/**
 * ToolbarToggleItem - Toggle button
 */
export const ToolbarToggleItem = styled<{
  size?: 'sm' | 'md' | 'lg';
}>(ToolbarToggleItemPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0.25rem',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#111827',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    '&:hover': {
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
        width: '2rem',
        height: '2rem',
        fontSize: '0.875rem',
      },
      md: {
        width: '2.5rem',
        height: '2.5rem',
        fontSize: '1rem',
      },
      lg: {
        width: '3rem',
        height: '3rem',
        fontSize: '1.125rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

// Attach sub-components
(Toolbar as any).Button = ToolbarButton;
(Toolbar as any).Separator = ToolbarSeparator;
(Toolbar as any).ToggleGroup = ToolbarToggleGroup;
(Toolbar as any).ToggleItem = ToolbarToggleItem;

// Display names
Toolbar.displayName = 'Toolbar';
ToolbarButton.displayName = 'ToolbarButton';
ToolbarSeparator.displayName = 'ToolbarSeparator';
ToolbarToggleGroup.displayName = 'ToolbarToggleGroup';
ToolbarToggleItem.displayName = 'ToolbarToggleItem';

// Type exports
export type { ToolbarPrimitiveProps as ToolbarProps };
