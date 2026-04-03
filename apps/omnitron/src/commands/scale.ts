/**
 * omnitron scale <app> <count>
 */

import { log, spinner } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';

export async function scaleCommand(appName: string, count: string): Promise<void> {
  const instances = parseInt(count, 10);
  if (isNaN(instances) || instances < 1) {
    log.error('Instance count must be a positive integer');
    return;
  }

  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    log.warn('Daemon is not running');
    await client.disconnect();
    return;
  }

  const s = spinner();
  s.start(`Scaling ${appName} to ${instances} instances...`);

  try {
    const app = await client.scale({ name: appName, instances });
    s.stop(`${app.name} scaled to ${app.instances} instances`);
  } catch (err) {
    s.stop(`Failed: ${(err as Error).message}`);
  }

  await client.disconnect();
}
