'use client';

/**
 * Field.Switch Component
 *
 * React Hook Form integrated switch field with full accessibility support.
 *
 * @module @omnitron/prism/components/field
 */

import type { ReactNode, ComponentProps } from 'react';
import { useId } from 'react';
import { Controller, useFormContext, type RegisterOptions } from 'react-hook-form';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';

/**
 * Props for Field.Switch component.
 */
export interface FieldSwitchProps extends Omit<ComponentProps<typeof Switch>, 'name'> {
  /** Field name in the form */
  name: string;
  /** Switch label */
  label?: ReactNode;
  /** Helper text */
  helperText?: string;
  /** Label placement */
  labelPlacement?: 'end' | 'start' | 'top' | 'bottom';
  /** Validation rules for react-hook-form */
  rules?: RegisterOptions;
}

/**
 * Field.Switch - Switch with React Hook Form integration.
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
 *   <Field.Switch name="notifications" label="Enable notifications" />
 *   <Field.Switch name="darkMode" label="Dark mode" labelPlacement="start" />
 * </FormProvider>
 * ```
 */
export function FieldSwitch({
  name,
  label,
  helperText,
  labelPlacement = 'end',
  rules,
  required,
  ...other
}: FieldSwitchProps): ReactNode {
  const { control } = useFormContext();
  const id = useId();
  const inputId = `field-switch-${id}`;
  const helperId = `field-switch-helper-${id}`;

  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field, fieldState: { error } }) => (
        <FormControl error={!!error} required={required}>
          <FormControlLabel
            control={
              <Switch
                {...field}
                id={inputId}
                checked={!!field.value}
                inputProps={{
                  'aria-describedby': error?.message || helperText ? helperId : undefined,
                  'aria-invalid': !!error,
                  'aria-required': required,
                }}
                {...other}
              />
            }
            label={label}
            labelPlacement={labelPlacement}
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
