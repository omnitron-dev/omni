/**
 * omnitron reload [app|all] — Zero-downtime reload
 */

import { log, spinner } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';

export async function reloadCommand(appName?: string): Promise<void> {
  const client = createDaemonClient();

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
