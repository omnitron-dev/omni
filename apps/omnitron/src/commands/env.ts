/**
 * omnitron env [app] — Show resolved environment variables
 */

import { log, prism } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { emitJson, emitError } from './output.js';
import { requireDaemon } from './daemon-required.js';

/**
 * The daemon replaces secrets before they leave it (`redactEnv`); `--reveal`
 * asks for the clear values, which only an admin may have and which the
 * daemon records in its audit trail.
 */
export async function envCommand(appName: string, options: { reveal?: boolean } = {}): Promise<void> {
  const client = createDaemonClient();

  if (!(await requireDaemon(client))) {
    await client.disconnect();
    return;
  }

  try {
    const envVars = options.reveal ? await client.revealEnv({ name: appName }) : await client.getEnv({ name: appName });
    if (options.reveal) log.warn('Secrets shown in clear — this reveal is recorded in the audit trail.');

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
    process.exitCode = 1;
  }

  await client.disconnect();
}
