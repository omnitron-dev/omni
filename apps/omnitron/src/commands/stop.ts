/**
 * omnitron stop [app|all]
 *
 * Gracefully stops managed apps (or the whole daemon).
 * Falls back to PID-based cleanup when the socket is unreachable.
 */

import { log } from '@xec-sh/kit';
import { spinner } from './spinner.js';
import { createDaemonClient, LONG_REQUEST_TIMEOUT } from '../daemon/daemon-client.js';
import { PidManager } from '../daemon/pid-manager.js';
import { DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { expandPath } from '../shared/paths.js';

/**
 * These commands wait for a whole Titan application to come up.
 *
 * The daemon allows an app up to its own `startupTimeout` — configured at two
 * and five minutes for the applications on this host — while the CLI's default
 * ceiling is sixty seconds. So the client gave up first, on an operation the
 * daemon had four more minutes to finish, and reported
 * `RPC request timed out after 60000ms`. Observed: three consecutive
 * `omnitron restart` calls "failed" that way and one of the apps came up
 * anyway. `daemon-client.ts` says why that is the worst thing to report — the
 * daemon cancels nothing when the caller stops waiting, so the operation runs
 * on with its outcome unknown, and an operator acts on the word "failed".
 *
 * `LONG_REQUEST_TIMEOUT` already exists for exactly this and was wired into
 * the STACK commands only; the per-app ones kept the default.
 */
export async function stopCommand(appName?: string, options: { force?: boolean } = {}): Promise<void> {
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);

  if (!(await client.isReachable())) {
    // Fall back: try to find and kill daemon via PID file
    const dc = DEFAULT_DAEMON_CONFIG;
    const pidFile = expandPath(dc.pidFile);
    const socketPath = expandPath(dc.socketPath);
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
        // `getPid()` and not `isProcessAlive()`: the second reads the pid
        // file AND checks the live process's argv against the signature
        // written there, so it answers "is OUR daemon still at this pid",
        // which is the question a SIGKILL needs answered. The ten seconds
        // above are exactly the window in which the daemon exits and the
        // kernel hands its number to something else — and this branch is
        // reached only when the daemon did NOT exit on its own, which is
        // when the file is most likely to be out of date. `daemonStop` was
        // fixed the same way; leaving the two commands disagreeing is how
        // one of them gets read as authoritative later.
        if (pidManager.getPid() !== pid) {
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
