/**
 * Styled Menubar Component
 *
 * Application menubar with nested menus.
 * Built on top of the Menubar primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Menubar as MenubarPrimitive,
  MenubarMenu as MenubarMenuPrimitive,
  MenubarTrigger as MenubarTriggerPrimitive,
  MenubarContent as MenubarContentPrimitive,
  MenubarItem as MenubarItemPrimitive,
  MenubarSeparator as MenubarSeparatorPrimitive,
  MenubarCheckboxItem as MenubarCheckboxItemPrimitive,
  MenubarRadioGroup as MenubarRadioGroupPrimitive,
  MenubarRadioItem as MenubarRadioItemPrimitive,
  type MenubarProps as MenubarPrimitiveProps,
} from '../../primitives/Menubar.js';

/**
 * Menubar - Root component
 */
export const Menubar = styled(MenubarPrimitive, {
  base: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
    padding: '0.25rem',
    backgroundColor: '#f9fafb',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
  },
});

/**
 * MenubarMenu - Individual menu
 */
export const MenubarMenu = MenubarMenuPrimitive;

/**
 * MenubarTrigger - Menu trigger button
 */
export const MenubarTrigger = styled(MenubarTriggerPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0.5rem 0.75rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    borderRadius: '0.25rem',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#111827',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    userSelect: 'none',
    '&:hover': {
      backgroundColor: '#f3f4f6',
    },
    '&:focus': {
      outline: 'none',
      backgroundColor: '#f3f4f6',
    },
    '&[data-state="open"]': {
      backgroundColor: '#ffffff',
    },
  },
});

/**
 * MenubarContent - Menu dropdown content
 */
export const MenubarContent = styled(MenubarContentPrimitive, {
  base: {
    backgroundColor: '#ffffff',
    borderRadius: '0.5rem',
    border: '1px solid #e5e7eb',
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    padding: '0.5rem',
    minWidth: '200px',
    zIndex: '50',
    animation: 'menubar-show 0.15s ease-out',
    '&[data-state="closed"]': {
      animation: 'menubar-hide 0.1s ease-in',
    },
  },
});

/**
 * MenubarItem - Menu item
 */
export const MenubarItem = styled<{
  variant?: 'default' | 'destructive';
}>(MenubarItemPrimitive, {
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
 * MenubarSeparator - Visual separator
 */
export const MenubarSeparator = styled(MenubarSeparatorPrimitive, {
  base: {
    height: '1px',
    backgroundColor: '#e5e7eb',
    margin: '0.5rem 0',
  },
});

/**
 * MenubarCheckboxItem - Checkbox menu item
 */
export const MenubarCheckboxItem = styled(MenubarCheckboxItemPrimitive, {
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
    '&[data-state="checked"]::before': {
      content: '"✓"',
      position: 'absolute',
      left: '0.75rem',
      color: '#3b82f6',
    },
  },
});

/**
 * MenubarRadioGroup - Radio group container
 */
export const MenubarRadioGroup = MenubarRadioGroupPrimitive;

/**
 * MenubarRadioItem - Radio menu item
 */
export const MenubarRadioItem = styled(MenubarRadioItemPrimitive, {
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
    '&[data-state="checked"]::before': {
      content: '"●"',
      position: 'absolute',
      left: '0.75rem',
      color: '#3b82f6',
    },
  },
});

// Attach sub-components
(Menubar as any).Menu = MenubarMenu;
(Menubar as any).Trigger = MenubarTrigger;
(Menubar as any).Content = MenubarContent;
(Menubar as any).Item = MenubarItem;
(Menubar as any).Separator = MenubarSeparator;
(Menubar as any).CheckboxItem = MenubarCheckboxItem;
(Menubar as any).RadioGroup = MenubarRadioGroup;
(Menubar as any).RadioItem = MenubarRadioItem;

// Display names
Menubar.displayName = 'Menubar';
MenubarTrigger.displayName = 'MenubarTrigger';
MenubarContent.displayName = 'MenubarContent';
MenubarItem.displayName = 'MenubarItem';
MenubarSeparator.displayName = 'MenubarSeparator';
MenubarCheckboxItem.displayName = 'MenubarCheckboxItem';
MenubarRadioItem.displayName = 'MenubarRadioItem';

// Type exports
export type { MenubarPrimitiveProps as MenubarProps };
