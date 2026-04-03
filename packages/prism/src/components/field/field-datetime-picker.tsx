'use client';

/**
 * Field.DateTimePicker Component
 *
 * React Hook Form integrated date-time picker using MUI X DatePickers.
 * Combines date and time selection in a single component.
 *
 * @module @omnitron-dev/prism/components/field
 */

import type { ReactNode } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import type { TextFieldProps } from '@mui/material/TextField';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Value types that can be normalized to Dayjs
 */
type DateValue = Dayjs | Date | string | number | null | undefined;

/**
 * Props for Field.DateTimePicker component.
 */
export interface FieldDateTimePickerProps {
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
  /** Minutes step for time selection */
  minutesStep?: number;
  /** Use 12-hour format with AM/PM */
  ampm?: boolean;
  /** Minimum selectable datetime */
  minDateTime?: Dayjs;
  /** Maximum selectable datetime */
  maxDateTime?: Dayjs;
  /** Disable past dates */
  disablePast?: boolean;
  /** Disable future dates */
  disableFuture?: boolean;
  /** Views to display */
  views?: Array<'year' | 'month' | 'day' | 'hours' | 'minutes' | 'seconds'>;
  /** Open picker to specific view */
  openTo?: 'year' | 'month' | 'day' | 'hours' | 'minutes' | 'seconds';
  /** Format for display */
  format?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Normalize various date value types to Dayjs or null.
 * Handles Dayjs, Date, string, number, null, and undefined.
 */
function normalizeValue(value: DateValue): Dayjs | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  // Already Dayjs
  if (dayjs.isDayjs(value)) {
    return value.isValid() ? value : null;
  }

  // Date object
  if (value instanceof Date) {
    const parsed = dayjs(value);
    return parsed.isValid() ? parsed : null;
  }

  // String or number
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed : null;
}

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Field.DateTimePicker - Combined date and time picker with React Hook Form integration.
 *
 * Uses @mui/x-date-pickers DateTimePicker for comprehensive date-time selection.
 * Automatically normalizes various date/time value types to Dayjs.
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.DateTimePicker
 *     name="eventStart"
 *     label="Event Start"
 *   />
 *   <Field.DateTimePicker
 *     name="eventEnd"
 *     label="Event End"
 *     ampm={false}
 *     minutesStep={15}
 *   />
 * </FormProvider>
 * ```
 *
 * @example
 * ```tsx
 * // With date constraints
 * <Field.DateTimePicker
 *   name="appointment"
 *   label="Appointment"
 *   minDateTime={dayjs()}
 *   maxDateTime={dayjs().add(30, 'day')}
 *   disablePast
 * />
 * ```
 *
 * @example
 * ```tsx
 * // With custom views
 * <Field.DateTimePicker
 *   name="scheduledAt"
 *   label="Schedule"
 *   views={['year', 'month', 'day', 'hours', 'minutes']}
 *   textFieldProps={{
 *     variant: 'filled',
 *     size: 'small',
 *   }}
 * />
 * ```
 */
export function FieldDateTimePicker({
  name,
  label,
  helperText,
  textFieldProps,
  disabled,
  readOnly,
  minutesStep,
  ampm,
  minDateTime,
  maxDateTime,
  disablePast,
  disableFuture,
  views,
  openTo,
  format,
}: FieldDateTimePickerProps): ReactNode {
  const { control } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        const normalizedValue = normalizeValue(field.value);

        return (
          <DateTimePicker
            label={label}
            value={normalizedValue}
            onChange={(newValue: Dayjs | null) => {
              // Store as ISO string for serialization compatibility
              field.onChange(newValue?.toISOString() ?? null);
            }}
            disabled={disabled}
            readOnly={readOnly}
            minutesStep={minutesStep}
            ampm={ampm}
            minDateTime={minDateTime}
            maxDateTime={maxDateTime}
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
