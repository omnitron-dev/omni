/**
 * Styled AlertDialog Component
 *
 * Modal dialog for important confirmations and alerts.
 * Built on top of the AlertDialog primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  AlertDialog as AlertDialogPrimitive,
  AlertDialogTrigger as AlertDialogTriggerPrimitive,
  // AlertDialogPortal as AlertDialogPortalPrimitive, // TODO: Not exported from primitive
  // AlertDialogOverlay as AlertDialogOverlayPrimitive, // TODO: Not exported from primitive
  AlertDialogContent as AlertDialogContentPrimitive,
  AlertDialogTitle as AlertDialogTitlePrimitive,
  AlertDialogDescription as AlertDialogDescriptionPrimitive,
  AlertDialogAction as AlertDialogActionPrimitive,
  AlertDialogCancel as AlertDialogCancelPrimitive,
  type AlertDialogProps as AlertDialogPrimitiveProps,
} from '../../primitives/AlertDialog.js';
import { defineComponent } from '../../core/component/index.js';

// Temporary placeholders until primitive components are implemented
const AlertDialogPortalPrimitive = defineComponent<{ children?: any }>((props) => () => props.children);
const AlertDialogOverlayPrimitive = defineComponent(() => () => ({ type: 'div', props: {} }));

/**
 * AlertDialog - Root component
 */
export const AlertDialog = AlertDialogPrimitive;

/**
 * AlertDialogTrigger - Trigger button
 */
export const AlertDialogTrigger = AlertDialogTriggerPrimitive;

/**
 * AlertDialogPortal - Portal container
 */
export const AlertDialogPortal = AlertDialogPortalPrimitive;

/**
 * AlertDialogOverlay - Backdrop overlay
 */
export const AlertDialogOverlay = styled(AlertDialogOverlayPrimitive, {
  base: {
    position: 'fixed',
    inset: '0',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: '50',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    animation: 'dialog-overlay-show 0.15s ease-out',
  },
});

/**
 * AlertDialogContent - Dialog content container
 */
export const AlertDialogContent = styled<{
  size?: 'sm' | 'md' | 'lg';
}>(AlertDialogContentPrimitive, {
  base: {
    position: 'relative',
    backgroundColor: '#ffffff',
    borderRadius: '0.5rem',
    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
    padding: '1.5rem',
    maxHeight: '85vh',
    overflow: 'auto',
    animation: 'dialog-content-show 0.2s ease-out',
    '&:focus': {
      outline: 'none',
    },
  },
  variants: {
    size: {
      sm: {
        width: '350px',
        maxWidth: '90vw',
      },
      md: {
        width: '450px',
        maxWidth: '90vw',
      },
      lg: {
        width: '550px',
        maxWidth: '90vw',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * AlertDialogTitle - Dialog title
 */
export const AlertDialogTitle = styled(AlertDialogTitlePrimitive!, {
  base: {
    fontSize: '1.125rem',
    fontWeight: '600',
    lineHeight: '1.5',
    color: '#111827',
    marginBottom: '0.5rem',
  },
});

/**
 * AlertDialogDescription - Dialog description
 */
export const AlertDialogDescription = styled(AlertDialogDescriptionPrimitive!, {
  base: {
    fontSize: '0.875rem',
    lineHeight: '1.5',
    color: '#6b7280',
    marginBottom: '1.5rem',
  },
});

/**
 * AlertDialogAction - Primary action button
 */
export const AlertDialogAction = styled<{
  variant?: 'default' | 'destructive' | 'success';
}>(AlertDialogActionPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    lineHeight: '1.25',
    borderRadius: '0.375rem',
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 2px #ffffff, 0 0 0 4px #3b82f6',
    },
    '&:disabled': {
      opacity: '0.5',
      cursor: 'not-allowed',
    },
  },
  variants: {
    variant: {
      default: {
        backgroundColor: '#3b82f6',
        color: '#ffffff',
        '&:hover:not(:disabled)': {
          backgroundColor: '#2563eb',
        },
      },
      destructive: {
        backgroundColor: '#ef4444',
        color: '#ffffff',
        '&:hover:not(:disabled)': {
          backgroundColor: '#dc2626',
        },
      },
      success: {
        backgroundColor: '#10b981',
        color: '#ffffff',
        '&:hover:not(:disabled)': {
          backgroundColor: '#059669',
        },
      },
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

/**
 * AlertDialogCancel - Cancel button
 */
export const AlertDialogCancel = styled(AlertDialogCancelPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.5rem 1rem',
    fontSize: '0.875rem',
    fontWeight: '500',
    lineHeight: '1.25',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
    backgroundColor: '#ffffff',
    color: '#111827',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    marginRight: '0.5rem',
    '&:hover': {
      backgroundColor: '#f9fafb',
    },
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 2px #3b82f6',
    },
  },
});

// Attach sub-components
(AlertDialog as any).Trigger = AlertDialogTrigger;
(AlertDialog as any).Portal = AlertDialogPortal;
(AlertDialog as any).Overlay = AlertDialogOverlay;
(AlertDialog as any).Content = AlertDialogContent;
(AlertDialog as any).Title = AlertDialogTitle;
(AlertDialog as any).Description = AlertDialogDescription;
(AlertDialog as any).Action = AlertDialogAction;
(AlertDialog as any).Cancel = AlertDialogCancel;

// Display names
AlertDialog.displayName = 'AlertDialog';
AlertDialogTrigger.displayName = 'AlertDialogTrigger';
AlertDialogOverlay.displayName = 'AlertDialogOverlay';
AlertDialogContent.displayName = 'AlertDialogContent';
AlertDialogTitle.displayName = 'AlertDialogTitle';
AlertDialogDescription.displayName = 'AlertDialogDescription';
AlertDialogAction.displayName = 'AlertDialogAction';
AlertDialogCancel.displayName = 'AlertDialogCancel';

// Type exports
export type { AlertDialogPrimitiveProps as AlertDialogProps };
