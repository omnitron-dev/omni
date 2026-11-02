import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createDaemonClient, LONG_REQUEST_TIMEOUT } from '../daemon/daemon-client.js';
import type { IOmnitronNodesService, KernelCatalogEntry, KernelRollout } from '../shared/dto/services.js';
import { requireDaemon } from './daemon-required.js';
import { emitError, emitInfo, emitJson } from './output.js';

type Request =
  | { kind: 'plan'; commit: string; nodes: string[]; apply: boolean; wait?: boolean; stage?: boolean; requestId?: string }
  | { kind: 'apply'; id: string; wait?: boolean }
  | { kind: 'reconcile'; id: string }
  | { kind: 'status'; id: string | undefined; wait: boolean };

function builds(entries: KernelCatalogEntry[]) {
  if (emitJson(entries)) return;
  if (!entries.length) emitInfo('The controller catalog is empty. Import qualified builds with omnitron fleet rollout import <runtime>.');
  for (const entry of entries) emitInfo(`${entry.commit}  ${entry.platform}/${entry.arch}  ${entry.nodeVersion}  ${entry.artifact}`);
}

export async function importFleetBuilds(directories: string[]): Promise<void> {
  const imported: KernelCatalogEntry[] = [];
  try {
    const { importKernelBuild } = await import('../services/kernel-catalog.js');
    for (const directory of directories) imported.push(await importKernelBuild(path.resolve(directory)));
    builds(imported);
  } catch (error) { emitError((error as Error).message, { imported }); process.exitCode = 1; }
}

export async function listFleetBuilds(): Promise<void> {
  const client = createDaemonClient();
  try {
    if (!(await requireDaemon(client, 'cannot inspect the controller catalog'))) { process.exitCode = 1; return; }
    const nodes = await client.service<IOmnitronNodesService>('OmnitronNodes');
    builds(await nodes.listKernelBuilds());
  } catch (error) { emitError((error as Error).message); process.exitCode = 1; }
  finally { await client.disconnect(); }
}

function show(plan: KernelRollout): void {
  emitInfo(`Rollout ${plan.id} · ${plan.state} · ${plan.commit}`);
  for (const node of plan.targets) {
    const from = node.previous?.slice(0, 12) ?? '?';
    const to = node.candidate?.slice(0, 12) ?? '?';
    emitInfo(`  ${node.name}  ${node.state}  ${from} → ${to}${node.reason ? ' · ' + node.reason : ''}`);
  }
  if (plan.reason) emitInfo(plan.reason);
}

async function follow(nodes: IOmnitronNodesService, plan: KernelRollout, phase: 'planning' | 'running') {
  const id = plan.id;
  let lastUpdate: string | undefined;
  while (plan.state === phase) {
    if (plan.updatedAt !== lastUpdate) show(plan);
    lastUpdate = plan.updatedAt;
    await delay(2000);
    const next = await nodes.getKernelRollout({ id });
    if (!next || next.id !== id) throw new Error(`Controller could not confirm rollout ${id}`);
    plan = next;
  }
  return plan;
}

export async function fleetRolloutCommand(request: Request): Promise<void> {
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  let operationId = request.kind === 'plan' ? undefined : request.id;
  try {
    if (!(await requireDaemon(client, 'cannot inspect the fleet rollout'))) { process.exitCode = 1; return; }
    const nodes = await client.service<IOmnitronNodesService>('OmnitronNodes');
    let plan: KernelRollout | null;
    if (request.kind === 'plan') {
      const nodeIds: string[] = [];
      if (request.nodes.length) {
        const inventory = await nodes.listNodes();
        for (const name of request.nodes) {
          const matches = inventory.filter(node => node.id === name || node.name === name);
          if (matches.length !== 1) throw new Error(`Expected exactly one registered node for ${name}`);
          nodeIds.push(matches[0]!.id);
        }
      }
      operationId = request.requestId ?? randomUUID();
      plan = await nodes.planKernelRollout({ requestId: operationId, commit: request.commit,
        ...(nodeIds.length > 0 && { nodeIds }), ...(request.stage && { stage: true }) });
      if (plan.id !== operationId) throw new Error(`Controller did not confirm the requested rollout ${operationId}`);
      if (request.apply || request.wait) plan = await follow(nodes, plan, 'planning');
      if (request.apply && plan.state === 'planned') plan = await nodes.startKernelRollout({ id: plan.id });
    } else if (request.kind === 'apply') {
      plan = await nodes.startKernelRollout({ id: request.id });
    } else if (request.kind === 'reconcile') {
      plan = await nodes.reconcileKernelRollout({ id: request.id });
    } else {
      plan = await nodes.getKernelRollout(request.id ? { id: request.id } : {});
    }
    operationId = plan?.id ?? operationId;
    if (request.kind !== 'reconcile' && request.wait && plan) {
      plan = await follow(nodes, plan, 'planning');
      plan = await follow(nodes, plan, 'running');
    }
    if (!plan) {
      if (operationId) throw new Error(`Rollout ${operationId} was not found`);
      if (!emitJson(null)) emitInfo('No kernel rollout has been planned.');
      return;
    }
    if (!emitJson(plan)) {
      show(plan);
      if (plan.state === 'planned') emitInfo(`Start with omnitron fleet rollout apply ${plan.id}`);
      if (plan.state === 'running' || plan.state === 'planning') emitInfo(`Follow with omnitron fleet rollout status ${plan.id} --wait`);
      if (plan.state === 'uncertain') emitInfo(`Check the nodes again with omnitron fleet rollout reconcile ${plan.id}`);
    }
    if (['blocked', 'failed', 'uncertain'].includes(plan.state)) process.exitCode = 1;
  } catch (error) {
    const message = (error as Error).message;
    if (operationId) {
      emitError(message + `. Check with omnitron fleet rollout status ${operationId}`, { rolloutId: operationId });
    } else emitError(message);
    process.exitCode = 1;
  } finally { await client.disconnect(); }
}
