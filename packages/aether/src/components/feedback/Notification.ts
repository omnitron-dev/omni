/**
 * Styled Notification Component
 *
 * System notification with variants and actions.
 * Built on top of the Notification primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  Notification as NotificationPrimitive,
  type NotificationProps as NotificationPrimitiveProps,
} from '../../primitives/Notification.js';

/**
 * Notification - Styled notification component
 *
 * @example
 * ```tsx
 * <Notification
 *   variant="info"
 *   title="New message"
 *   description="You have a new message from John"
 *   onClose={() => console.log('closed')}
 * />
 * ```
 */
export const Notification = styled<
  NotificationPrimitiveProps & {
    variant?: 'default' | 'info' | 'success' | 'warning' | 'error';
    size?: 'sm' | 'md' | 'lg';
  }
>(NotificationPrimitive, {
  base: {
    display: 'flex',
    gap: '0.75rem',
    padding: '1rem',
    borderRadius: '0.5rem',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    minWidth: '300px',
    maxWidth: '500px',
    position: 'relative',
    '[data-notification-icon]': {
      flexShrink: '0',
      width: '1.25rem',
      height: '1.25rem',
    },
    '[data-notification-content]': {
      flex: '1',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem',
    },
    '[data-notification-title]': {
      fontSize: '0.875rem',
      fontWeight: '600',
      color: '#111827',
      lineHeight: '1.25',
    },
    '[data-notification-description]': {
      fontSize: '0.875rem',
      color: '#6b7280',
      lineHeight: '1.25',
    },
    '[data-notification-close]': {
      flexShrink: '0',
      width: '1.25rem',
      height: '1.25rem',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '0.25rem',
      border: 'none',
      backgroundColor: 'transparent',
      color: '#6b7280',
      cursor: 'pointer',
      fontSize: '1rem',
      lineHeight: '1',
      transition: 'all 0.15s ease',
      '&:hover': {
        backgroundColor: '#f3f4f6',
        color: '#111827',
      },
    },
  },
  variants: {
    variant: {
      default: {
        borderColor: '#e5e7eb',
      },
      info: {
        borderColor: '#3b82f6',
        backgroundColor: '#eff6ff',
        '[data-notification-icon]': {
          color: '#3b82f6',
        },
        '[data-notification-title]': {
          color: '#1e40af',
        },
        '[data-notification-description]': {
          color: '#2563eb',
        },
      },
      success: {
        borderColor: '#10b981',
        backgroundColor: '#f0fdf4',
        '[data-notification-icon]': {
          color: '#10b981',
        },
        '[data-notification-title]': {
          color: '#065f46',
        },
        '[data-notification-description]': {
          color: '#047857',
        },
      },
      warning: {
        borderColor: '#f59e0b',
        backgroundColor: '#fffbeb',
        '[data-notification-icon]': {
          color: '#f59e0b',
        },
        '[data-notification-title]': {
          color: '#92400e',
        },
        '[data-notification-description]': {
          color: '#d97706',
        },
      },
      error: {
        borderColor: '#ef4444',
        backgroundColor: '#fef2f2',
        '[data-notification-icon]': {
          color: '#ef4444',
        },
        '[data-notification-title]': {
          color: '#991b1b',
        },
        '[data-notification-description]': {
          color: '#dc2626',
        },
      },
    },
    size: {
      sm: {
        padding: '0.75rem',
        minWidth: '250px',
        '[data-notification-icon]': {
          width: '1rem',
          height: '1rem',
        },
        '[data-notification-title]': {
          fontSize: '0.8125rem',
        },
        '[data-notification-description]': {
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
        '[data-notification-icon]': {
          width: '1.5rem',
          height: '1.5rem',
        },
        '[data-notification-title]': {
          fontSize: '1rem',
        },
        '[data-notification-description]': {
          fontSize: '0.9375rem',
        },
      },
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'md',
  },
});

// Display name
Notification.displayName = 'Notification';

// Type exports
export type { NotificationPrimitiveProps as NotificationProps };
