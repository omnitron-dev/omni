'use client';

/**
 * Field.Checkbox Component
 *
 * React Hook Form integrated checkbox field with full accessibility support.
 *
 * @module @omnitron-dev/prism/components/field
 */

import type { ReactNode, ComponentProps } from 'react';
import { useId } from 'react';
import { Controller, useFormContext, type RegisterOptions } from 'react-hook-form';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';

/**
 * Props for Field.Checkbox component.
 */
export interface FieldCheckboxProps extends Omit<ComponentProps<typeof Checkbox>, 'name'> {
  /** Field name in the form */
  name: string;
  /** Checkbox label */
  label?: ReactNode;
  /** Helper text */
  helperText?: string;
  /** Validation rules for react-hook-form */
  rules?: RegisterOptions;
}

/**
 * Field.Checkbox - Checkbox with React Hook Form integration.
 *
 * Includes comprehensive accessibility attributes:
 * - aria-describedby for helper text and error messages
 * - aria-invalid for error states
 * - aria-required for required fields
 * - Proper label associations
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.Checkbox name="terms" label="I agree to the terms" />
 *   <Field.Checkbox name="newsletter" label="Subscribe to newsletter" />
 * </FormProvider>
 * ```
 */
export function FieldCheckbox({
  name,
  label,
  helperText,
  rules,
  required,
  indeterminate,
  ...other
}: FieldCheckboxProps): ReactNode {
  const { control } = useFormContext();
  const id = useId();
  const inputId = `field-checkbox-${id}`;
  const helperId = `field-checkbox-helper-${id}`;

  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field, fieldState: { error } }) => (
        <FormControl error={!!error} required={required}>
          <FormControlLabel
            control={
              <Checkbox
                {...field}
                id={inputId}
                checked={!!field.value}
                indeterminate={indeterminate}
                inputProps={{
                  'aria-describedby': error?.message || helperText ? helperId : undefined,
                  'aria-invalid': !!error,
                  'aria-required': required,
                  ...(indeterminate && { 'aria-checked': 'mixed' as const }),
                }}
                {...other}
              />
            }
            label={label}
            htmlFor={inputId}
          />
          {(error?.message || helperText) && (
            <FormHelperText id={helperId}>{error?.message ?? helperText}</FormHelperText>
          )}
        </FormControl>
      )}
    />
  );
}
