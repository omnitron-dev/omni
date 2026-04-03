'use client';

/**
 * Field.TimePicker Component
 *
 * React Hook Form integrated time picker using MUI X DatePickers.
 * Provides a professional time selection experience with dayjs integration.
 *
 * @module @omnitron/prism/components/field
 */

import type { ReactNode } from 'react';
import { Controller, useFormContext } from 'react-hook-form';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
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
 * Props for Field.TimePicker component.
 */
export interface FieldTimePickerProps {
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
  /** Minimum selectable time */
  minTime?: Dayjs;
  /** Maximum selectable time */
  maxTime?: Dayjs;
  /** Time views to display */
  views?: Array<'hours' | 'minutes' | 'seconds'>;
  /** Open picker to specific view */
  openTo?: 'hours' | 'minutes' | 'seconds';
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
 * Field.TimePicker - Time picker with React Hook Form integration.
 *
 * Uses @mui/x-date-pickers TimePicker for a professional time selection experience.
 * Automatically normalizes various date/time value types to Dayjs.
 *
 * @example
 * ```tsx
 * <FormProvider {...methods}>
 *   <Field.TimePicker
 *     name="startTime"
 *     label="Start Time"
 *   />
 *   <Field.TimePicker
 *     name="endTime"
 *     label="End Time"
 *     ampm={false}
 *     minutesStep={15}
 *   />
 * </FormProvider>
 * ```
 *
 * @example
 * ```tsx
 * // With custom text field props
 * <Field.TimePicker
 *   name="meetingTime"
 *   label="Meeting Time"
 *   textFieldProps={{
 *     variant: 'filled',
 *     size: 'small',
 *   }}
 * />
 * ```
 */
export function FieldTimePicker({
  name,
  label,
  helperText,
  textFieldProps,
  disabled,
  readOnly,
  minutesStep,
  ampm,
  minTime,
  maxTime,
  views,
  openTo,
  format,
}: FieldTimePickerProps): ReactNode {
  const { control } = useFormContext();

  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState: { error } }) => {
        const normalizedValue = normalizeValue(field.value);

        return (
          <TimePicker
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
            minTime={minTime}
            maxTime={maxTime}
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
