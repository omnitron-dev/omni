/**
 * Shared Theme Utilities for Component Overrides
 *
 * Centralized color channel helpers and density utilities.
 * Used across all component override modules.
 *
 * @module @omnitron-dev/prism/theme/components/theme-utils
 */

import type { Theme } from '@mui/material/styles';
import type { ComponentsConfig } from '../../types/theme.js';

// =============================================================================
// COLOR CHANNEL HELPERS
// =============================================================================

/**
 * Safely get a grey color channel from theme.vars or return fallback.
 * MUI's Color type doesn't include channel properties, so we access dynamically.
 */
export function getGreyChannel(theme: Theme, shade: '500' | '900' = '500'): string {
  const channelKey = `${shade}Channel` as const;
  const vars = theme.vars?.palette.grey as Record<string, string> | undefined;
  const fallbacks: Record<string, string> = {
    '500': '145 158 171',
    '900': '0 0 0',
  };
  return vars?.[channelKey] ?? fallbacks[shade];
}

/**
 * Safely get a semantic color channel from theme.vars.
 */
export function getColorChannel(theme: Theme, color: 'primary' | 'success' | 'error' | 'warning' | 'info'): string {
  const vars = theme.vars?.palette[color] as { mainChannel?: string } | undefined;
  const fallbacks: Record<string, string> = {
    primary: '51 133 240',
    success: '9 159 105',
    error: '208 34 65',
    warning: '246 141 42',
    info: '13 166 214',
  };
  return vars?.mainChannel ?? fallbacks[color];
}

// =============================================================================
// DENSITY HELPERS
// =============================================================================

/**
 * Get density multiplier from config.
 */
export function getDensityMultiplier(density: ComponentsConfig['density']): number {
  switch (density) {
    case 'compact':
      return 0.75;
    case 'comfortable':
      return 1.25;
    default:
      return 1;
  }
}
