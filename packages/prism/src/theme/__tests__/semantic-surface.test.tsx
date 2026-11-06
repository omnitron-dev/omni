import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import MuiAlert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import PaginationItem from '@mui/material/PaginationItem';
import { createTheme, getContrastRatio, ThemeProvider } from '@mui/material/styles';
import { blend } from '@mui/system/colorManipulator';
import { Alert } from '../../components/alert/alert.js';
import { Label } from '../../components/label/label.js';
import { createPrismTheme } from '../create-theme.js';
import { presetNames } from '../presets/index.js';

afterEach(cleanup);

const colors = ['info', 'success', 'warning', 'error'] as const;
const info = { main: '#A8BAFF', dark: '#7582B2', light: '#B9C7FF' };

function channels(background: string): number[] {
  expect(background).toMatch(/^rgba?\(/);
  return background.match(/[\d.]+/g)!.map(Number);
}

function contrast(element: Element, paper: string) {
  const style = getComputedStyle(element);
  const values = channels(style.backgroundColor);
  const surface = blend(paper, `rgb(${values.slice(0, 3).join(',')})`, values[3] ?? 1);
  return getContrastRatio(style.color, surface);
}

function emittedStyles(element: Element) {
  const selector = `.${Array.from(element.classList).find((name) => name.startsWith('css-'))}`;
  return Array.from(document.styleSheets)
    .flatMap((sheet) => Array.from(sheet.cssRules))
    .map((rule) => rule.cssText)
    .filter((rule) => rule.includes(selector))
    .join('').replace(/\s+/g, '');
}

describe('semantic status surfaces', () => {
  it.each(['light', 'dark'] as const)('keeps all preset alerts and chips readable in %s', (mode) => {
    for (const preset of presetNames) {
      const theme = createPrismTheme({ preset, mode, cssVariables: { enabled: false } });
      const { getByTestId, unmount } = render(
        <ThemeProvider theme={theme}>
          {colors.map((color) => (
            <div key={color}>
              <MuiAlert severity={color} data-testid={`${color}-mui`}>Status</MuiAlert>
              <Alert severity={color} data-testid={`${color}-standard`}>Status</Alert>
              <Alert severity={color} variant="soft" data-testid={`${color}-soft`}>Status</Alert>
              <Chip color={color} variant="soft" data-testid={`${color}-chip`} label="Status" />
            </div>
          ))}
        </ThemeProvider>
      );
      for (const color of colors) {
        for (const variant of ['mui', 'standard', 'soft', 'chip']) {
          expect(contrast(getByTestId(`${color}-${variant}`), theme.palette.background.paper),
            `${preset}/${mode}/${color}/${variant}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      unmount();
    }
  });

  it('uses the application colour and readable text on a custom dark paper', () => {
    const theme = createPrismTheme({ mode: 'dark', cssVariables: { enabled: false }, overrides: {
      palette: { info, background: { paper: '#241E2C' } },
    } });
    const { getByRole } = render(<ThemeProvider theme={theme}><Alert>Information</Alert></ThemeProvider>);
    const element = getByRole('alert');
    expect(channels(getComputedStyle(element).backgroundColor)).toEqual([168, 186, 255, 0.08]);
    expect(contrast(element, '#241E2C')).toBeGreaterThanOrEqual(4.5);
    expect(getComputedStyle(element).color).toBe(info.light);
  });

  it.each(['standard', 'soft', 'filled', 'outlined'] as const)(
    'respects explicit colour independently of severity for %s alerts', (variant) => {
      const theme = createPrismTheme({ mode: 'dark', cssVariables: { enabled: false } });
      const { getByTestId } = render(<ThemeProvider theme={theme}>
        <Alert severity="success" color="error" variant={variant} data-testid="override">Override</Alert>
        <Alert severity="error" variant={variant} data-testid="reference">Reference</Alert>
      </ThemeProvider>);
      const actual = getComputedStyle(getByTestId('override'));
      const reference = getComputedStyle(getByTestId('reference'));
      expect([actual.color, actual.backgroundColor, actual.borderColor])
        .toEqual([reference.color, reference.backgroundColor, reference.borderColor]);
    }
  );

  it('keeps scheme switching and custom CSS prefixes for every status component', () => {
    const theme = createTheme({
      cssVariables: { cssVarPrefix: 'status-spec', colorSchemeSelector: 'class' },
      colorSchemes: {
        light: { palette: { info: { ...info, dark: '#263358' } } },
        dark: { palette: { info } },
      },
      components: createPrismTheme().components,
    });
    const { getByTestId } = render(<ThemeProvider theme={theme}>
      <Alert data-testid="standard">Standard</Alert>
      <Alert variant="soft" data-testid="soft">Soft</Alert>
      <Chip color="info" variant="soft" data-testid="chip" label="Status" />
      <Label color="info">Label</Label>
    </ThemeProvider>);
    // happy-dom cannot apply :where() reliably. Inspect the emitted browser rules.
    for (const kind of ['standard', 'soft', 'chip']) {
      const css = emittedStyles(getByTestId(kind));
      expect(css).toContain('color:var(--status-spec-palette-info-dark)');
      expect(css).toMatch(/:where\(\.dark\)[^{]*\{[^}]*color:var\(--status-spec-palette-info-light\)/);
      expect(css).toContain('--status-spec-palette-info-mainChannel');
      expect(css).not.toContain('--prism-');
    }
  });

  it('preserves consumer sx and semantic text fallback for a palette without readable tones', () => {
    const theme = createTheme({ palette: { info: { main: '#bdddcc', dark: '#9dbdac', light: '#ddeedd' } } });
    const { getByRole } = render(<ThemeProvider theme={theme}>
      <Alert variant="soft" sx={{ padding: '7px' }}>Information</Alert>
    </ThemeProvider>);
    const style = getComputedStyle(getByRole('alert'));
    expect(style.color).toBe(theme.palette.text.primary);
    expect(style.padding).toBe('7px');
    expect(getByRole('alert').hasAttribute('sx')).toBe(false);
  });

  it('uses the configured primary channels for selected controls without CSS variables', () => {
    const theme = createPrismTheme({ cssVariables: { enabled: false }, overrides: {
      palette: { primary: { main: 'hsl(240, 100%, 50%)' } },
    } });
    const { getByRole } = render(<ThemeProvider theme={theme}>
      <PaginationItem selected variant="outlined" page={1} />
    </ThemeProvider>);
    expect(channels(getComputedStyle(getByRole('button')).backgroundColor)).toEqual([0, 0, 255, 0.08]);
  });
});
