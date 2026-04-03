/**
 * Theme Presets Index
 *
 * @module @omnitron-dev/prism/theme/presets
 */

import type { ThemePreset, ThemePresetDefinition } from '../../types/theme.js';
import { defaultPreset } from './default.js';
import { luxuryPreset } from './luxury.js';
import { arcticPreset } from './arctic.js';
import { naturePreset } from './nature.js';
import { emberPreset } from './ember.js';
import { draculaPreset } from './dracula.js';
import { midnightPreset } from './midnight.js';
import { retroPreset } from './retro.js';
import { minimalPreset } from './minimal.js';

/**
 * All available preset names.
 */
export const presetNames: ThemePreset[] = [
  'default-light',
  'default-dark',
  'luxury',
  'arctic',
  'nature',
  'ember',
  'dracula',
  'midnight',
  'retro',
  'minimal',
];

/**
 * Preset registry.
 */
const presets: Record<string, ThemePresetDefinition> = {
  'default-light': defaultPreset,
  'default-dark': defaultPreset, // Uses same preset but different preferred mode
  luxury: luxuryPreset,
  arctic: arcticPreset,
  nature: naturePreset,
  ember: emberPreset,
  dracula: draculaPreset,
  midnight: midnightPreset,
  retro: retroPreset,
  minimal: minimalPreset,
};

/**
 * Get a theme preset by name.
 *
 * @param name - Preset name
 * @returns Theme preset definition
 * @throws If preset is not found
 */
export function getPreset(name: ThemePreset): ThemePresetDefinition {
  const preset = presets[name];

  if (!preset) {
    console.warn(`Preset "${name}" not found, falling back to "default-light"`);
    return defaultPreset;
  }

  return preset;
}

/**
 * Register a custom preset.
 *
 * @param name - Preset name
 * @param preset - Preset definition
 */
export function registerPreset(name: string, preset: ThemePresetDefinition): void {
  presets[name] = preset;
}

/**
 * Get all registered presets.
 */
export function getAllPresets(): Record<string, ThemePresetDefinition> {
  return { ...presets };
}

// Re-export presets
export { defaultPreset } from './default.js';
export { luxuryPreset } from './luxury.js';
export { arcticPreset } from './arctic.js';
export { naturePreset } from './nature.js';
export { emberPreset } from './ember.js';
export { draculaPreset } from './dracula.js';
export { midnightPreset } from './midnight.js';
export { retroPreset } from './retro.js';
export { minimalPreset } from './minimal.js';
