/**
 * omnitron exec <app> <service> <method> [...args]
 */

import { log } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';

export async function execCommand(appName: string, service: string, method: string, args: string[]): Promise<void> {
  const client = createDaemonClient();

  if (!(await client.isReachable())) {
    log.warn('Daemon is not running');
    await client.disconnect();
    return;
  }

  try {
    // Parse args as JSON where possible
    const parsedArgs = args.map((arg) => {
      try {
        return JSON.parse(arg);
      } catch {
        return arg;
      }
    });

    const result = await client.exec({
      name: appName,
      service,
      method,
      args: parsedArgs,
    });

    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    log.error((err as Error).message);
  }

  await client.disconnect();
}
