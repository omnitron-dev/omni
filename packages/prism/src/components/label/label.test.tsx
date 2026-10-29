import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createTheme, getContrastRatio, ThemeProvider } from '@mui/material/styles';
import { blend } from '@mui/system/colorManipulator';
import { createPrismTheme } from '../../theme/create-theme';
import { presetNames } from '../../theme/presets';
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

  it.each(['light', 'dark'] as const)('keeps small status text readable on its actual %s tinted surface', (mode) => {
    const colors = ['primary', 'secondary', 'info', 'success', 'warning', 'error'] as const;
    for (const preset of presetNames) {
      const theme = createPrismTheme({ preset, mode, cssVariables: { enabled: false } });
      const { getByText, unmount } = render(
        <ThemeProvider theme={theme}>
          {colors.map((color) => (
            <Label key={color} color={color}>
              {color}
            </Label>
          ))}
        </ThemeProvider>
      );
      for (const color of colors) {
        const style = getComputedStyle(getByText(color));
        // MUI may emit modern space-separated rgba(), which its legacy
        // decomposeColor helper does not parse. Read the rendered channels.
        expect(style.backgroundColor).toMatch(/^rgba?\(/);
        const values = style.backgroundColor.match(/[\d.]+/g)!.map(Number);
        const surface = blend(theme.palette.background.paper, `rgb(${values.slice(0, 3).join(',')})`, values[3] ?? 1);
        expect(
          getContrastRatio(style.color, surface),
          `${preset}/${mode}/${color}: ${style.color} on ${surface}`
        ).toBeGreaterThanOrEqual(4.5);
      }
      unmount();
    }
  });

  it('falls back to semantic text when a custom MUI palette has no readable tone, and applies sx locally', () => {
    const theme = createTheme({ palette: { success: { main: '#bdddcc', dark: '#9dbdac', light: '#ddeedd' } } });
    const { getByText } = render(
      <ThemeProvider theme={theme}>
        <Label color="success" sx={{ height: 32 }}>
          Custom
        </Label>
      </ThemeProvider>
    );
    const label = getByText('Custom');
    expect(getComputedStyle(label).color).toBe(theme.palette.text.primary);
    expect(getComputedStyle(label).height).toBe('32px');
    expect(label.hasAttribute('sx')).toBe(false);
  });

  it('composites HSL theme colours as RGB instead of blending HSL channels', () => {
    const theme = createTheme({
      palette: {
        background: { paper: 'hsl(0, 0%, 100%)' },
        success: { main: 'hsl(160, 57%, 45%)', dark: '#066f49', light: '#70d1aa' },
      },
    });
    const { getByText } = render(
      <ThemeProvider theme={theme}>
        <Label color="success">HSL</Label>
      </ThemeProvider>
    );
    expect(getComputedStyle(getByText('HSL')).color).toBe('#066f49');
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
