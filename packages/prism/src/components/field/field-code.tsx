'use client';

/**
 * Field.Code Component
 *
 * React Hook Form integrated OTP (One-Time Password) input.
 * Provides a professional code/PIN entry experience.
 *
 * @module @omnitron-dev/prism/components/field
 */

import type { ReactNode, ChangeEvent, KeyboardEvent, ClipboardEvent } from 'react';
import { useRef, useCallback, useId } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import FormHelperText from '@mui/material/FormHelperText';
import type { BoxProps } from '@mui/material/Box';
import type { TextFieldProps } from '@mui/material/TextField';
import type { FormHelperTextProps } from '@mui/material/FormHelperText';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Props for Field.Code component.
 */
export interface FieldCodeProps {
  /** Field name in the form */
  name: string;
  /** Number of code digits (default: 6) */
  length?: number;
  /** Placeholder character (default: '-') */
  placeholder?: string;
  /** Helper text shown below the input */
  helperText?: ReactNode;
  /** Auto-focus the first input on mount */
  autoFocus?: boolean;
  /** Disable all inputs */
  disabled?: boolean;
  /** Input type: text, number, or password */
  type?: 'text' | 'number' | 'password';
  /** Gap between inputs (CSS value) */
  gap?: number | string;
  /** Width of each input field (CSS value) */
  inputWidth?: number | string;
  /** Slot props for nested components */
  slotProps?: {
    /** Wrapper Box props */
    wrapper?: Partial<BoxProps>;
    /** Individual TextField props */
    textField?: Partial<TextFieldProps>;
    /** FormHelperText props */
    helperText?: Partial<FormHelperTextProps>;
  };
}

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Field.Code - OTP/PIN code input with React Hook Form integration.
 *
 * Features:
 * - Automatic focus navigation between digits
 * - Paste support for full codes
 * - Backspace navigation
 * - Configurable length and styling
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.Code
 *     name="verificationCode"
 *     autoFocus
 *   />
 * </FormProvider>
 * ```
 *
 * @example
 * ```tsx
 * // With custom styling
 * <Field.Code
 *   name="pin"
 *   length={4}
 *   type="password"
 *   inputWidth={56}
 *   gap={2}
 *   slotProps={{
 *     textField: { variant: 'filled' },
 *   }}
 * />
 * ```
 */
export function FieldCode({
  name,
  length = 6,
  placeholder = '-',
  helperText,
  autoFocus = false,
  disabled = false,
  type = 'text',
  gap = 1.5,
  inputWidth = 48,
  slotProps,
}: FieldCodeProps): ReactNode {
  const { control } = useFormContext();
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const id = useId();
  const helperId = `field-code-helper-${id}`;

  const focusInput = useCallback((index: number) => {
    const input = inputRefs.current[index];
    if (input) {
      input.focus();
      input.select();
    }
  }, []);

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        // Ensure value is a string of correct length
        const valueString = String(field.value ?? '').slice(0, length);
        const digits = Array.from({ length }, (_, i) => valueString[i] ?? '');

        const updateValue = (newDigits: string[]) => {
          const newValue = newDigits.join('');
          field.onChange(newValue);
        };

        const handleChange = (index: number) => (e: ChangeEvent<HTMLInputElement>) => {
          const inputValue = e.target.value;

          // Handle single character input
          if (inputValue.length <= 1) {
            const newDigits = [...digits];
            newDigits[index] = inputValue;
            updateValue(newDigits);

            // Move to next input if character was entered
            if (inputValue && index < length - 1) {
              focusInput(index + 1);
            }
          }
        };

        const handleKeyDown = (index: number) => (e: KeyboardEvent<HTMLInputElement>) => {
          const key = e.key;

          // Backspace: clear current or go to previous
          if (key === 'Backspace') {
            e.preventDefault();
            const newDigits = [...digits];

            if (digits[index]) {
              // Clear current digit
              newDigits[index] = '';
              updateValue(newDigits);
            } else if (index > 0) {
              // Move to previous and clear it
              newDigits[index - 1] = '';
              updateValue(newDigits);
              focusInput(index - 1);
            }
          }

          // Arrow keys navigation
          if (key === 'ArrowLeft' && index > 0) {
            e.preventDefault();
            focusInput(index - 1);
          }
          if (key === 'ArrowRight' && index < length - 1) {
            e.preventDefault();
            focusInput(index + 1);
          }

          // Delete: clear current
          if (key === 'Delete') {
            e.preventDefault();
            const newDigits = [...digits];
            newDigits[index] = '';
            updateValue(newDigits);
          }
        };

        const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
          e.preventDefault();
          const pastedData = e.clipboardData.getData('text').slice(0, length);

          // Only allow valid characters based on type
          const validChars = type === 'number' ? pastedData.replace(/\D/g, '') : pastedData;

          if (validChars) {
            const newDigits = Array.from({ length }, (_, i) => validChars[i] ?? '');
            updateValue(newDigits);

            // Focus the input after the last pasted character
            const focusIndex = Math.min(validChars.length, length - 1);
            focusInput(focusIndex);
          }
        };

        const hasHelper = !!(error?.message || helperText);

        return (
          <Box role="group" aria-label={`${name} code input`} {...slotProps?.wrapper}>
            <Box
              sx={{
                display: 'flex',
                gap,
                justifyContent: 'center',
              }}
            >
              {digits.map((digit, index) => (
                <TextField
                  key={index}
                  inputRef={(el) => {
                    inputRefs.current[index] = el;
                  }}
                  value={digit}
                  onChange={handleChange(index)}
                  onKeyDown={handleKeyDown(index)}
                  onPaste={handlePaste}
                  onFocus={(e) => e.target.select()}
                  disabled={disabled}
                  error={!!error}
                  autoFocus={autoFocus && index === 0}
                  placeholder={placeholder}
                  slotProps={{
                    htmlInput: {
                      maxLength: 1,
                      'aria-label': `Digit ${index + 1} of ${length}`,
                      'aria-describedby': hasHelper ? helperId : undefined,
                      'aria-invalid': !!error,
                      style: {
                        textAlign: 'center',
                        fontSize: '1.25rem',
                        fontWeight: 600,
                        padding: '12px 0',
                      },
                      inputMode: type === 'number' ? 'numeric' : 'text',
                      autoComplete: 'one-time-code',
                    },
                  }}
                  sx={{
                    width: inputWidth,
                    '& .MuiInputBase-input': {
                      p: 0,
                      height: inputWidth,
                    },
                  }}
                  {...slotProps?.textField}
                />
              ))}
            </Box>

            {hasHelper && (
              <FormHelperText
                id={helperId}
                error={!!error}
                sx={{ textAlign: 'center', mt: 1 }}
                {...slotProps?.helperText}
              >
                {error?.message ?? helperText}
              </FormHelperText>
            )}
          </Box>
        );
      }}
    />
  );
}
