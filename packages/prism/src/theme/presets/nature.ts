/**
 * Nature Theme Preset
 *
 * An earthy, organic theme with warm greens and natural tones.
 *
 * @module @omnitron/prism/theme/presets/nature
 */

import type { ThemePresetDefinition } from '../../types/theme.js';
import { green } from '../colors/base.js';

/**
 * Nature theme preset.
 * Optimized for light mode with earthy green tones.
 */
export const naturePreset: ThemePresetDefinition = {
  name: 'nature',
  displayName: 'Nature',
  description: 'An earthy, organic theme with warm greens and natural tones.',
  preferredMode: 'light',
  typography: {
    fontFamily: {
      primary: '"Nunito", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      secondary: '"Merriweather", Georgia, serif',
      mono: '"JetBrains Mono", Consolas, Monaco, monospace',
    },
    fontWeights: {
      light: 300,
      regular: 400,
      medium: 500,
      semiBold: 600,
      bold: 700,
    },
  },
  colorGroup: {
    key: 'nature',
    main: green[500],
    palette: green,
  },
};
