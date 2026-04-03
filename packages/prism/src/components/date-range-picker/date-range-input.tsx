'use client';

/**
 * DateRangeInput — Compact inline date range selector for filter toolbars.
 *
 * Renders as a clickable TextField that opens a DateRangePicker dialog.
 * Shows the selected range as a short label or placeholder.
 */

import type { DateRangeValue } from './use-date-range-picker.js';

import { useState, useCallback } from 'react';
import dayjs from 'dayjs';

import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import { DateRangePicker } from './date-range-picker.js';

// ---------------------------------------------------------------------------
// Icons (inline to avoid external deps)
// ---------------------------------------------------------------------------

function CalendarIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DateRangeInputProps {
  /** Label displayed on the field */
  label?: string;
  /** Start date as ISO string (YYYY-MM-DD) */
  startDate: string;
  /** End date as ISO string (YYYY-MM-DD) */
  endDate: string;
  /** Called when dates change */
  onChange: (startDate: string, endDate: string) => void;
  /** Minimum width */
  width?: number | string;
  /** Picker variant */
  variant?: 'calendar' | 'input';
  /** Size of the field */
  size?: 'small' | 'medium';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDayjs(value: string): DateRangeValue {
  if (!value) return null;
  const d = dayjs(value);
  return d.isValid() ? d : null;
}

function toIso(value: DateRangeValue): string {
  if (!value || !value.isValid()) return '';
  return value.format('YYYY-MM-DD');
}

function formatLabel(start: string, end: string): string {
  if (!start && !end) return '';
  const s = toDayjs(start);
  const e = toDayjs(end);
  if (s && e) {
    if (s.isSame(e, 'day')) return e.format('DD MMM YYYY');
    if (s.isSame(e, 'month')) return `${s.format('DD')} – ${e.format('DD MMM YYYY')}`;
    if (s.isSame(e, 'year')) return `${s.format('DD MMM')} – ${e.format('DD MMM YYYY')}`;
    return `${s.format('DD MMM YYYY')} – ${e.format('DD MMM YYYY')}`;
  }
  if (s) return `From ${s.format('DD MMM YYYY')}`;
  if (e) return `To ${e.format('DD MMM YYYY')}`;
  return '';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DateRangeInput({
  label = 'Date range',
  startDate,
  endDate,
  onChange,
  width = 220,
  variant = 'input',
  size = 'small',
}: DateRangeInputProps) {
  const [open, setOpen] = useState(false);
  const [tempStart, setTempStart] = useState<DateRangeValue>(toDayjs(startDate));
  const [tempEnd, setTempEnd] = useState<DateRangeValue>(toDayjs(endDate));

  const displayLabel = formatLabel(startDate, endDate);
  const hasValue = !!startDate || !!endDate;

  const handleOpen = useCallback(() => {
    setTempStart(toDayjs(startDate));
    setTempEnd(toDayjs(endDate));
    setOpen(true);
  }, [startDate, endDate]);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleSubmit = useCallback(() => {
    onChange(toIso(tempStart), toIso(tempEnd));
    setOpen(false);
  }, [tempStart, tempEnd, onChange]);

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onChange('', '');
    },
    [onChange]
  );

  const error = !!(tempStart && tempEnd && tempStart.isAfter(tempEnd));

  return (
    <>
      <TextField
        size={size}
        label={label}
        value={displayLabel}
        placeholder="Select dates..."
        onClick={handleOpen}
        slotProps={{
          input: {
            readOnly: true,
            sx: { cursor: 'pointer' },
            startAdornment: (
              <InputAdornment position="start" sx={{ color: 'text.disabled' }}>
                <CalendarIcon />
              </InputAdornment>
            ),
            ...(hasValue && {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={handleClear} sx={{ p: 0.25 }}>
                    <ClearIcon />
                  </IconButton>
                </InputAdornment>
              ),
            }),
          },
          inputLabel: { shrink: true },
        }}
        sx={{
          minWidth: width,
          '& .MuiOutlinedInput-root': { borderRadius: 1 },
          '& .MuiInputBase-input': { cursor: 'pointer' },
        }}
      />

      <DateRangePicker
        open={open}
        error={error}
        onClose={handleClose}
        onSubmit={handleSubmit}
        startDate={tempStart}
        endDate={tempEnd}
        onChangeStartDate={setTempStart}
        onChangeEndDate={setTempEnd}
        variant={variant}
        selected={!!(tempStart && tempEnd)}
        label=""
        shortLabel=""
        onOpen={handleOpen}
        onReset={() => {
          setTempStart(null);
          setTempEnd(null);
        }}
        setStartDate={setTempStart}
        setEndDate={setTempEnd}
      />
    </>
  );
}
