'use client';

/**
 * DateRangePicker — Dialog-based date range selector.
 *
 * Responsive: shows calendar view on desktop, input fields on mobile.
 * Based on @mui/x-date-pickers DatePicker and DateCalendar.
 */

import type { DialogProps } from '@mui/material/Dialog';
import type { PaperProps } from '@mui/material/Paper';
import type { UseDateRangePickerReturn } from './use-date-range-picker.js';

import { useCallback } from 'react';

import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import useMediaQuery from '@mui/material/useMediaQuery';
import FormHelperText from '@mui/material/FormHelperText';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { DateCalendar, dateCalendarClasses } from '@mui/x-date-pickers/DateCalendar';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Translatable strings rendered inside the picker dialog.
 *
 * Prism components stay framework-agnostic: we don't depend on
 * react-i18next here. Consumers pass already-translated strings via
 * this prop. Every key is optional so callers can override only the
 * ones they need; missing keys fall back to English.
 */
export interface DateRangePickerTranslations {
  /** Dialog title — "Select date range" */
  title?: string;
  /** Start-date input label (mobile/input variant) — "Start date" */
  startDate?: string;
  /** End-date input label (mobile/input variant) — "End date" */
  endDate?: string;
  /** Helper text when end < start — "End date must be later than start date" */
  errorRange?: string;
  /** Cancel button — "Cancel" */
  cancel?: string;
  /** Apply button — "Apply" */
  apply?: string;
}

export type DateRangePickerProps = DialogProps &
  UseDateRangePickerReturn & {
    onSubmit?: () => void;
    variant?: 'calendar' | 'input';
    /** @deprecated Use `translations.title` instead. */
    title?: string;
    translations?: DateRangePickerTranslations;
  };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DateRangePicker({
  open,
  error,
  onClose,
  onSubmit,
  startDate,
  endDate,
  onChangeStartDate,
  onChangeEndDate,
  slotProps,
  variant = 'input',
  title,
  translations,
  // Exclude hook props that shouldn't go to Dialog
  selected: _selected,
  label: _label,
  shortLabel: _shortLabel,
  onOpen: _onOpen,
  onReset: _onReset,
  setStartDate: _setStartDate,
  setEndDate: _setEndDate,
  ...other
}: DateRangePickerProps) {
  // Precedence: explicit translations > legacy `title` prop > English default.
  const txTitle = translations?.title ?? title ?? 'Select date range';
  const txStart = translations?.startDate ?? 'Start date';
  const txEnd = translations?.endDate ?? 'End date';
  const txErrorRange = translations?.errorRange ?? 'End date must be later than start date';
  const txCancel = translations?.cancel ?? 'Cancel';
  const txApply = translations?.apply ?? 'Apply';
  const mdUp = useMediaQuery((theme: any) => theme.breakpoints.up('md'));
  const isCalendarView = mdUp && variant === 'calendar';

  const handleSubmit = useCallback(() => {
    onClose({}, 'backdropClick');
    onSubmit?.();
  }, [onClose, onSubmit]);

  const handleClose = useCallback(() => {
    onClose({}, 'backdropClick');
  }, [onClose]);

  const dialogPaperSx = (slotProps?.paper as PaperProps)?.sx;

  return (
    <Dialog
      fullWidth
      open={open}
      onClose={onClose}
      maxWidth={isCalendarView ? false : 'xs'}
      slotProps={{
        ...slotProps,
        paper: {
          ...slotProps?.paper,
          sx: [
            { ...(isCalendarView && { maxWidth: 720 }) },
            ...(Array.isArray(dialogPaperSx) ? dialogPaperSx : dialogPaperSx ? [dialogPaperSx] : []),
          ],
        },
      }}
      {...other}
    >
      <DialogTitle>{txTitle}</DialogTitle>

      <DialogContent
        sx={[
          (theme) => ({
            gap: 3,
            display: 'flex',
            overflow: 'unset',
            flexDirection: isCalendarView ? 'row' : 'column',
            [`& .${dateCalendarClasses.root}`]: {
              borderRadius: 2,
              border: `dashed 1px ${theme.palette.divider}`,
            },
          }),
        ]}
      >
        {isCalendarView ? (
          <>
            <DateCalendar value={startDate} onChange={onChangeStartDate} />
            <DateCalendar value={endDate} onChange={onChangeEndDate} />
          </>
        ) : (
          <>
            <DatePicker label={txStart} value={startDate} onChange={onChangeStartDate} />
            <DatePicker label={txEnd} value={endDate} onChange={onChangeEndDate} />
          </>
        )}

        {error && (
          <FormHelperText error sx={{ px: 2 }}>
            {txErrorRange}
          </FormHelperText>
        )}
      </DialogContent>

      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={handleClose}>
          {txCancel}
        </Button>
        <Button disabled={error} variant="contained" onClick={handleSubmit}>
          {txApply}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
