/**
 * Icon Preset Loader Utilities
 *
 * Functions for dynamically loading icon presets and individual icons
 */

import type { IconSet, IconDefinition } from '../../../IconRegistry.js';
import type { IconPreset } from './types.js';

/**
 * Load an entire icon preset dynamically
 *
 * This function lazy-loads a complete preset (stroke, duotone, or twotone)
 * which includes all ~4,559 icons in that style.
 *
 * @param preset - The preset to load ('stroke', 'duotone', or 'twotone')
 * @returns Promise resolving to an IconSet containing all icons in the preset
 *
 * @example
 * ```typescript
 * import { loadIconPreset } from '@omnitron-dev/aether/svg/icons/presets';
 * import { getIconRegistry } from '@omnitron-dev/aether';
 *
 * // Load the stroke preset
 * const strokeIcons = await loadIconPreset('stroke');
 * const registry = getIconRegistry();
 * registry.registerSet('icons-stroke', strokeIcons);
 * ```
 */
export async function loadIconPreset(preset: IconPreset): Promise<IconSet> {
  try {
    let module;

    switch (preset) {
      case 'stroke':
        module = await import('../stroke/index.js');
        break;
      case 'duotone':
        module = await import('../duotone/index.js');
        break;
      case 'twotone':
        module = await import('../twotone/index.js');
        break;
      default:
        throw new Error(`Unknown preset: ${preset as string}`);
    }

    // Extract all icon definitions from the module
    const iconSet: IconSet = {};

    for (const [key, value] of Object.entries(module)) {
      // Skip metadata and other non-icon exports
      if (key.startsWith('HUGEICONS_') || key.endsWith('_NAMES')) {
        continue;
      }

      // Only include IconDefinition objects
      if (value && typeof value === 'object' && 'id' in value) {
        const icon = value as IconDefinition;
        if (icon.id) {
          iconSet[icon.id] = icon;
        }
      }
    }

    return iconSet;
  } catch (error) {
    throw new Error(
      `Failed to load icon preset "${preset}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Load a specific icon from a preset
 *
 * This function loads a single icon from a preset without loading the entire set.
 * It's more efficient than loading the full preset if you only need a few icons.
 *
 * @param preset - The preset to load from
 * @param name - The icon name (kebab-case, e.g., 'user', 'home-01')
 * @returns Promise resolving to the IconDefinition
 * @throws Error if the icon is not found
 *
 * @example
 * ```typescript
 * import { loadIcon } from '@omnitron-dev/aether/svg/icons/presets';
 *
 * // Load a single icon
 * const userIcon = await loadIcon('stroke', 'user');
 * console.log(userIcon); // { id: 'user', content: '...', ... }
 * ```
 */
export async function loadIcon(
  preset: IconPreset,
  name: string
): Promise<IconDefinition> {
  try {
    // Convert kebab-case to PascalCase with Icon suffix
    const pascalName = kebabToPascalCase(name) + 'Icon';

    let module;

    switch (preset) {
      case 'stroke':
        module = await import(`../stroke/${name}.js`);
        break;
      case 'duotone':
        module = await import(`../duotone/${name}.js`);
        break;
      case 'twotone':
        module = await import(`../twotone/${name}.js`);
        break;
      default:
        throw new Error(`Unknown preset: ${preset as string}`);
    }

    const icon = module[pascalName] as IconDefinition | undefined;

    if (!icon) {
      throw new Error(`Icon "${pascalName}" not found in module`);
    }

    return icon;
  } catch (error) {
    throw new Error(
      `Failed to load icon "${name}" from preset "${preset}": ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Preload multiple icons from a preset
 *
 * Efficiently loads multiple icons at once using Promise.all.
 *
 * @param preset - The preset to load from
 * @param names - Array of icon names to load
 * @returns Promise resolving to a Map of icon names to definitions
 *
 * @example
 * ```typescript
 * import { preloadIcons } from '@omnitron-dev/aether/svg/icons/presets';
 *
 * const icons = await preloadIcons('stroke', ['user', 'home-01', 'settings']);
 * const userIcon = icons.get('user');
 * ```
 */
export async function preloadIcons(
  preset: IconPreset,
  names: string[]
): Promise<Map<string, IconDefinition>> {
  const results = await Promise.allSettled(
    names.map(async (name) => {
      const icon = await loadIcon(preset, name);
      return { name, icon };
    })
  );

  const iconMap = new Map<string, IconDefinition>();

  for (const result of results) {
    if (result.status === 'fulfilled') {
      iconMap.set(result.value.name, result.value.icon);
    } else {
      console.warn(`Failed to load icon: ${result.reason}`);
    }
  }

  return iconMap;
}

/**
 * Convert kebab-case to PascalCase
 *
 * @internal
 */
function kebabToPascalCase(str: string): string {
  return str
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}
