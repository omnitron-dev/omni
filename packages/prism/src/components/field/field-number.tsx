'use client';

/**
 * Field.Number Component
 *
 * React Hook Form integrated number field with proper numeric handling
 * and full accessibility support.
 *
 * @module @omnitron/prism/components/field
 */

import type { ReactNode, ComponentProps } from 'react';
import { useCallback, useState, useEffect, useId } from 'react';
import {
  Controller,
  useFormContext,
  type RegisterOptions,
  type ControllerRenderProps,
  type FieldValues,
  type FieldError,
} from 'react-hook-form';
import TextField from '@mui/material/TextField';
import type { TransformNumberOptions } from '../../utils/transform-number.js';
import { transformOnChange, transformOnBlur, transformForDisplay } from '../../utils/transform-number.js';

/**
 * Props for Field.Number component.
 */
export interface FieldNumberProps extends Omit<ComponentProps<typeof TextField>, 'name' | 'type'> {
  /** Field name in the form */
  name: string;
  /** Minimum allowed value */
  min?: number;
  /** Maximum allowed value */
  max?: number;
  /** Decimal places to allow */
  decimals?: number;
  /** Allow negative numbers */
  allowNegative?: boolean;
  /** Default value when input is empty */
  defaultValue?: number;
  /** Validation rules for react-hook-form */
  rules?: RegisterOptions;
}

/**
 * Internal props for the number input renderer.
 * Excludes 'error' from FieldNumberProps because TextField's error is boolean,
 * but we need FieldError from react-hook-form.
 */
interface NumberInputProps extends Omit<FieldNumberProps, 'name' | 'rules' | 'error'> {
  field: ControllerRenderProps<FieldValues, string>;
  error?: FieldError;
  options: TransformNumberOptions;
  inputId: string;
  helperId: string;
}

/**
 * Internal component that handles the number input rendering.
 * Extracted to comply with Rules of Hooks - hooks must be called at top level.
 *
 * Includes comprehensive accessibility attributes:
 * - aria-describedby for helper text and error messages
 * - aria-invalid for error states
 * - aria-valuemin/max for range constraints
 * - Proper inputMode for numeric keyboard
 */
function NumberInput({
  field,
  error,
  options,
  helperText,
  inputId,
  helperId,
  required,
  slotProps,
  ...other
}: NumberInputProps): ReactNode {
  const [displayValue, setDisplayValue] = useState<string>(() =>
    transformForDisplay(field.value ?? options.defaultValue ?? 0, options)
  );

  // Sync display value when field value changes externally (e.g., form reset)
  useEffect(() => {
    const formatted = transformForDisplay(field.value ?? options.defaultValue ?? 0, options);
    setDisplayValue(formatted);
  }, [field.value, options]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const transformed = transformOnChange(e.target.value, options);
      setDisplayValue(transformed);

      // Update form value if we have a valid number
      const num = parseFloat(transformed);
      if (!isNaN(num)) {
        field.onChange(num);
      } else if (transformed === '' || transformed === '-') {
        // Keep intermediate states for UX
        field.onChange(options.defaultValue ?? 0);
      }
    },
    [field, options]
  );

  const handleBlur = useCallback(() => {
    const finalValue = transformOnBlur(displayValue || String(field.value ?? options.defaultValue ?? 0), options);
    field.onChange(finalValue);
    setDisplayValue(transformForDisplay(finalValue, options));
    field.onBlur();
  }, [displayValue, field, options]);

  return (
    <TextField
      {...other}
      id={inputId}
      fullWidth
      value={displayValue}
      onChange={handleChange}
      onBlur={handleBlur}
      error={!!error}
      helperText={error?.message ?? helperText}
      required={required}
      slotProps={{
        formHelperText: {
          id: helperId,
        },
        htmlInput: {
          inputMode: options.decimals === 0 ? 'numeric' : 'decimal',
          'aria-describedby': error?.message || helperText ? helperId : undefined,
          'aria-invalid': !!error,
          'aria-required': required,
          'aria-valuemin': options.min,
          'aria-valuemax': options.max,
          'aria-valuenow': field.value ?? options.defaultValue ?? 0,
        },
        ...slotProps,
      }}
    />
  );
}

/**
 * Field.Number - Number input with proper numeric handling.
 * Uses transformNumber utilities for three-phase input handling.
 *
 * Includes comprehensive accessibility attributes:
 * - aria-describedby for helper text and error messages
 * - aria-invalid for error states
 * - aria-valuemin/max for range constraints
 * - Proper inputMode for numeric keyboard
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.Number name="quantity" label="Quantity" min={1} max={100} />
 *   <Field.Number name="price" label="Price" decimals={2} min={0} />
 * </FormProvider>
 * ```
 */
export function FieldNumber({
  name,
  min,
  max,
  decimals,
  allowNegative = true,
  defaultValue = 0,
  rules,

  error: _error,
  ...other
}: FieldNumberProps): ReactNode {
  const { control } = useFormContext();
  const id = useId();
  const inputId = `field-number-${id}`;
  const helperId = `field-number-helper-${id}`;

  const options: TransformNumberOptions = {
    min,
    max,
    decimals,
    allowNegative,
    defaultValue,
  };

  return (
    <Controller
      name={name}
      control={control}
      rules={rules}
      render={({ field, fieldState: { error } }) => (
        <NumberInput field={field} error={error} options={options} inputId={inputId} helperId={helperId} {...other} />
      )}
    />
  );
}
