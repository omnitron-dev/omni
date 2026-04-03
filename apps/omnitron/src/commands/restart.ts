/**
 * omnitron restart [app|all]
 */

import { log, spinner } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';

export async function restartCommand(appName?: string): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    log.warn('Daemon is not running');
    await client.disconnect();
    return;
  }

  const s = spinner();

  try {

    if (!appName || appName === 'all') {
      s.start('Restarting all apps...');
      const apps = await client.restartAll();
      s.stop(`Restarted ${apps.length} apps`);
    } else {
      s.start(`Restarting ${appName}...`);
      const app = await client.restartApp({ name: appName });
      s.stop(`${app.name} — ${app.status} (PID: ${app.pid})`);
    }
  } catch (err) {
    s.stop(`Failed: ${(err as Error).message}`);
  }

  await client.disconnect();
}
