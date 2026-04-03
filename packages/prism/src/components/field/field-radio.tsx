'use client';

/**
 * Field.Radio Component
 *
 * React Hook Form integrated radio group with full accessibility support.
 *
 * @module @omnitron-dev/prism/components/field
 */

import type { ReactNode } from 'react';
import { useId } from 'react';
import { Controller, useFormContext, type RegisterOptions } from 'react-hook-form';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import type { FormControlProps } from '@mui/material/FormControl';

/**
 * Option for radio group.
 */
export interface RadioOption {
  /** Option value */
  value: string | number;
  /** Display label */
  label: string;
  /** Disabled state */
  disabled?: boolean;
}

/**
 * Props for Field.Radio component.
 */
export interface FieldRadioProps extends Omit<FormControlProps, 'name'> {
  /** Field name in the form */
  name: string;
  /** Radio options */
  options: RadioOption[];
  /** Label for the radio group */
  label?: string;
  /** Helper text */
  helperText?: string;
  /** Layout direction */
  row?: boolean;
  /** Validation rules for react-hook-form */
  rules?: RegisterOptions;
}

/**
 * Field.Radio - Radio group with React Hook Form integration.
 *
 * Includes comprehensive accessibility attributes:
 * - aria-describedby for helper text and error messages
 * - aria-invalid for error states
 * - aria-required for required fields
 * - Proper radiogroup role and label association
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.Radio
 *     name="gender"
 *     label="Gender"
 *     options={[
 *       { value: 'male', label: 'Male' },
 *       { value: 'female', label: 'Female' },
 *       { value: 'other', label: 'Other' },
 *     ]}
 *   />
 * </FormProvider>
 * ```
 */
export function FieldRadio({
  name,
  options,
  label,
  helperText,
  row = false,
  rules,
  required,
  ...other
}: FieldRadioProps): ReactNode {
  const { control } = useFormContext();
  const id = useId();
  const groupId = `field-radio-${id}`;
  const labelId = `field-radio-label-${id}`;
  const helperId = `field-radio-helper-${id}`;

  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field, fieldState: { error } }) => (
        <FormControl error={!!error} required={required} {...other}>
          {label && (
            <FormLabel id={labelId} htmlFor={groupId}>
              {label}
            </FormLabel>
          )}
          <RadioGroup
            {...field}
            id={groupId}
            row={row}
            value={field.value ?? ''}
            aria-labelledby={label ? labelId : undefined}
            aria-describedby={error?.message || helperText ? helperId : undefined}
            aria-invalid={!!error}
            aria-required={required}
          >
            {options.map((option, index) => (
              <FormControlLabel
                key={String(option.value)}
                value={option.value}
                control={
                  <Radio
                    id={`${groupId}-option-${index}`}
                    inputProps={{
                      'aria-label': option.label,
                    }}
                  />
                }
                label={option.label}
                disabled={option.disabled}
              />
            ))}
          </RadioGroup>
          {(error?.message || helperText) && (
            <FormHelperText id={helperId}>{error?.message ?? helperText}</FormHelperText>
          )}
        </FormControl>
      )}
    />
  );
}
