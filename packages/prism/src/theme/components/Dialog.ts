/**
 * Dialog Component Overrides
 *
 * MuiDialog + MuiDialogTitle + MuiDialogContent + MuiDialogActions
 * as one cohesive module. The visible inset is shared (24/16/20px
 * combinations) so co-locating the four keeps the spacing scale
 * obvious at a glance.
 *
 * @module @omnitron-dev/prism/theme/components/Dialog
 */

import type { Theme, Components } from '@mui/material/styles';
import type { ComponentsConfig } from '../../types/theme.js';
import { getDensityMultiplier, getGreyChannel } from './theme-utils.js';

/**
 * Bundle of dialog-family component overrides. Spread into the
 * top-level `Components<Theme>` map.
 */
export function createDialogOverrides(config: ComponentsConfig): {
  MuiDialog: Components<Theme>['MuiDialog'];
  MuiDialogTitle: Components<Theme>['MuiDialogTitle'];
  MuiDialogContent: Components<Theme>['MuiDialogContent'];
  MuiDialogActions: Components<Theme>['MuiDialogActions'];
} {
  const { density, borderRadius } = config;
  const dm = getDensityMultiplier(density);

  return {
    MuiDialog: {
      styleOverrides: {
        paper: ({ theme }) => ({
          boxShadow: `0 24px 48px -12px rgba(${getGreyChannel(theme, '900')} / 0.24)`,
          variants: [
            // Mobile-first: any dialog (non-fullScreen included) goes
            // edge-to-edge on < sm. MUI's `maxWidth`/`fullWidth` props
            // attach their own paper-sizing rules at the same
            // specificity tier — encoding the rule as a `variants`
            // entry lets MUI's styled engine compose it without the
            // !important pile that the old descendant override used.
            {
              props: () => true,
              style: {
                [theme.breakpoints.down('sm')]: {
                  margin: 0,
                  width: '100%',
                  maxWidth: 'none',
                  maxHeight: 'none',
                  height: '100%',
                  borderRadius: 0,
                },
              },
            },
            {
              props: (props: Record<string, unknown>) => !props.fullScreen,
              style: {
                borderRadius: borderRadius * 2,
                [theme.breakpoints.up('sm')]: {
                  margin: theme.spacing(2),
                },
              },
            },
          ],
        }),
      },
    },
    MuiDialogTitle: {
      styleOverrides: {
        root: ({ theme }) => ({
          padding: `${20 * dm}px ${24 * dm}px`,
          fontSize: theme.typography.pxToRem(18),
          fontWeight: 600,
          lineHeight: 28 / 18,
        }),
      },
    },
    MuiDialogContent: {
      styleOverrides: {
        root: {
          padding: `${16 * dm}px ${24 * dm}px`,
        },
      },
    },
    MuiDialogActions: {
      styleOverrides: {
        root: {
          padding: `${16 * dm}px ${24 * dm}px`,
          gap: 8,
        },
      },
    },
  };
}
