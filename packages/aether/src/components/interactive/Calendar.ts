/**
 * Styled Calendar Component
 *
 * Full calendar widget for date selection.
 * Built on top of the Calendar primitive with styled() function.
 */

import { styled } from '../../styling/styled.js';
import { Calendar as CalendarPrimitive, type CalendarProps as CalendarPrimitiveProps } from '../../primitives/Calendar.js';

/**
 * Calendar - Full calendar widget
 */
export const Calendar = styled<{
  size?: 'sm' | 'md' | 'lg';
}>(CalendarPrimitive, {
  base: {
    backgroundColor: '#ffffff',
    borderRadius: '0.5rem',
    border: '1px solid #e5e7eb',
    padding: '1rem',
    '[data-calendar-header]': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '1rem',
    },
    '[data-calendar-title]': {
      fontSize: '1rem',
      fontWeight: '600',
      color: '#111827',
    },
    '[data-calendar-nav]': {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '2rem',
      height: '2rem',
      borderRadius: '0.375rem',
      border: 'none',
      backgroundColor: 'transparent',
      color: '#6b7280',
      cursor: 'pointer',
      transition: 'all 0.15s ease',
      '&:hover': {
        backgroundColor: '#f3f4f6',
        color: '#111827',
      },
      '&:disabled': {
        opacity: '0.5',
        pointerEvents: 'none',
      },
    },
    '[data-calendar-grid]': {
      width: '100%',
      borderCollapse: 'collapse',
    },
    '[data-calendar-weekday]': {
      padding: '0.5rem',
      fontSize: '0.75rem',
      fontWeight: '600',
      color: '#6b7280',
      textAlign: 'center',
      textTransform: 'uppercase',
    },
    '[data-calendar-day]': {
      position: 'relative',
      padding: '0',
      textAlign: 'center',
    },
    '[data-calendar-day-button]': {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '2.5rem',
      height: '2.5rem',
      fontSize: '0.875rem',
      borderRadius: '0.375rem',
      border: 'none',
      backgroundColor: 'transparent',
      color: '#111827',
      cursor: 'pointer',
      transition: 'all 0.15s ease',
      '&:hover:not([data-disabled]):not([data-outside])': {
        backgroundColor: '#f3f4f6',
      },
      '&[data-selected]': {
        backgroundColor: '#3b82f6',
        color: '#ffffff',
        '&:hover': {
          backgroundColor: '#2563eb',
        },
      },
      '&[data-today]:not([data-selected])': {
        fontWeight: '600',
        color: '#3b82f6',
      },
      '&[data-outside]': {
        color: '#9ca3af',
        opacity: '0.5',
      },
      '&[data-disabled]': {
        opacity: '0.5',
        pointerEvents: 'none',
        cursor: 'not-allowed',
      },
    },
  },
  variants: {
    size: {
      sm: {
        padding: '0.75rem',
        '[data-calendar-title]': {
          fontSize: '0.875rem',
        },
        '[data-calendar-day-button]': {
          width: '2rem',
          height: '2rem',
          fontSize: '0.8125rem',
        },
      },
      md: {
        padding: '1rem',
      },
      lg: {
        padding: '1.25rem',
        '[data-calendar-title]': {
          fontSize: '1.125rem',
        },
        '[data-calendar-day-button]': {
          width: '3rem',
          height: '3rem',
          fontSize: '1rem',
        },
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

// Display name
Calendar.displayName = 'Calendar';

// Type exports
export type { CalendarPrimitiveProps as CalendarProps };
