/**
 * Icon Preset Type Definitions
 */

import type { IconDefinition } from '../../../IconRegistry.js';

/**
 * Available icon presets
 */
export type IconPreset = 'stroke' | 'duotone' | 'twotone';

/**
 * Icon preset metadata
 */
export interface IconPresetMetadata {
  preset: IconPreset;
  count: number;
  license: string;
  source: string;
}

/**
 * Icon search options
 */
export interface IconSearchOptions {
  /** Preset to search in, or 'all' for all presets */
  preset?: IconPreset | 'all';
  /** Search query */
  query: string;
  /** Maximum number of results */
  limit?: number;
  /** Case-sensitive search */
  caseSensitive?: boolean;
}

/**
 * Icon search result
 */
export interface IconSearchResult {
  /** Icon name (kebab-case) */
  name: string;
  /** Preset the icon belongs to */
  preset: IconPreset;
  /** Icon definition */
  definition: IconDefinition;
  /** Relevance score (0-1) */
  relevance: number;
}
