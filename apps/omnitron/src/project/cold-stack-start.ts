import path from 'node:path';
import { createHash } from 'node:crypto';
import { compareProcessLifetimes, readProcessLifetime } from '@omnitron-dev/common/process-identity';
import { readPrivateRecord, ExecutionJournal } from '../daemon/execution-journal.js';
import { readManagedRuntime, verifyManagedIsolation } from '../daemon/managed-runtime.js';
import { RuntimeInstallation } from '../daemon/runtime-installation.js';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import { stackExecutionKey, type StackExecutionScope } from '../shared/dto/stack-execution.js';
import type { RuntimeUpdateOwner, RuntimeUpdatePlan, RuntimeUpdateReceipt, ReviewedRuntimeUpdateStack } from '../shared/dto/runtime-update.js';

const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
type Direction = 'target' | 'previous';
export interface ColdBatch {
  digest: string; phase: string; direction: Direction;
  artifact: string; ownerArtifact: string; before: RuntimeUpdatePlan['before']; retiringOwner: RuntimeUpdateOwner; target: string;
  database: string | null; stacks: ReviewedRuntimeUpdateStack[]; excluded: RuntimeUpdatePlan['excluded'];
}
export interface ColdStartPermit extends RuntimeUpdateOwner {
  digest: string; direction: Direction; scope: StackExecutionScope; review: string;
}
const terminal = new Set(['accepted', 'rolled-back']);
const targetPhases = new Set(['starting', 'verifying']);
const previousPhases = new Set(['restoring']);

export async function readColdBatch(instance: string): Promise<ColdBatch | null> {
  const receipt = await readPrivateRecord<RuntimeUpdateReceipt>(path.join(instance, 'runtime/local-updates/current.json'));
  if (!receipt) return null;
  const plan = receipt.plan;
  if (receipt.protocol !== 1 || !sha(receipt.digest) || createHash('sha256').update(JSON.stringify(plan) ?? '').digest('hex') !== receipt.digest ||
      plan?.protocol !== 1 || plan.instance !== instance) throw Error('Unverified local update receipt');
  if (plan.stackAdmissionProtocol === undefined || terminal.has(receipt.phase)) return null;
  if (plan.stackAdmissionProtocol !== 1 || !sha(plan.target?.artifact) || !sha(plan.before?.backend) || !sha(plan.before.owner) ||
      !Number.isSafeInteger(plan.before.revision) || plan.before.revision < 1 || !plan.before.ownerId ||
      !Number.isSafeInteger(plan.before.ownerPid) || plan.before.ownerPid < 1 || typeof plan.before.ownerLifetime !== 'string' ||
      compareProcessLifetimes(plan.before.ownerLifetime, plan.before.ownerLifetime) !== 'same' ||
      !plan.infrastructure || plan.infrastructure.database !== null && !sha(plan.infrastructure.database) ||
      !Array.isArray(plan.stacks) || !Array.isArray(plan.excluded)) throw Error('Invalid local stack admission authority');
  const scopes = new Set<string>();
  for (const stack of plan.stacks) {
    const key = stackExecutionKey(stack.runtimeScope);
    if (scopes.has(key) || !sha(stack.startReview) || stack.enabled !== true || !path.isAbsolute(stack.path)) throw Error('Ambiguous or disabled local stack admission');
    scopes.add(key);
  }
  const direction = previousPhases.has(receipt.phase) ? 'previous' : 'target';
  const retiringOwner = direction === 'previous' && receipt.rollbackOwner ? receipt.rollbackOwner : plan.before;
  if (!retiringOwner.ownerId || !Number.isSafeInteger(retiringOwner.ownerPid) || retiringOwner.ownerPid < 1 ||
      typeof retiringOwner.ownerLifetime !== 'string' || compareProcessLifetimes(retiringOwner.ownerLifetime, retiringOwner.ownerLifetime) !== 'same')
    throw Error('Cannot identify the retiring execution owner');
  return { digest: receipt.digest, phase: receipt.phase, direction, retiringOwner, artifact: direction === 'target' ? plan.target.artifact : plan.before.backend,
    ownerArtifact: direction === 'target' ? plan.target.artifact : plan.before.owner, before: plan.before, target: plan.target.artifact,
    database: plan.infrastructure.database, stacks: plan.stacks, excluded: plan.excluded };
}

/** The running backend and OS-supervised owner must both belong to the reviewed direction. */
async function observeOwner(instance: string, batch: ColdBatch): Promise<RuntimeUpdateOwner> {
  const config = await readManagedRuntime(instance);
  if (!config || config.owner.artifact !== batch.ownerArtifact ||
      process.execPath !== path.join(instance, 'runtime/releases', batch.artifact, 'node')) throw Error('Serving runtime differs from the reviewed local stack admission');
  const installation = await RuntimeInstallation.openReadOnly(instance);
  if (!installation) throw Error('Cannot establish local runtime selection');
  try {
    const selected = installation.startupSelection();
    if (selected.current !== batch.artifact || selected.revision < batch.before.revision ||
        selected.revision === batch.before.revision && selected.current !== batch.before.backend) throw Error('The native selector differs from the reviewed startup');
  } finally { await installation.close(); }
  const journal = await new ExecutionJournal(path.join(config.directory, 'controller.json')).read();
  if (!journal || journal.owner.id === batch.before.ownerId || journal.owner.id === batch.retiringOwner.ownerId)
    throw Error('The old owner cannot consume a cold stack review');
  await verifyManagedIsolation(config, journal.owner.pid, process.ppid, process.pid);
  const life = readProcessLifetime(journal.owner.pid);
  if (life.state !== 'alive' || [batch.before, batch.retiringOwner].some(retired => journal.owner.pid === retired.ownerPid &&
    compareProcessLifetimes(retired.ownerLifetime, life.identity) !== 'different'))
    throw Error('Cannot prove a replacement execution owner lifetime');
  return { ownerId: journal.owner.id, ownerPid: journal.owner.pid, ownerLifetime: life.identity };
}

/** A remote boot may only reattach its declared remote stack. Local admissions never widen a stored policy. */
export async function reviewedColdStart(instance: string, batch: ColdBatch, scope: StackExecutionScope,
  registration: { path: string; enabledStacks?: readonly string[] } | null, kind: 'local' | 'remote' | 'cluster' | undefined, automatic: boolean,
  logical: StackExecutionScope, observe = observeOwner): Promise<ColdStartPermit | null> {
  if (!automatic || !targetPhases.has(batch.phase) && !previousPhases.has(batch.phase)) throw Error('Stack operation is held by local update ' + batch.digest);
  if (!registration?.enabledStacks?.includes(scope.stack)) throw Error('Disabled stack is excluded from the local update');
  if (kind === 'remote' || kind === 'cluster') {
    if (batch.excluded.some(entry => entry.reason === 'remote' && stackExecutionKey(entry) === stackExecutionKey(logical))) return null;
    throw Error('Remote stack was not recorded for attachment');
  }
  const target = batch.stacks.find(entry => stackExecutionKey(entry.runtimeScope) === stackExecutionKey(scope));
  if (kind !== 'local' || !target || target.path !== registration.path || stackExecutionKey(target) !== stackExecutionKey(logical)) throw Error('Stack registration differs from the reviewed local update');
  return { digest: batch.digest, direction: batch.direction, scope, review: target.startReview, ...await observe(instance, batch) };
}

/** Durable exactly-once attempt, even across a backend crash. Recovery uses the opposite direction. */
export function claimColdStart(store: DaemonStateStore, permit: ColdStartPermit): void {
  const key = 'lifecycle:cold-start:' + stackExecutionKey(permit.scope);
  store.kvUpdateSync<{ digest: string; target?: RuntimeUpdateOwner; previous?: RuntimeUpdateOwner }>(key, prior => {
    if (prior && (!sha(prior.digest) || !prior.target && !prior.previous)) throw Error('Invalid previous cold stack claim');
    if (prior?.digest === permit.digest && prior[permit.direction]) throw Error('The reviewed stack start was already attempted for this direction');
    if (prior?.digest === permit.digest && prior.previous && permit.direction === 'target') throw Error('The local update is already restoring the previous runtime');
    const claim = { ownerId: permit.ownerId, ownerPid: permit.ownerPid, ownerLifetime: permit.ownerLifetime };
    return { ...(prior?.digest === permit.digest ? prior : {}), digest: permit.digest, [permit.direction]: claim };
  });
}
