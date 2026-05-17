/**
 * DataGrid (MUI X) Component Overrides
 *
 * MuiDataGrid uses descendant `& .MuiDataGrid-X` selectors instead
 * of per-slot styleOverrides — that's the official theming API for
 * DataGrid in MUI X (slots exposed via internal class names), not
 * an anti-pattern.
 *
 * @module @omnitron-dev/prism/theme/components/DataGrid
 */

import type { Theme, Components } from '@mui/material/styles';
// Module augmentation: registers `MuiDataGrid` on `Components<Theme>`
// so `Components<Theme>['MuiDataGrid']` typechecks. The DataGrid lives
// in a separate `@mui/x-data-grid` package, so its augmentation entry
// must be imported explicitly by any consumer that themes it.
import '@mui/x-data-grid/themeAugmentation';
import type { ComponentsConfig } from '../../types/theme.js';
import { getColorChannel, getGreyChannel, paletteVar } from './theme-utils.js';

export function createDataGridOverrides(config: ComponentsConfig): Components<Theme>['MuiDataGrid'] {
  const { borderRadius } = config;

  return {
    styleOverrides: {
      root: ({ theme }: { theme: Theme }) => ({
        border: 'none',
        borderRadius,
        // background.neutral falls back to grey[50] (different path
        // on either side) — kept as a manual chain rather than
        // paletteVar() so the fallback is explicit.
        '--DataGrid-containerBackground':
          theme.vars?.palette.background.neutral || theme.palette.grey[50],
        '--DataGrid-pinnedBackground': paletteVar(theme, 'background.paper'),
        '& .MuiDataGrid-columnHeaders': {
          borderBottom: `1px solid ${paletteVar(theme, 'divider')}`,
        },
        '& .MuiDataGrid-columnHeader': {
          fontWeight: 600,
          fontSize: theme.typography.pxToRem(14),
          color: paletteVar(theme, 'text.secondary'),
          '&:focus, &:focus-within': {
            outline: 'none',
          },
        },
        '& .MuiDataGrid-cell': {
          borderBottom: `1px solid rgba(${getGreyChannel(theme)} / 0.12)`,
          '&:focus, &:focus-within': {
            outline: 'none',
          },
        },
        '& .MuiDataGrid-row': {
          '&:hover': {
            backgroundColor: paletteVar(theme, 'action.hover'),
          },
          '&.Mui-selected': {
            backgroundColor: `rgba(${getColorChannel(theme, 'primary')} / 0.08)`,
            '&:hover': {
              backgroundColor: `rgba(${getColorChannel(theme, 'primary')} / 0.12)`,
            },
          },
        },
        '& .MuiDataGrid-footerContainer': {
          borderTop: `1px solid ${paletteVar(theme, 'divider')}`,
        },
        '& .MuiDataGrid-selectedRowCount': {
          whiteSpace: 'nowrap',
        },
        '& .MuiDataGrid-toolbarContainer': {
          padding: theme.spacing(1.5, 1.5, 0.5),
          gap: theme.spacing(1),
        },
        '& .MuiDataGrid-columnSeparator': {
          color: paletteVar(theme, 'divider'),
        },
      }),
    },
  };
}
