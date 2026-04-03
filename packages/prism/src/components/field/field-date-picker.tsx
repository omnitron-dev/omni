'use client';

/**
 * Field.DatePicker Component
 *
 * React Hook Form integrated date picker using MUI X DatePickers.
 * Consistent with Field.DateTimePicker and Field.TimePicker.
 *
 * @module @omnitron/prism/components/field
 */

import type { ReactNode } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import type { TextFieldProps } from '@mui/material/TextField';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

// =============================================================================
// TYPES
// =============================================================================

type DateValue = Dayjs | Date | string | number | null | undefined;

/**
 * Props for Field.DatePicker component.
 */
export interface FieldDatePickerProps {
  /** Field name in the form */
  name: string;
  /** Field label */
  label?: ReactNode;
  /** Helper text shown below the field */
  helperText?: ReactNode;
  /** TextField props for customization */
  textFieldProps?: Partial<TextFieldProps>;
  /** Disable the field */
  disabled?: boolean;
  /** Read-only mode */
  readOnly?: boolean;
  /** Minimum selectable date */
  minDate?: Dayjs;
  /** Maximum selectable date */
  maxDate?: Dayjs;
  /** Disable past dates */
  disablePast?: boolean;
  /** Disable future dates */
  disableFuture?: boolean;
  /** Views to display */
  views?: Array<'year' | 'month' | 'day'>;
  /** Open picker to specific view */
  openTo?: 'year' | 'month' | 'day';
  /** Format for display */
  format?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function normalizeValue(value: DateValue): Dayjs | null {
  if (value === null || value === undefined || value === '') return null;
  if (dayjs.isDayjs(value)) return value.isValid() ? value : null;
  if (value instanceof Date) {
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed : null;
  }
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
}

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Field.DatePicker - Date picker with React Hook Form integration.
 *
 * Uses @mui/x-date-pickers DatePicker for a polished calendar UI.
 * Stores value as ISO string for serialization compatibility.
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.DatePicker name="birthDate" label="Birth Date" />
 *   <Field.DatePicker name="deadline" label="Deadline" disablePast />
 * </FormProvider>
 * ```
 */
export function FieldDatePicker({
  name,
  label,
  helperText,
  textFieldProps,
  disabled,
  readOnly,
  minDate,
  maxDate,
  disablePast,
  disableFuture,
  views,
  openTo,
  format,
}: FieldDatePickerProps): ReactNode {
  const { control } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        const normalizedValue = normalizeValue(field.value);

        return (
          <DatePicker
            label={label}
            value={normalizedValue}
            onChange={(newValue: Dayjs | null) => {
              field.onChange(newValue?.toISOString() ?? null);
            }}
            disabled={disabled}
            readOnly={readOnly}
            minDate={minDate}
            maxDate={maxDate}
            disablePast={disablePast}
            disableFuture={disableFuture}
            views={views}
            openTo={openTo}
            format={format}
            slotProps={{
              textField: {
                fullWidth: true,
                error: !!error,
                helperText: error?.message ?? helperText,
                ...textFieldProps,
              },
            }}
          />
        );
      }}
    />
  );
}
