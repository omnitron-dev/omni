/**
 * Shared constants for the Omnitron webapp.
 *
 * Centralises STATUS_COLORS, LEVEL_COLORS, LEVEL_BG so they are not
 * duplicated across pages.
 */


/**
 * One answer to "what colour is this state", for the whole console.
 *
 * There were three, and they disagreed. This map (MUI palette names, keyed on
 * `AppStatus`); a hex map in `stack-selector` where `starting` is #eab308 and
 * `degraded` is #f97316; and a wider hex map in `topology/shared-styles` where
 * the same two are #f59e0b. So a stack that was starting drew yellow in the
 * selector and amber in the topology view, and an operator comparing the two
 * had no way to know they meant the same thing.
 *
 * Keyed by `string` rather than `AppStatus` because the console renders more
 * kinds of state than an app has: containers are `exited`, health is
 * `unhealthy`, stacks are `running` and `degraded`. Anything unknown is
 * `default` — grey, which reads as "no opinion" rather than as a colour that
 * means something.
 */
export const STATUS_COLORS: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  // Running, and meant to be.
  online: 'success',
  running: 'success',
  healthy: 'success',

  // In transition — nothing is wrong yet.
  starting: 'warning',
  stopping: 'warning',
  restarting: 'warning',
  degraded: 'warning',
  provisioning: 'warning',

  // Deliberately not running.
  stopped: 'default',
  exited: 'default',
  created: 'default',
  none: 'default',
  unknown: 'default',
  not_found: 'default',

  // Wrong.
  crashed: 'error',
  errored: 'error',
  error: 'error',
  unhealthy: 'error',
  dead: 'error',
  offline: 'error',
};

/** The palette colour for a state, or `default` when the console has no opinion. */
export function statusColor(status: string | null | undefined): 'success' | 'error' | 'warning' | 'default' {
  return (status && STATUS_COLORS[status]) || 'default';
}

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
