/**
 * Icon Component
 *
 * High-level wrapper around SVGIcon for the minimalist icon API
 * Supports string-based and object-based icon configuration
 */

import { defineComponent } from '../../core/component/define.js';
import { SVGIcon } from './SVGIcon.js';
import type { IconProp, IconConfig } from '../icons/types.js';
import {
  normalizeIcon,
  buildIconClasses,
  buildIconDataAttributes,
  buildIconStyles,
  buildIconA11yAttributes,
  resolveIconName,
  resolveIconSize,
} from '../icons/utils.js';
import { getIconRegistry } from '../icons/IconRegistry.js';
import { useIconDefaults } from '../icons/IconProvider.js';

/**
 * Icon component props
 *
 * Accepts either:
 * - String: icon name (simplest)
 * - IconConfig: full configuration object
 */
export interface IconProps extends Partial<IconConfig> {
  /** Icon name or full configuration */
  name: string;

  /** Click handler */
  onClick?: (e: MouseEvent) => void;

  /** Mouse enter handler */
  onMouseEnter?: (e: MouseEvent) => void;

  /** Mouse leave handler */
  onMouseLeave?: (e: MouseEvent) => void;

  /** Load handler */
  onLoad?: () => void;

  /** Error handler */
  onError?: (e: Error) => void;
}

/**
 * Icon component
 *
 * Minimalist, powerful icon component for Aether
 *
 * @example Simple usage
 * ```tsx
 * <Icon name="user" />
 * ```
 *
 * @example With size and color
 * ```tsx
 * <Icon name="heart" size="lg" color="red" />
 * ```
 *
 * @example With animation
 * ```tsx
 * <Icon name="spinner" animation="spin" />
 * <Icon name="heart" animation="pulse" />
 * ```
 *
 * @example Advanced configuration
 * ```tsx
 * <Icon
 *   name="user"
 *   preset="duotone"
 *   size={32}
 *   animation="hover"
 *   animationDuration={0.3}
 *   rotate={45}
 *   flip="horizontal"
 * />
 * ```
 *
 * @example Decorative icon
 * ```tsx
 * <Icon name="sparkle" decorative />
 * ```
 *
 * @example With label for accessibility
 * ```tsx
 * <Icon name="warning" label="Warning" />
 * ```
 */
export const Icon = defineComponent<IconProps>((props) => {
  // Get default icon settings from context
  const defaults = useIconDefaults();

  return () => {
    // Normalize icon configuration
    const config = normalizeIcon(
      {
        name: props.name,
        preset: props.preset,
        animation: props.animation,
        size: props.size,
        color: props.color,
        position: props.position,
        className: props.className,
        style: props.style,
        label: props.label,
        decorative: props.decorative,
        animationDuration: props.animationDuration,
        animationTiming: props.animationTiming,
        animationIterations: props.animationIterations,
        rotate: props.rotate,
        flip: props.flip,
        transform: props.transform,
      },
      defaults
    );

    if (!config) return null;

    // Resolve full icon name with preset
    const fullIconName = resolveIconName(config.name, config.preset);

    // Build props for SVGIcon
    const iconClasses = buildIconClasses(config);
    const dataAttrs = buildIconDataAttributes(config);
    const styles = buildIconStyles(config);
    const a11yAttrs = buildIconA11yAttributes(config);

    // Resolve size to number
    const size = resolveIconSize(config.size);

    return (
      <SVGIcon
        name={fullIconName}
        size={size}
        color={config.color}
        className={iconClasses}
        style={styles}
        onClick={props.onClick}
        onLoad={props.onLoad}
        onError={props.onError}
        {...dataAttrs}
        {...a11yAttrs}
      />
    );
  };
});
