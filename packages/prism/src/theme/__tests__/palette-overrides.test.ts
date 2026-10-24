import { describe, expect, it } from 'vitest';
import { getContrastRatio, getLuminance, type CssVarsTheme } from '@mui/material/styles';
import { createPrismTheme } from '../create-theme.js';
import { varAlpha } from '../utils/color.js';

// These fixtures use the factory's enabled CSS variables, unlike consumers that
// can explicitly disable them. Check the generated CSS contract as well as data.
const styleSheets = (theme: unknown) => JSON.stringify((theme as CssVarsTheme).generateStyleSheets());

describe('application palettes replace derived preset values coherently', () => {
  for (const mode of ['light', 'dark'] as const) {
    it(`regenerates channels and shades from new colours in ${mode}`, () => {
      // Deliberately different hues, saturation, luminance and colour syntaxes.
      for (const [main, channel] of [
        ['#8247B5', '130 71 181'], ['#F90', '255 153 0'],
        ['rgb(15, 120, 170)', '15 120 170'], ['hsl(240, 100%, 50%)', '0 0 255'],
      ] as const) {
        const theme = createPrismTheme({ mode, overrides: { palette: { primary: { main }, text: { primary: '#312637' }, background: { paper: '#FDF9F3' } } } });
        expect(theme.palette.primary).toEqual(expect.objectContaining({ mainChannel: channel }));
        expect(theme.palette.text).toEqual(expect.objectContaining({ primaryChannel: '49 38 55' }));
        expect(theme.palette.background).toEqual(expect.objectContaining({ paperChannel: '253 249 243' }));
        expect(getContrastRatio(main, theme.palette.primary.contrastText)).toBeGreaterThanOrEqual(4.5);
        expect(getLuminance(theme.palette.primary.light)).toBeGreaterThan(getLuminance(main));
        expect(getLuminance(theme.palette.primary.dark)).toBeLessThan(getLuminance(main));
      }
    });
  }
  it('preserves explicitly supplied shades, channels and typography without mutating inputs', () => {
    const overrides = { palette: { secondary: { main: '#8247B5', light: '#F6EDFF', lightChannel: '246 237 255', contrastText: '#FFFFFF' } }, typography: { fontFamily: 'Application Sans' } };
    const before = JSON.stringify(overrides);
    const theme = createPrismTheme({ overrides });
    expect(theme.palette.secondary).toEqual(expect.objectContaining({ light: '#F6EDFF', lightChannel: '246 237 255', contrastText: '#FFFFFF' }));
    expect(theme.typography.fontFamily).toBe('Application Sans');
    expect(JSON.stringify(overrides)).toBe(before);
  });
  it('keeps unchanged roles intact and updates a single overridden shade channel', () => {
    const baseline = createPrismTheme();
    const theme = createPrismTheme({ overrides: { palette: { info: { light: '#F0E0FF' } } } });
    expect(theme.palette.info.main).toBe(baseline.palette.info.main);
    expect(theme.palette.info).toEqual(expect.objectContaining({ lightChannel: '240 224 255' }));
    expect(theme.palette.error).toEqual(baseline.palette.error);
  });
  it('rebuilds inherited Prism channels that native MUI does not augment', () => {
    const theme = createPrismTheme({ overrides: { palette: {
      text: { disabled: '#123456' },
      info: { lighter: '#F0E0FF', darker: '#102030' },
    } } });
    expect(theme.palette.text).toEqual(expect.objectContaining({ disabledChannel: '18 52 86' }));
    expect(theme.palette.info).toEqual(expect.objectContaining({ lighterChannel: '240 224 255', darkerChannel: '16 32 48' }));
    expect(styleSheets(theme)).toContain('--prism-palette-text-disabledChannel');
  });
  it('preserves explicit channel overrides when only their colour changes', () => {
    const theme = createPrismTheme({ overrides: { palette: {
      text: { disabled: '#123456', disabledChannel: 'var(--disabled-rgb)' },
      info: { lighter: '#F0E0FF', lighterChannel: 'var(--info-lighter-rgb)' },
    } } });
    expect(theme.palette.text).toEqual(expect.objectContaining({ disabledChannel: 'var(--disabled-rgb)' }));
    expect(theme.palette.info).toEqual(expect.objectContaining({ lighterChannel: 'var(--info-lighter-rgb)' }));
  });
  it('uses sRGB channels for HSL source colours, including isolated tone overrides', () => {
    const theme = createPrismTheme({ overrides: { palette: { info: { lighter: 'hsl(120, 100%, 50%)' } } } });
    expect(theme.palette.info).toEqual(expect.objectContaining({ lighterChannel: '0 255 0' }));
  });
  it('keeps provided dynamic tones and their browser-resolved channels', () => {
    const theme = createPrismTheme({ overrides: { palette: { primary: {
      main: 'var(--brand)', light: 'var(--brand-light)', dark: 'var(--brand-dark)', contrastText: '#fff',
    } } } });
    expect(theme.palette.primary.main).toBe('var(--brand)');
    expect(theme.palette.primary).toEqual(expect.objectContaining({ mainChannel: 'from var(--brand) r g b' }));
    expect(theme.palette.primary.light).toBe('var(--brand-light)');
  });
  it('explains the native-colour requirement for unresolved main colours without explicit tones', () => {
    expect(() => createPrismTheme({ overrides: { palette: { primary: { main: 'var(--brand)' } } } }))
      .toThrow('Enable overrides.cssVariables.nativeColor or supply light, dark and contrastText explicitly');
  });
});

describe('browser-resolved application palettes', () => {
  it.each(['var(--brand)', 'oklch(60% 0.15 280)', 'rgb(20 80 140)', 'color(display-p3 0.4 0.2 0.7)'])(
    'keeps %s in native colour mode without inventing numeric channels', (main) => {
      const theme = createPrismTheme({ overrides: { cssVariables: { nativeColor: true }, palette: { primary: { main } } } });
      expect(theme.palette.primary.main).toBe(main);
      expect(theme.palette.primary.light).toContain(main);
      expect(theme.palette.primary.dark).toContain(main);
      expect(theme.palette.primary.contrastText).toContain(main);
      expect(theme.palette.primary).toEqual(expect.objectContaining({ mainChannel: `from ${main} r g b` }));
      expect(styleSheets(theme)).not.toMatch(/NaN|undefined/);
      expect(varAlpha(`from ${main} r g b`, 0.2)).toBe(`rgba(from ${main} r g b / 20%)`);
    },
  );
  it('keeps generated tone channels bound to MUI tones with a custom variable prefix', () => {
    const theme = createPrismTheme({ cssVarPrefix: 'app', overrides: {
      cssVariables: { nativeColor: true }, palette: { primary: { main: 'var(--brand)' }, tonalOffset: 0.4 },
    } });
    expect(theme.palette.primary.light).toContain('40%');
    expect(theme.palette.primary).toEqual(expect.objectContaining({ lightChannel: 'from var(--app-palette-primary-light) r g b' }));
    const styles = styleSheets(theme);
    expect(styles).toContain('--app-palette-primary-light');
    expect(styles).not.toContain('--prism-');
  });
});
