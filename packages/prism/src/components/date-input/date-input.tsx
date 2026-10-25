import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { TimePicker } from '@mui/x-date-pickers/TimePicker';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import type { Dayjs } from 'dayjs';
import type { FieldRef } from '@mui/x-date-pickers/models';
import type { SxProps, Theme } from '@mui/material/styles';
import { formatCalendarValue, parseCalendarValue, type CalendarValueKind, type CalendarPrecision } from './value.js';
export interface PrismCalendarInputProps {
  /** Calendar date, wall time, or local date-time; empty string means cleared. */
  value: string;
  onChange: (value: string) => void;
  label: ReactNode;
  /** Localized text for a partial, invalid, or out-of-range value. */
  invalidText: string;
  helperText?: ReactNode;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  min?: string;
  max?: string;
  precision?: CalendarPrecision;
  onValidityChange?: (valid: boolean) => void;
  sx?: SxProps<Theme>;
}
/** MUI's segmented keyboard editing/calendar/clock, with an explicit wall-value
 * contract. Invalid drafts remain visible but cannot submit a previous value. */
function CalendarInput({
  kind,
  value,
  onChange,
  label,
  invalidText,
  helperText,
  name,
  required,
  disabled,
  readOnly,
  size = 'medium',
  fullWidth = true,
  min,
  max,
  precision = 'minute',
  onValidityChange,
  sx,
}: PrismCalendarInputProps & { kind: CalendarValueKind }) {
  const [draft, setDraft] = useState(() => parseCalendarValue(value, kind));
  const [invalid, setInvalid] = useState(false);
  const [partial, setPartial] = useState(false);
  // MUI intentionally publishes null when one segment is deleted, while retaining
  // the other sections. Its public field API distinguishes that draft from clear.
  const captureField = useCallback((field: FieldRef<Dayjs | null> | null) => {
    if (!field) return;
    const sections = field.getSections();
    setPartial(sections.some((section) => section.value !== '') && sections.some((section) => section.value === ''));
  }, []);
  const invalidDraft = invalid || partial;
  const published = useRef(value);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (published.current !== value) {
      published.current = value;
      setDraft(parseCalendarValue(value, kind));
    }
  }, [value, kind]);
  useEffect(() => {
    input.current?.setCustomValidity(invalidDraft ? invalidText : '');
    onValidityChange?.(!invalidDraft);
  }, [invalidDraft, invalidText, onValidityChange]);
  const onValue = (next: Dayjs | null, context: { validationError: unknown }) => {
    const failed = context.validationError != null || (next !== null && !next.isValid());
    setDraft(next);
    setInvalid(failed);
    const text = failed ? '' : formatCalendarValue(next, kind, precision);
    published.current = text;
    onChange(text);
  };
  const props = {
    label,
    value: draft,
    timezone: 'UTC',
    onChange: onValue,
    onError: (error: unknown) => setInvalid(error != null),
    inputRef: input,
    disabled,
    readOnly,
    sx,
    slotProps: {
      textField: {
        name,
        required,
        size,
        fullWidth,
        error: invalidDraft,
        helperText: invalidDraft ? invalidText : helperText,
      },
      field: { clearable: true, fieldRef: captureField },
      actionBar: { actions: ['clear', 'cancel', 'accept'] as ('clear' | 'cancel' | 'accept')[] },
    },
  };
  const lower = min ? (parseCalendarValue(min, kind) ?? undefined) : undefined;
  const upper = max ? (parseCalendarValue(max, kind) ?? undefined) : undefined;
  if (kind === 'date') return <DatePicker {...props} minDate={lower} maxDate={upper} />;
  const views = precision === 'second' ? (['hours', 'minutes', 'seconds'] as const) : (['hours', 'minutes'] as const);
  if (kind === 'time') return <TimePicker {...props} ampm={false} views={[...views]} minTime={lower} maxTime={upper} />;
  return (
    <DateTimePicker {...props} ampm={false} views={['year', 'day', ...views]} minDateTime={lower} maxDateTime={upper} />
  );
}
export function PrismDatePicker(props: PrismCalendarInputProps) {
  return <CalendarInput {...props} kind="date" />;
}
export function PrismTimePicker(props: PrismCalendarInputProps) {
  return <CalendarInput {...props} kind="time" />;
}
export function PrismDateTimePicker(props: PrismCalendarInputProps) {
  return <CalendarInput {...props} kind="datetime" />;
}
