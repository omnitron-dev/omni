/**
 * HugeIcons Type Definitions
 */

import type { IconDefinition } from '../../../IconRegistry.js';

/**
 * Available HugeIcon presets
 */
export type HugeIconPreset = 'stroke' | 'duotone' | 'twotone';

/**
 * HugeIcons preset metadata
 */
export interface HugeIconsMetadata {
  preset: HugeIconPreset;
  count: number;
  license: string;
  source: string;
}

/**
 * Icon search options
 */
export interface IconSearchOptions {
  /** Preset to search in, or 'all' for all presets */
  preset?: HugeIconPreset | 'all';
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
  preset: HugeIconPreset;
  /** Icon definition */
  definition: IconDefinition;
  /** Relevance score (0-1) */
  relevance: number;
}
