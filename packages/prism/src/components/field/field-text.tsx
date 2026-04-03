'use client';

/**
 * Field.Text Component
 *
 * React Hook Form integrated text field with full accessibility support.
 *
 * @module @omnitron-dev/prism/components/field
 */

import type { ReactNode, ComponentProps } from 'react';
import { useId } from 'react';
import { Controller, useFormContext, type RegisterOptions } from 'react-hook-form';
import TextField from '@mui/material/TextField';

/**
 * Props for Field.Text component.
 */
export interface FieldTextProps extends Omit<ComponentProps<typeof TextField>, 'name'> {
  /** Field name in the form */
  name: string;
  /** Validation rules for react-hook-form */
  rules?: RegisterOptions;
}

/**
 * Field.Text - Text input with React Hook Form integration.
 *
 * Includes comprehensive accessibility attributes:
 * - aria-describedby for helper text and error messages
 * - aria-invalid for error states
 * - aria-required for required fields
 * - Proper label associations via htmlFor
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.Text name="email" label="Email" type="email" />
 *   <Field.Text name="password" label="Password" type="password" />
 * </FormProvider>
 * ```
 */
export function FieldText({
  name,
  helperText,
  rules,
  required,
  slotProps,
  multiline,
  ...other
}: FieldTextProps): ReactNode {
  const { control } = useFormContext();
  const id = useId();
  const inputId = `field-text-${id}`;
  const helperId = `field-text-helper-${id}`;

  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field, fieldState: { error } }) => (
        <TextField
          {...field}
          id={inputId}
          fullWidth
          multiline={multiline}
          value={field.value ?? ''}
          error={!!error}
          helperText={error?.message ?? helperText}
          required={required}
          slotProps={{
            formHelperText: {
              id: helperId,
            },
            htmlInput: {
              'aria-describedby': error?.message || helperText ? helperId : undefined,
              'aria-invalid': !!error,
              'aria-required': required,
            },
            // Shrink label for multiline fields to prevent overlap with textarea content
            ...(multiline ? { inputLabel: { shrink: true } } : {}),
            ...slotProps,
          }}
          {...other}
        />
      )}
    />
  );
}
