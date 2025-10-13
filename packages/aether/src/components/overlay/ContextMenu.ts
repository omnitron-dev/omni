/**
 * Styled ContextMenu Component
 *
 * Right-click context menu.
 * Built on top of the ContextMenu primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  ContextMenu as ContextMenuPrimitive,
  ContextMenuTrigger as ContextMenuTriggerPrimitive,
  ContextMenuContent as ContextMenuContentPrimitive,
  ContextMenuItem as ContextMenuItemPrimitive,
  ContextMenuSeparator as ContextMenuSeparatorPrimitive,
  ContextMenuLabel as ContextMenuLabelPrimitive,
  type ContextMenuProps as ContextMenuPrimitiveProps,
} from '../../primitives/ContextMenu.js';

/**
 * ContextMenu - Root component
 */
export const ContextMenu = ContextMenuPrimitive;

/**
 * ContextMenuTrigger - Trigger area
 */
export const ContextMenuTrigger = ContextMenuTriggerPrimitive;

/**
 * ContextMenuContent - Content container
 */
export const ContextMenuContent = styled<{
  size?: 'sm' | 'md' | 'lg';
}>(ContextMenuContentPrimitive, {
  base: {
    backgroundColor: '#ffffff',
    borderRadius: '0.5rem',
    border: '1px solid #e5e7eb',
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    padding: '0.5rem',
    minWidth: '200px',
    zIndex: '50',
    animation: 'contextmenu-show 0.15s ease-out',
    '&[data-state="closed"]': {
      animation: 'contextmenu-hide 0.1s ease-in',
    },
  },
  variants: {
    size: {
      sm: {
        minWidth: '150px',
        padding: '0.375rem',
      },
      md: {
        minWidth: '200px',
        padding: '0.5rem',
      },
      lg: {
        minWidth: '250px',
        padding: '0.625rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * ContextMenuItem - Menu item
 */
export const ContextMenuItem = styled<{
  variant?: 'default' | 'destructive';
}>(ContextMenuItemPrimitive, {
  base: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 0.75rem',
    fontSize: '0.875rem',
    lineHeight: '1.25',
    borderRadius: '0.375rem',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'all 0.1s ease',
    '&:hover': {
      backgroundColor: '#f3f4f6',
    },
    '&:focus': {
      outline: 'none',
      backgroundColor: '#f3f4f6',
    },
    '&[data-disabled]': {
      opacity: '0.5',
      pointerEvents: 'none',
    },
  },
  variants: {
    variant: {
      default: {
        color: '#111827',
      },
      destructive: {
        color: '#ef4444',
        '&:hover': {
          backgroundColor: '#fee2e2',
        },
      },
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

/**
 * ContextMenuSeparator - Visual separator
 */
export const ContextMenuSeparator = styled(ContextMenuSeparatorPrimitive, {
  base: {
    height: '1px',
    backgroundColor: '#e5e7eb',
    margin: '0.5rem 0',
  },
});

/**
 * ContextMenuLabel - Section label
 */
export const ContextMenuLabel = styled(ContextMenuLabelPrimitive, {
  base: {
    padding: '0.375rem 0.75rem',
    fontSize: '0.75rem',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
});

// Attach sub-components
(ContextMenu as any).Trigger = ContextMenuTrigger;
(ContextMenu as any).Content = ContextMenuContent;
(ContextMenu as any).Item = ContextMenuItem;
(ContextMenu as any).Separator = ContextMenuSeparator;
(ContextMenu as any).Label = ContextMenuLabel;

// Display names
ContextMenu.displayName = 'ContextMenu';
ContextMenuTrigger.displayName = 'ContextMenuTrigger';
ContextMenuContent.displayName = 'ContextMenuContent';
ContextMenuItem.displayName = 'ContextMenuItem';
ContextMenuSeparator.displayName = 'ContextMenuSeparator';
ContextMenuLabel.displayName = 'ContextMenuLabel';

// Type exports
export type { ContextMenuPrimitiveProps as ContextMenuProps };
