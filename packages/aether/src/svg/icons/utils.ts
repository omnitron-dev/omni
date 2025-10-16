/**
 * Icon Utilities
 *
 * Helper functions for working with icons in Aether
 */

import type { IconProp, IconConfig, IconPreset, IconAnimation, IconSize } from './types.js';
import type { Signal } from '../../core/reactivity/signal.js';

/**
 * Size preset mapping to pixel values
 */
export const ICON_SIZE_MAP: Record<string, number> = {
  xs: 14,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 28,
};

/**
 * Default icon configuration
 */
export const DEFAULT_ICON_CONFIG: Partial<IconConfig> = {
  preset: 'stroke',
  animation: 'none',
  size: 'md',
  decorative: false,
};

/**
 * Normalize IconProp to full IconConfig
 *
 * Converts string-based icon props to full configuration objects
 * with sensible defaults.
 *
 * @param icon - Icon prop (string or config object)
 * @param defaults - Optional default values to merge
 * @returns Normalized icon configuration
 *
 * @example
 * ```tsx
 * // String normalization
 * normalizeIcon('user')
 * // => { name: 'user', preset: 'stroke', animation: 'none', size: 'md', ... }
 *
 * // Object normalization with defaults
 * normalizeIcon({ name: 'user', animation: 'hover' }, { preset: 'duotone' })
 * // => { name: 'user', preset: 'duotone', animation: 'hover', size: 'md', ... }
 * ```
 */
export function normalizeIcon(icon: IconProp | undefined, defaults?: Partial<IconConfig>): IconConfig | null {
  if (!icon) return null;

  const config: IconConfig = typeof icon === 'string' ? { name: icon } : { ...icon };

  // Merge with defaults
  return {
    ...DEFAULT_ICON_CONFIG,
    ...defaults,
    ...config,
  } as IconConfig;
}

/**
 * Resolve icon size to pixel value
 *
 * @param size - Size preset or number
 * @returns Size in pixels
 *
 * @example
 * ```tsx
 * resolveIconSize('md')  // => 20
 * resolveIconSize(32)    // => 32
 * resolveIconSize('xl')  // => 28
 * ```
 */
export function resolveIconSize(size?: IconSize): number {
  if (!size) return ICON_SIZE_MAP.md;
  if (typeof size === 'number') return size;
  return ICON_SIZE_MAP[size] || ICON_SIZE_MAP.md;
}

/**
 * Get animation CSS class name
 *
 * @param animation - Animation type
 * @returns CSS class name
 *
 * @example
 * ```tsx
 * getAnimationClass('spin')  // => 'aether-icon-spin'
 * getAnimationClass('hover') // => 'aether-icon-hover'
 * getAnimationClass('none')  // => ''
 * ```
 */
export function getAnimationClass(animation?: IconAnimation): string {
  if (!animation || animation === 'none') return '';
  return `aether-icon-${animation}`;
}

/**
 * Get position CSS class name
 *
 * @param position - Icon position
 * @returns CSS class name
 *
 * @example
 * ```tsx
 * getPositionClass('left')  // => 'aether-icon-left'
 * getPositionClass('right') // => 'aether-icon-right'
 * ```
 */
export function getPositionClass(position?: string): string {
  if (!position) return '';
  return `aether-icon-${position}`;
}

/**
 * Build icon class names
 *
 * Combines base icon class with animation, position, size, and custom classes
 *
 * @param config - Icon configuration
 * @returns Space-separated class names
 *
 * @example
 * ```tsx
 * buildIconClasses({ name: 'user', animation: 'hover', size: 'lg' })
 * // => 'aether-icon aether-icon-hover aether-icon-lg'
 * ```
 */
export function buildIconClasses(config: IconConfig): string {
  const classes: string[] = ['aether-icon'];

  // Animation class
  const animationClass = getAnimationClass(config.animation);
  if (animationClass) {
    classes.push(animationClass);
  }

  // Position class
  if (config.position) {
    const positionClass = getPositionClass(config.position);
    if (positionClass) {
      classes.push(positionClass);
    }
  }

  // Size class (if preset)
  if (config.size && typeof config.size === 'string') {
    classes.push(`aether-icon-${config.size}`);
  }

  // Custom class
  if (config.className) {
    classes.push(config.className);
  }

  return classes.join(' ');
}

/**
 * Build icon data attributes
 *
 * Creates data attributes for headless styling
 *
 * @param config - Icon configuration
 * @returns Object with data attributes
 *
 * @example
 * ```tsx
 * buildIconDataAttributes({ name: 'user', animation: 'spin', preset: 'stroke' })
 * // => {
 * //   'data-icon': 'user',
 * //   'data-icon-preset': 'stroke',
 * //   'data-icon-animation': 'spin'
 * // }
 * ```
 */
export function buildIconDataAttributes(config: IconConfig): Record<string, string> {
  const attrs: Record<string, string> = {
    'data-icon': config.name,
  };

  if (config.preset) {
    attrs['data-icon-preset'] = config.preset;
  }

  if (config.animation && config.animation !== 'none') {
    attrs['data-icon-animation'] = config.animation;
  }

  if (config.position) {
    attrs['data-icon-position'] = config.position;
  }

  return attrs;
}

/**
 * Build icon inline styles
 *
 * Creates inline styles from icon configuration
 *
 * @param config - Icon configuration
 * @returns Style object
 *
 * @example
 * ```tsx
 * buildIconStyles({ size: 32, color: 'red', rotate: 45 })
 * // => {
 * //   width: '32px',
 * //   height: '32px',
 * //   color: 'red',
 * //   transform: 'rotate(45deg)'
 * // }
 * ```
 */
export function buildIconStyles(config: IconConfig): Record<string, any> {
  const styles: Record<string, any> = { ...config.style };

  // Size
  if (config.size) {
    const size = resolveIconSize(config.size);
    styles.width = `${size}px`;
    styles.height = `${size}px`;
  }

  // Color
  if (config.color) {
    const color = typeof config.color === 'function' ? (config.color as Signal<string>)() : config.color;
    styles.color = color;
  }

  // Transform
  const transforms: string[] = [];

  if (config.rotate !== undefined) {
    const rotate = typeof config.rotate === 'function' ? (config.rotate as Signal<number>)() : config.rotate;
    transforms.push(`rotate(${rotate}deg)`);
  }

  if (config.flip) {
    const scaleX = config.flip === 'horizontal' || config.flip === 'both' ? -1 : 1;
    const scaleY = config.flip === 'vertical' || config.flip === 'both' ? -1 : 1;
    transforms.push(`scale(${scaleX}, ${scaleY})`);
  }

  if (config.transform) {
    transforms.push(config.transform);
  }

  if (transforms.length > 0) {
    styles.transform = transforms.join(' ');
  }

  // Animation customization
  if (config.animationConfig) {
    const { duration, timing, iterations, delay, direction, fillMode } = config.animationConfig;

    if (duration !== undefined) {
      styles.animationDuration = `${duration}s`;
    }

    if (timing) {
      styles.animationTimingFunction = timing;
    }

    if (iterations !== undefined) {
      styles.animationIterationCount = iterations;
    }

    if (delay !== undefined) {
      styles.animationDelay = `${delay}s`;
    }

    if (direction) {
      styles.animationDirection = direction;
    }

    if (fillMode) {
      styles.animationFillMode = fillMode;
    }
  } else {
    // Apply simple animation config
    if (config.animationDuration !== undefined) {
      styles.animationDuration = `${config.animationDuration}s`;
    }

    if (config.animationTiming) {
      styles.animationTimingFunction = config.animationTiming;
    }

    if (config.animationIterations !== undefined) {
      styles.animationIterationCount = config.animationIterations;
    }
  }

  return styles;
}

/**
 * Build icon accessibility attributes
 *
 * Creates ARIA attributes for icon accessibility
 *
 * @param config - Icon configuration
 * @returns Object with ARIA attributes
 *
 * @example
 * ```tsx
 * buildIconA11yAttributes({ name: 'user', label: 'User profile' })
 * // => { 'aria-label': 'User profile' }
 *
 * buildIconA11yAttributes({ name: 'sparkle', decorative: true })
 * // => { 'aria-hidden': 'true' }
 * ```
 */
export function buildIconA11yAttributes(config: IconConfig): Record<string, string> {
  const attrs: Record<string, string> = {};

  if (config.decorative) {
    attrs['aria-hidden'] = 'true';
  } else if (config.label) {
    attrs['aria-label'] = config.label;
  }

  return attrs;
}

/**
 * Resolve full icon name with preset
 *
 * Combines icon name with preset for registry lookup
 *
 * @param name - Icon name
 * @param preset - Icon preset
 * @returns Full icon identifier
 *
 * @example
 * ```tsx
 * resolveIconName('user', 'stroke')    // => 'icons:stroke:user'
 * resolveIconName('user', 'duotone')   // => 'icons:duotone:user'
 * resolveIconName('custom-icon')       // => 'custom-icon'
 * ```
 */
export function resolveIconName(name: string, preset?: IconPreset): string {
  if (!preset) return name;

  // Check if name already includes preset
  if (name.includes(':')) return name;

  // Build full name with preset
  return `icons:${preset}:${name}`;
}

/**
 * Validate icon configuration
 *
 * Checks if icon configuration is valid
 *
 * @param config - Icon configuration
 * @returns Validation result
 *
 * @example
 * ```tsx
 * validateIconConfig({ name: 'user' })
 * // => { valid: true, errors: [] }
 *
 * validateIconConfig({ name: '' })
 * // => { valid: false, errors: ['Icon name is required'] }
 * ```
 */
export function validateIconConfig(config: IconConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config.name || config.name.trim() === '') {
    errors.push('Icon name is required');
  }

  if (config.size && typeof config.size === 'number' && config.size <= 0) {
    errors.push('Icon size must be greater than 0');
  }

  if (config.animationDuration !== undefined && config.animationDuration <= 0) {
    errors.push('Animation duration must be greater than 0');
  }

  if (config.rotate !== undefined) {
    const rotate = typeof config.rotate === 'function' ? (config.rotate as Signal<number>)() : config.rotate;

    if (typeof rotate !== 'number' || rotate < 0 || rotate >= 360) {
      errors.push('Rotation must be between 0 and 359 degrees');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Merge icon configurations
 *
 * Merges multiple icon configurations with proper precedence
 *
 * @param configs - Array of icon configs (later configs override earlier ones)
 * @returns Merged configuration
 *
 * @example
 * ```tsx
 * mergeIconConfigs(
 *   { name: 'user', preset: 'stroke', size: 'md' },
 *   { animation: 'hover' },
 *   { size: 'lg' }
 * )
 * // => { name: 'user', preset: 'stroke', animation: 'hover', size: 'lg' }
 * ```
 */
export function mergeIconConfigs(...configs: Array<Partial<IconConfig>>): Partial<IconConfig> {
  return configs.reduce(
    (merged, config) => ({
      ...merged,
      ...config,
    }),
    {}
  );
}

/**
 * Check if value is an IconConfig object
 *
 * @param value - Value to check
 * @returns True if value is IconConfig
 *
 * @example
 * ```tsx
 * isIconConfig('user')                                // => false
 * isIconConfig({ name: 'user' })                     // => true
 * isIconConfig({ name: 'user', preset: 'stroke' })   // => true
 * ```
 */
export function isIconConfig(value: any): value is IconConfig {
  return typeof value === 'object' && value !== null && 'name' in value;
}

/**
 * Create icon configuration from string or object
 *
 * Convenience function for creating icon configs
 *
 * @param nameOrConfig - Icon name or configuration
 * @param options - Additional options
 * @returns Icon configuration
 *
 * @example
 * ```tsx
 * createIconConfig('user')
 * // => { name: 'user', preset: 'stroke', animation: 'none', ... }
 *
 * createIconConfig('user', { preset: 'duotone', animation: 'hover' })
 * // => { name: 'user', preset: 'duotone', animation: 'hover', ... }
 *
 * createIconConfig({ name: 'user', size: 'lg' })
 * // => { name: 'user', preset: 'stroke', animation: 'none', size: 'lg', ... }
 * ```
 */
export function createIconConfig(nameOrConfig: string | IconConfig, options?: Partial<IconConfig>): IconConfig {
  const base = typeof nameOrConfig === 'string' ? { name: nameOrConfig } : nameOrConfig;

  return {
    ...DEFAULT_ICON_CONFIG,
    ...base,
    ...options,
  } as IconConfig;
}
