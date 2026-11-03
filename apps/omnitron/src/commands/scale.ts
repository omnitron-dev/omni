/** omnitron scale <app> <count> --process <declared-pool> */
import { spinner } from './spinner.js';
import { emitError, emitJson } from './output.js';
import { createDaemonClient } from '../daemon/daemon-client.js';
import { requireDaemon } from './daemon-required.js';
import { LONG_REQUEST_TIMEOUT } from '../shared/dto/services.js';
import { parsePoolScaleRequest } from '../shared/pool-scale.js';

export async function scaleCommand(appName: string, count: string, processName?: string): Promise<void> {
  let request;
  try {
    if (!/^[1-9]\d*$/.test(count)) throw new Error('Instance count must be a positive safe integer');
    request = parsePoolScaleRequest({ name: appName, process: processName, instances: Number(count) });
  } catch (error) { emitError((error as Error).message, { outcome: 'refused' }); process.exitCode = 1; return; }
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  const progress = spinner();
  let dispatched = false;
  try {
    if (!(await requireDaemon(client))) { process.exitCode = 1; return; }
    progress.start(`Resizing ${request.name}/${request.process} to ${request.instances} workers...`);
    dispatched = true;
    const app = await client.scale(request);
    const observed = app.processes?.find(item => item.name === request.process);
    if (!observed || observed.declaredInstances < 2) throw new Error('The requested pool is absent from the owner observation');
    if (emitJson({ request, observation: { app: app.name, process: observed }, lifetime: 'until-restart',
      declarationChanged: false, automaticPolicy: 'unchanged' })) { progress.stop(); return; }
    progress.stop(`${app.name}/${request.process}: ${observed.instances} observed workers (requested ${request.instances}). Runtime resize only; restart restores the declaration and automatic scaling remains active where configured.`);
  } catch (error) {
    progress.stop();
    emitError(dispatched ? `Resize not confirmed: ${(error as Error).message}. Inspect the selected pool before retrying.` : (error as Error).message,
      { request, outcome: dispatched ? 'unknown' : 'refused' });
    process.exitCode = 1;
  } finally { await client.disconnect(); }
}
