/** Recover one interrupted host operation without requiring its daemon to answer. */
import { createDaemonClient, LONG_REQUEST_TIMEOUT } from '../daemon/daemon-client.js';
import type { IOmnitronNodesService } from '../shared/dto/services.js';
import { requireDaemon } from './daemon-required.js';
import { emitError, emitJson, emitSuccess } from './output.js';

export async function fleetRecoverCommand(node: string, receiptId: string): Promise<void> {
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  try {
    if (!(await requireDaemon(client, 'cannot recover a host upgrade'))) { process.exitCode = 1; return; }
    const service = await client.service<IOmnitronNodesService>('OmnitronNodes');
    const matches = (await service.listNodes()).filter(n => n.id === node || n.name === node);
    if (matches.length !== 1 || matches[0]!.isLocal) throw new Error('Name one unambiguous registered remote node by ID or name');
    const recovered = await service.recoverBundleOnNode({ nodeId: matches[0]!.id, receiptId });
    if (!recovered) throw new Error(`Recovery incomplete; inspect /opt/omnitron/upgrade-receipts/${receiptId}.json on ${node}`);
    if (!emitJson({ nodeId: matches[0]!.id, receiptId, recovered })) emitSuccess(`Restored the previous host and app bindings on ${node}; receipt ${receiptId}`);
  } catch (error) {
    emitError((error as Error).message); process.exitCode = 1;
  } finally { await client.disconnect(); }
}
