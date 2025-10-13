/**
 * Styled Dialog Component
 *
 * Modal dialog with accessible focus management and overlay.
 * Built on top of the Dialog primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Dialog as DialogPrimitive,
  DialogTrigger as DialogTriggerPrimitive,
  DialogPortal as DialogPortalPrimitive,
  DialogOverlay as DialogOverlayPrimitive,
  DialogContent as DialogContentPrimitive,
  DialogTitle as DialogTitlePrimitive,
  DialogDescription as DialogDescriptionPrimitive,
  DialogClose as DialogClosePrimitive,
  type DialogProps as DialogPrimitiveProps,
} from '../../primitives/Dialog.js';

/**
 * Dialog - Root component
 */
export const Dialog = DialogPrimitive;

/**
 * DialogTrigger - Trigger button
 */
export const DialogTrigger = DialogTriggerPrimitive;

/**
 * DialogPortal - Portal container
 */
export const DialogPortal = DialogPortalPrimitive;

/**
 * DialogOverlay - Backdrop overlay
 */
export const DialogOverlay = styled(DialogOverlayPrimitive, {
  base: {
    position: 'fixed',
    inset: '0',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: '50',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: 'dialog-overlay-show 0.15s ease-out',
    '&[data-state="closed"]': {
      animation: 'dialog-overlay-hide 0.15s ease-in',
    },
  },
});

/**
 * DialogContent - Dialog content container
 */
export const DialogContent = styled<{
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}>(DialogContentPrimitive, {
  base: {
    position: 'relative',
    backgroundColor: '#ffffff',
    borderRadius: '0.5rem',
    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
    padding: '1.5rem',
    maxHeight: '85vh',
    overflow: 'auto',
    animation: 'dialog-content-show 0.2s ease-out',
    '&[data-state="closed"]': {
      animation: 'dialog-content-hide 0.15s ease-in',
    },
    '&:focus': {
      outline: 'none',
    },
  },
  variants: {
    size: {
      sm: {
        width: '400px',
        maxWidth: '90vw',
      },
      md: {
        width: '500px',
        maxWidth: '90vw',
      },
      lg: {
        width: '700px',
        maxWidth: '90vw',
      },
      xl: {
        width: '900px',
        maxWidth: '95vw',
      },
      full: {
        width: '95vw',
        height: '85vh',
        maxWidth: 'none',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * DialogTitle - Dialog title
 */
export const DialogTitle = styled(DialogTitlePrimitive!, {
  base: {
    fontSize: '1.25rem',
    fontWeight: '600',
    lineHeight: '1.5',
    color: '#111827',
    marginBottom: '0.5rem',
  },
  variants: {
    size: {
      sm: {
        fontSize: '1rem',
      },
      md: {
        fontSize: '1.25rem',
      },
      lg: {
        fontSize: '1.5rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * DialogDescription - Dialog description
 */
export const DialogDescription = styled(DialogDescriptionPrimitive!, {
  base: {
    fontSize: '0.875rem',
    lineHeight: '1.5',
    color: '#6b7280',
    marginBottom: '1rem',
  },
});

/**
 * DialogClose - Close button
 */
export const DialogClose = styled(DialogClosePrimitive, {
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
(Dialog as any).Trigger = DialogTrigger;
(Dialog as any).Portal = DialogPortal;
(Dialog as any).Overlay = DialogOverlay;
(Dialog as any).Content = DialogContent;
(Dialog as any).Title = DialogTitle;
(Dialog as any).Description = DialogDescription;
(Dialog as any).Close = DialogClose;

// Display names
Dialog.displayName = 'Dialog';
DialogTrigger.displayName = 'DialogTrigger';
DialogOverlay.displayName = 'DialogOverlay';
DialogContent.displayName = 'DialogContent';
DialogTitle.displayName = 'DialogTitle';
DialogDescription.displayName = 'DialogDescription';
DialogClose.displayName = 'DialogClose';

// Type exports
export type { DialogPrimitiveProps as DialogProps };
