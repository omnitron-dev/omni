import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createTheme, getContrastRatio, ThemeProvider } from '@mui/material/styles';
import { createPrismTheme } from '../../theme/create-theme';
import { Label } from './label';

afterEach(cleanup);

const success = { main: '#35b084', dark: '#066f49', light: '#70d1aa' };

describe('label contrast across colour schemes', () => {
  it.each(['light', 'dark'] as const)('uses the readable %s foreground in a plain MUI theme', (mode) => {
    const { getByText } = render(
      <ThemeProvider theme={createTheme({ palette: { mode, success } })}>
        <Label color="success">Online</Label>
      </ThemeProvider>
    );
    expect(getComputedStyle(getByText('Online')).color).toBe(mode === 'light' ? success.dark : success.light);
  });

  it.each(['light', 'dark'] as const)('handles Prism tonal roles in %s, including inverted badges', (mode) => {
    const theme = createPrismTheme({ mode, cssVariables: { enabled: false } });
    const { getByText } = render(
      <ThemeProvider theme={theme}>
        <Label color="success">Online</Label>
        <Label color="success" variant="inverted">
          Inverted
        </Label>
      </ThemeProvider>
    );
    expect(
      getContrastRatio(getComputedStyle(getByText('Online')).color, theme.palette.background.paper)
    ).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio(getComputedStyle(getByText('Inverted')).color, '#fff')).toBeGreaterThanOrEqual(4.5);
  });

  it('emits both scheme rules using a consumer variable prefix', () => {
    const theme = createTheme({
      cssVariables: { cssVarPrefix: 'label-spec', colorSchemeSelector: 'class' },
      colorSchemes: { light: { palette: { success } }, dark: { palette: { success } } },
    });
    // happy-dom does not apply :where() rules reliably; verify the emitted contract
    // here and exercise actual scheme switching in the Console browser check.
    const { getByText } = render(
      <ThemeProvider theme={theme}>
        <Label color="success">Online</Label>
      </ThemeProvider>
    );
    const selector = `.${getByText('Online').className}`;
    const css = Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .map((rule) => rule.cssText)
      .filter((rule) => rule.includes(selector))
      .join('')
      .replace(/\s+/g, '');
    expect(css).toContain('color:var(--label-spec-palette-success-dark)');
    expect(css).toMatch(/:where\(\.dark\)[^{]*\{color:var\(--label-spec-palette-success-light\)/);
    expect(css).not.toContain('--prism-palette-success');
  });
});
