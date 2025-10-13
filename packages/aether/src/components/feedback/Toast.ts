/**
 * Styled Toast Component
 *
 * Toast notifications with variants for different message types.
 * Built on top of the Toast primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Toast as ToastPrimitive,
  ToastProvider as ToastProviderPrimitive,
  ToastViewport as ToastViewportPrimitive,
  type ToastProps as ToastPrimitiveProps,
} from '../../primitives/Toast.js';

/**
 * Toast - Styled notification component
 *
 * @example
 * ```tsx
 * <Toast
 *   toast={{
 *     title: 'Success!',
 *     description: 'Your changes have been saved.',
 *     variant: 'success',
 *   }}
 *   size="md"
 * />
 * ```
 */
export const Toast = styled<
  {
    size?: 'sm' | 'md' | 'lg';
  },
  ToastPrimitiveProps
>(ToastPrimitive, {
  base: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    padding: '1rem',
    borderRadius: '0.5rem',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    minWidth: '300px',
    maxWidth: '500px',
    position: 'relative',
    '[data-toast-title]': {
      fontSize: '0.875rem',
      fontWeight: '600',
      color: '#111827',
    },
    '[data-toast-description]': {
      fontSize: '0.875rem',
      color: '#6b7280',
    },
    '[data-toast-action]': {
      marginTop: '0.5rem',
      padding: '0.375rem 0.75rem',
      fontSize: '0.875rem',
      fontWeight: '500',
      borderRadius: '0.375rem',
      border: '1px solid #e5e7eb',
      backgroundColor: '#ffffff',
      cursor: 'pointer',
      transition: 'all 0.15s ease',
      '&:hover': {
        backgroundColor: '#f9fafb',
      },
    },
    '[data-toast-close]': {
      position: 'absolute',
      top: '0.5rem',
      right: '0.5rem',
      width: '1.5rem',
      height: '1.5rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '0.25rem',
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
    },
    '&[data-variant="success"]': {
      borderColor: '#10b981',
      backgroundColor: '#d1fae5',
      '[data-toast-title]': {
        color: '#065f46',
      },
      '[data-toast-description]': {
        color: '#047857',
      },
    },
    '&[data-variant="error"]': {
      borderColor: '#ef4444',
      backgroundColor: '#fee2e2',
      '[data-toast-title]': {
        color: '#991b1b',
      },
      '[data-toast-description]': {
        color: '#dc2626',
      },
    },
    '&[data-variant="warning"]': {
      borderColor: '#f59e0b',
      backgroundColor: '#fef3c7',
      '[data-toast-title]': {
        color: '#92400e',
      },
      '[data-toast-description]': {
        color: '#d97706',
      },
    },
    '&[data-variant="info"]': {
      borderColor: '#3b82f6',
      backgroundColor: '#dbeafe',
      '[data-toast-title]': {
        color: '#1e40af',
      },
      '[data-toast-description]': {
        color: '#2563eb',
      },
    },
  },
  variants: {
    size: {
      sm: {
        padding: '0.75rem',
        minWidth: '250px',
        '[data-toast-title]': {
          fontSize: '0.8125rem',
        },
        '[data-toast-description]': {
          fontSize: '0.8125rem',
        },
      },
      md: {
        padding: '1rem',
        minWidth: '300px',
      },
      lg: {
        padding: '1.25rem',
        minWidth: '350px',
        '[data-toast-title]': {
          fontSize: '1rem',
        },
        '[data-toast-description]': {
          fontSize: '0.9375rem',
        },
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * ToastViewport - Container for rendering toasts
 */
export const ToastViewport = styled(ToastViewportPrimitive, {
  base: {
    position: 'fixed',
    top: '0',
    right: '0',
    zIndex: '9999',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    padding: '1rem',
    maxWidth: '550px',
    width: '100%',
    pointerEvents: 'none',
    '& > *': {
      pointerEvents: 'auto',
    },
  },
  variants: {
    position: {
      'top-right': {
        top: '0',
        right: '0',
      },
      'top-left': {
        top: '0',
        left: '0',
        right: 'auto',
      },
      'bottom-right': {
        top: 'auto',
        bottom: '0',
        right: '0',
      },
      'bottom-left': {
        top: 'auto',
        bottom: '0',
        left: '0',
        right: 'auto',
      },
      'top-center': {
        top: '0',
        left: '50%',
        right: 'auto',
        transform: 'translateX(-50%)',
      },
      'bottom-center': {
        top: 'auto',
        bottom: '0',
        left: '50%',
        right: 'auto',
        transform: 'translateX(-50%)',
      },
    },
  },
  defaultVariants: {
    position: 'top-right',
  },
});

/**
 * ToastProvider - Context provider for toast notifications
 */
export const ToastProvider = ToastProviderPrimitive;

// Display names
Toast.displayName = 'Toast';
ToastViewport.displayName = 'ToastViewport';

// Type exports
export type { ToastPrimitiveProps as ToastProps };
