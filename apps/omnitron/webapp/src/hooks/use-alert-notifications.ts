/**
 * Tell the operator when an alert fires — the three notification settings,
 * read at last (`utils/alert-notify-settings.ts`).
 *
 * The daemon's firing list is read every fifteen seconds while the console
 * is open — in a background tab too, which is where a desktop notification
 * is for (a browser may slow a long-hidden tab's timers to once a minute).
 * What is already firing when the console opens is taken as known and not
 * announced; after that, each alert that appears at or above the chosen
 * severity gets a desktop notification (when enabled and permitted) and a
 * short tone (when enabled). Polled rather than pushed: the console's event
 * socket is not wired to anything that sends.
 */

import { useEffect, useRef } from 'react';

import { alerts } from 'src/netron/client';
import { usePolledResource } from 'src/hooks/use-polled-resource';
import { alertsToAnnounce, readAlertNotifySettings } from 'src/utils/alert-notify-settings';

/** A short tone, made here: no sound file travels with the console. */
function tone(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => void ctx.close();
  } catch {
    // No audio in this browser, or not yet allowed — the notification stands alone.
  }
}

export function useAlertNotifications(enabled: boolean): void {
  const seen = useRef<Set<string> | null>(null);
  const { data } = usePolledResource(() => alerts.getActiveAlerts(), {
    intervalMs: 15_000,
    enabled,
    pauseWhileHidden: false,
  });

  useEffect(() => {
    if (!data) return;
    // The first reading is what was already firing: known, not news.
    if (seen.current === null) {
      seen.current = new Set(data.map((a) => a.id));
      return;
    }
    const settings = readAlertNotifySettings();
    const news = alertsToAnnounce(seen.current, data, settings.minSeverity);
    if (news.length === 0) return;

    if (settings.desktop && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const a of news) {
        new Notification(`${a.severity.toUpperCase()} · ${a.ruleName}`, {
          body: a.node ? `${a.message} — ${a.node}` : a.message,
          tag: a.id,
        });
      }
    }
    if (settings.sound) tone();
  }, [data]);
}
