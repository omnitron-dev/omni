import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChildProcess } from 'node:child_process';
import type { ControllerGrant, ExecutionOwnerIdentity, HandoffTicket } from '@omnitron-dev/titan-pm';
import { readProcessLifetime } from '@omnitron-dev/common/process-identity';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { DomainError } from '@omnitron-dev/titan/errors';
import { ProjectRegistry } from '../project/registry.js';
import { projectExecutionIdentity, isExecutionIdentityEvidence, type ExecutionIdentityEvidence } from '../shared/execution-identity.js';
import { describeError } from '../shared/describe-error.js';
import type { InfrastructureHandoffState } from '../infrastructure/infrastructure.service.js';
import { RuntimeInstallation, type RuntimeActivation, type RuntimeSelection } from './runtime-installation.js';
import { BackendRecoveryJournal, type BackendRecoveryRecord } from './backend-recovery-journal.js';
import { readBackendBootRecord, checkpointInstanceHome, type BackendBootRecord } from './backend-handoff-types.js';
import { ExecutionClient } from './execution-client.js';
import { ExecutionJournal, writePrivateRecord } from './execution-journal.js';
import type { ExecutionSnapshot } from './execution-host.js';
import { executionDirectory } from './execution-launcher.js';
import { attestManagedOwnerRuntime } from './managed-owner-build.js';
import { readManagedRuntime, managedJobPid, verifyManagedIsolation, type ManagedRuntime } from './managed-runtime.js';
import { PidManager } from './pid-manager.js';
import { privateControlClient } from './private-control-client.js';
import type { BackendControlService } from './backend-control.js';
import { spawnReplacement, stopFailedCandidate, completeRetiredBackend, type BackendReplacementResult } from './backend-upgrade.js';

/** Private reviewed intent. It acknowledges current state, not an invented
 * history of the execution delta since the original controller checkpoint. */
export interface ReviewedBackendRecoveryFence {
  protocol: 1;
  instanceHome: string;
  activation: RuntimeActivation;
  selection: RuntimeSelection;
  originalCheckpointSha256: string;
  certifiedRecoveryRecordSha256: string;
  registryDigest: string;
  owner: ExecutionOwnerIdentity;
  controller: ControllerGrant;
  pending: HandoffTicket | null;
  inventoryDigest: string;
  identity: ExecutionIdentityEvidence;
  ownerLifetime: string;
  ownerArtifact: string;
  managedOwnerSha256: string;
  retiredBackendLifetime: string | null;
  historicalExecutionDelta: 'unknown';
}

const HASH = /^[a-f0-9]{64}$/;
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const grant = (value: ControllerGrant | undefined): boolean => !!value && text(value.ownerId) && text(value.controllerId) && positive(value.epoch);

export function assertReviewedBackendRecoveryFence(value: unknown): asserts value is ReviewedBackendRecoveryFence {
  const v = value as ReviewedBackendRecoveryFence | undefined;
  const a = v?.activation, s = v?.selection, o = v?.owner, p = v?.pending;
  if (!v || v.protocol !== 1 || typeof v.instanceHome !== 'string' || !path.isAbsolute(v.instanceHome) ||
      !a || a.reviewedRecovery !== undefined || !HASH.test(a.candidate) || !HASH.test(a.previous) ||
      typeof a.checkpoint !== 'string' || !path.isAbsolute(a.checkpoint) || !Number.isFinite(Date.parse(a.startedAt)) ||
      !s || s.protocol !== 1 || !positive(s.revision) || !HASH.test(s.current) ||
      (s.previous !== null && !HASH.test(s.previous)) || (s.bootstrap !== null && !HASH.test(s.bootstrap)) || !Number.isFinite(Date.parse(s.selectedAt)) ||
      ![v.originalCheckpointSha256, v.certifiedRecoveryRecordSha256, v.registryDigest, v.inventoryDigest, v.ownerArtifact, v.managedOwnerSha256].every(x => typeof x === 'string' && HASH.test(x)) ||
      !o || !text(o.id) || !positive(o.pid) || !Number.isFinite(Date.parse(o.startedAt)) || !grant(v.controller) || v.controller.ownerId !== o.id ||
      (p !== null && (!p || !text(p.id) || p.ownerId !== o.id || !grant(p.from) || !grant(p.to) ||
        p.from.ownerId !== o.id || p.to.ownerId !== o.id || p.to.epoch !== p.from.epoch + 1 || !same(p.to, v.controller))) ||
      !text(v.ownerLifetime) || (v.retiredBackendLifetime !== null && !text(v.retiredBackendLifetime)) ||
      !isExecutionIdentityEvidence(v.identity) || v.identity.owner.id !== o.id || v.identity.owner.pid !== o.pid ||
      v.historicalExecutionDelta !== 'unknown') throw Error('Invalid reviewed backend recovery fence');
}

function activationIdentity(value: RuntimeActivation): RuntimeActivation {
  const { reviewedRecovery: _hold, ...original } = value;
  return original;
}

/** Preparation adds native container observations to a previously certified
 * state. Only that typed observation field may differ; desired ownership,
 * service definitions and failure history must still match exactly. */
function withoutNativeObservations(state: BackendRecoveryRecord['state']): BackendRecoveryRecord['state'] {
  const copy = structuredClone(state);
  const remove = (infra: InfrastructureHandoffState | null) => { if (infra?.nativeState) delete infra.nativeState.observations; };
  remove(copy.infrastructure);
  for (const stack of copy.projects.infrastructure) remove(stack.infrastructure);
  return copy;
}

async function checkpoint(file: string): Promise<{ record: BackendBootRecord; sha256: string }> {
  if ((await fs.lstat(file)).size > 16 * 1024 * 1024) throw Error('Backend checkpoint exceeds its size limit');
  const record = await readBackendBootRecord(file);
  const bytes = await fs.readFile(file);
  if (!same(JSON.parse(bytes.toString('utf8')), record)) throw Error('Backend checkpoint changed while reading');
  return { record, sha256: createHash('sha256').update(bytes).digest('hex') };
}

async function originalActivation(file: string, home: string) {
  const original = await checkpoint(file);
  const record = original.record;
  const directory = executionDirectory(record.daemonConfig);
  if (checkpointInstanceHome(record) !== home || path.dirname(file) !== directory) throw Error('Recovery checkpoint belongs to a different instance');
  const installation = await RuntimeInstallation.openReadOnly(home);
  if (!installation) throw Error('Reviewed recovery requires an existing runtime installation');
  let activation: RuntimeActivation | null, selection: RuntimeSelection | null;
  try { activation = installation.activation(); selection = installation.selection(); }
  finally { await installation.close(); }
  if (!activation || activation.checkpoint !== file || !selection || selection.current !== activation.previous)
    throw Error('Original activation and selected previous runtime do not match');
  return { ...original, activation, selection, directory };
}

async function lineage(file: string, home: string) {
  const facts = await originalActivation(file, home);
  const { record, activation, directory } = facts;
  const journal = new BackendRecoveryJournal(directory, { readOnly: true });
  let certified: BackendRecoveryRecord | undefined;
  try { const state = journal.read(); certified = state?.status === 'ready' ? state.record : state?.previous; }
  finally { await journal.close(); }
  if (!certified || certified.protocol !== 1 || certified.state?.protocol !== 1 || !HASH.test(certified.registryDigest) ||
      certified.runtimeHash !== activation.previous || !same(certified.controller, record.state.ticket.from) ||
      certified.previousEntry !== record.previousEntry || certified.previousPid !== record.previousPid ||
      certified.state.executionInventory !== record.state.executionInventory ||
      !same(certified.daemonConfig, record.daemonConfig) || !same(certified.environment, record.environment) || certified.cwd !== record.cwd) {
    throw Error('Original checkpoint has no matching certified controller and registry lineage');
  }
  const { ticket: _ticket, ...state } = record.state;
  if (!same(withoutNativeObservations(certified.state), withoutNativeObservations(state)))
    throw Error('Certified project/configuration ownership differs from the prepared checkpoint');
  const registryDigest = ProjectRegistry.readRecoveryDigest(path.join(home, 'data/daemon-state.db'));
  if (registryDigest !== certified.registryDigest) throw Error('Project registry changed since the certified checkpoint');
  return { ...facts, certifiedRecoveryRecordSha256: digest(certified), registryDigest };
}

function managedOwnerDigest(config: ManagedRuntime): string {
  const { backend: _backend, ...owner } = config;
  return digest(owner);
}

function assertObserved(snapshot: ExecutionSnapshot, expected: Pick<ReviewedBackendRecoveryFence, 'owner' | 'controller' | 'pending' | 'inventoryDigest'>,
  phase: 'active' | 'prepared' = 'active'): void {
  if (!same(snapshot.status.owner, expected.owner) || !same(snapshot.status.controller, expected.controller) ||
      !same(snapshot.status.pending, expected.pending) || snapshot.status.phase !== phase || snapshot.status.inFlight !== 0 ||
      snapshot.inventoryDigest !== expected.inventoryDigest) throw Error('Reviewed owner, grant or strict execution inventory changed');
}

async function observeOwner(home: string, directory: string, phase: 'active' | 'prepared' = 'active') {
  const config = await readManagedRuntime(home);
  if (!config || config.directory !== directory) throw Error('Reviewed recovery requires the existing managed instance');
  const client = new ExecutionClient(path.join(directory, 'owner.sock'), createNullLogger());
  try {
    const snapshot = await client.connect();
    if (snapshot.status.phase !== phase || snapshot.status.inFlight !== 0) throw Error(`Execution owner is not settled in the expected ${phase} phase`);
    const journal = await new ExecutionJournal(path.join(directory, 'controller.json')).read();
    if (!journal || !same(journal.owner, snapshot.status.owner) || !same(journal.grant, snapshot.status.controller))
      throw Error('Execution journal disagrees with the current owner grant');
    const guardianPid = await managedJobPid(config, 'backend');
    const ownerPid = new PidManager(path.join(directory, 'owner.pid')).getPid();
    if (ownerPid !== snapshot.status.owner.pid) throw Error('Owner marker differs from the current owner');
    await verifyManagedIsolation(config, ownerPid, guardianPid);
    const native = await attestManagedOwnerRuntime(home, snapshot.status.owner);
    assertObserved(await client.recoverySnapshot(), { owner: snapshot.status.owner, controller: snapshot.status.controller,
      pending: snapshot.status.pending, inventoryDigest: snapshot.inventoryDigest }, phase);
    return { snapshot, config, native };
  } finally { await client.close(); }
}

async function retiredBackend(record: BackendBootRecord, expected?: string | null, afterGuardianStop = false): Promise<string | null> {
  const observed = readProcessLifetime(record.previousPid);
  if (observed.state === 'dead') return null;
  if (observed.state !== 'alive' || afterGuardianStop || expected === null || expected !== undefined && observed.identity !== expected)
    throw Error('Original backend lifetime changed or its absence is unconfirmed');
  const control = await privateControlClient<BackendControlService>(path.join(executionDirectory(record.daemonConfig), `c-${record.state.ticket.from.controllerId}.sock`), 'OmnitronBackendControl');
  try {
    const status = await control.service.status();
    if (!status.retired || status.pid !== record.previousPid || status.ticketId !== record.state.ticket.id || status.entry !== record.previousEntry)
      throw Error('Original backend has not retired on the original checkpoint');
  } finally { await control.close(); }
  const after = readProcessLifetime(record.previousPid);
  if (after.state !== 'alive' || after.identity !== observed.identity) throw Error('Retired backend changed during observation');
  return observed.identity;
}

/** Read-only preparation for the existing guardian-transition plan. */
export async function prepareReviewedBackendRecovery(file: string, instanceHome: string): Promise<ReviewedBackendRecoveryFence> {
  const facts = await lineage(file, instanceHome);
  if (facts.activation.reviewedRecovery) throw Error('A reviewed recovery already holds this activation');
  if (new PidManager(facts.record.daemonConfig.pidFile).isRunning()) throw Error('A backend still owns the daemon marker');
  const observed = await observeOwner(instanceHome, facts.directory);
  if (observed.snapshot.status.owner.id !== facts.record.state.ticket.ownerId ||
      !same(observed.snapshot.status.controller, facts.record.state.ticket.to) || !same(observed.snapshot.status.pending, facts.record.state.ticket))
    throw Error('Only the original activation candidate grant can be reconciled by this checkpoint');
  const identity = projectExecutionIdentity(observed.snapshot);
  if (!identity) throw Error('Current execution identity evidence is unavailable');
  const fence: ReviewedBackendRecoveryFence = { protocol: 1, instanceHome,
    activation: activationIdentity(facts.activation), selection: facts.selection, originalCheckpointSha256: facts.sha256,
    certifiedRecoveryRecordSha256: facts.certifiedRecoveryRecordSha256, registryDigest: facts.registryDigest,
    owner: observed.snapshot.status.owner, controller: observed.snapshot.status.controller, pending: observed.snapshot.status.pending,
    inventoryDigest: observed.snapshot.inventoryDigest, identity, ownerLifetime: observed.native.lifetime,
    ownerArtifact: observed.config.owner.artifact, managedOwnerSha256: managedOwnerDigest(observed.config),
    retiredBackendLifetime: await retiredBackend(facts.record), historicalExecutionDelta: 'unknown' };
  assertReviewedBackendRecoveryFence(fence);
  await checkReviewedBackendRecovery(fence);
  return fence;
}

async function checkStatic(fence: ReviewedBackendRecoveryFence, certificate = true) {
  const facts = await originalActivation(fence.activation.checkpoint, fence.instanceHome);
  if (!same(activationIdentity(facts.activation), fence.activation) || !same(facts.selection, fence.selection) ||
      facts.sha256 !== fence.originalCheckpointSha256 || ProjectRegistry.readRecoveryDigest(path.join(fence.instanceHome, 'data/daemon-state.db')) !== fence.registryDigest ||
      facts.record.state.ticket.ownerId !== fence.owner.id || !same(facts.record.state.ticket.to, fence.controller) || !same(facts.record.state.ticket, fence.pending))
    throw Error('Reviewed checkpoint, activation, selection, original grant or registry changed');
  if (certificate && (await lineage(fence.activation.checkpoint, fence.instanceHome)).certifiedRecoveryRecordSha256 !== fence.certifiedRecoveryRecordSha256)
    throw Error('Reviewed recovery certificate changed before admission');
  return facts;
}

async function assertRestoredCertificate(directory: string, fence: ReviewedBackendRecoveryFence,
  ticket: HandoffTicket, pid: number, entry: string): Promise<void> {
  const until = Date.now() + 15_000;
  let reason = 'No recovery certificate has been published';
  while (true) {
    const journal = new BackendRecoveryJournal(directory, { readOnly: true });
    let state;
    try { state = journal.read(); } finally { await journal.close(); }
    const candidate = state?.status === 'ready' ? state.record : state?.previous;
    if (candidate) {
      const expected = candidate.previousPid === pid && candidate.previousEntry === entry &&
        candidate.runtimeHash === fence.activation.previous && same(candidate.controller, ticket.to) &&
        candidate.registryDigest === fence.registryDigest && candidate.state.executionInventory === fence.inventoryDigest;
      // Startup may retain the old certificate while its new writer is pending.
      // A different writer or contradictory new certificate is never a wait condition.
      if (!expected && !(state?.status === 'invalid' && digest(candidate) === fence.certifiedRecoveryRecordSha256))
        throw Error('Restored recovery certificate belongs to a different writer, registry, runtime or execution inventory');
      if (state?.status === 'ready' && expected) return;
    }
    if (state?.status === 'invalid') reason = state.reason.slice(0, 1024);
    if (!PidManager.isProcessAlive(pid)) throw Error('Restored backend exited before certifying recovery');
    if (Date.now() >= until) throw Error(`Restored backend recovery certificate remained unavailable for 15 seconds: ${reason}`);
    await delay(Math.min(250, until - Date.now()));
  }
}

async function checkOwner(fence: ReviewedBackendRecoveryFence, directory: string,
  expected: Pick<ReviewedBackendRecoveryFence, 'owner' | 'controller' | 'pending' | 'inventoryDigest'> = fence,
  phase: 'active' | 'prepared' = 'active'): Promise<void> {
  const observed = await observeOwner(fence.instanceHome, directory, phase);
  assertObserved(observed.snapshot, expected, phase);
  if (observed.native.lifetime !== fence.ownerLifetime || observed.config.owner.artifact !== fence.ownerArtifact ||
      managedOwnerDigest(observed.config) !== fence.managedOwnerSha256) throw Error('Reviewed native owner or instance configuration changed');
}

export async function checkReviewedBackendRecovery(fence: ReviewedBackendRecoveryFence, options: { afterGuardianStop?: boolean } = {}): Promise<void> {
  assertReviewedBackendRecoveryFence(fence);
  const facts = await checkStatic(fence);
  if (new PidManager(facts.record.daemonConfig.pidFile).isRunning()) throw Error('A backend still owns the daemon marker');
  await retiredBackend(facts.record, fence.retiredBackendLifetime, options.afterGuardianStop);
  await checkOwner(fence, facts.directory);
  await checkStatic(fence);
}

/** Only the new guardian executes this operation, under both its command guard
 * and the existing installation lease. An older recover endpoint cannot admit it. */
export async function recoverReviewedBackend(config: ManagedRuntime, input: { plan: string; sha256: string }): Promise<BackendReplacementResult> {
  const { readSupervisorTransition, supervisorTransitionIntentDigest } = await import('./supervisor-transition.js');
  const plan = await readSupervisorTransition(input.plan);
  if (!HASH.test(input.sha256) || supervisorTransitionIntentDigest(plan) !== input.sha256 || !plan.recovery || plan.phase !== 'started' ||
      !same(plan.after, config) || await managedJobPid(config, 'backend') !== process.pid)
    throw Error('Reviewed recovery requires the exact started native transition and its current guardian');
  const fence = plan.recovery;
  assertReviewedBackendRecoveryFence(fence);
  const installation = await RuntimeInstallation.open(config.instanceHome, { existing: true });
  if (!installation) throw Error('No runtime installation exists');
  try { return await installation.exclusive(async () => {
    let hold = installation.activation()?.reviewedRecovery;
    if (!hold || hold.phase !== 'held' || hold.planId !== plan.id || hold.planFile !== input.plan || hold.planSha256 !== input.sha256)
      throw Error('Reviewed recovery is not held by this exact plan, or an earlier attempt is unresolved');
    await checkReviewedBackendRecovery(fence, { afterGuardianStop: true });
    const artifact = await installation.artifact(fence.activation.previous);
    await checkReviewedBackendRecovery(fence, { afterGuardianStop: true });
    const currentPlan = await readSupervisorTransition(input.plan);
    if (currentPlan.phase !== 'started' || supervisorTransitionIntentDigest(currentPlan) !== input.sha256)
      throw Error('Reviewed transition changed before recovery admission');
    hold = installation.advanceReviewedRecovery(hold, { phase: 'applying' });
    const owner = new ExecutionClient(path.join(config.directory, 'owner.sock'), createNullLogger());
    let candidate: ChildProcess | null = null, ticket: HandoffTicket | undefined;
    let spawned = false;
    try {
      assertObserved(await owner.connect(), fence);
      const prepared = await owner.prepareReviewedReplacement(fence.controller, randomUUID());
      ticket = prepared.ticket;
      if (!same(prepared.snapshot.status.owner, fence.owner) || prepared.snapshot.inventoryDigest !== fence.inventoryDigest ||
          !same(ticket.from, fence.controller) || ticket.ownerId !== fence.owner.id || prepared.snapshot.status.phase !== 'prepared' ||
          !same(prepared.snapshot.status.pending, ticket) || !same(prepared.snapshot.status.controller, fence.controller) ||
          prepared.snapshot.status.inFlight !== 0) throw Error('Execution inventory or grant changed while preparing reviewed recovery');
      const original = (await checkStatic(fence)).record;
      const file = path.join(config.directory, `handoff-${ticket.id}.json`);
      const boot: BackendBootRecord = { ...original, createdAt: new Date().toISOString(),
        state: { ...original.state, ticket, executionInventory: fence.inventoryDigest } };
      await writePrivateRecord(file, { ...boot, reviewedRecovery: { protocol: 1, planId: plan.id, intentDigest: input.sha256,
        originalCheckpoint: fence.activation.checkpoint, originalCheckpointSha256: fence.originalCheckpointSha256,
        certifiedRecoveryRecordSha256: fence.certifiedRecoveryRecordSha256, acceptedInventoryDigest: fence.inventoryDigest,
        historicalExecutionDelta: 'unknown' } });
      hold = installation.advanceReviewedRecovery(hold, { phase: 'applying', checkpoint: file });
      const result = await spawnReplacement(artifact, file, boot, child => { candidate = child; spawned = true; }, async () => {
        await checkStatic(fence);
        await checkOwner(fence, config.directory, { ...fence, controller: ticket!.from, pending: ticket! }, 'prepared');
        const fresh = await readSupervisorTransition(input.plan);
        if (fresh.phase !== 'started' || supervisorTransitionIntentDigest(fresh) !== input.sha256)
          throw Error('Reviewed transition changed before spawning the backend');
      });
      const confirm = async () => {
        // The newly admitted controller legitimately replaces the recovery
        // certificate. Its new receipt must be proven, not compared to the old writer's bytes.
        await assertRestoredCertificate(config.directory, fence, ticket!, result.pid, artifact.entry);
        await checkStatic(fence, false);
        await checkOwner(fence, config.directory, { ...fence, controller: ticket!.to, pending: ticket! });
        const fresh = await readSupervisorTransition(input.plan);
        if (fresh.phase !== 'started' || supervisorTransitionIntentDigest(fresh) !== input.sha256)
          throw Error('Reviewed transition changed while restoring the backend');
      };
      await confirm();
      await completeRetiredBackend(original);
      await installation.select(artifact.runtimeHash, fence.selection.revision, false,
        { hold, selection: fence.selection, activation: fence.activation, beforeCommit: confirm });
      return result;
    } catch (error) {
      const failures: unknown[] = [error];
      try { await stopFailedCandidate(candidate); } catch (cleanup) { failures.push(cleanup); }
      if (ticket && !spawned) {
        try { await owner.cancelReplacement(ticket); } catch (cancel) { failures.push(cancel); }
      }
      try { installation.advanceReviewedRecovery(hold, { phase: 'unconfirmed' }); } catch (persistence) { failures.push(persistence); }
      const reasons = failures.map(failure => describeError(failure));
      throw new DomainError({ domainCode: 'REVIEWED_RECOVERY_FAILED',
        message: 'Reviewed backend recovery failed; its held activation requires explicit reconciliation. ' + reasons.join('; '),
        details: { planId: plan.id, originalCheckpoint: fence.activation.checkpoint, checkpoint: hold.checkpoint ?? null,
          outcome: 'unconfirmed', failures: reasons }, cause: new AggregateError(failures, 'Reviewed recovery and settlement failures') });
    } finally { await owner.close(); }
  }); } finally { await installation.close(); }
}
