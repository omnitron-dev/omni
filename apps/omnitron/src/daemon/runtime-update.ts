import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { withKernelFileLock } from '../shared/kernel-file-lock.js';
import { readPrivateRecord, writePrivateRecord } from './execution-journal.js';
import type {
  PreparedRuntimeUpdate, RuntimeUpdateAcceptance, RuntimeUpdateIdentity, RuntimeUpdatePhase,
  RuntimeUpdatePlan, RuntimeUpdateReceipt, RuntimeUpdateReference,
} from '../shared/dto/runtime-update.js';

const hash = /^[a-f0-9]{64}$/;
const finished = new Set<RuntimeUpdatePhase>(['accepted', 'rolled-back']);
const phases = new Set<RuntimeUpdatePhase>(['stopping', 'starting', 'verifying', 'accepted', 'failed',
  'stopping-candidate', 'restoring', 'rolled-back', 'recovery-required']);

export interface RuntimeUpdateActions {
  prepare(): Promise<RuntimeUpdatePlan>;
  validateStop(previous: RuntimeUpdateIdentity, plan?: RuntimeUpdatePlan): Promise<void>;
  stop(previous: RuntimeUpdateIdentity): Promise<unknown>;
  assertStopped(previous: RuntimeUpdateIdentity): Promise<unknown>;
  canRestore(previous: RuntimeUpdateIdentity): Promise<boolean>;
  captureForRollback(plan: RuntimeUpdatePlan): Promise<RuntimeUpdateIdentity>;
  start(destination: RuntimeUpdateReference | RuntimeUpdatePlan['before'], plan: RuntimeUpdatePlan): Promise<void>;
  accept(plan: RuntimeUpdatePlan, direction: 'target' | 'previous', inspectOnly?: boolean): Promise<RuntimeUpdateAcceptance>;
}

export function runtimeUpdatePlanDigest(plan: RuntimeUpdatePlan): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex');
}

function assertPrepared(record: PreparedRuntimeUpdate): void {
  if (record.protocol !== 1 || record.plan?.protocol !== 1 || !hash.test(record.digest) ||
      record.digest !== runtimeUpdatePlanDigest(record.plan)) throw Error('The local update record does not match its reviewed plan');
}

export async function readRuntimeUpdateReceipt(directory: string, digest?: string): Promise<RuntimeUpdateReceipt | null> {
  if (digest !== undefined && !hash.test(digest)) throw Error('Use the full SHA-256 of the local update plan');
  let receipt = await readPrivateRecord<RuntimeUpdateReceipt>(path.join(directory, 'current.json'));
  if (digest && receipt?.digest !== digest) receipt = await readPrivateRecord<RuntimeUpdateReceipt>(path.join(directory, digest + '.json'));
  if (receipt) {
    assertPrepared(receipt);
    if (!phases.has(receipt.phase) || typeof receipt.updatedAt !== 'string' || digest && receipt.digest !== digest)
      throw Error('Invalid local update receipt');
  }
  return receipt;
}

export async function readPreparedRuntimeUpdate(directory: string): Promise<PreparedRuntimeUpdate | null> {
  const prepared = await readPrivateRecord<PreparedRuntimeUpdate>(path.join(directory, 'prepared.json'));
  if (prepared) assertPrepared(prepared);
  return prepared;
}

/** Persist intent before each native operation. Interrupted updates require explicit recovery. */
export async function runRuntimeUpdate({ actions, directory, operation, digest: review, progress = () => {} }: {
  actions: RuntimeUpdateActions;
  directory: string;
  operation: 'prepare' | 'apply' | 'recover';
  digest?: string;
  progress?: (phase: RuntimeUpdatePhase) => void;
}): Promise<PreparedRuntimeUpdate | RuntimeUpdateReceipt> {
  if (review !== undefined && !hash.test(review) || operation !== 'prepare' && !review || operation === 'prepare' && review)
    throw Error('Use the full SHA-256 of the local update plan with apply or recover');
  await fs.mkdir(directory, { mode: 0o700, recursive: true });
  return withKernelFileLock(path.join(directory, 'update.lock'), async () => {
    let record = await readRuntimeUpdateReceipt(directory);
    const save = async (phase: RuntimeUpdatePhase, details: Partial<RuntimeUpdateReceipt> = {}) => {
      if (!record) throw Error('No local update intent exists');
      const next = { ...record, ...details, phase, updatedAt: new Date().toISOString() };
      await writePrivateRecord(path.join(directory, 'current.json'), next);
      record = next;
      progress(phase);
      return next;
    };
    const recover = async () => {
      if (!record) throw Error('No local update is available for recovery');
      const plan = record.plan;
      try {
        if (record.restoreAttempted || record.phase === 'restoring') {
          const acceptance = await actions.accept(plan, 'previous', true);
          return await save('rolled-back', { acceptance });
        }
        if (!(await actions.canRestore(record.rollbackOwner ?? plan.before))) {
          const live = await actions.captureForRollback(plan);
          await actions.validateStop(live);
          await save('stopping-candidate', { rollbackOwner: live });
          await actions.stop(live);
          await actions.assertStopped(live);
        }
        await save('restoring', { restoreAttempted: true });
        await actions.start(plan.before, plan);
        const acceptance = await actions.accept(plan, 'previous');
        return await save('rolled-back', { acceptance });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await save('recovery-required', { recoveryError: message });
        throw Error('Local recovery requires inspection: ' + message, { cause: error });
      }
    };
    if (operation === 'recover') {
      if (!record || record.digest !== review) throw Error('The requested local update is not the current receipt');
      if (record.phase === 'rolled-back') { await actions.accept(record.plan, 'previous', true); return record; }
      return recover();
    }
    if (record && !finished.has(record.phase)) throw Error('A local update is unfinished (' + record.phase + '). Inspect its status and recover its exact plan ' + record.digest);
    if (record?.phase === 'accepted' && review === record.digest) {
      await actions.accept(record.plan, 'target', true);
      return record;
    }
    if (review && record?.phase === 'rolled-back' && review === record.digest) throw Error('This attempt was rolled back. Prepare a fresh plan');
    if (operation === 'apply') {
      const prepared = await readPreparedRuntimeUpdate(directory);
      if (prepared?.digest !== review) throw Error('The requested local update is not the prepared plan' + (prepared ? '. Current plan ' + prepared.digest : ''));
    }
    const plan = await actions.prepare();
    if (operation === 'prepare' && record?.phase === 'accepted' && record.plan.target.artifact === plan.target.artifact &&
        plan.before.backend === plan.target.artifact && plan.before.owner === plan.target.artifact && plan.before.guardian === plan.target.artifact) {
      const declarations = (snapshot: RuntimeUpdatePlan) => snapshot.stacks.map(({ project, stack, enabled, startReview, selection, savedSelection }) =>
        [project, stack, enabled, startReview, selection, savedSelection]);
      if (JSON.stringify(declarations(plan)) === JSON.stringify(declarations(record.plan)) &&
          JSON.stringify(plan.excluded) === JSON.stringify(record.plan.excluded)) {
        await actions.accept(record.plan, 'target', true);
        return record;
      }
    }
    const digest = runtimeUpdatePlanDigest(plan);
    if (operation === 'prepare') {
      const prepared: PreparedRuntimeUpdate = { protocol: 1, digest, plan };
      await writePrivateRecord(path.join(directory, 'prepared.json'), prepared);
      return prepared;
    }
    if (review !== digest) throw Error('Local placement, roles, launch selection, infrastructure or process identities changed. Inspect the current plan ' + digest);
    await actions.validateStop(plan.before, plan);
    if (record) await writePrivateRecord(path.join(directory, record.digest + '.json'), record);
    record = { protocol: 1, digest, plan, phase: 'stopping', updatedAt: new Date().toISOString() };
    await save('stopping');
    try {
      await actions.stop(plan.before);
      await actions.assertStopped(plan.before);
      await save('starting');
      await actions.start(plan.target, plan);
      await save('verifying');
      const acceptance = await actions.accept(plan, 'target');
      return await save('accepted', { acceptance });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await save('failed', { error: message });
      const result = await recover();
      throw Error('Local update failed and was ' + result.phase + ': ' + message, { cause: error });
    }
  }, 0);
}
