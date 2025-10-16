/**
 * Aether Icon Presets
 *
 * Complete icon library with 13,677 icons across 3 presets:
 * - Stroke: 4,559 outline icons
 * - Duotone: 4,559 two-tone icons with fill and stroke
 * - Twotone: 4,559 icons with selective opacity
 *
 * @module @omnitron-dev/aether/svg/icons/presets
 *
 * @example
 * ```typescript
 * import { loadIconPreset, searchIcons } from '@omnitron-dev/aether/svg/icons/presets';
 * import { getIconRegistry } from '@omnitron-dev/aether';
 *
 * // Load entire stroke preset
 * const strokeIcons = await loadIconPreset('stroke');
 * const registry = getIconRegistry();
 * registry.registerSet('icons', strokeIcons);
 *
 * // Search for specific icons
 * const results = await searchIcons({
 *   query: 'user',
 *   preset: 'stroke',
 *   limit: 10
 * });
 * ```
 */

// Export utility functions
export { loadIconPreset, loadIcon, preloadIcons } from './utils/loader.js';
export { searchIcons, getMatchingIconNames, searchByMetadata } from './utils/search.js';

// Export types
export type {
  IconPreset,
  IconPresetMetadata,
  IconSearchOptions,
  IconSearchResult,
} from './utils/types.js';

// Export preset metadata
export { HUGEICONS_STROKE_METADATA } from './stroke/index.js';
export { HUGEICONS_DUOTONE_METADATA } from './duotone/index.js';
export { HUGEICONS_TWOTONE_METADATA } from './twotone/index.js';

/**
 * Note: Individual icon exports are available from preset-specific paths:
 *
 * ```typescript
 * // Import individual icons from stroke preset
 * import { UserIcon, HomeIcon } from '@omnitron-dev/aether/svg/icons/presets/stroke';
 *
 * // Import individual icons from duotone preset
 * import { UserIcon, HomeIcon } from '@omnitron-dev/aether/svg/icons/presets/duotone';
 *
 * // Import individual icons from twotone preset
 * import { UserIcon, HomeIcon } from '@omnitron-dev/aether/svg/icons/presets/twotone';
 * ```
 */
