/**
 * Styled DateRangePicker Component
 *
 * A calendar-based date range selection component.
 * Built on top of the DateRangePicker primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import { DateRangePicker as DateRangePickerPrimitive } from '../../primitives/DateRangePicker.js';

/**
 * DateRangePicker - Date range selection
 *
 * @example
 * ```tsx
 * <DateRangePicker
 *   value={dateRange}
 *   onValueChange={setDateRange}
 *   size="md"
 * />
 * ```
 */
export const DateRangePicker = styled(DateRangePickerPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.5rem 1rem',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
    fontSize: '1rem',
    backgroundColor: '#ffffff',
    color: '#111827',
    cursor: 'pointer',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    '&:focus': {
      outline: 'none',
      borderColor: '#3b82f6',
      boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.1)',
    },
    '&:hover:not([data-disabled])': {
      borderColor: '#d1d5db',
    },
    '&[data-disabled]': {
      backgroundColor: '#f9fafb',
      color: '#9ca3af',
      cursor: 'not-allowed',
    },
  },
  variants: {
    size: {
      sm: {
        padding: '0.375rem 0.75rem',
        fontSize: '0.875rem',
      },
      md: {
        padding: '0.5rem 1rem',
        fontSize: '1rem',
      },
      lg: {
        padding: '0.625rem 1.25rem',
        fontSize: '1.125rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

// Attach display name
(DateRangePicker as any).displayName = 'DateRangePicker';
