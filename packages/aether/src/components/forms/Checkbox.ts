/**
 * Styled Checkbox Component
 *
 * A styled checkbox with indeterminate state support.
 * Built on top of the Checkbox primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import { Checkbox as CheckboxPrimitive, CheckboxIndicator } from '../../primitives/Checkbox.js';

/**
 * Checkbox - Custom styled checkbox
 *
 * @example
 * ```tsx
 * <Checkbox checked={isChecked} onCheckedChange={setIsChecked} size="md">
 *   <Checkbox.Indicator>✓</Checkbox.Indicator>
 * </Checkbox>
 * ```
 */
export const Checkbox = styled(CheckboxPrimitive, {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1.25rem',
    height: '1.25rem',
    borderRadius: '0.25rem',
    border: '2px solid #d1d5db',
    backgroundColor: '#ffffff',
    cursor: 'pointer',
    transition: 'all 0.2s',
    '&:hover:not([data-disabled])': {
      borderColor: '#9ca3af',
    },
    '&:focus': {
      outline: 'none',
      boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.1)',
    },
    '&[data-state="checked"], &[data-state="indeterminate"]': {
      backgroundColor: '#3b82f6',
      borderColor: '#3b82f6',
      color: '#ffffff',
    },
    '&[data-disabled]': {
      backgroundColor: '#f9fafb',
      borderColor: '#e5e7eb',
      cursor: 'not-allowed',
      opacity: 0.5,
    },
  },
  variants: {
    size: {
      sm: {
        width: '1rem',
        height: '1rem',
        fontSize: '0.625rem',
      },
      md: {
        width: '1.25rem',
        height: '1.25rem',
        fontSize: '0.75rem',
      },
      lg: {
        width: '1.5rem',
        height: '1.5rem',
        fontSize: '0.875rem',
      },
    },
    colorScheme: {
      blue: {
        '&[data-state="checked"], &[data-state="indeterminate"]': {
          backgroundColor: '#3b82f6',
          borderColor: '#3b82f6',
        },
      },
      green: {
        '&[data-state="checked"], &[data-state="indeterminate"]': {
          backgroundColor: '#10b981',
          borderColor: '#10b981',
        },
      },
      red: {
        '&[data-state="checked"], &[data-state="indeterminate"]': {
          backgroundColor: '#ef4444',
          borderColor: '#ef4444',
        },
      },
      purple: {
        '&[data-state="checked"], &[data-state="indeterminate"]': {
          backgroundColor: '#8b5cf6',
          borderColor: '#8b5cf6',
        },
      },
    },
  },
  defaultVariants: {
    size: 'md',
    colorScheme: 'blue',
  },
});

export const StyledCheckboxIndicator = styled(CheckboxIndicator, {
  base: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
    color: 'inherit',
    fontSize: 'inherit',
  },
});

// Attach styled indicator to Checkbox
(Checkbox as any).Indicator = StyledCheckboxIndicator;

// Attach display name
(Checkbox as any).displayName = 'Checkbox';
