import { randomUUID } from 'node:crypto';
import { createDaemonClient, LONG_REQUEST_TIMEOUT } from '../daemon/daemon-client.js';
import type { IDaemonService, SourceWatchObservation, SourceWatchReceipt } from '../shared/dto/services.js';
import { emitError, emitInfo, emitJson } from './output.js';

type WatchControl = Pick<IDaemonService, 'inspectSourceWatch' | 'suspendSourceWatch' | 'resumeSourceWatch'>;

export async function changeSourceWatch(service: WatchControl, action: 'suspend' | 'resume', name: string, id?: string): Promise<SourceWatchReceipt> {
  if (action === 'resume') {
    if (!id) throw new Error('Resume requires the suspension receipt ID');
    return service.resumeSourceWatch({ name, id });
  }
  const { registration, receipt, sameBinding } = await service.inspectSourceWatch({ name });
  const held = receipt && sameBinding && receipt.phase === 'suspended' ? receipt : null;
  const source = held?.source ?? registration;
  if (!source) throw new Error('This exact application has no active source watch. Inspect its watch status.');
  return service.suspendSourceWatch({ name, generation: source.generation, definitionRevision: source.definitionRevision,
    id: held?.id ?? randomUUID(), previousReceipt: receipt?.id ?? null });
}

export async function watchCommand(action: 'status' | 'suspend' | 'resume', name: string, id?: string): Promise<void> {
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  try {
    if (action === 'status') {
      const status: SourceWatchObservation = await client.inspectSourceWatch({ name });
      if (!emitJson(status)) {
        emitInfo(`${name} · ${status.online ? 'online' : 'not online'} · ${status.registration ? 'watch registered' : 'watch inactive'}`);
        if (status.receipt) emitInfo(`${status.receipt.id} · ${status.receipt.phase} · ${status.sameBinding ? 'same binding' : 'previous binding'}`);
      }
      return;
    }
    const result = await changeSourceWatch(client, action, name, id);
    if (result.phase !== (action === 'suspend' ? 'suspended' : 'resumed'))
      throw new Error(`Watch receipt ${result.id} is ${result.phase}`);
    if (!emitJson(result)) emitInfo(`${name} · ${result.mechanism} watch ${result.phase} · receipt ${result.id}`);
  } catch (error) {
    emitError(error, { inspect: `omnitron watch status ${name}` });
    process.exitCode = 1;
  } finally { await client.disconnect(); }
}
