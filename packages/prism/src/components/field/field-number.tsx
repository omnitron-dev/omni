'use client';

/**
 * Field.Number Component
 *
 * React Hook Form integrated number field with proper numeric handling
 * and full accessibility support.
 *
 * @module components/field
 */

import type { ReactNode, ComponentProps } from 'react';
import { useCallback, useState, useEffect, useId, useMemo, useRef } from 'react';
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

  // The last value this input pushed into the form. Anything else arriving in
  // `field.value` came from outside (a reset, a setValue, a server default).
  const committedRef = useRef<unknown>(field.value);

  // Re-render the box from the form value ONLY when the form value changed
  // externally.
  //
  // This effect used to run on every render and unconditionally overwrite the
  // display. Two consequences, both user-visible: a decimal separator could
  // never be typed (mid-entry "1." parses to 1 and formats back to "1", so the
  // character vanished as it was typed), and any unrelated parent re-render —
  // form validation, a sibling field updating — reformatted whatever was
  // half-typed. `options` was rebuilt on every render too, so the dependency
  // array never held it still.
  useEffect(() => {
    if (Object.is(field.value, committedRef.current)) return;
    committedRef.current = field.value;
    setDisplayValue(transformForDisplay(field.value ?? options.defaultValue ?? 0, options));
  }, [field.value, options]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const transformed = transformOnChange(e.target.value, options);
      setDisplayValue(transformed);

      // Update form value if we have a valid number
      const num = parseFloat(transformed);
      if (!isNaN(num)) {
        committedRef.current = num;
        field.onChange(num);
      } else if (transformed === '' || transformed === '-') {
        // Intermediate states ('' while clearing, '-' before the digits) are
        // kept in the display and reported as `undefined` rather than being
        // silently replaced with the default. Substituting the default here
        // meant the box could not be emptied — it refilled with 0 — and a
        // `required` rule could never fire, because the form always held a
        // number.
        committedRef.current = undefined;
        field.onChange(undefined);
      }
    },
    [field, options]
  );

  const handleBlur = useCallback(() => {
    const finalValue = transformOnBlur(displayValue || String(field.value ?? options.defaultValue ?? 0), options);
    committedRef.current = finalValue;
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
        ...slotProps,
        formHelperText: {
          id: helperId,
          ...slotProps?.formHelperText,
        },
        // Merged, not overwritten: spreading the caller's `slotProps` last
        // replaced `htmlInput` wholesale, so passing any input prop silently
        // stripped every aria attribute below.
        htmlInput: {
          inputMode: options.decimals === 0 ? 'numeric' : 'decimal',
          'aria-describedby': error?.message || helperText ? helperId : undefined,
          'aria-invalid': !!error,
          'aria-required': required,
          'aria-valuemin': options.min,
          'aria-valuemax': options.max,
          'aria-valuenow': field.value ?? options.defaultValue ?? 0,
          ...(slotProps?.htmlInput as object | undefined),
        },
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

  // Memoised on the primitives: rebuilding this object every render made it a
  // new dependency each time for the effect and callbacks inside NumberInput.
  const options: TransformNumberOptions = useMemo(
    () => ({ min, max, decimals, allowNegative, defaultValue }),
    [min, max, decimals, allowNegative, defaultValue]
  );

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
