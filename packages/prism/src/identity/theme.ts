import { alpha, type Theme, type ThemeOptions } from '@mui/material/styles';
import { createTypography, typography } from '../theme/typography.js';
import { rootColorSchemeStyles, systemColorSchemeStyles } from '../theme/color-scheme.js';
import { omnitronCssVariables, omnitronTokens, type OmnitronColorMode } from './tokens.js';

/** Use as PrismProvider.themeOverrides in both Console and the public website. */
export function omnitronTheme({ mode }: { mode: OmnitronColorMode }): ThemeOptions & Record<string, unknown> {
  const color = omnitronTokens.color[mode];
  const focus = { outline: '2px solid var(--omni-accent)', outlineOffset: 3 };
  const overlay = ({ theme }: { theme: Theme }) => ({
    borderRadius: omnitronTokens.radius,
    border: '1px solid var(--omni-border)',
    boxShadow: '0 8px 24px rgb(0 0 0 / .1)',
    ...theme.applyStyles('dark', { boxShadow: '0 8px 24px rgb(0 0 0 / .24)' }),
  });
  return {
    palette: {
      primary: { main: color.accent, contrastText: color.onAccent },
      secondary: { main: color.muted },
      success: { main: color.success },
      warning: { main: color.warning },
      error: { main: color.error },
      info: { main: color.info },
      text: { primary: color.text, secondary: color.muted, disabled: color.disabled },
      divider: color.border,
      background: {
        default: color.background, paper: color.surface, neutral: color.raised,
        elevation1: color.surface, elevation2: color.raised, elevation3: color.raised,
        elevation4: color.raised, menu: color.surface, menuElevation1: color.raised, menuElevation2: color.raised,
      },
      action: {
        active: color.muted, hover: alpha(color.text, 0.05), selected: alpha(color.accent, 0.1),
        focus: alpha(color.accent, 0.16), disabled: color.disabled, disabledBackground: color.raised,
      },
    },
    shape: { borderRadius: omnitronTokens.radius },
    typography: {
      ...createTypography({
        fontFamily: { primary: omnitronTokens.font.sans, secondary: omnitronTokens.font.sans, mono: omnitronTokens.font.mono },
        fontWeights: typography.fontWeights,
      }),
      h1: { fontFamily: omnitronTokens.font.sans, fontSize: '3rem', fontWeight: 600, lineHeight: 1.12, letterSpacing: '-0.04em' },
      h2: { fontFamily: omnitronTokens.font.sans, fontSize: '2.25rem', fontWeight: 600, lineHeight: 1.2, letterSpacing: '-0.035em' },
      overline: { fontFamily: omnitronTokens.font.mono, fontSize: '0.75rem', fontWeight: 500, lineHeight: 1.5, letterSpacing: '0.08em' },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: (theme) => ({
          ':root': omnitronCssVariables((theme.defaultColorScheme ?? theme.palette.mode) === 'dark' ? 'dark' : 'light'),
          ...rootColorSchemeStyles(theme, 'light', omnitronCssVariables('light')),
          ...rootColorSchemeStyles(theme, 'dark', omnitronCssVariables('dark')),
          ...systemColorSchemeStyles(theme, 'dark', omnitronCssVariables('dark')),
          body: { WebkitFontSmoothing: 'antialiased' },
          'code, kbd, pre, samp': { fontFamily: omnitronTokens.font.mono },
          'a:focus-visible, button:focus-visible, [tabindex]:focus-visible': focus,
          '::selection': { backgroundColor: 'color-mix(in srgb, var(--omni-accent) 24%, transparent)' },
          '@media (prefers-reduced-motion: reduce)': { html: { scrollBehavior: 'auto' } },
        }),
      },
      MuiButtonBase: { styleOverrides: { root: { '&.Mui-focusVisible': focus } } },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: omnitronTokens.radius, boxShadow: 'none', '&:hover': { boxShadow: 'none' } },
        },
      },
      MuiOutlinedInput: { styleOverrides: { root: { borderRadius: omnitronTokens.radius }, notchedOutline: { borderColor: 'var(--omni-control-border)' } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' }, rounded: { borderRadius: omnitronTokens.radius }, outlined: { borderColor: 'var(--omni-border)' } } },
      MuiCard: { styleOverrides: { root: { minWidth: 0, borderRadius: omnitronTokens.radius, boxShadow: 'none' } } },
      MuiCardHeader: {
        styleOverrides: {
          root: { flexWrap: 'wrap', gap: 8 },
          content: { minWidth: 0, overflowWrap: 'anywhere' },
          action: { margin: 0, alignSelf: 'center' },
        },
      },
      MuiDialog: { styleOverrides: { paper: overlay } },
      MuiMenu: { styleOverrides: { paper: overlay } },
      MuiPopover: { styleOverrides: { paper: overlay } },
      MuiAlert: { styleOverrides: { root: { borderRadius: omnitronTokens.radius } } },
      MuiDivider: { styleOverrides: { root: { borderColor: 'var(--omni-border)' } } },
      MuiChip: { styleOverrides: { root: { borderRadius: 4 } } },
      MuiTableCell: { styleOverrides: { head: { backgroundColor: 'var(--omni-surface-raised)', color: 'var(--omni-text-muted)', fontWeight: 600 } } },
    },
  };
}
