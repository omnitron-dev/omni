/**
 * Styled NumberInput Component
 *
 * A number input with increment/decrement steppers.
 * Built on top of the NumberInput primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import {
  NumberInput as NumberInputPrimitive,
  NumberInputField,
  NumberInputIncrement,
  NumberInputDecrement,
} from '../../primitives/NumberInput.js';

/**
 * NumberInput - Number input with steppers
 *
 * @example
 * ```tsx
 * <NumberInput value={count} onValueChange={setCount} min={0} max={100} size="md">
 *   <NumberInput.Field />
 *   <NumberInput.Increment />
 *   <NumberInput.Decrement />
 * </NumberInput>
 * ```
 */
export const NumberInput = NumberInputPrimitive;

export const StyledNumberInputField = styled(NumberInputField, {
  base: {
    width: '100%',
    padding: '0.5rem 1rem',
    paddingRight: '2.5rem',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
    fontSize: '1rem',
    lineHeight: '1.5',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    backgroundColor: '#ffffff',
    color: '#111827',
    textAlign: 'left',
    '&:focus': {
      outline: 'none',
      borderColor: '#3b82f6',
      boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.1)',
    },
    '&:hover:not(:disabled)': {
      borderColor: '#d1d5db',
    },
    '&:disabled, &[readonly]': {
      backgroundColor: '#f9fafb',
      color: '#9ca3af',
      cursor: 'not-allowed',
    },
    '&::placeholder': {
      color: '#9ca3af',
    },
  },
  variants: {
    size: {
      sm: {
        padding: '0.375rem 0.75rem',
        paddingRight: '2rem',
        fontSize: '0.875rem',
        borderRadius: '0.25rem',
      },
      md: {
        padding: '0.5rem 1rem',
        paddingRight: '2.5rem',
        fontSize: '1rem',
        borderRadius: '0.375rem',
      },
      lg: {
        padding: '0.625rem 1.25rem',
        paddingRight: '3rem',
        fontSize: '1.125rem',
        borderRadius: '0.5rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

export const StyledNumberInputIncrement = styled(NumberInputIncrement, {
  base: {
    position: 'absolute',
    right: '0.125rem',
    top: '0.125rem',
    width: '1.75rem',
    height: 'calc(50% - 0.125rem)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0.25rem',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#6b7280',
    fontSize: '0.75rem',
    cursor: 'pointer',
    transition: 'background-color 0.15s, color 0.15s',
    '&:hover:not(:disabled)': {
      backgroundColor: '#f3f4f6',
      color: '#374151',
    },
    '&:disabled': {
      color: '#d1d5db',
      cursor: 'not-allowed',
    },
  },
  variants: {
    size: {
      sm: {
        width: '1.5rem',
        fontSize: '0.625rem',
      },
      md: {
        width: '1.75rem',
        fontSize: '0.75rem',
      },
      lg: {
        width: '2rem',
        fontSize: '0.875rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

export const StyledNumberInputDecrement = styled(NumberInputDecrement, {
  base: {
    position: 'absolute',
    right: '0.125rem',
    bottom: '0.125rem',
    width: '1.75rem',
    height: 'calc(50% - 0.125rem)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '0.25rem',
    border: 'none',
    backgroundColor: 'transparent',
    color: '#6b7280',
    fontSize: '0.75rem',
    cursor: 'pointer',
    transition: 'background-color 0.15s, color 0.15s',
    '&:hover:not(:disabled)': {
      backgroundColor: '#f3f4f6',
      color: '#374151',
    },
    '&:disabled': {
      color: '#d1d5db',
      cursor: 'not-allowed',
    },
  },
  variants: {
    size: {
      sm: {
        width: '1.5rem',
        fontSize: '0.625rem',
      },
      md: {
        width: '1.75rem',
        fontSize: '0.75rem',
      },
      lg: {
        width: '2rem',
        fontSize: '0.875rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

// Attach styled sub-components to NumberInput
(NumberInput as any).Field = StyledNumberInputField;
(NumberInput as any).Increment = StyledNumberInputIncrement;
(NumberInput as any).Decrement = StyledNumberInputDecrement;

// Attach display name
(NumberInput as any).displayName = 'NumberInput';
