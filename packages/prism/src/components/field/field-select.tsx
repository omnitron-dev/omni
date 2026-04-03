'use client';

/**
 * Field.Select Component
 *
 * React Hook Form integrated select field with full accessibility support.
 *
 * @module @omnitron-dev/prism/components/field
 */

import type { ReactNode, ComponentProps } from 'react';
import { useId } from 'react';
import { Controller, useFormContext, type RegisterOptions } from 'react-hook-form';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import type { SelectOption } from '../../types/components.js';

/**
 * Props for Field.Select component.
 */
export interface FieldSelectProps extends Omit<ComponentProps<typeof TextField>, 'name' | 'select'> {
  /** Field name in the form */
  name: string;
  /** Select options */
  options: SelectOption<string | number>[];
  /** Placeholder text */
  placeholder?: string;
  /** Validation rules for react-hook-form */
  rules?: RegisterOptions;
}

/**
 * Field.Select - Select input with React Hook Form integration.
 *
 * Includes comprehensive accessibility attributes:
 * - aria-describedby for helper text and error messages
 * - aria-invalid for error states
 * - aria-required for required fields
 * - Proper listbox role for dropdown
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.Select
 *     name="country"
 *     label="Country"
 *     options={[
 *       { value: 'us', label: 'United States' },
 *       { value: 'uk', label: 'United Kingdom' },
 *       { value: 'ca', label: 'Canada' },
 *     ]}
 *   />
 * </FormProvider>
 * ```
 */
export function FieldSelect({
  name,
  options,
  helperText,
  placeholder,
  rules,
  required,
  slotProps,
  ...other
}: FieldSelectProps): ReactNode {
  const { control } = useFormContext();
  const id = useId();
  const inputId = `field-select-${id}`;
  const helperId = `field-select-helper-${id}`;

  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field, fieldState: { error } }) => (
        <TextField
          {...field}
          id={inputId}
          select
          fullWidth
          value={field.value ?? ''}
          error={!!error}
          helperText={error?.message ?? helperText}
          required={required}
          slotProps={{
            formHelperText: {
              id: helperId,
            },
            select: {
              'aria-describedby': error?.message || helperText ? helperId : undefined,
              'aria-invalid': !!error,
              'aria-required': required,
            },
            ...slotProps,
          }}
          {...other}
        >
          {placeholder && (
            <MenuItem value="" disabled aria-hidden="true">
              {placeholder}
            </MenuItem>
          )}
          {options.map((option) => (
            <MenuItem
              key={option.value}
              value={option.value}
              disabled={option.disabled}
              aria-disabled={option.disabled}
            >
              {option.label}
            </MenuItem>
          ))}
        </TextField>
      )}
    />
  );
}
