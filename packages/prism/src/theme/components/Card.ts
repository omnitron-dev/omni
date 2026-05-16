/**
 * Card Component Overrides
 *
 * MuiCard + MuiCardHeader + MuiCardContent + MuiCardActions as one
 * cohesive module. The padding rhythm (16/20 at default density,
 * scaled by `dm`) is shared across all four — co-locating them
 * keeps the rhythm explicit and lets a theme tweak land in one
 * place.
 *
 * @module @omnitron-dev/prism/theme/components/Card
 */

import type { Theme, Components } from '@mui/material/styles';
import type { ComponentsConfig } from '../../types/theme.js';
import { getDensityMultiplier, getGreyChannel, paletteVar } from './theme-utils.js';

export function createCardOverrides(config: ComponentsConfig): {
  MuiCard: Components<Theme>['MuiCard'];
  MuiCardHeader: Components<Theme>['MuiCardHeader'];
  MuiCardContent: Components<Theme>['MuiCardContent'];
  MuiCardActions: Components<Theme>['MuiCardActions'];
} {
  const { density, borderRadius } = config;
  const dm = getDensityMultiplier(density);

  return {
    MuiCard: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: ({ theme }) => ({
          position: 'relative',
          zIndex: 0, // Safari stacking context fix
          borderRadius: borderRadius * 1.5,
          border: `1px solid ${paletteVar(theme, 'divider')}`,
          backgroundImage: 'none',
          boxShadow: `0 0 2px 0 rgba(${getGreyChannel(theme)} / 0.2), 0 12px 24px -4px rgba(${getGreyChannel(theme)} / 0.12)`,
        }),
      },
    },
    MuiCardHeader: {
      defaultProps: {
        slotProps: {
          title: { variant: 'h6' },
          subheader: { variant: 'body2' },
        },
      },
      styleOverrides: {
        root: {
          padding: `${16 * dm}px ${20 * dm}px`,
        },
        title: ({ theme }) => ({
          fontSize: theme.typography.pxToRem(16),
          fontWeight: 600,
          lineHeight: 1.5,
        }),
        subheader: ({ theme }) => ({
          fontSize: theme.typography.pxToRem(14),
          lineHeight: 22 / 14,
          color: paletteVar(theme, 'text.secondary'),
        }),
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: `${16 * dm}px ${20 * dm}px`,
          '&:last-child': {
            paddingBottom: 16 * dm,
          },
        },
      },
    },
    MuiCardActions: {
      styleOverrides: {
        root: {
          padding: `${12 * dm}px ${20 * dm}px`,
          gap: 8,
        },
      },
    },
  };
}
