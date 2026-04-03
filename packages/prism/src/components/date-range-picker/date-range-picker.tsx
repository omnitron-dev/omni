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

export type DateRangePickerProps = DialogProps &
  UseDateRangePickerReturn & {
    onSubmit?: () => void;
    variant?: 'calendar' | 'input';
    title?: string;
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
  title = 'Select date range',
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
      <DialogTitle>{title}</DialogTitle>

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
            <DatePicker label="Start date" value={startDate} onChange={onChangeStartDate} />
            <DatePicker label="End date" value={endDate} onChange={onChangeEndDate} />
          </>
        )}

        {error && (
          <FormHelperText error sx={{ px: 2 }}>
            End date must be later than start date
          </FormHelperText>
        )}
      </DialogContent>

      <DialogActions>
        <Button variant="outlined" color="inherit" onClick={handleClose}>
          Cancel
        </Button>
        <Button disabled={error} variant="contained" onClick={handleSubmit}>
          Apply
        </Button>
      </DialogActions>
    </Dialog>
  );
}
