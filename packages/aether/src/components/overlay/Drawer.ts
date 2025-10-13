/**
 * Styled Drawer Component
 *
 * Slide-out panel from screen edges.
 * Built on top of the Drawer primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Drawer as DrawerPrimitive,
  DrawerTrigger as DrawerTriggerPrimitive,
  DrawerPortal as DrawerPortalPrimitive,
  DrawerOverlay as DrawerOverlayPrimitive,
  DrawerContent as DrawerContentPrimitive,
  DrawerTitle as DrawerTitlePrimitive,
  DrawerDescription as DrawerDescriptionPrimitive,
  DrawerClose as DrawerClosePrimitive,
  type DrawerProps as DrawerPrimitiveProps,
} from '../../primitives/Drawer.js';

/**
 * Drawer - Root component
 */
export const Drawer = DrawerPrimitive;

/**
 * DrawerTrigger - Trigger button
 */
export const DrawerTrigger = DrawerTriggerPrimitive;

/**
 * DrawerPortal - Portal container
 */
export const DrawerPortal = DrawerPortalPrimitive;

/**
 * DrawerOverlay - Backdrop overlay
 */
export const DrawerOverlay = styled(DrawerOverlayPrimitive, {
  base: {
    position: 'fixed',
    inset: '0',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: '50',
    animation: 'drawer-overlay-show 0.2s ease-out',
    '&[data-state="closed"]': {
      animation: 'drawer-overlay-hide 0.2s ease-in',
    },
  },
});

/**
 * DrawerContent - Drawer content container
 */
export const DrawerContent = styled<{
  size?: 'sm' | 'md' | 'lg' | 'full';
}>(DrawerContentPrimitive, {
  base: {
    position: 'fixed',
    backgroundColor: '#ffffff',
    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
    padding: '1.5rem',
    zIndex: '51',
    overflow: 'auto',
    '&:focus': {
      outline: 'none',
    },
    // Side-based positioning and animations
    '&[data-side="right"]': {
      top: '0',
      right: '0',
      bottom: '0',
      animation: 'drawer-slide-in-right 0.3s ease-out',
      '&[data-state="closed"]': {
        animation: 'drawer-slide-out-right 0.25s ease-in',
      },
    },
    '&[data-side="left"]': {
      top: '0',
      left: '0',
      bottom: '0',
      animation: 'drawer-slide-in-left 0.3s ease-out',
      '&[data-state="closed"]': {
        animation: 'drawer-slide-out-left 0.25s ease-in',
      },
    },
    '&[data-side="top"]': {
      top: '0',
      left: '0',
      right: '0',
      animation: 'drawer-slide-in-top 0.3s ease-out',
      '&[data-state="closed"]': {
        animation: 'drawer-slide-out-top 0.25s ease-in',
      },
    },
    '&[data-side="bottom"]': {
      bottom: '0',
      left: '0',
      right: '0',
      animation: 'drawer-slide-in-bottom 0.3s ease-out',
      '&[data-state="closed"]': {
        animation: 'drawer-slide-out-bottom 0.25s ease-in',
      },
    },
  },
  variants: {
    size: {
      sm: {
        '&[data-side="right"], &[data-side="left"]': {
          width: '300px',
        },
        '&[data-side="top"], &[data-side="bottom"]': {
          height: '200px',
        },
      },
      md: {
        '&[data-side="right"], &[data-side="left"]': {
          width: '400px',
        },
        '&[data-side="top"], &[data-side="bottom"]': {
          height: '300px',
        },
      },
      lg: {
        '&[data-side="right"], &[data-side="left"]': {
          width: '500px',
        },
        '&[data-side="top"], &[data-side="bottom"]': {
          height: '400px',
        },
      },
      full: {
        '&[data-side="right"], &[data-side="left"]': {
          width: '100vw',
        },
        '&[data-side="top"], &[data-side="bottom"]': {
          height: '100vh',
        },
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * DrawerTitle - Drawer title
 */
export const DrawerTitle = styled(DrawerTitlePrimitive!, {
  base: {
    fontSize: '1.25rem',
    fontWeight: '600',
    lineHeight: '1.5',
    color: '#111827',
    marginBottom: '0.5rem',
  },
});

/**
 * DrawerDescription - Drawer description
 */
export const DrawerDescription = styled(DrawerDescriptionPrimitive!, {
  base: {
    fontSize: '0.875rem',
    lineHeight: '1.5',
    color: '#6b7280',
    marginBottom: '1rem',
  },
});

/**
 * DrawerClose - Close button
 */
export const DrawerClose = styled(DrawerClosePrimitive, {
  base: {
    position: 'absolute',
    top: '1rem',
    right: '1rem',
    width: '2rem',
    height: '2rem',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0.375rem',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#6b7280',
    cursor: 'pointer',
    fontSize: '1.25rem',
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
(Drawer as any).Trigger = DrawerTrigger;
(Drawer as any).Portal = DrawerPortal;
(Drawer as any).Overlay = DrawerOverlay;
(Drawer as any).Content = DrawerContent;
(Drawer as any).Title = DrawerTitle;
(Drawer as any).Description = DrawerDescription;
(Drawer as any).Close = DrawerClose;

// Display names
Drawer.displayName = 'Drawer';
DrawerTrigger.displayName = 'DrawerTrigger';
DrawerOverlay.displayName = 'DrawerOverlay';
DrawerContent.displayName = 'DrawerContent';
DrawerTitle.displayName = 'DrawerTitle';
DrawerDescription.displayName = 'DrawerDescription';
DrawerClose.displayName = 'DrawerClose';

// Type exports
export type { DrawerPrimitiveProps as DrawerProps };
