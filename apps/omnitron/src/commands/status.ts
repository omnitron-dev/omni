/**
 * omnitron status — Rich daemon status overview
 *
 * Shows daemon info, per-app status table, and aggregate metrics.
 * Uses both socket connection and PID file for robust detection.
 * Cleans up stale state from crashed daemons automatically.
 */

import { box, log, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { PidManager } from '../daemon/pid-manager.js';
import { DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { formatUptime, formatMemoryColored } from '../shared/format.js';
import { expandPath } from '../shared/paths.js';
import { reportAbsence } from './daemon-required.js';

export async function statusCommand(): Promise<void> {
  const client = createDaemonClient();

  const absence = await client.whyUnreachable();
  if (absence) {
    // This command's own copy of the pid-file check was, for a long time, the
    // only place in the CLI that told a stopped daemon from a silent one.
    // That copy is now `DaemonClient.whyUnreachable()`, so every command gets
    // the distinction; what stays here is the part only `status` does —
    // clearing up after a daemon that crashed.
    reportAbsence(absence);
    if (absence.kind === 'stale') {
      try {
        const dc = DEFAULT_DAEMON_CONFIG;
        const pidManager = new PidManager(expandPath(dc.pidFile));
        if (pidManager.cleanupStale(expandPath(dc.socketPath))) {
          log.info('Cleaned up the PID file and socket it left behind');
        }
      } catch { /* diagnostics only — the report above is what matters */ }
    }
    if (absence.kind === 'silent') {
      log.info('  omnitron down          # graceful: SIGTERM, then SIGKILL after 3s');
      log.info('  omnitron kill          # force immediately');
    }

    await client.disconnect();
    return;
  }

  try {
    const status = await client.status();

    const onlineApps = status.apps.filter((a: any) => a.status === 'online');
    const erroredApps = status.apps.filter((a: any) => a.status === 'errored' || a.status === 'crashed');

    // JSON mode — emit structured snapshot and skip TUI rendering.
    {
      const { emitJson } = await import('./output.js');
      if (emitJson({
        version: status.version,
        pid: status.pid,
        uptime: status.uptime,
        memoryBytes: status.totalMemory,
        ...(status.daemonMemory !== undefined ? { daemonMemoryBytes: status.daemonMemory } : {}),
        ...(status.appsMemory !== undefined ? { appsMemoryBytes: status.appsMemory } : {}),
        appsTotal: status.apps.length,
        appsOnline: onlineApps.length,
        errors: erroredApps.map((a: any) => a.name),
        apps: status.apps,
      })) {
        await client.disconnect();
        return;
      }
    }

    // Daemon status only — no app table (use `omnitron list` for apps)
    const headerLines = [
      `Version:    ${prism.bold(status.version)}`,
      `PID:        ${status.pid}`,
      `Uptime:     ${formatUptime(status.uptime)}`,
      // The daemon's own memory and the apps' apart; a daemon on an older
      // build answers only the sum, and says so.
      ...(status.daemonMemory !== undefined && status.appsMemory !== undefined
        ? [
            `Memory:     ${formatMemoryColored(status.daemonMemory)} daemon (RSS)`,
            `Apps:       ${formatMemoryColored(status.appsMemory)} across ${status.apps.length} app(s)`,
          ]
        : [`Memory:     ${formatMemoryColored(status.totalMemory)} (daemon and apps together)`]),
      `Online:     ${prism.green(String(onlineApps.length))} of ${status.apps.length} app(s)`,
      ...(erroredApps.length > 0
        ? [`Errors:     ${prism.red(String(erroredApps.length))} (${erroredApps.map((a: any) => a.name).join(', ')})`]
        : []),
    ];

    box(headerLines.join('\n'), 'Omnitron Daemon');
  } catch (err) {
    log.error((err as Error).message);
  }

  await client.disconnect();
}
