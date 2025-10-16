/**
 * Icon Search Utilities
 *
 * Functions for searching and filtering icon presets
 */

import type { IconDefinition } from '../../../IconRegistry.js';
import type { IconSearchOptions, IconSearchResult, IconPreset } from './types.js';
import { loadIconPreset } from './loader.js';

/**
 * Search for icons across presets
 *
 * Searches icon names within the specified preset(s) and returns
 * matching results sorted by relevance.
 *
 * @param options - Search options
 * @returns Promise resolving to array of search results
 *
 * @example
 * ```typescript
 * import { searchIcons } from '@omnitron-dev/aether/svg/icons/presets';
 *
 * // Search for user-related icons in stroke preset
 * const results = await searchIcons({
 *   query: 'user',
 *   preset: 'stroke',
 *   limit: 10
 * });
 *
 * console.log(results[0].name); // e.g., 'user'
 * console.log(results[0].relevance); // e.g., 1.0 (exact match)
 * ```
 *
 * @example
 * ```typescript
 * // Search across all presets
 * const results = await searchIcons({
 *   query: 'home',
 *   preset: 'all',
 *   limit: 20
 * });
 * ```
 */
export async function searchIcons(options: IconSearchOptions): Promise<IconSearchResult[]> {
  const { query, preset = 'stroke', limit, caseSensitive = false } = options;

  if (!query || query.trim().length === 0) {
    throw new Error('Search query cannot be empty');
  }

  const searchQuery = caseSensitive ? query : query.toLowerCase();
  const presetsToSearch: IconPreset[] = preset === 'all' ? ['stroke', 'duotone', 'twotone'] : [preset];

  const allResults: IconSearchResult[] = [];

  // Search in each preset
  for (const currentPreset of presetsToSearch) {
    try {
      const iconSet = await loadIconPreset(currentPreset);

      for (const [name, iconData] of Object.entries(iconSet)) {
        const icon = typeof iconData === 'string' ? { path: iconData } : iconData;
        const searchName = caseSensitive ? name : name.toLowerCase();

        // Calculate relevance score
        const relevance = calculateRelevance(searchName, searchQuery);

        if (relevance > 0) {
          allResults.push({
            name,
            preset: currentPreset,
            definition: icon as IconDefinition,
            relevance,
          });
        }
      }
    } catch (error) {
      console.error(`Failed to search preset "${currentPreset}":`, error);
    }
  }

  // Sort by relevance (highest first)
  allResults.sort((a, b) => b.relevance - a.relevance);

  // Apply limit if specified
  return limit ? allResults.slice(0, limit) : allResults;
}

/**
 * Get icon names matching a pattern
 *
 * Returns just the icon names (without loading the full definitions)
 * that match the query. More efficient than searchIcons if you only
 * need the names.
 *
 * @param options - Search options
 * @returns Promise resolving to array of matching icon names
 *
 * @example
 * ```typescript
 * import { getMatchingIconNames } from '@omnitron-dev/aether/svg/icons/presets';
 *
 * const names = await getMatchingIconNames({
 *   query: 'arrow',
 *   preset: 'stroke',
 *   limit: 50
 * });
 * console.log(names); // ['arrow-up', 'arrow-down', 'arrow-left', ...]
 * ```
 */
export async function getMatchingIconNames(options: IconSearchOptions): Promise<string[]> {
  const results = await searchIcons(options);
  return results.map((r) => r.name);
}

/**
 * Calculate relevance score for search results
 *
 * Scoring algorithm:
 * - Exact match: 1.0
 * - Starts with query: 0.9
 * - Contains query as word: 0.7
 * - Contains query: 0.5
 * - Fuzzy match: 0.3
 *
 * @internal
 */
function calculateRelevance(name: string, query: string): number {
  // Exact match
  if (name === query) {
    return 1.0;
  }

  // Starts with query
  if (name.startsWith(query)) {
    return 0.9;
  }

  // Contains query as a word (separated by hyphens)
  const words = name.split('-');
  if (words.includes(query)) {
    return 0.7;
  }

  // Contains query anywhere
  if (name.includes(query)) {
    return 0.5;
  }

  // Check if any word starts with query
  if (words.some((word) => word.startsWith(query))) {
    return 0.6;
  }

  // Fuzzy match - check if all characters of query exist in order
  if (fuzzyMatch(name, query)) {
    return 0.3;
  }

  return 0;
}

/**
 * Check if string matches pattern in fuzzy way
 *
 * @internal
 */
function fuzzyMatch(str: string, pattern: string): boolean {
  let patternIdx = 0;
  let strIdx = 0;

  while (strIdx < str.length && patternIdx < pattern.length) {
    if (str[strIdx] === pattern[patternIdx]) {
      patternIdx++;
    }
    strIdx++;
  }

  return patternIdx === pattern.length;
}

/**
 * Search icons by category or metadata
 *
 * Note: This requires icons to have metadata.category or metadata.tags
 * populated. This is a placeholder for future enhancement.
 *
 * @param preset - Preset to search
 * @param filter - Metadata filter function
 * @returns Promise resolving to filtered icons
 *
 * @example
 * ```typescript
 * const icons = await searchByMetadata('stroke', (metadata) =>
 *   metadata.preset === 'stroke' && !metadata.hasOpacity
 * );
 * ```
 */
export async function searchByMetadata(
  preset: IconPreset | 'all',
  filter: (metadata: Record<string, any>) => boolean
): Promise<IconSearchResult[]> {
  const presetsToSearch: IconPreset[] = preset === 'all' ? ['stroke', 'duotone', 'twotone'] : [preset];

  const results: IconSearchResult[] = [];

  for (const currentPreset of presetsToSearch) {
    try {
      const iconSet = await loadIconPreset(currentPreset);

      for (const [name, iconData] of Object.entries(iconSet)) {
        const icon = typeof iconData === 'string' ? { path: iconData } : iconData;

        if (icon.metadata && filter(icon.metadata)) {
          results.push({
            name,
            preset: currentPreset,
            definition: icon as IconDefinition,
            relevance: 1.0, // All metadata matches are considered equally relevant
          });
        }
      }
    } catch (error) {
      console.error(`Failed to search preset "${currentPreset}":`, error);
    }
  }

  return results;
}
