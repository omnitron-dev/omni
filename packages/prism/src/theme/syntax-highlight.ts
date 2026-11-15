import type { CSSObject, Theme } from '@mui/material/styles';

/** Shiki's dual-token projection, shared by static documents and React code blocks. */
export function syntaxHighlightStyles(theme: Theme): CSSObject {
  const styles = (mode: 'light' | 'dark'): CSSObject => ({
    color: `var(--shiki-${mode}, inherit)`,
    fontStyle: `var(--shiki-${mode}-font-style, normal)`,
    fontWeight: `var(--shiki-${mode}-font-weight, inherit)`,
    textDecoration: `var(--shiki-${mode}-text-decoration, none)`,
  });
  const mode = (theme.defaultColorScheme ?? theme.palette.mode) === 'dark' ? 'dark' : 'light';
  return {
    ...styles(mode),
    // color-scheme is inherited from the native theme even before its selector
    // is installed; no JavaScript palette branch determines the first frame.
    ...(theme.vars && { color: 'light-dark(var(--shiki-light, currentColor), var(--shiki-dark, currentColor))' }),
    ...theme.applyStyles('light', styles('light')),
    ...theme.applyStyles('dark', styles('dark')),
  };
}
