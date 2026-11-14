/** Start one managed application, or start the fleet when explicitly requested. */
import { createProgress, emitError } from './output.js';
import { log } from '@xec-sh/kit';
import { createDaemonClient, LONG_REQUEST_TIMEOUT } from '../daemon/daemon-client.js';
import { daemonStart } from './daemon-cmd.js';
import { reportAbsence, requireDaemon } from './daemon-required.js';

export async function startCommand(appName?: string): Promise<void> {
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  const progress = createProgress();
  try {
    const absence = await client.whyUnreachable();
    if (absence) {
      // Starting a daemon can start every autostart stack. Only a fleet-wide
      // request can authorize that, and only when the previous daemon is gone.
      if ((appName && appName !== 'all') || (absence.kind !== 'stopped' && absence.kind !== 'stale')) {
        reportAbsence(absence, 'application start was not sent');
        process.exitCode = 1;
        return;
      }
      log.info('Starting the daemon...');
      await daemonStart();
      if (!(await requireDaemon(client, 'daemon startup could not be confirmed'))) {
        process.exitCode = 1;
        return;
      }
    }

    if (!appName || appName === 'all') {
      progress.start('Starting all apps...');
      const apps = await client.startAll();
      const incomplete = apps.filter(app => app.status !== 'online');
      if (incomplete.length) throw new Error(incomplete.map(app => `${app.name} is ${app.status}`).join('; '));
      progress.stop(`Started ${apps.length} apps`);
      for (const app of apps) log.success(`  ${app.name} — ${app.status} (PID: ${app.pid})`);
    } else {
      progress.start(`Starting ${appName}...`);
      const app = await client.startApp({ name: appName });
      if (app.status !== 'online') throw new Error(`${app.name} is ${app.status}`);
      progress.stop(`${app.name} — ${app.status} (PID: ${app.pid})`);
    }
  } catch (error) {
    progress.clear();
    emitError(`Start not confirmed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}
