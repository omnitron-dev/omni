/**
 * Styled Sheet Component
 *
 * Bottom sheet for mobile interfaces.
 * Built on top of the Sheet primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Sheet as SheetPrimitive,
  SheetTrigger as SheetTriggerPrimitive,
  SheetPortal as SheetPortalPrimitive,
  SheetOverlay as SheetOverlayPrimitive,
  SheetContent as SheetContentPrimitive,
  SheetTitle as SheetTitlePrimitive,
  SheetDescription as SheetDescriptionPrimitive,
  SheetClose as SheetClosePrimitive,
  type SheetProps as SheetPrimitiveProps,
} from '../../primitives/Sheet.js';

/**
 * Sheet - Root component
 */
export const Sheet = SheetPrimitive;

/**
 * SheetTrigger - Trigger button
 */
export const SheetTrigger = SheetTriggerPrimitive;

/**
 * SheetPortal - Portal container
 */
export const SheetPortal = SheetPortalPrimitive;

/**
 * SheetOverlay - Backdrop overlay
 */
export const SheetOverlay = styled(SheetOverlayPrimitive, {
  base: {
    position: 'fixed',
    inset: '0',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: '50',
    animation: 'sheet-overlay-show 0.2s ease-out',
    '&[data-state="closed"]': {
      animation: 'sheet-overlay-hide 0.2s ease-in',
    },
  },
});

/**
 * SheetContent - Sheet content container
 */
export const SheetContent = styled<{
  size?: 'sm' | 'md' | 'lg' | 'full';
}>(SheetContentPrimitive, {
  base: {
    position: 'fixed',
    bottom: '0',
    left: '0',
    right: '0',
    backgroundColor: '#ffffff',
    borderTopLeftRadius: '1rem',
    borderTopRightRadius: '1rem',
    boxShadow: '0 -4px 6px -1px rgb(0 0 0 / 0.1), 0 -2px 4px -2px rgb(0 0 0 / 0.1)',
    padding: '1.5rem',
    zIndex: '51',
    overflow: 'auto',
    animation: 'sheet-slide-in 0.3s ease-out',
    '&[data-state="closed"]': {
      animation: 'sheet-slide-out 0.25s ease-in',
    },
    '&:focus': {
      outline: 'none',
    },
    // Handle for dragging
    '&::before': {
      content: '""',
      position: 'absolute',
      top: '0.75rem',
      left: '50%',
      transform: 'translateX(-50%)',
      width: '3rem',
      height: '0.25rem',
      backgroundColor: '#e5e7eb',
      borderRadius: '9999px',
    },
  },
  variants: {
    size: {
      sm: {
        height: '30vh',
        minHeight: '200px',
      },
      md: {
        height: '50vh',
        minHeight: '300px',
      },
      lg: {
        height: '70vh',
        minHeight: '400px',
      },
      full: {
        height: '95vh',
        borderTopLeftRadius: '0',
        borderTopRightRadius: '0',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * SheetTitle - Sheet title
 */
export const SheetTitle = styled(SheetTitlePrimitive!, {
  base: {
    fontSize: '1.125rem',
    fontWeight: '600',
    lineHeight: '1.5',
    color: '#111827',
    marginTop: '1rem',
    marginBottom: '0.5rem',
  },
});

/**
 * SheetDescription - Sheet description
 */
export const SheetDescription = styled(SheetDescriptionPrimitive!, {
  base: {
    fontSize: '0.875rem',
    lineHeight: '1.5',
    color: '#6b7280',
    marginBottom: '1rem',
  },
});

/**
 * SheetClose - Close button
 */
export const SheetClose = styled(SheetClosePrimitive, {
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
(Sheet as any).Trigger = SheetTrigger;
(Sheet as any).Portal = SheetPortal;
(Sheet as any).Overlay = SheetOverlay;
(Sheet as any).Content = SheetContent;
(Sheet as any).Title = SheetTitle;
(Sheet as any).Description = SheetDescription;
(Sheet as any).Close = SheetClose;

// Display names
Sheet.displayName = 'Sheet';
SheetTrigger.displayName = 'SheetTrigger';
SheetOverlay.displayName = 'SheetOverlay';
SheetContent.displayName = 'SheetContent';
SheetTitle.displayName = 'SheetTitle';
SheetDescription.displayName = 'SheetDescription';
SheetClose.displayName = 'SheetClose';

// Type exports
export type { SheetPrimitiveProps as SheetProps };
