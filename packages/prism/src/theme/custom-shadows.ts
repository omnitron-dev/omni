/**
 * Custom Shadows
 *
 * Color-coded shadow system for consistent depth effects.
 * Based on Minimals template patterns.
 *
 * @module @omnitron/prism/theme/custom-shadows
 */

import { varAlpha } from './utils/color.js';

/**
 * Custom shadows configuration.
 */
export interface CustomShadows {
  /** Shadow level 1 - minimal elevation */
  z1: string;
  /** Shadow level 4 - subtle elevation */
  z4: string;
  /** Shadow level 8 - medium elevation */
  z8: string;
  /** Shadow level 12 - prominent elevation */
  z12: string;
  /** Shadow level 16 - high elevation */
  z16: string;
  /** Shadow level 20 - very high elevation */
  z20: string;
  /** Shadow level 24 - maximum elevation */
  z24: string;
  /** Primary color shadow */
  primary: string;
  /** Secondary color shadow */
  secondary: string;
  /** Info color shadow */
  info: string;
  /** Success color shadow */
  success: string;
  /** Warning color shadow */
  warning: string;
  /** Error color shadow */
  error: string;
  /** Card shadow */
  card: string;
  /** Dialog shadow */
  dialog: string;
  /** Dropdown shadow */
  dropdown: string;
}

/**
 * Default color channels for shadow colors.
 */
const defaultChannels = {
  grey500: '145, 158, 171',
  black: '0, 0, 0',
  primary: '51, 133, 240',
  secondary: '142, 51, 240',
  info: '13, 166, 214',
  success: '9, 159, 105',
  warning: '246, 141, 42',
  error: '208, 34, 65',
};

/**
 * Create shadow for a specific color.
 */
function createShadowColor(colorChannel: string): string {
  return `0 8px 16px 0 ${varAlpha(colorChannel, 0.24)}`;
}

/**
 * Create custom shadows based on a color channel.
 */
function createCustomShadows(colorChannel: string, blackChannel: string): CustomShadows {
  return {
    z1: `0 1px 2px 0 ${varAlpha(colorChannel, 0.16)}`,
    z4: `0 4px 8px 0 ${varAlpha(colorChannel, 0.16)}`,
    z8: `0 8px 16px 0 ${varAlpha(colorChannel, 0.16)}`,
    z12: `0 12px 24px -4px ${varAlpha(colorChannel, 0.16)}`,
    z16: `0 16px 32px -4px ${varAlpha(colorChannel, 0.16)}`,
    z20: `0 20px 40px -4px ${varAlpha(colorChannel, 0.16)}`,
    z24: `0 24px 48px 0 ${varAlpha(colorChannel, 0.16)}`,
    // Component-specific shadows
    dialog: `-40px 40px 80px -8px ${varAlpha(blackChannel, 0.24)}`,
    card: `0 0 2px 0 ${varAlpha(colorChannel, 0.2)}, 0 12px 24px -4px ${varAlpha(colorChannel, 0.12)}`,
    dropdown: `0 0 2px 0 ${varAlpha(colorChannel, 0.24)}, -20px 20px 40px -4px ${varAlpha(colorChannel, 0.24)}`,
    // Color-specific shadows
    primary: createShadowColor(defaultChannels.primary),
    secondary: createShadowColor(defaultChannels.secondary),
    info: createShadowColor(defaultChannels.info),
    success: createShadowColor(defaultChannels.success),
    warning: createShadowColor(defaultChannels.warning),
    error: createShadowColor(defaultChannels.error),
  };
}

/**
 * Custom shadows for light mode.
 */
export const lightCustomShadows: CustomShadows = createCustomShadows(defaultChannels.grey500, defaultChannels.black);

/**
 * Custom shadows for dark mode.
 */
export const darkCustomShadows: CustomShadows = createCustomShadows(defaultChannels.black, defaultChannels.black);

/**
 * Create custom shadows with specific palette channels.
 */
export function createCustomShadowsFromPalette(
  greyChannel: string,
  primaryChannel: string,
  secondaryChannel: string,
  infoChannel: string,
  successChannel: string,
  warningChannel: string,
  errorChannel: string,
  mode: 'light' | 'dark'
): CustomShadows {
  const colorChannel = mode === 'light' ? greyChannel : defaultChannels.black;

  return {
    z1: `0 1px 2px 0 ${varAlpha(colorChannel, 0.16)}`,
    z4: `0 4px 8px 0 ${varAlpha(colorChannel, 0.16)}`,
    z8: `0 8px 16px 0 ${varAlpha(colorChannel, 0.16)}`,
    z12: `0 12px 24px -4px ${varAlpha(colorChannel, 0.16)}`,
    z16: `0 16px 32px -4px ${varAlpha(colorChannel, 0.16)}`,
    z20: `0 20px 40px -4px ${varAlpha(colorChannel, 0.16)}`,
    z24: `0 24px 48px 0 ${varAlpha(colorChannel, 0.16)}`,
    // Component-specific shadows
    dialog: `-40px 40px 80px -8px ${varAlpha(defaultChannels.black, 0.24)}`,
    card: `0 0 2px 0 ${varAlpha(colorChannel, 0.2)}, 0 12px 24px -4px ${varAlpha(colorChannel, 0.12)}`,
    dropdown: `0 0 2px 0 ${varAlpha(colorChannel, 0.24)}, -20px 20px 40px -4px ${varAlpha(colorChannel, 0.24)}`,
    // Color-specific shadows
    primary: createShadowColor(primaryChannel),
    secondary: createShadowColor(secondaryChannel),
    info: createShadowColor(infoChannel),
    success: createShadowColor(successChannel),
    warning: createShadowColor(warningChannel),
    error: createShadowColor(errorChannel),
  };
}
