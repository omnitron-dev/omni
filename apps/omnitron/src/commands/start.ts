/**
 * omnitron start [app|all]
 *
 * Starts app(s). Auto-starts daemon if not running.
 */

import { log, spinner } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { daemonStart } from './daemon-cmd.js';

export async function startCommand(appName?: string): Promise<void> {
  const client = createDaemonClient();

  // Auto-start daemon if not running
  if (!(await client.isReachable())) {
    log.info('Daemon not running — starting it first...');
    await daemonStart();

    // If no specific app requested, daemon already started all
    if (!appName) {
      await client.disconnect();
      return;
    }
  }

  const s = spinner();

  try {

    if (!appName || appName === 'all') {
      s.start('Starting all apps...');
      const apps = await client.startAll();
      s.stop(`Started ${apps.length} apps`);

      for (const app of apps) {
        log.success(`  ${app.name} — ${app.status} (PID: ${app.pid})`);
      }
    } else {
      s.start(`Starting ${appName}...`);
      const app = await client.startApp({ name: appName });
      s.stop(`${app.name} — ${app.status} (PID: ${app.pid})`);
    }
  } catch (err) {
    s.stop(`Failed: ${(err as Error).message}`);
    log.error((err as Error).message);
  }

  await client.disconnect();
}
