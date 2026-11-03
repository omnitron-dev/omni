/** Stop managed applications through the owner-facing daemon RPC. */
import { createDaemonClient, LONG_REQUEST_TIMEOUT } from '../daemon/daemon-client.js';
import { requireDaemon } from './daemon-required.js';
import { spinner } from './spinner.js';

export async function stopCommand(appName?: string, options: { force?: boolean } = {}): Promise<void> {
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  try {
    if (!(await requireDaemon(client, 'application stop was not sent'))) {
      process.exitCode = 1;
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
        const result = await client.stopApp({ name: appName, force });
        if (!result.success) throw new Error(result.error ?? 'The daemon refused the stop request');
        s.stop(`${appName} stopped`);
      }
    } catch (err) {
      s.stop(`Stop not confirmed: ${err instanceof Error ? err.message : String(err)}`, 1);
      process.exitCode = 1;
    }
  } finally {
    await client.disconnect();
  }
}
