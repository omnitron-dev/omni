import { createDaemonClient } from '../daemon/daemon-client.js';
import { requireDaemon } from './daemon-required.js';
import { emitError, emitJson, emitStep, emitSuccess } from './output.js';
import { resolveNodeArgument } from './node.js';
import type { IOmnitronNodesService } from '../shared/dto/services.js';
import type { INodeReconciliationRequest, INodeReconciliationResult } from '../shared/dto/nodes.js';

export async function nodeReconcileCommand(name: string, options: {
  restore?: boolean; pages?: string; after?: string; through?: string; epoch?: string;
}): Promise<void> {
  const client = createDaemonClient(undefined, 60_000);
  let request: INodeReconciliationRequest | undefined;
  try {
    if (!await requireDaemon(client)) return;
    const pages = Number(options.pages ?? '1');
    if (!Number.isSafeInteger(pages) || pages < 1 || pages > 2000) throw new Error('pages must be between 1 and 2000');
    const nodes = await client.service<IOmnitronNodesService>('OmnitronNodes');
    const resolution = resolveNodeArgument(name, await nodes.listNodes());
    if (resolution.kind !== 'found') throw new Error(`Node '${name}' is ${resolution.kind === 'ambiguous' ? 'ambiguous' : 'not registered'}`);
    request = { nodeId: resolution.node.id, restore: options.restore === true,
      ...(options.after !== undefined && { after: options.after }), ...(options.through !== undefined && { through: options.through }),
      ...(options.epoch !== undefined && { epoch: options.epoch }) };
    const totals = { examined: 0, present: 0, missing: 0, reconciled: 0, alreadyReconciled: 0 };
    let last: INodeReconciliationResult | undefined;
    for (let i = 0; i < pages; i++) {
      last = await nodes.reconcileNodeMetrics(request);
      for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += last[key];
      emitStep(`${options.restore ? 'Reconciled' : 'Inspected'} ${totals.examined} metrics; ${totals.present} present, ${totals.missing} ${options.restore ? 'restored' : 'missing'}`);
      if (last.next === null) break;
      request = { ...request, after: last.next, through: last.through, epoch: last.epoch };
    }
    const result = { nodeId: request.nodeId, mode: options.restore ? 'restore' : 'inspect', ...totals,
      unresolvedSourceRows: last!.unresolvedSourceRows, continuation: last!.next === null ? null : request,
      limitation: last!.next === null && last!.unresolvedSourceRows > 0 && options.restore
        ? 'Remaining gaps have no retained metric payload or belong to another category; no proof was invented.' : null };
    if (result.limitation) process.exitCode = 1;
    if (!emitJson(result)) emitSuccess(JSON.stringify(result, null, 2));
  } catch (error) {
    emitError((error as Error).message, { continuation: request }); process.exitCode = 1;
  } finally { await client.disconnect(); }
}
