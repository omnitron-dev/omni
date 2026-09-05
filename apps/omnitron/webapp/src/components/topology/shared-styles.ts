/**
 * Shared topology node styles — theme-aware via Prism palette.
 *
 * Uses MUI theme palette references instead of hardcoded hex values.
 * This ensures topology nodes adapt to any Prism preset (midnight, dracula, etc.).
 */

import type { SxProps, Theme } from '@mui/material/styles';

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
  if (kind === 'success') return p.success.main;
  if (kind === 'warning') return p.warning.main;
  if (kind === 'error') return p.error.main;
  return p.text.disabled;
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

// ---------------------------------------------------------------------------
// Glass card style — uses theme-aware alpha
// ---------------------------------------------------------------------------

export const glassCardSx: SxProps<Theme> = {
  background: (theme) => theme.palette.mode === 'dark'
    ? 'rgba(15, 15, 25, 0.85)'
    : 'rgba(255, 255, 255, 0.9)',
  backdropFilter: 'blur(12px)',
  border: (theme) => `1px solid ${theme.palette.divider}`,
  borderRadius: '12px',
  color: (theme) => theme.palette.text.primary,
  minWidth: 260,
  transition: 'border-color 0.2s, box-shadow 0.2s',
  '&:hover': {
    borderColor: (theme) => theme.palette.mode === 'dark'
      ? 'rgba(255, 255, 255, 0.12)'
      : 'rgba(0, 0, 0, 0.12)',
  },
};

export const selectedGlowSx: SxProps<Theme> = {
  borderColor: (theme) => `${theme.palette.primary.main} !important`,
  boxShadow: (theme) => `0 0 20px ${theme.palette.primary.main}26, inset 0 0 20px ${theme.palette.primary.main}08`,
};

// ---------------------------------------------------------------------------
// Pulse keyframe
// ---------------------------------------------------------------------------

export const pulseKeyframes = `
@keyframes topoPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.6; transform: scale(1.3); }
}
`;

// ---------------------------------------------------------------------------
// Mini progress bar — theme-aware
// ---------------------------------------------------------------------------

export function miniBarSx(value: number, color: string, height = 4): SxProps<Theme> {
  const pct = Math.min(100, Math.max(0, value));
  return {
    width: '100%',
    height,
    borderRadius: height / 2,
    bgcolor: (theme) => theme.palette.action.hover,
    position: 'relative',
    overflow: 'hidden',
    '&::after': {
      content: '""',
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: `${pct}%`,
      borderRadius: height / 2,
      bgcolor: color,
      transition: 'width 0.4s ease',
    },
  };
}
