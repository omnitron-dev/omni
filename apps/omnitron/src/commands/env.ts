/**
 * omnitron env [app] — Show resolved environment variables
 */

import { log, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { emitJson, emitError, isJsonMode } from './output.js';

export async function envCommand(appName: string): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    if (isJsonMode()) emitError('Daemon is not running');
    else log.warn('Daemon is not running');
    await client.disconnect();
    return;
  }

  try {
    const envVars = await client.getEnv({ name: appName });

    if (emitJson({ app: appName, env: envVars })) {
      await client.disconnect();
      return;
    }

    if (Object.keys(envVars).length === 0) {
      log.info(`No custom environment variables for ${appName}`);
    } else {
      console.log(`Environment for ${prism.cyan(appName)}:`);
      for (const [key, value] of Object.entries(envVars).sort()) {
        console.log(`  ${prism.green(key)}=${value}`);
      }
    }
  } catch (err) {
    emitError((err as Error).message, { app: appName });
  }

  await client.disconnect();
}
