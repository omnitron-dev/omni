/**
 * Shared constants for the Omnitron webapp.
 *
 * Centralises STATUS_COLORS, LEVEL_COLORS, LEVEL_BG so they are not
 * duplicated across pages.
 */

import type { AppStatus } from '@omnitron-dev/omnitron/dto/services';

export const STATUS_COLORS: Record<AppStatus, 'success' | 'error' | 'warning' | 'default'> = {
  online: 'success',
  stopped: 'default',
  crashed: 'error',
  errored: 'error',
  starting: 'warning',
  stopping: 'warning',
};

export const LEVEL_COLORS: Record<string, string> = {
  fatal: '#dc2626',
  error: '#ef4444',
  warn: '#f59e0b',
  info: '#3b82f6',
  debug: '#6b7280',
  trace: '#9ca3af',
};

export const LEVEL_BG: Record<string, string> = {
  fatal: 'rgba(220,38,38,0.08)',
  error: 'rgba(239,68,68,0.06)',
  warn: 'rgba(245,158,11,0.06)',
};
