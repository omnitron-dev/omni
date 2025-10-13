/**
 * Styled PinInput Component
 *
 * An OTP/PIN code input component.
 * Built on top of the PinInput primitive with the styled() function.
 */

import { styled } from '../../styling/styled.js';
import { PinInput as PinInputPrimitive } from '../../primitives/PinInput.js';

/**
 * PinInput - OTP/PIN code input
 *
 * @example
 * ```tsx
 * <PinInput
 *   value={pin}
 *   onValueChange={setPin}
 *   length={6}
 *   size="md"
 * />
 * ```
 */
export const PinInput = styled(PinInputPrimitive, {
  base: {
    display: 'inline-flex',
    gap: '0.5rem',
    '& input': {
      width: '2.5rem',
      height: '2.5rem',
      textAlign: 'center',
      fontSize: '1.25rem',
      fontWeight: '600',
      borderRadius: '0.375rem',
      border: '2px solid #e5e7eb',
      backgroundColor: '#ffffff',
      color: '#111827',
      transition: 'border-color 0.2s, box-shadow 0.2s',
      '&:focus': {
        outline: 'none',
        borderColor: '#3b82f6',
        boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.1)',
      },
      '&:hover:not(:disabled)': {
        borderColor: '#d1d5db',
      },
      '&:disabled': {
        backgroundColor: '#f9fafb',
        color: '#9ca3af',
        cursor: 'not-allowed',
      },
    },
  },
  variants: {
    size: {
      sm: {
        gap: '0.375rem',
        '& input': {
          width: '2rem',
          height: '2rem',
          fontSize: '1rem',
        },
      },
      md: {
        gap: '0.5rem',
        '& input': {
          width: '2.5rem',
          height: '2.5rem',
          fontSize: '1.25rem',
        },
      },
      lg: {
        gap: '0.625rem',
        '& input': {
          width: '3rem',
          height: '3rem',
          fontSize: '1.5rem',
        },
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

// Attach display name
(PinInput as any).displayName = 'PinInput';
