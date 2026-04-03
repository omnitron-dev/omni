'use client';

import type { Dayjs } from 'dayjs';

import { useState, useCallback } from 'react';
import dayjs from 'dayjs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DateRangeValue = Dayjs | null;

export interface UseDateRangePickerReturn {
  startDate: DateRangeValue;
  endDate: DateRangeValue;
  onChangeStartDate: (value: DateRangeValue) => void;
  onChangeEndDate: (value: DateRangeValue) => void;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onReset: () => void;
  selected: boolean;
  error: boolean;
  label: string;
  shortLabel: string;
  setStartDate: React.Dispatch<React.SetStateAction<DateRangeValue>>;
  setEndDate: React.Dispatch<React.SetStateAction<DateRangeValue>>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAfter(start: DateRangeValue, end: DateRangeValue): boolean {
  if (!start || !end) return false;
  return start.isAfter(end);
}

function formatRangeLabel(start: DateRangeValue, end: DateRangeValue, full?: boolean): string {
  if (!start || !end) return '';
  if (!start.isValid() || !end.isValid() || start.isAfter(end)) return '';

  if (full) {
    return `${start.format('DD MMM YYYY')} - ${end.format('DD MMM YYYY')}`;
  }

  if (start.isSame(end, 'day')) return end.format('DD MMM YYYY');
  if (start.isSame(end, 'month')) return `${start.format('DD')} - ${end.format('DD MMM YYYY')}`;
  if (start.isSame(end, 'year')) return `${start.format('DD MMM')} - ${end.format('DD MMM YYYY')}`;
  return `${start.format('DD MMM YYYY')} - ${end.format('DD MMM YYYY')}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDateRangePicker(
  initialStart: DateRangeValue = null,
  initialEnd: DateRangeValue = null
): UseDateRangePickerReturn {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState<DateRangeValue>(initialStart);
  const [endDate, setEndDate] = useState<DateRangeValue>(initialEnd);

  const error = isAfter(startDate, endDate);

  const onOpen = useCallback(() => setOpen(true), []);
  const onClose = useCallback(() => setOpen(false), []);

  const onChangeStartDate = useCallback((value: DateRangeValue) => {
    setStartDate(value);
  }, []);

  const onChangeEndDate = useCallback(
    (value: DateRangeValue) => {
      if (error) setEndDate(null);
      setEndDate(value);
    },
    [error]
  );

  const onReset = useCallback(() => {
    setStartDate(null);
    setEndDate(null);
  }, []);

  return {
    startDate,
    endDate,
    onChangeStartDate,
    onChangeEndDate,
    open,
    onOpen,
    onClose,
    onReset,
    error,
    selected: !!startDate && !!endDate,
    label: formatRangeLabel(startDate, endDate, true),
    shortLabel: formatRangeLabel(startDate, endDate),
    setStartDate,
    setEndDate,
  };
}

/**
 * Parse a YYYY-MM-DD string to Dayjs or null.
 */
export function parseDateString(value: string | undefined | null): DateRangeValue {
  if (!value) return null;
  const d = dayjs(value);
  return d.isValid() ? d : null;
}

/**
 * Format a Dayjs value to YYYY-MM-DD string or empty string.
 */
export function formatDateString(value: DateRangeValue): string {
  if (!value || !value.isValid()) return '';
  return value.format('YYYY-MM-DD');
}
