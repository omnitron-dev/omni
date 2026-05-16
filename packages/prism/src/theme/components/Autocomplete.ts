/**
 * Autocomplete Component Overrides
 *
 * @module @omnitron-dev/prism/theme/components/Autocomplete
 */

import type { Theme, Components } from '@mui/material/styles';
import type { ComponentsConfig } from '../../types/theme.js';
import { autocompleteClasses } from '@mui/material/Autocomplete';
import { svgIconClasses } from '@mui/material/SvgIcon';
import { getGreyChannel, paletteVar } from './theme-utils.js';

export function createAutocompleteOverrides(config: ComponentsConfig): Components<Theme>['MuiAutocomplete'] {
  const { borderRadius } = config;

  return {
    styleOverrides: {
      paper: ({ theme }) => ({
        borderRadius,
        boxShadow: `0 0 2px 0 rgba(${getGreyChannel(theme)} / 0.24), -20px 20px 40px -4px rgba(${getGreyChannel(theme)} / 0.24)`,
      }),
      listbox: {
        padding: 4,
      },
      option: ({ theme }) => ({
        borderRadius: borderRadius - 2,
        margin: 2,
        [`&.${autocompleteClasses.focused}`]: {
          backgroundColor: paletteVar(theme, 'action.hover'),
        },
        '&[aria-selected="true"]': {
          backgroundColor: paletteVar(theme, 'action.selected'),
          fontWeight: 500,
          [`&.${autocompleteClasses.focused}`]: {
            backgroundColor: paletteVar(theme, 'action.hover'),
          },
        },
      }),
      popupIndicator: {
        [`& .${svgIconClasses.root}`]: {
          fontSize: 20,
        },
      },
      clearIndicator: {
        [`& .${svgIconClasses.root}`]: {
          fontSize: 18,
        },
      },
    },
  };
}
