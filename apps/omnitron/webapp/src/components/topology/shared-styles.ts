/**
 * Shared topology node styles — theme-aware via Prism palette.
 *
 * Uses MUI theme palette references instead of hardcoded hex values.
 * This ensures topology nodes adapt to any Prism preset (midnight, dracula, etc.).
 */

import type { SxProps, Theme } from '@mui/material/styles';

// ---------------------------------------------------------------------------
// Status colors — theme-aware via callback
// ---------------------------------------------------------------------------

export function getStatusColor(status: string, theme?: { palette: any }): string {
  if (!theme) return getStatusColorFallback(status);
  const p = theme.palette;
  switch (status) {
    case 'online':
    case 'running':
    case 'healthy':
      return p.success.main;
    case 'starting':
    case 'stopping':
    case 'degraded':
    case 'restarting':
      return p.warning.main;
    case 'crashed':
    case 'errored':
    case 'unhealthy':
    case 'dead':
    case 'offline':
      return p.error.main;
    default:
      return p.text.disabled;
  }
}

/** Fallback for contexts without theme access */
function getStatusColorFallback(status: string): string {
  const STATUS_COLORS: Record<string, string> = {
    online: '#22c55e', running: '#22c55e', healthy: '#22c55e',
    starting: '#f59e0b', stopping: '#f59e0b', degraded: '#f59e0b', restarting: '#f59e0b',
    stopped: '#6b7280', exited: '#6b7280', not_found: '#6b7280', none: '#6b7280', unknown: '#6b7280',
    crashed: '#ef4444', errored: '#ef4444', unhealthy: '#ef4444', dead: '#ef4444', offline: '#ef4444',
  };
  return STATUS_COLORS[status] ?? '#6b7280';
}

// Legacy export for MiniMap (no theme context)
export const STATUS_DOT_COLORS: Record<string, string> = {
  online: '#22c55e', running: '#22c55e', healthy: '#22c55e',
  starting: '#f59e0b', stopping: '#f59e0b',
  stopped: '#6b7280', exited: '#6b7280',
  crashed: '#ef4444', errored: '#ef4444', unhealthy: '#ef4444', offline: '#ef4444',
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
