/**
 * omnitron stop [app|all]
 *
 * Gracefully stops managed apps (or the whole daemon).
 * Falls back to PID-based cleanup when the socket is unreachable.
 */

import { log, spinner } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { PidManager } from '../daemon/pid-manager.js';
import { DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';

export async function stopCommand(appName?: string, options: { force?: boolean } = {}): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    // Fall back: try to find and kill daemon via PID file
    const dc = DEFAULT_DAEMON_CONFIG;
    const pidFile = dc.pidFile.replace('~', process.env['HOME'] ?? '');
    const socketPath = dc.socketPath.replace('~', process.env['HOME'] ?? '');
    const pidManager = new PidManager(pidFile);
    const pid = pidManager.getPid();

    if (pid) {
      log.info(`Socket unreachable — sending SIGTERM to daemon (PID: ${pid})...`);
      try {
        process.kill(pid, 'SIGTERM');
        const maxWait = 10_000;
        const start = Date.now();
        while (Date.now() - start < maxWait && PidManager.isProcessAlive(pid)) {
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!PidManager.isProcessAlive(pid)) {
          pidManager.remove();
          log.success('Daemon stopped');
        } else {
          process.kill(pid, 'SIGKILL');
          pidManager.remove();
          log.success(`Daemon force-killed (PID: ${pid})`);
        }
      } catch {
        pidManager.cleanupStale(socketPath);
      }
    } else {
      pidManager.cleanupStale(socketPath);
      log.warn('Daemon is not running');
    }

    await client.disconnect();
    return;
  }

  const s = spinner();
  const force = options.force ?? false;

  try {

    if (!appName || appName === 'all') {
      s.start('Stopping all apps...');
      const result = await client.stopAll({ force });
      s.stop(`Stopped ${result.count} apps`);
    } else {
      s.start(`Stopping ${appName}...`);
      await client.stopApp({ name: appName, force });
      s.stop(`${appName} stopped`);
    }
  } catch (err) {
    s.stop(`Failed: ${(err as Error).message}`);
  }

  await client.disconnect();
}
