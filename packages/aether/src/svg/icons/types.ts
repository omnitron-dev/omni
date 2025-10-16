/**
 * Icon API Type Definitions
 *
 * Minimalist, powerful types for icon integration across Aether
 */

import type { Signal } from '../../core/reactivity/signal.js';

/**
 * Available icon presets
 */
export type IconPreset = 'stroke' | 'duotone' | 'twotone';

/**
 * Icon animation types
 */
export type IconAnimation =
  | 'hover' // Animate on mouse hover
  | 'click' // Animate on click
  | 'loading' // Continuous loading animation
  | 'spin' // Continuous spinning
  | 'pulse' // Pulsing scale animation
  | 'bounce' // Bouncing animation
  | 'none'; // No animation

/**
 * Icon position in component
 */
export type IconPosition = 'left' | 'right' | 'top' | 'bottom';

/**
 * Icon size presets
 */
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number;

/**
 * Icon configuration object
 *
 * Flexible object-based API for maximum control
 */
export interface IconConfig {
  /** Icon name from registry */
  name: string;

  /** Icon preset (stroke, duotone, twotone) */
  preset?: IconPreset;

  /** Animation type */
  animation?: IconAnimation;

  /** Icon size */
  size?: IconSize;

  /** Icon color (CSS color value) */
  color?: string | Signal<string>;

  /** Icon position in component */
  position?: IconPosition;

  /** Custom CSS class */
  className?: string;

  /** Custom inline styles */
  style?: any;

  /** Accessibility label */
  label?: string;

  /** Mark icon as decorative (aria-hidden) */
  decorative?: boolean;

  /** Custom animation duration (in seconds) */
  animationDuration?: number;

  /** Custom animation timing function */
  animationTiming?: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | string;

  /** Custom animation iteration count */
  animationIterations?: number | 'infinite';

  /** Rotation angle (degrees) */
  rotate?: number | Signal<number>;

  /** Flip direction */
  flip?: 'horizontal' | 'vertical' | 'both';

  /** Apply transformations */
  transform?: string;
}

/**
 * Simplified icon props for common use cases
 *
 * This is what components accept - can be string or config
 */
export type IconProp = string | IconConfig;

/**
 * Icon props for components with multiple icon slots
 */
export interface IconSlots {
  /** Main icon (used alone or with text) */
  icon?: IconProp;

  /** Left-positioned icon */
  leftIcon?: IconProp;

  /** Right-positioned icon */
  rightIcon?: IconProp;

  /** Top-positioned icon */
  topIcon?: IconProp;

  /** Bottom-positioned icon */
  bottomIcon?: IconProp;

  /** Loading state icon (replaces other icons when loading) */
  loadingIcon?: IconProp;

  /** Default icon preset for all icons */
  iconPreset?: IconPreset;

  /** Default icon size for all icons */
  iconSize?: IconSize;

  /** Default icon color for all icons */
  iconColor?: string | Signal<string>;
}

/**
 * Animation configuration for advanced use cases
 */
export interface AnimationConfig {
  /** Animation type */
  type: IconAnimation;

  /** Duration in seconds */
  duration?: number;

  /** Timing function */
  timing?: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' | string;

  /** Iteration count */
  iterations?: number | 'infinite';

  /** Animation delay in seconds */
  delay?: number;

  /** Animation direction */
  direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';

  /** Fill mode */
  fillMode?: 'none' | 'forwards' | 'backwards' | 'both';

  /** Custom keyframes name */
  keyframes?: string;
}

/**
 * Resolved icon configuration (internal use)
 */
export interface ResolvedIconConfig {
  name: string;
  preset: IconPreset;
  animation: IconAnimation;
  size: number;
  color: string;
  className?: string;
  style?: any;
  label?: string;
  decorative: boolean;
  animationConfig?: AnimationConfig;
  rotate?: number;
  flip?: 'horizontal' | 'vertical' | 'both';
  transform?: string;
}

/**
 * Icon registry entry with metadata
 */
export interface IconEntry {
  /** Icon name */
  name: string;

  /** Icon preset */
  preset: IconPreset;

  /** SVG path data or full SVG content */
  content: string;

  /** ViewBox attribute */
  viewBox?: string;

  /** Icon metadata */
  metadata?: {
    tags?: string[];
    category?: string;
    keywords?: string[];
  };
}

/**
 * Icon context value for providers
 */
export interface IconContextValue {
  /** Default icon preset */
  defaultPreset?: IconPreset;

  /** Default icon size */
  defaultSize?: IconSize;

  /** Default icon color */
  defaultColor?: string;

  /** Default animation */
  defaultAnimation?: IconAnimation;

  /** Custom icon registry path */
  registryPath?: string;
}
