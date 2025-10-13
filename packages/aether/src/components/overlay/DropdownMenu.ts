/**
 * Styled DropdownMenu Component
 *
 * Dropdown action menu with items and submenus.
 * Built on top of the DropdownMenu primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  DropdownMenu as DropdownMenuPrimitive,
  DropdownMenuTrigger as DropdownMenuTriggerPrimitive,
  DropdownMenuContent as DropdownMenuContentPrimitive,
  DropdownMenuItem as DropdownMenuItemPrimitive,
  DropdownMenuSeparator as DropdownMenuSeparatorPrimitive,
  DropdownMenuLabel as DropdownMenuLabelPrimitive,
  DropdownMenuCheckboxItem as DropdownMenuCheckboxItemPrimitive,
  DropdownMenuRadioGroup as DropdownMenuRadioGroupPrimitive,
  DropdownMenuRadioItem as DropdownMenuRadioItemPrimitive,
  type DropdownMenuProps as DropdownMenuPrimitiveProps,
} from '../../primitives/DropdownMenu.js';

/**
 * DropdownMenu - Root component
 */
export const DropdownMenu = DropdownMenuPrimitive;

/**
 * DropdownMenuTrigger - Trigger button
 */
export const DropdownMenuTrigger = DropdownMenuTriggerPrimitive;

/**
 * DropdownMenuContent - Content container
 */
export const DropdownMenuContent = styled<{
  size?: 'sm' | 'md' | 'lg';
}>(DropdownMenuContentPrimitive, {
  base: {
    backgroundColor: '#ffffff',
    borderRadius: '0.5rem',
    border: '1px solid #e5e7eb',
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    padding: '0.5rem',
    minWidth: '200px',
    zIndex: '50',
    animation: 'dropdown-show 0.15s ease-out',
    '&[data-state="closed"]': {
      animation: 'dropdown-hide 0.1s ease-in',
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
 * DropdownMenuItem - Menu item
 */
export const DropdownMenuItem = styled<{
  variant?: 'default' | 'destructive';
}>(DropdownMenuItemPrimitive, {
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
 * DropdownMenuSeparator - Visual separator
 */
export const DropdownMenuSeparator = styled(DropdownMenuSeparatorPrimitive, {
  base: {
    height: '1px',
    backgroundColor: '#e5e7eb',
    margin: '0.5rem 0',
  },
});

/**
 * DropdownMenuLabel - Section label
 */
export const DropdownMenuLabel = styled(DropdownMenuLabelPrimitive, {
  base: {
    padding: '0.375rem 0.75rem',
    fontSize: '0.75rem',
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
});

/**
 * DropdownMenuCheckboxItem - Checkbox menu item
 */
export const DropdownMenuCheckboxItem = styled(DropdownMenuCheckboxItemPrimitive, {
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
    position: 'relative',
    paddingLeft: '2rem',
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
    '&[data-state="checked"]::before': {
      content: '"✓"',
      position: 'absolute',
      left: '0.75rem',
      color: '#3b82f6',
    },
  },
});

/**
 * DropdownMenuRadioGroup - Radio group container
 */
export const DropdownMenuRadioGroup = DropdownMenuRadioGroupPrimitive;

/**
 * DropdownMenuRadioItem - Radio menu item
 */
export const DropdownMenuRadioItem = styled(DropdownMenuRadioItemPrimitive, {
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
    position: 'relative',
    paddingLeft: '2rem',
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
    '&[data-state="checked"]::before': {
      content: '"●"',
      position: 'absolute',
      left: '0.75rem',
      color: '#3b82f6',
    },
  },
});

// Attach sub-components
(DropdownMenu as any).Trigger = DropdownMenuTrigger;
(DropdownMenu as any).Content = DropdownMenuContent;
(DropdownMenu as any).Item = DropdownMenuItem;
(DropdownMenu as any).Separator = DropdownMenuSeparator;
(DropdownMenu as any).Label = DropdownMenuLabel;
(DropdownMenu as any).CheckboxItem = DropdownMenuCheckboxItem;
(DropdownMenu as any).RadioGroup = DropdownMenuRadioGroup;
(DropdownMenu as any).RadioItem = DropdownMenuRadioItem;

// Display names
DropdownMenu.displayName = 'DropdownMenu';
DropdownMenuTrigger.displayName = 'DropdownMenuTrigger';
DropdownMenuContent.displayName = 'DropdownMenuContent';
DropdownMenuItem.displayName = 'DropdownMenuItem';
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';
DropdownMenuLabel.displayName = 'DropdownMenuLabel';
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';
DropdownMenuRadioGroup.displayName = 'DropdownMenuRadioGroup';
DropdownMenuRadioItem.displayName = 'DropdownMenuRadioItem';

// Type exports
export type { DropdownMenuPrimitiveProps as DropdownMenuProps };
