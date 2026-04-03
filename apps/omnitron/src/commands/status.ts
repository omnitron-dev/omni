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

export async function statusCommand(): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    // Socket not responding — check PID file for diagnostics
    try {
      const dc = DEFAULT_DAEMON_CONFIG;
      const pidFile = dc.pidFile.replace('~', process.env['HOME'] ?? '');
      const socketPath = dc.socketPath.replace('~', process.env['HOME'] ?? '');
      const pidManager = new PidManager(pidFile);

      const rawPid = pidManager.readPid();
      if (rawPid !== null) {
        if (PidManager.isProcessAlive(rawPid)) {
          log.warn(`Daemon process exists (PID: ${rawPid}) but socket is not responding`);
          log.info('The daemon may still be starting. Retry in a few seconds, or kill it:');
          log.info(`  omnitron daemon kill`);
        } else {
          // Stale PID — clean up
          const cleaned = pidManager.cleanupStale(socketPath);
          if (cleaned) {
            log.warn('Cleaned up stale PID/socket from a previously crashed daemon');
          }
          log.warn('Daemon is not running');
        }
      } else {
        log.warn('Daemon is not running');
      }
    } catch {
      log.warn('Daemon is not running');
    }

    await client.disconnect();
    return;
  }

  try {
    const status = await client.status();

    const onlineApps = status.apps.filter((a: any) => a.status === 'online');
    const erroredApps = status.apps.filter((a: any) => a.status === 'errored' || a.status === 'crashed');

    // Daemon status only — no app table (use `omnitron list` for apps)
    const headerLines = [
      `Version:    ${prism.bold(status.version)}`,
      `PID:        ${status.pid}`,
      `Uptime:     ${formatUptime(status.uptime)}`,
      `Memory:     ${formatMemoryColored(status.totalMemory)}`,
      `Apps:       ${prism.green(String(onlineApps.length))} online / ${status.apps.length} total`,
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
