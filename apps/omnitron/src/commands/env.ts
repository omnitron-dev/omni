/**
 * omnitron env [app] — Show resolved environment variables
 */

import { log, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';

export async function envCommand(appName: string): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    log.warn('Daemon is not running');
    await client.disconnect();
    return;
  }

  try {
    const envVars = await client.getEnv({ name: appName });

    if (Object.keys(envVars).length === 0) {
      log.info(`No custom environment variables for ${appName}`);
    } else {
      console.log(`Environment for ${prism.cyan(appName)}:`);
      for (const [key, value] of Object.entries(envVars).sort()) {
        console.log(`  ${prism.green(key)}=${value}`);
      }
    }
  } catch (err) {
    log.error((err as Error).message);
  }

  await client.disconnect();
}
