/**
 * Shared Theme Utilities for Component Overrides
 *
 * Centralized color channel helpers and density utilities.
 * Used across all component override modules.
 *
 * @module theme/components/theme-utils
 */

import type { Theme } from '@mui/material/styles';
import type { ComponentsConfig } from '../../types/theme.js';
import { channelFor } from '../palette/overrides.js';

// =============================================================================
// COLOR CHANNEL HELPERS
// =============================================================================

/**
 * Resolve a grey channel from the active theme, including themes without CSS variables.
 * MUI's Color type doesn't include channel properties, so we access dynamically.
 */
export function getGreyChannel(theme: Theme, shade: '500' | '900' = '500'): string {
  const channelKey = `${shade}Channel` as const;
  const vars = theme.vars?.palette.grey as Record<string, string> | undefined;
  const palette = theme.palette.grey as unknown as Record<string, string>;
  return vars?.[channelKey] ?? palette[channelKey] ?? channelFor(palette[shade]!);
}

/**
 * Resolve a `theme.vars.palette.<path>` value with fallback to the
 * non-CSS-variable `theme.palette.<path>` equivalent. The `theme.vars`
 * branch exists when CssVarsProvider is in scope and the override
 * needs to participate in light/dark theme-switching without a
 * re-mount; the fallback covers SSR and theme-without-vars paths.
 *
 * Path is dotted, e.g. `'text.primary'`, `'action.disabled'`,
 * `'grey.500'`, `'divider'`. Always returns a string — when neither
 * branch resolves to a string (path typo or missing palette token)
 * returns `''`, which CSS treats as "no-op" so a broken token never
 * breaks layout, just produces a missing colour.
 *
 * This replaces the verbose `theme.vars?.palette.X.Y || theme.palette.X.Y`
 * chain used throughout component overrides — one helper, one
 * fallback rule, two code lines collapse to one.
 */
export function paletteVar(theme: Theme, path: string): string {
  const segments = path.split('.');
  const fromVars = (theme.vars?.palette as unknown as Record<string, unknown> | undefined) ?? undefined;
  const fromFallback = theme.palette as unknown as Record<string, unknown>;
  const walk = (obj: Record<string, unknown> | undefined): unknown =>
    segments.reduce<unknown>(
      (acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined),
      obj,
    );
  const fromVarsVal = walk(fromVars);
  if (typeof fromVarsVal === 'string') return fromVarsVal;
  const fromFallbackVal = walk(fromFallback);
  if (typeof fromFallbackVal === 'string') return fromFallbackVal;
  return '';
}

/**
 * Resolve a semantic channel without substituting a hard-coded preset colour.
 */
export function getColorChannel(theme: Theme, color: 'primary' | 'success' | 'error' | 'warning' | 'info'): string {
  const vars = theme.vars?.palette[color] as { mainChannel?: string } | undefined;
  const palette = theme.palette[color] as { main: string; mainChannel?: string };
  return vars?.mainChannel ?? palette.mainChannel ?? channelFor(palette.main);
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
