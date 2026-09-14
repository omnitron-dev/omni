/**
 * omnitron reload [app|all] — Zero-downtime reload
 */

import { log } from '@xec-sh/kit';
import { spinner } from './spinner.js';
import { createDaemonClient, LONG_REQUEST_TIMEOUT } from '../daemon/daemon-client.js';

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
export async function reloadCommand(appName?: string): Promise<void> {
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);

  if (!(await client.isReachable())) {
    log.warn('Daemon is not running');
    await client.disconnect();
    return;
  }

  const s = spinner();

  try {

    if (!appName || appName === 'all') {
      s.start('Reloading all apps...');
      const apps = await client.restartAll();
      s.stop(`Reloaded ${apps.length} apps`);
    } else {
      s.start(`Reloading ${appName}...`);
      const app = await client.reloadApp({ name: appName });
      s.stop(`${app.name} — ${app.status}`);
    }
  } catch (err) {
    s.stop(`Failed: ${(err as Error).message}`);
  }

  await client.disconnect();
}
