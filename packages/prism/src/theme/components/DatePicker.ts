/**
 * Date Picker (MUI X) Component Overrides
 *
 * MuiDatePicker + MuiPickersLayout + MuiPickersDay + MuiPickersYear
 * + MuiPickersMonth as one cohesive module. They share the picker
 * grid's rhythm (day buttons borderRadius, today indicator, etc.)
 * so it makes sense to co-locate.
 *
 * @module @omnitron-dev/prism/theme/components/DatePicker
 */

import type { Theme, Components } from '@mui/material/styles';
import type { ComponentsConfig } from '../../types/theme.js';
import { paletteVar } from './theme-utils.js';

// MuiPickers* keys aren't on the public `Components<Theme>` map
// (they live on @mui/x-date-pickers' separate theme augmentation),
// so the return type uses a permissive Record for those slots.
export function createDatePickerOverrides(config: ComponentsConfig): {
  MuiDatePicker: Record<string, unknown>;
  MuiPickersLayout: Record<string, unknown>;
  MuiPickersDay: Record<string, unknown>;
  MuiPickersYear: Record<string, unknown>;
  MuiPickersMonth: Record<string, unknown>;
} {
  const { density, borderRadius } = config;

  return {
    MuiDatePicker: {
      defaultProps: {
        slotProps: {
          openPickerButton: {
            size: density === 'compact' ? 'small' : 'medium',
          },
        },
      },
    },
    MuiPickersLayout: {
      styleOverrides: {
        root: ({ theme }: { theme: Theme }) => ({
          '& .MuiPickersLayout-actionBar': {
            padding: theme.spacing(1, 2),
          },
        }),
      },
    },
    MuiPickersDay: {
      styleOverrides: {
        root: () => ({
          borderRadius: borderRadius - 2,
          fontWeight: 400,
          '&.Mui-selected': {
            fontWeight: 600,
          },
        }),
        today: ({ theme }: { theme: Theme }) => ({
          borderColor: paletteVar(theme, 'primary.main'),
          '&:not(.Mui-selected)': {
            backgroundColor: 'transparent',
          },
        }),
      },
    },
    MuiPickersYear: {
      styleOverrides: {
        yearButton: () => ({
          borderRadius,
          '&.Mui-selected': {
            fontWeight: 600,
          },
        }),
      },
    },
    MuiPickersMonth: {
      styleOverrides: {
        monthButton: () => ({
          borderRadius,
          '&.Mui-selected': {
            fontWeight: 600,
          },
        }),
      },
    },
  };
}
