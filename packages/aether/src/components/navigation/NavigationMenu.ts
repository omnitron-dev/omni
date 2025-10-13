/**
 * Styled NavigationMenu Component
 *
 * Complex navigation menu with submenus.
 * Built on top of the NavigationMenu primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  NavigationMenu as NavigationMenuPrimitive,
  NavigationMenuList as NavigationMenuListPrimitive,
  NavigationMenuItem as NavigationMenuItemPrimitive,
  NavigationMenuTrigger as NavigationMenuTriggerPrimitive,
  NavigationMenuContent as NavigationMenuContentPrimitive,
  NavigationMenuLink as NavigationMenuLinkPrimitive,
  type NavigationMenuProps as NavigationMenuPrimitiveProps,
} from '../../primitives/NavigationMenu.js';

/**
 * NavigationMenu - Root component
 */
export const NavigationMenu = NavigationMenuPrimitive;

/**
 * NavigationMenuList - List container
 */
export const NavigationMenuList = styled(NavigationMenuListPrimitive, {
  base: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    listStyle: 'none',
    margin: '0',
    padding: '0',
  },
});

/**
 * NavigationMenuItem - Individual menu item
 */
export const NavigationMenuItem = styled(NavigationMenuItemPrimitive, {
  base: {
    position: 'relative',
  },
});

/**
 * NavigationMenuTrigger - Trigger button for submenus
 */
export const NavigationMenuTrigger = styled<{
  size?: 'sm' | 'md' | 'lg';
}>(NavigationMenuTriggerPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.375rem',
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    borderRadius: '0.375rem',
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
      backgroundColor: '#eff6ff',
      color: '#1e40af',
    },
  },
  variants: {
    size: {
      sm: {
        padding: '0.375rem 0.75rem',
        fontSize: '0.8125rem',
      },
      md: {
        padding: '0.5rem 1rem',
        fontSize: '0.875rem',
      },
      lg: {
        padding: '0.625rem 1.25rem',
        fontSize: '1rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * NavigationMenuContent - Content dropdown
 */
export const NavigationMenuContent = styled(NavigationMenuContentPrimitive, {
  base: {
    position: 'absolute',
    top: '100%',
    left: '0',
    marginTop: '0.5rem',
    minWidth: '200px',
    backgroundColor: '#ffffff',
    borderRadius: '0.5rem',
    border: '1px solid #e5e7eb',
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
    padding: '0.5rem',
    zIndex: '50',
    animation: 'navigationmenu-show 0.15s ease-out',
    '&[data-state="closed"]': {
      animation: 'navigationmenu-hide 0.1s ease-in',
    },
  },
});

/**
 * NavigationMenuLink - Navigation link
 */
export const NavigationMenuLink = styled<{
  size?: 'sm' | 'md' | 'lg';
}>(NavigationMenuLinkPrimitive, {
  base: {
    display: 'block',
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: '400',
    borderRadius: '0.375rem',
    color: '#111827',
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    '&:hover': {
      backgroundColor: '#f3f4f6',
    },
    '&:focus': {
      outline: 'none',
      backgroundColor: '#f3f4f6',
    },
    '&[data-active]': {
      backgroundColor: '#eff6ff',
      color: '#1e40af',
      fontWeight: '500',
    },
  },
  variants: {
    size: {
      sm: {
        padding: '0.375rem 0.75rem',
        fontSize: '0.8125rem',
      },
      md: {
        padding: '0.5rem 1rem',
        fontSize: '0.875rem',
      },
      lg: {
        padding: '0.625rem 1.25rem',
        fontSize: '1rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

// Attach sub-components
(NavigationMenu as any).List = NavigationMenuList;
(NavigationMenu as any).Item = NavigationMenuItem;
(NavigationMenu as any).Trigger = NavigationMenuTrigger;
(NavigationMenu as any).Content = NavigationMenuContent;
(NavigationMenu as any).Link = NavigationMenuLink;

// Display names
NavigationMenu.displayName = 'NavigationMenu';
NavigationMenuList.displayName = 'NavigationMenuList';
NavigationMenuItem.displayName = 'NavigationMenuItem';
NavigationMenuTrigger.displayName = 'NavigationMenuTrigger';
NavigationMenuContent.displayName = 'NavigationMenuContent';
NavigationMenuLink.displayName = 'NavigationMenuLink';

// Type exports
export type { NavigationMenuPrimitiveProps as NavigationMenuProps };
