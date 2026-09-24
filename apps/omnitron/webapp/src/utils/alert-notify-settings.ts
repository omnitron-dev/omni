/**
 * The three alert notification settings, and who reads them.
 *
 * They were kept in the browser and read by nobody: the settings page wrote
 * them, and nothing notified anyone of anything. And the severity threshold
 * offered log levels — info / warn / error / fatal — while alerts are
 * `info | warning | critical`: `critical` could not be chosen, and the
 * default `error` matched no alert at all.
 *
 * They stay per browser — a desktop notification's permission and a sound
 * are this browser's — and `useAlertNotifications` reads them on every alert
 * it sees fire.
 */

import { ALERT_SEVERITIES, severityRank, type AlertSeverity } from '@omnitron-dev/omnitron/alerts';
import type { ActiveAlert } from '@omnitron-dev/omnitron/dto/services';

import { readStored, writeStored } from './storage';

export const LS_DESKTOP_NOTIFICATIONS = 'omnitron_desktop_notifications';
export const LS_SOUND_ALERTS = 'omnitron_sound_alerts';
export const LS_ALERT_SEVERITY = 'omnitron_alert_severity';

export const DEFAULT_MIN_SEVERITY: AlertSeverity = 'warning';

export function readLocalBool(key: string, fallback: boolean): boolean {
  const v = readStored(key);
  return v === null ? fallback : v === 'true';
}

export function writeLocalBool(key: string, value: boolean): void {
  writeStored(key, String(value));
}

/** The stored threshold, or the default for nothing stored — or a log level left from before. */
export function readMinSeverity(): AlertSeverity {
  const stored = readStored(LS_ALERT_SEVERITY);
  return stored !== null && (ALERT_SEVERITIES as readonly string[]).includes(stored)
    ? (stored as AlertSeverity)
    : DEFAULT_MIN_SEVERITY;
}

export function readAlertNotifySettings(): { desktop: boolean; sound: boolean; minSeverity: AlertSeverity } {
  return {
    desktop: readLocalBool(LS_DESKTOP_NOTIFICATIONS, false),
    sound: readLocalBool(LS_SOUND_ALERTS, true),
    minSeverity: readMinSeverity(),
  };
}

/**
 * The alerts to announce from one reading of the firing list: those not seen
 * before, at or above the threshold. `seen` is updated with every id read,
 * announced or not, so an alert is announced at most once per page load.
 */
export function alertsToAnnounce(
  seen: Set<string>,
  firing: readonly ActiveAlert[],
  minSeverity: AlertSeverity,
): ActiveAlert[] {
  const fresh = firing.filter((a) => !seen.has(a.id));
  for (const a of firing) seen.add(a.id);
  return fresh.filter((a) => severityRank(a.severity) >= severityRank(minSeverity));
}
