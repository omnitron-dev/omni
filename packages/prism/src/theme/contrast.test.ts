/**
 * Text has to be readable on the colour behind it.
 *
 * This is the failure mode that never throws and never looks broken in a
 * screenshot review by someone with good eyesight on a good monitor: the
 * label is *there*, it is just hard to read — or, in one case, exactly the
 * colour of its own background.
 *
 * Both consoles let an operator pick a primary colour. That path built
 * `contrastText` from the far end of the generated scale, which is a lighter
 * or darker shade of the same hue — a plausible-looking choice that is not a
 * contrast guarantee. Measured before the fix, 10 of 14 combinations fell
 * below WCAG AA, and `primaryColor: '#FFFFFF'` produced a ratio of 1.00.
 *
 * The presets were fine: they used `getContrastText`. So a themed console was
 * less readable than an unthemed one, which is the opposite of what choosing
 * a colour is for.
 */

import { describe, it, expect } from 'vitest';

import { createPrismTheme } from './create-theme.js';
import { presetNames } from './presets/index.js';
import { getContrastText, getContrastRatio } from './utils/color.js';

/** WCAG AA for body text. */
const AA = 4.5;

/** Colours an operator plausibly picks, including the awkward ends. */
const CANDIDATES = [
  '#7c4dff', // violet — the value in our own docs
  '#FF5630', // mid-tone orange: white scores 3.17, black 6.63
  '#00A76F', // mid-tone green: the same trap
  '#123456', // very dark
  '#FFD700', // very light
  '#FFFFFF', // the degenerate case that scored 1.00
  '#000000',
];

/** `primary` for a theme, across the two shapes MUI may return. */
function primaryOf(theme: any, mode: 'light' | 'dark') {
  return theme.palette?.primary ?? theme.colorSchemes?.[mode]?.palette?.primary;
}

describe('getContrastText', () => {
  it('picks the candidate that actually contrasts more', () => {
    // Not "is the background light" — that returned white for every colour
    // below 0.5 luminance, which is most brand colours.
    expect(getContrastText('#FF5630')).toBe('#000000');
    expect(getContrastText('#00A76F')).toBe('#000000');
    expect(getContrastText('#123456')).toBe('#FFFFFF');
  });

  it('never returns the worse of the two', () => {
    for (const colour of CANDIDATES) {
      const chosen = getContrastText(colour);
      const other = chosen === '#FFFFFF' ? '#000000' : '#FFFFFF';
      expect(
        getContrastRatio(colour, chosen),
        `${colour}: chose ${chosen}`
      ).toBeGreaterThanOrEqual(getContrastRatio(colour, other));
    }
  });

  it('honours caller-supplied candidates', () => {
    // Some surfaces need an off-white or a near-black rather than the pure
    // ones; the choice between them must still be measured.
    expect(getContrastText('#FFD700', '#F8F8F8', '#111111')).toBe('#111111');
  });
});

describe('a themed palette stays readable', () => {
  it('meets WCAG AA for every candidate colour, in both modes', () => {
    const failures: string[] = [];

    for (const colour of CANDIDATES) {
      for (const mode of ['light', 'dark'] as const) {
        const theme = createPrismTheme({ mode, primaryColor: colour });
        const primary = primaryOf(theme, mode);
        const ratio = getContrastRatio(primary.main, primary.contrastText);
        if (ratio < AA) {
          failures.push(`${colour} ${mode}: ${primary.main} on ${primary.contrastText} = ${ratio.toFixed(2)}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it('never puts a label on a background of its own colour', () => {
    // The specific defect: `#FFFFFF` yielded main `#F2F2F2` and contrastText
    // `#F2F2F2`. An invisible button label, from a valid setting.
    for (const mode of ['light', 'dark'] as const) {
      const primary = primaryOf(createPrismTheme({ mode, primaryColor: '#FFFFFF' }), mode);
      expect(primary.contrastText).not.toBe(primary.main);
    }
  });

  it('still returns the requested colour as `main` in light mode', () => {
    // Fixing contrast must not quietly change the colour the operator asked
    // for. Dark mode lightens it deliberately, for contrast against the
    // dark surface behind it.
    const theme = createPrismTheme({ mode: 'light', primaryColor: '#7c4dff' });
    expect(String(primaryOf(theme, 'light').main).toLowerCase()).toBe('#7c4dff');
  });

  it('leaves the presets alone', () => {
    // They already used getContrastText; this change must not shift them.
    const theme = createPrismTheme({ mode: 'light', preset: 'default-light' });
    const primary = primaryOf(theme, 'light');
    expect(getContrastRatio(primary.main, primary.contrastText)).toBeGreaterThanOrEqual(3);
  });
});


describe('every preset', () => {
  /**
   * 3:1 is the WCAG floor for UI components and large text; 4.5:1 is the one
   * for body text. Preset palettes sit between the two on purpose — white on
   * a mid-tone brand colour is the convention this design system follows, and
   * changing that is a design decision rather than an audit finding.
   *
   * Below 3:1 is not a judgement call. `arctic` had seven such pairs, the
   * worst at 1.84 (white on `#4DD0E1`), where black scored 11.43 — the wrong
   * choice by a factor of six, in a preset an operator can select from the
   * settings drawer.
   */
  const SURFACES = ['primary', 'secondary', 'error', 'warning', 'info', 'success'] as const;

  it('found the presets to check', () => {
    // An empty list would make the assertion below pass by checking nothing.
    expect(presetNames.length).toBeGreaterThan(8);
  });

  it('keeps every colour pair above the UI-component floor', () => {
    const failures: string[] = [];

    for (const preset of presetNames) {
      for (const mode of ['light', 'dark'] as const) {
        const theme = createPrismTheme({ preset, mode }) as any;
        const palette = theme.palette ?? theme.colorSchemes?.[mode]?.palette;
        if (!palette) continue;

        for (const surface of SURFACES) {
          const colour = palette[surface];
          if (!colour?.main || !colour?.contrastText) continue;
          const ratio = getContrastRatio(colour.main, colour.contrastText);
          if (ratio < 3) {
            failures.push(`${preset}/${mode}/${surface}: ${colour.main} on ${colour.contrastText} = ${ratio.toFixed(2)}`);
          }
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
