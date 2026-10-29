/**
 * Topology state colours shared by cards, inspector and minimap.
 */

import { statusColor } from 'src/utils/constants';

// ---------------------------------------------------------------------------
// Status colors — theme-aware via callback
// ---------------------------------------------------------------------------

/**
 * The colour for a state, from the theme when there is one.
 *
 * The classification comes from `statusColor` in `utils/constants` — the
 * console's single answer to which states are healthy, in transition, or
 * wrong. It used to be repeated here as a switch and twice more as hex maps,
 * and they had drifted: `starting` was amber here and yellow in the stack
 * selector, `degraded` amber here and orange there.
 */
export function getStatusColor(status: string, theme?: { palette: any }): string {
  const kind = statusColor(status);
  if (!theme) return FALLBACK_HEX[kind];

  const p = theme.palette;
  const tone = p.mode === 'light' ? 'dark' : 'main';
  if (kind === 'success' || kind === 'warning' || kind === 'error') return p[kind][tone] ?? p[kind].main;
  return p.text.secondary;
}

/**
 * Hex for each classification, used only where no theme is reachable.
 *
 * These are the values the console has always drawn; a preset that changes
 * the palette will not reach here, which is why every caller that CAN pass a
 * theme should.
 */
const FALLBACK_HEX: Record<'success' | 'warning' | 'error' | 'default', string> = {
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  default: '#6b7280',
};
