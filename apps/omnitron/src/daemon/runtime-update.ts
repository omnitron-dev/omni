import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { withKernelFileLock } from '@xec-sh/ops/utils/file-lock';
import { readPrivateRecord, writePrivateRecord } from './execution-journal.js';
import { RUNTIME_UPDATE_TERMINAL_PHASES } from '../shared/dto/runtime-update.js';
import type {
  PreparedRuntimeUpdate, RuntimeUpdateAcceptance, RuntimeUpdateApplication, RuntimeUpdateIdentity, RuntimeUpdatePhase,
  RuntimeUpdatePlan, RuntimeUpdateReceipt, RuntimeUpdateReference,
} from '../shared/dto/runtime-update.js';

const hash = /^[a-f0-9]{64}$/;
const finished = new Set<RuntimeUpdatePhase>(RUNTIME_UPDATE_TERMINAL_PHASES);
const phases = new Set<RuntimeUpdatePhase>(['draining', 'aborted', 'stopping', 'starting', 'verifying', 'accepted', 'failed',
  'stopping-candidate', 'restoring', 'rolled-back', 'recovery-required']);

const healthRank = { unknown: 0, unhealthy: 1, degraded: 2, healthy: 3, absent: 0 };

/** The reviewed baseline remains the acceptance floor throughout the transition. */
export function assertRuntimeUpdateHealth(previous: Pick<RuntimeUpdateApplication, 'handleKey' | 'health'>,
  current: Pick<RuntimeUpdateApplication, 'handleKey' | 'health'>): void {
  if (current.handleKey !== previous.handleKey || !Object.hasOwn(healthRank, previous.health) || !Object.hasOwn(healthRank, current.health))
    throw Error('Invalid application health observation for ' + previous.handleKey);
  if (healthRank[current.health] < healthRank[previous.health])
    throw Error('Application health regressed for ' + previous.handleKey + ': ' + previous.health + ' -> ' + current.health);
}

function retainReviewedHealth(observed: RuntimeUpdatePlan, reviewed: RuntimeUpdatePlan): RuntimeUpdatePlan {
  return { ...observed, stacks: observed.stacks.map(stack => {
    const prior = reviewed.stacks.find(value => value.project === stack.project && value.stack === stack.stack);
    return { ...stack, apps: stack.apps.map(app => {
      const baseline = prior?.apps.find(value => value.handleKey === app.handleKey);
      if (!baseline) return app; // Membership changes remain part of the exact plan comparison.
      assertRuntimeUpdateHealth(baseline, app);
      return { ...app, health: baseline.health };
    }) };
  }) };
}

export interface RuntimeUpdateRestoration {
  guardian(): RuntimeUpdateReceipt['restoreGuardian'];
  recordGuardian(reference: NonNullable<RuntimeUpdateReceipt['restoreGuardian']>): Promise<void>;
}

function assertGuardianReference(plan: RuntimeUpdatePlan, reference: NonNullable<RuntimeUpdateReceipt['restoreGuardian']>) {
  if (!plan.configuration || typeof reference.file !== 'string' || !path.isAbsolute(reference.file) ||
      path.dirname(reference.file) !== path.join(plan.instance, 'runtime') ||
      !/^supervisor-transition-[0-9a-f-]{36}\.json$/.test(path.basename(reference.file)) || !hash.test(reference.intentSha256))
    throw Error('Invalid runtime restoration guardian reference');
}

export interface RuntimeUpdateActions {
  prepare(reviewed?: RuntimeUpdatePlan): Promise<RuntimeUpdatePlan>;
  /** Quiesce only the reviewed backup attempts, then obtain the strict certificate. */
  admit(plan: RuntimeUpdatePlan, digest: string): Promise<void>;
  /** Release only this plan's admission; never stop or restore application processes. */
  releaseAdmission(plan: RuntimeUpdatePlan, digest: string): Promise<void>;
  validateStop(previous: RuntimeUpdateIdentity, plan?: RuntimeUpdatePlan): Promise<void>;
  stop(previous: RuntimeUpdateIdentity): Promise<unknown>;
  assertStopped(previous: RuntimeUpdateIdentity): Promise<unknown>;
  canRestore(previous: RuntimeUpdateIdentity): Promise<boolean>;
  /** Prove the original roles, processes and retained intent still serve after a refused stop. */
  isPreviousServing?(plan: RuntimeUpdatePlan): Promise<boolean>;
  captureForRollback(plan: RuntimeUpdatePlan): Promise<RuntimeUpdateIdentity>;
  start(destination: RuntimeUpdateReference | RuntimeUpdatePlan['before'], plan: RuntimeUpdatePlan, restoration?: RuntimeUpdateRestoration): Promise<void>;
  /** Finish only observed restoration stages; never starts a second owner or stack attempt. */
  completeRestore?(plan: RuntimeUpdatePlan, restoration: RuntimeUpdateRestoration): Promise<void>;
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
    if (receipt.restoreGuardian) assertGuardianReference(receipt.plan, receipt.restoreGuardian);
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
  operation: 'prepare' | 'apply' | 'recover' | 'reconcile';
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
    const restoration: RuntimeUpdateRestoration = {
      guardian: () => record?.restoreGuardian,
      async recordGuardian(reference) {
        if (!record?.restoreAttempted || !['restoring', 'recovery-required'].includes(record.phase))
          throw Error('No runtime restoration owns this guardian plan');
        assertGuardianReference(record.plan, reference);
        if (record.restoreGuardian && (record.restoreGuardian.file !== reference.file || record.restoreGuardian.intentSha256 !== reference.intentSha256))
          throw Error('Runtime restoration already owns another guardian plan');
        await save('restoring', { restoreGuardian: reference });
      },
    };
    const releaseAdmission = async (error?: string) => {
      if (!record || record.phase !== 'draining') throw Error('No runtime update admission is pending');
      try {
        await actions.releaseAdmission(record.plan, record.digest);
        delete record.recoveryError;
        return await save('aborted', { ...(error && { error }) });
      } catch (cause) {
        const recoveryError = cause instanceof Error ? cause.message : String(cause);
        await save('draining', { ...(error && { error }), recoveryError });
        throw Error('Runtime admission release is unconfirmed; inspect and recover this plan: ' + recoveryError, { cause });
      }
    };
    const recover = async () => {
      if (!record) throw Error('No local update is available for recovery');
      // Admission precedes every process effect. Losing its acknowledgement
      // requires releasing this exact quiesce, never an application restart.
      if (record.phase === 'aborted') return record;
      if (record.phase === 'draining') return releaseAdmission(record.error);
      const plan = record.plan;
      try {
        if (!record.restoreAttempted && !record.rollbackOwner &&
            ['stopping', 'failed', 'recovery-required'].includes(record.phase) && await actions.isPreviousServing?.(plan)) {
          // The stop may have refused before any effect. Reconcile its original
          // identity instead of attempting to retire a candidate that never ran.
          await save('draining');
          return await releaseAdmission(record.error);
        }
        if (record.restoreAttempted || record.phase === 'restoring') {
          if (record.phase !== 'restoring') await save('restoring');
          await actions.completeRestore?.(plan, restoration);
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
        await actions.start(plan.before, plan, restoration);
        const acceptance = await actions.accept(plan, 'previous');
        return await save('rolled-back', { acceptance });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await save('recovery-required', { recoveryError: message });
        throw Error('Local recovery requires inspection: ' + message, { cause: error });
      }
    };
    if (operation === 'reconcile') {
      if (!record || record.digest !== review) throw Error('The requested local update is not the current receipt');
      if (record.restoreAttempted || record.rollbackOwner || !['starting', 'verifying', 'failed', 'recovery-required', 'accepted'].includes(record.phase))
        throw Error('Only a candidate which has started and has not entered restoration can be reconciled');
      // Observation cannot stop, start, release admission or replay a failed
      // action. Accept only the exact serving roles, stacks and infrastructure.
      const acceptance = await actions.accept(record.plan, 'target', true);
      if (record.phase === 'accepted') return record;
      delete record.recoveryError;
      return save('accepted', { acceptance });
    }
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
    let prepared: PreparedRuntimeUpdate | null = null;
    if (operation === 'apply') {
      prepared = await readPreparedRuntimeUpdate(directory);
      if (prepared?.digest !== review) throw Error('The requested local update is not the prepared plan' + (prepared ? '. Current plan ' + prepared.digest : ''));
    }
    const observed = await actions.prepare(prepared?.plan);
    // Health is a live observation, not a new shutdown authorization. An
    // improvement must not invalidate review; a regression must never silently
    // lower the acceptance floor by publishing a replacement plan.
    const plan = prepared ? retainReviewedHealth(observed, prepared.plan) : observed;
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
      const preview: PreparedRuntimeUpdate = { protocol: 1, digest, plan };
      await writePrivateRecord(path.join(directory, 'prepared.json'), preview);
      return preview;
    }
    if (review !== digest) {
      const changed = (Object.keys(plan) as Array<keyof RuntimeUpdatePlan>)
        .filter(key => !isDeepStrictEqual(prepared?.plan[key], plan[key]));
      await writePrivateRecord(path.join(directory, 'prepared.json'), { protocol: 1, digest, plan });
      throw Error('Local update plan changed (' + changed.join(', ') + '). No processes were stopped. Inspect the current plan ' + digest);
    }
    if (record) await writePrivateRecord(path.join(directory, record.digest + '.json'), record);
    record = { protocol: 1, digest, plan, phase: 'draining', updatedAt: new Date().toISOString() };
    await save('draining');
    try {
      await actions.admit(plan, digest);
      await actions.validateStop(plan.before, plan);
    } catch (error) {
      await releaseAdmission(error instanceof Error ? error.message : String(error));
      throw error;
    }
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
