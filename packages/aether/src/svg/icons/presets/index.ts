/**
 * Icon Set Presets
 *
 * Utilities for loading popular icon sets
 */

import type { IconSet, IconDefinition } from '../IconRegistry.js';

/**
 * Icon set configuration
 */
export interface IconSetConfig {
  name: string;
  version?: string;
  license?: string;
  url?: string;
  icons: IconSet;
}

/**
 * Icon set loader function
 */
export type IconSetLoader = () => Promise<IconSet>;

/**
 * Available icon sets
 */
export const iconSets: Record<string, IconSetLoader> = {
  // Feather Icons - beautiful open source icons
  feather: async () => 
    // TODO: Implement actual icon loading
    // This would dynamically import the icon set
     ({})
  ,

  // Heroicons - beautiful hand-crafted SVG icons by Tailwind CSS team
  heroicons: async () => 
    // TODO: Implement actual icon loading
     ({})
  ,

  // Material Icons - Google's material design icons
  material: async () => 
    // TODO: Implement actual icon loading
     ({})
  ,

  // Tabler Icons - over 5000 pixel-perfect icons
  tabler: async () => 
    // TODO: Implement actual icon loading
     ({})
  ,

  // Phosphor Icons - flexible icon family
  phosphor: async () => 
    // TODO: Implement actual icon loading
     ({})
  ,

  // Lucide Icons - beautiful & consistent icons (Feather fork)
  lucide: async () => 
    // TODO: Implement actual icon loading
     ({})
  ,
};

/**
 * Load an icon set by name
 *
 * @param name - Icon set name
 * @returns Promise that resolves to the icon set
 *
 * @example
 * ```typescript
 * const featherIcons = await loadIconSet('feather');
 * registry.registerSet('feather', featherIcons);
 * ```
 */
export async function loadIconSet(
  name: keyof typeof iconSets
): Promise<IconSet> {
  const loader = iconSets[name];
  if (!loader) {
    throw new Error(`Icon set "${name}" not found`);
  }

  return loader();
}

/**
 * Create a custom icon set from icon definitions
 *
 * @param icons - Record of icon names to path data or icon definitions
 * @returns IconSet
 *
 * @example
 * ```typescript
 * const customIcons = createIconSet({
 *   heart: 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z',
 *   star: {
 *     path: 'M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
 *     viewBox: '0 0 24 24'
 *   }
 * });
 * ```
 */
export function createIconSet(
  icons: Record<string, string | { path: string; viewBox?: string; content?: string }>
): IconSet {
  const iconSet: IconSet = {};

  for (const [name, data] of Object.entries(icons)) {
    if (typeof data === 'string') {
      // Simple path string
      iconSet[name] = {
        path: data,
        viewBox: '0 0 24 24',
      };
    } else {
      // Icon definition object
      iconSet[name] = {
        path: data.path,
        content: data.content,
        viewBox: data.viewBox || '0 0 24 24',
      };
    }
  }

  return iconSet;
}

/**
 * Merge multiple icon sets into one
 *
 * @param sets - Array of icon sets to merge
 * @param options - Merge options
 * @returns Merged icon set
 *
 * @example
 * ```typescript
 * const merged = mergeIconSets([featherIcons, customIcons], {
 *   prefix: 'icon-',
 *   overwrite: false
 * });
 * ```
 */
export function mergeIconSets(
  sets: IconSet[],
  options?: {
    prefix?: string;
    overwrite?: boolean;
  }
): IconSet {
  const { prefix = '', overwrite = true } = options || {};
  const merged: IconSet = {};

  for (const set of sets) {
    for (const [name, icon] of Object.entries(set)) {
      const key = prefix ? `${prefix}${name}` : name;

      if (!overwrite && merged[key]) {
        continue;
      }

      merged[key] = icon;
    }
  }

  return merged;
}

/**
 * Filter icon set by names
 *
 * @param iconSet - Icon set to filter
 * @param names - Array of icon names to include
 * @returns Filtered icon set
 *
 * @example
 * ```typescript
 * const filtered = filterIconSet(featherIcons, ['heart', 'star', 'home']);
 * ```
 */
export function filterIconSet(iconSet: IconSet, names: string[]): IconSet {
  const filtered: IconSet = {};

  for (const name of names) {
    if (iconSet[name]) {
      filtered[name] = iconSet[name];
    }
  }

  return filtered;
}

/**
 * Transform icon set with a custom transformer
 *
 * @param iconSet - Icon set to transform
 * @param transformer - Transformer function
 * @returns Transformed icon set
 *
 * @example
 * ```typescript
 * const transformed = transformIconSet(featherIcons, (icon) => ({
 *   ...icon,
 *   path: optimizePath(icon.path)
 * }));
 * ```
 */
export function transformIconSet(
  iconSet: IconSet,
  transformer: (icon: IconDefinition, name: string) => IconDefinition
): IconSet {
  const transformed: IconSet = {};

  for (const [name, icon] of Object.entries(iconSet)) {
    const iconDef = typeof icon === 'string' ? { path: icon } : icon;
    transformed[name] = transformer(iconDef, name);
  }

  return transformed;
}

/**
 * Get icon set metadata
 *
 * @param iconSet - Icon set
 * @returns Metadata
 */
export function getIconSetMetadata(iconSet: IconSet) {
  const names = Object.keys(iconSet);
  const total = names.length;

  // Count icons with different properties
  let withPath = 0;
  let withContent = 0;
  let withViewBox = 0;

  for (const icon of Object.values(iconSet)) {
    const iconDef = typeof icon === 'string' ? { path: icon } : icon;

    if (iconDef.path) withPath++;
    if (iconDef.content) withContent++;
    if (iconDef.viewBox) withViewBox++;
  }

  return {
    total,
    names,
    withPath,
    withContent,
    withViewBox,
  };
}

/**
 * Validate icon set
 *
 * @param iconSet - Icon set to validate
 * @returns Validation result
 */
export function validateIconSet(iconSet: IconSet): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  for (const [name, icon] of Object.entries(iconSet)) {
    if (!name || name.trim() === '') {
      errors.push('Icon name cannot be empty');
      continue;
    }

    const iconDef = typeof icon === 'string' ? { path: icon } : icon;

    if (!iconDef.path && !iconDef.content) {
      errors.push(`Icon "${name}" must have either path or content`);
    }

    if (iconDef.viewBox && !isValidViewBox(iconDef.viewBox)) {
      errors.push(`Icon "${name}" has invalid viewBox: ${iconDef.viewBox}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if viewBox string is valid
 */
function isValidViewBox(viewBox: string): boolean {
  const parts = viewBox.split(' ');
  if (parts.length !== 4) return false;

  return parts.every(part => !isNaN(parseFloat(part)));
}
