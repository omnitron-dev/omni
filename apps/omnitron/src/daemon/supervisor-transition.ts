import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { renderLaunchdPlist, renderSystemdUnit } from '../commands/service-units.js';
import { BACKEND_ACTIVITY_COUNTERS } from '../shared/dto/backend.js';
import { RuntimeInstallation } from './runtime-installation.js';
import { readManagedRuntime, managedRuntimeFile, managedSupervisorSocket, managedJobPid, managedGuardianStopFence, assertGuardianStopped, managedSystemdProperties, verifyManagedIsolation, type ManagedRuntime } from './managed-runtime.js';
import { privateControlClient, withControlDeadline } from './private-control-client.js';
import { createDaemonClient } from './daemon-client.js';
import type { BackendRpcService } from './backend.rpc-service.js';
import type { BackendControlService } from './backend-control.js';
import type { BackendSupervisorService } from './backend-supervisor.js';
import { checkBackendCandidate } from './backend-candidate.js';
import { checkpointInstanceHome, readBackendBootRecord } from './backend-handoff-types.js';
import { readPrivateRecord, writePrivateRecord } from './execution-journal.js';
import { ExecutionClient } from './execution-client.js';
import { PidManager } from './pid-manager.js';
import { checkSystemGuardian, guardianUnitProperties, replaceGuardianExec } from './system-guardian-unit.js';
import type { GuardianStopFence } from './system-guardian-cgroup.js';
import { expandPath } from '../shared/paths.js';
import { projectExecutionIdentity, compareExecutionIdentityEvidence, describeExecutionIdentityDrift, type ExecutionIdentityEvidence } from '../shared/execution-identity.js';
import { assertReviewedBackendRecoveryFence, checkReviewedBackendRecovery, prepareReviewedBackendRecovery, type ReviewedBackendRecoveryFence } from './reviewed-backend-recovery.js';

export interface SupervisorTransition {
  protocol: 1;
  id: string;
  phase: 'prepared' | 'preparing' | 'retired' | 'stopped' | 'configured' | 'started' | 'complete';
  createdAt: string;
  before: ManagedRuntime;
  after: ManagedRuntime;
  unit: { file: string; before: string; after: string };
  backend: { runtime: string; pid: number; control: string; socket: string };
  owner: { id: string; pid: number; inventory: string; identity?: ExecutionIdentityEvidence };
  guardianPid: number;
  selectionRevision?: number;
  linuxStop?: GuardianStopFence;
  checkpoint?: string;
  recovery?: ReviewedBackendRecoveryFence;
  result?: { backendPid: number; guardianPid: number; ownerPid: number };
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** All authority-bearing fields are sealed; progress and the observed result
 * can advance without changing the operator's reviewed intent. */
export function supervisorTransitionIntentDigest(plan: SupervisorTransition): string {
  const { protocol, id, createdAt, before, after, unit, backend, owner, guardianPid,
    selectionRevision, linuxStop, recovery } = plan;
  return hash({ protocol, id, createdAt, before, after, unit, backend, owner, guardianPid,
    selectionRevision, linuxStop, recovery });
}
const execute = promisify(execFile);
async function native(command: string, args: string[]): Promise<string> {
  return (await execute(command, args, { encoding: 'utf8', timeout: 40_000, maxBuffer: 1024 * 1024 })).stdout;
}
const domain = () => `gui/${process.getuid!()}`;

const systemctlScope = (config: ManagedRuntime) => config.scope === 'user' ? ['--user'] : [];
async function systemGuardianFile(config: ManagedRuntime, requireLoaded: boolean): Promise<string> {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) throw Error('System guardian replacement requires the root-owned Linux instance');
  const facts = await managedSystemdProperties(config, config.backend.unit, guardianUnitProperties);
  checkSystemGuardian(config.backend.unit, facts, requireLoaded);
  const file = facts['FragmentPath']!;
  if (await fs.realpath(file) !== file) throw Error('A system guardian requires a canonical unit file');
  return file;
}

async function assertSystemGuardianProcess(config: ManagedRuntime, pid: number): Promise<void> {
  const root = path.join(config.instanceHome, 'runtime/releases', config.backend.artifact);
  const args = (await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')).split('\0').filter(Boolean);
  if (await fs.realpath(`/proc/${pid}/exe`) !== path.join(root, 'node') ||
      args.length !== 3 || args[1] !== path.join(root, 'packages/0/dist/daemon/managed-entry.js') || args[2] !== 'backend')
    throw Error('Actual guardian process differs from the sealed system unit');
}

async function unitFile(config: ManagedRuntime): Promise<string> {
  let file: string | undefined;
  if (process.platform === 'darwin') {
    file = (await native('/bin/launchctl', ['print', `${domain()}/${config.backend.label}`])).match(/^\s*path = (.+)$/m)?.[1];
  } else if (process.platform === 'linux') {
    file = config.scope === 'system' ? await systemGuardianFile(config, true) :
      (await native('systemctl', ['--user', 'show', config.backend.unit, '--property=FragmentPath', '--value'])).trim();
  }
  if (!file || !path.isAbsolute(file)) throw new Error('The loaded guardian has no verifiable unit file');
  await assertUnitFile(file);
  return file;
}

async function assertUnitFile(file: string): Promise<void> {
  const [stat, parent] = await Promise.all([fs.lstat(file), fs.lstat(path.dirname(file))]);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 || (stat.mode & 0o022) ||
      !parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o022) ||
      (process.getuid && (stat.uid !== process.getuid() || parent.uid !== process.getuid()))) {
    throw new Error('The guardian unit and its directory must be owned by the instance user and not writable by other users');
  }
}

/** Unit directories are commonly 0755; record writers intentionally require 0700. */
async function replaceUnit(file: string, expected: string[], contents: string): Promise<void> {
  await assertUnitFile(file);
  if (!expected.includes(await fs.readFile(file, 'utf8'))) throw new Error('The guardian unit changed since preparation');
  const temporary = path.join(path.dirname(file), `.omnitron-${randomUUID()}`);
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
    const parent = await fs.open(path.dirname(file), 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  } finally { await fs.unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
}

async function inventory(config: ManagedRuntime) {
  const client = new ExecutionClient(path.join(config.directory, 'owner.sock'), createNullLogger());
  try { return await client.connect(); } finally { await client.close(); }
}

function assertSameOwner(plan: SupervisorTransition, current: Awaited<ReturnType<typeof inventory>>): void {
  if (current.status.owner.id !== plan.owner.id || current.status.owner.pid !== plan.owner.pid || current.inventoryDigest !== plan.owner.inventory) {
    const expected = plan.owner.identity?.owner?.id === plan.owner.id && plan.owner.identity.owner.pid === plan.owner.pid ? plan.owner.identity : undefined;
    const detail = describeExecutionIdentityDrift(compareExecutionIdentityEvidence(expected, projectExecutionIdentity(current)));
    const action = plan.phase === 'prepared' && !plan.checkpoint
      ? 'Review current status and prepare a new guardian transition plan.'
      : 'Reconcile this transition checkpoint before preparing another plan.';
    throw new Error('Execution owner or application inventory changed; automatic guardian transition is refused. ' + detail + '. ' + action);
  }
}

export async function readSupervisorTransition(file: string): Promise<SupervisorTransition> {
  const stat = await fs.lstat(file);
  if (stat.size > 1024 * 1024) throw new Error('Supervisor transition record exceeds its size limit');
  const plan = await readPrivateRecord<SupervisorTransition>(file);
  if (!plan || plan.protocol !== 1 || !/^[0-9a-f-]{36}$/.test(plan.id) || !Number.isFinite(Date.parse(plan.createdAt)) ||
      !['prepared', 'preparing', 'retired', 'stopped', 'configured', 'started', 'complete'].includes(plan.phase) ||
      !path.isAbsolute(plan.before?.instanceHome ?? '') || plan.after?.instanceHome !== plan.before.instanceHome ||
      !['user', 'system'].includes(plan.before.scope) || plan.after.scope !== plan.before.scope ||
      !path.isAbsolute(plan.unit?.file ?? '') || typeof plan.unit.before !== 'string' || typeof plan.unit.after !== 'string' ||
      !/^[a-f0-9]{64}$/.test(plan.backend?.runtime ?? '') || !Number.isSafeInteger(plan.backend.pid) || plan.backend.pid < 1 ||
      !path.isAbsolute(plan.backend.control ?? '') || !path.isAbsolute(plan.backend.socket ?? '') ||
      !plan.owner?.id || !Number.isSafeInteger(plan.owner.pid) || plan.owner.pid < 1 || !/^[a-f0-9]{64}$/.test(plan.owner.inventory ?? '') ||
      !Number.isSafeInteger(plan.guardianPid) || plan.guardianPid < 1 ||
      (plan.linuxStop !== undefined && (!plan.linuxStop || !path.isAbsolute(plan.linuxStop.group ?? '') ||
        [plan.linuxStop.directoryId, plan.linuxStop.guardianProcess, plan.linuxStop.backendProcess].some(value => !/^[a-f0-9]{64}$/.test(value)))) ||
      (plan.selectionRevision !== undefined && (!Number.isSafeInteger(plan.selectionRevision) || plan.selectionRevision < 1)) ||
      (plan.checkpoint !== undefined && !path.isAbsolute(plan.checkpoint)) ||
      hash({ ...plan.before, backend: plan.after.backend }) !== hash(plan.after) ||
      plan.before.backend.label !== plan.after.backend.label || plan.before.backend.unit !== plan.after.backend.unit) {
    throw new Error('Invalid supervisor transition record');
  }
  if (plan.before.scope === 'system' && (plan.unit.file !== '/etc/systemd/system/' + plan.before.backend.unit ||
      replaceGuardianExec(plan.unit.before, plan.before, plan.after) !== plan.unit.after)) throw Error('Invalid system guardian unit transition');
  if (path.resolve(file) !== path.join(plan.before.instanceHome, 'runtime', `supervisor-transition-${plan.id}.json`)) {
    throw new Error('Supervisor transition record is outside its instance');
  }
  if (plan.recovery) assertReviewedBackendRecoveryFence(plan.recovery);
  if (plan.recovery && (plan.recovery.instanceHome !== plan.before.instanceHome ||
      plan.checkpoint !== plan.recovery.activation?.checkpoint || plan.backend.runtime !== plan.recovery.activation.previous ||
      plan.selectionRevision !== plan.recovery.selection?.revision || plan.owner.id !== plan.recovery.owner?.id ||
      plan.owner.pid !== plan.recovery.owner.pid || plan.owner.inventory !== plan.recovery.inventoryDigest)) {
    throw new Error('Reviewed recovery does not match the guardian transition');
  }
  return plan;
}

/** Install a management artifact and save a reviewable plan; running services are untouched. */
export async function prepareSupervisorTransition(directory: string, socket?: string, options: {
  recoveryCheckpoint?: string;
} = {}): Promise<{ file: string; plan: ReturnType<typeof summarize> }> {
  let controlAddress: { socket: string };
  let backendPid: number;
  const recoveryCheckpoint = options.recoveryCheckpoint ? path.resolve(options.recoveryCheckpoint) : undefined;
  const retired = recoveryCheckpoint ? await readBackendBootRecord(recoveryCheckpoint) : null;
  if (retired) {
    if (socket) throw Error('Reviewed recovery derives the instance from its checkpoint, not a public socket');
    backendPid = retired.previousPid;
    controlAddress = { socket: path.join(path.dirname(recoveryCheckpoint!), `c-${retired.state.ticket.from.controllerId}.sock`) };
  } else {
    const client = createDaemonClient(socket, 15_000);
    try {
      backendPid = (await client.ping()).pid;
      controlAddress = await (await client.service<BackendRpcService>('OmnitronBackend')).controlAddress();
    } finally { await client.disconnect(); }
  }
  const control = await privateControlClient<BackendControlService>(controlAddress.socket, 'OmnitronBackendControl');
  let installation: RuntimeInstallation | null = null;
  try {
    const current = await control.service.status();
    const config = await readManagedRuntime(current.instanceHome);
    if (!config || config.scope === 'system' && (process.platform !== 'linux' || process.getuid?.() !== 0)) throw new Error('Automatic guardian replacement requires independent user services or a root-owned Linux system instance');
    if (path.dirname(controlAddress.socket) !== config.directory || !current.runtime.owner ||
        (retired ? (!current.retired || current.pid !== backendPid || current.ticketId !== retired.state.ticket.id ||
          current.instanceHome !== checkpointInstanceHome(retired)) : (current.retired || current.ticketId))) {
      throw new Error('The backend is not ready for a guardian transition in this instance');
    }
    const guardianPid = await managedJobPid(config, 'backend');
    await verifyManagedIsolation(config, current.runtime.owner.pid, guardianPid);
    const file = await unitFile(config);
    if (config.scope === 'system') await assertSystemGuardianProcess(config, guardianPid);
    installation = await RuntimeInstallation.open(config.instanceHome, { existing: true });
    if (!installation) throw new Error('No permanent installation exists');
    return await installation.exclusive(async () => {
      if (!retired && installation!.activation()) throw new Error('Finish the pending backend activation first');
      const recovery = recoveryCheckpoint ? await prepareReviewedBackendRecovery(recoveryCheckpoint, config.instanceHome) : undefined;
      const selected = installation!.selection();
      const running = await checkBackendCandidate(path.dirname(path.dirname(current.entry)));
      if (selected?.current !== running.runtimeHash) throw new Error('Running backend does not match the startup selection');
      const candidate = await installation!.install(path.resolve(directory));
      await fs.access(path.join(candidate.directory, 'daemon/managed-entry.js'));
      await fs.access(path.join(candidate.directory, 'daemon/backend-supervisor-entry.js'));
      const view = await inventory(config);
      if (recovery && (view.inventoryDigest !== recovery.inventoryDigest || view.status.owner.id !== recovery.owner.id ||
          view.status.owner.pid !== recovery.owner.pid)) throw Error('Reviewed ownership changed while preparing the guardian');
      const identity = projectExecutionIdentity(view);
      const after: ManagedRuntime = { ...config, backend: { ...config.backend, artifact: candidate.runtimeHash } };
      const inputs = { scope: 'user' as const, execPath: candidate.execPath,
        entryPath: path.join(candidate.directory, 'daemon/managed-entry.js'), nodeArgs: [], args: ['backend'],
        workdir: path.dirname(candidate.directory), path: config.environment['PATH'] ?? process.env['PATH'] ?? '/usr/bin:/bin',
        environment: { OMNITRON_HOME: config.instanceHome,
          ...(config.environment['TMPDIR'] ? { TMPDIR: config.environment['TMPDIR'] } : {}) }, label: config.backend.label,
        stderrLog: path.join(config.directory, 'supervisor.log') };
      const beforeUnit = await fs.readFile(file, 'utf8');
      const afterUnit = config.scope === 'system' ? replaceGuardianExec(beforeUnit, config, after) :
        process.platform === 'darwin' ? renderLaunchdPlist(inputs) : renderSystemdUnit(inputs);
      const plan: SupervisorTransition = { protocol: 1, id: randomUUID(), phase: 'prepared', createdAt: new Date().toISOString(),
        before: config, after, unit: { file, before: beforeUnit, after: afterUnit },
        backend: { runtime: running.runtimeHash, pid: backendPid, control: controlAddress.socket,
          socket: retired ? expandPath(retired.daemonConfig.socketPath) : await readCertificateSocket(config, backendPid) },
        owner: { id: view.status.owner.id, pid: view.status.owner.pid, inventory: view.inventoryDigest, ...(identity ? { identity } : {}) }, guardianPid };
      plan.selectionRevision = selected.revision;
      if (process.platform === 'linux') plan.linuxStop = await managedGuardianStopFence(config, guardianPid, backendPid);
      if (recovery) {
        plan.recovery = recovery;
        plan.checkpoint = recovery.activation.checkpoint;
        plan.backend.socket = expandPath(retired!.daemonConfig.socketPath);
        await checkReviewedBackendRecovery(recovery);
      }
      const record = path.join(installation!.directory, `supervisor-transition-${plan.id}.json`);
      await writePrivateRecord(record, plan);
      return { file: record, plan: summarize(plan) };
    });
  } finally { await installation?.close(); await control.close(); }
}

async function readCertificateSocket(config: ManagedRuntime, pid: number): Promise<string> {
  const { BackendRecoveryJournal } = await import('./backend-recovery-journal.js');
  const journal = new BackendRecoveryJournal(config.directory);
  try {
    const state = journal.read();
    if (state?.status !== 'ready' || state.record.previousPid !== pid) throw new Error('Wait for a current recovery certificate before preparing the guardian');
    return expandPath(state.record.daemonConfig.socketPath);
  } finally { await journal.close(); }
}

async function verifyStopBoundary(plan: SupervisorTransition, retired: boolean): Promise<void> {
  if (!plan.linuxStop) {
    if (plan.phase === 'prepared' && !plan.checkpoint) throw Error('This Linux guardian plan predates the stop fence. Prepare a new plan before retirement.');
    throw Error('This Linux checkpoint predates the stop fence. Reconcile the original backend and ticket; an unretired ticket can be aborted before preparing a new plan.');
  }
  await managedGuardianStopFence(plan.before, plan.guardianPid, plan.backend.pid, plan.linuxStop, retired);
}

function summarize(plan: SupervisorTransition) {
  return { id: plan.id, phase: plan.phase, instanceHome: plan.before.instanceHome,
    from: plan.before.backend.artifact, to: plan.after.backend.artifact, backendRuntime: plan.backend.runtime,
    ownerPid: plan.owner.pid, backendPid: plan.backend.pid, guardianPid: plan.guardianPid,
    unit: plan.unit.file, checkpoint: plan.checkpoint ?? null, result: plan.result ?? null,
    ...(plan.recovery ? { reviewedRecovery: { intentSha256: supervisorTransitionIntentDigest(plan),
      originalCheckpointSha256: plan.recovery.originalCheckpointSha256,
      acceptedInventory: plan.recovery.inventoryDigest, historicalExecutionDelta: 'unknown' as const } } : {}) };
}

/** Resume a private plan. Only the backend OS job is stopped; its owner is never signalled. */
export async function applySupervisorTransition(file: string, options: { checkOnly?: boolean } = {}) {
  file = path.resolve(file);
  let plan = await readSupervisorTransition(file);
  if (plan.phase === 'complete') return options.checkOnly ? { ...summarize(plan), checked: false } : summarize(plan);
  if (options.checkOnly && plan.phase !== 'prepared') throw Error('Guardian transition already started; reconcile its checkpoint before continuing');
  const installation = options.checkOnly ? await RuntimeInstallation.openReadOnly(plan.before.instanceHome) :
    await RuntimeInstallation.open(plan.before.instanceHome, { existing: true });
  if (!installation) throw new Error('No permanent installation exists');
  try {
    const inspectOrApply = async () => {
      plan = await readSupervisorTransition(file);
      if (options.checkOnly && plan.phase !== 'prepared') throw Error('Guardian transition changed during inspection; reconcile its checkpoint');
      if (plan.phase === 'complete') return;
      const active = await readManagedRuntime(plan.before.instanceHome);
      if (hash(active) !== hash(plan.before) && hash(active) !== hash(plan.after)) throw new Error('Supervision configuration changed since preparation');
      // The selected backend, replacement guardian and its rollback may be three distinct runtimes.
      for (const artifact of new Set([plan.backend.runtime, plan.before.backend.artifact, plan.after.backend.artifact])) {
        await installation.artifact(artifact);
      }
      const selected = options.checkOnly && !plan.recovery ? installation.settledSelection() : installation.selection();
      if (selected?.current !== plan.backend.runtime || (['prepared', 'preparing', 'retired'].includes(plan.phase) &&
          plan.selectionRevision !== undefined && selected.revision !== plan.selectionRevision)) throw new Error('Backend selection changed since preparation');
      assertSameOwner(plan, await inventory(plan.before));
      if (plan.recovery && ['prepared', 'preparing', 'retired'].includes(plan.phase)) {
        await checkReviewedBackendRecovery(plan.recovery);
        const hold = installation.activation()?.reviewedRecovery;
        if (hold && (hold.planId !== plan.id || hold.planFile !== file ||
            hold.planSha256 !== supervisorTransitionIntentDigest(plan) || hold.phase !== 'held')) {
          throw Error('Another reviewed recovery or an uncertain attempt owns this installation');
        }
      }
      if (plan.before.scope === 'system') {
        await systemGuardianFile(plan.before, ['prepared', 'preparing', 'retired'].includes(plan.phase));
        if (['prepared', 'preparing', 'retired'].includes(plan.phase) && PidManager.isProcessAlive(plan.guardianPid)) {
          await assertSystemGuardianProcess(plan.before, plan.guardianPid);
          await verifyManagedIsolation(plan.before, plan.owner.pid, plan.guardianPid, PidManager.isProcessAlive(plan.backend.pid) ? plan.backend.pid : undefined);
        }
      }
      if (plan.phase === 'started') {
        await assertUnitFile(plan.unit.file);
        if (hash(active) !== hash(plan.after) || await fs.readFile(plan.unit.file, 'utf8') !== plan.unit.after) {
          throw new Error('Prepared guardian configuration changed before resume');
        }
        return;
      }
      if (plan.phase === 'prepared' || plan.phase === 'preparing') {
        await assertUnitFile(plan.unit.file);
        if (await fs.readFile(plan.unit.file, 'utf8') !== plan.unit.before) throw new Error('The guardian unit changed since preparation');
        const intent = installation.activation();
        if (intent && intent.checkpoint !== plan.checkpoint) throw new Error('Another runtime activation is in progress');
        if (hash(active) !== hash(plan.before) || await managedJobPid(plan.before, 'backend') !== plan.guardianPid) throw new Error('The original guardian is no longer running');
        const control = await privateControlClient<BackendControlService>(plan.backend.control, 'OmnitronBackendControl');
        try {
          const state = await control.service.status();
          if (state.pid !== undefined && state.pid !== plan.backend.pid) throw new Error('The original backend changed');
          if (plan.recovery) {
            const record = await readBackendBootRecord(plan.checkpoint);
            if (!state.retired || state.pid !== plan.backend.pid || state.ticketId !== record.state.ticket.id ||
                state.instanceHome !== plan.before.instanceHome || record.previousPid !== plan.backend.pid) {
              throw Error('The checkpoint backend is not the verified retired controller');
            }
          } else if (plan.phase === 'prepared') {
            if (intent || state.retired || state.ticketId) throw Error('Another backend transfer has started; reconcile its checkpoint');
            if (state.pid !== plan.backend.pid || state.instanceHome !== plan.before.instanceHome ||
                state.runtime.owner?.id !== plan.owner.id || state.runtime.owner.pid !== plan.owner.pid ||
                state.runtime.phase !== 'active' || state.runtime.connection?.status !== 'connected') {
              throw Error('The original backend is not connected to the reviewed resident owner');
            }
            const blockers = state.runtime.blockers;
            if (!blockers || !BACKEND_ACTIVITY_COUNTERS.every(key => Object.hasOwn(blockers, key)) ||
                Object.values(blockers).some(count => count !== 0)) {
              throw Error('Active or unknown backend operations block guardian transition');
            }
          }
          if (process.platform === 'linux') await verifyStopBoundary(plan, !!plan.recovery);
          if (options.checkOnly) {
            const observedSelection = plan.recovery ? installation.selection() : installation.settledSelection();
            if (hash(observedSelection) !== hash(selected) || hash(await readSupervisorTransition(file)) !== hash(plan)) {
              throw Error('Guardian transition changed during inspection');
            }
            return;
          }
          if (plan.recovery) {
            // The existing controller already retired. The immutable checkpoint
            // remains the failed activation's evidence; it is never rewritten.
            installation.holdReviewedRecovery(plan.recovery.activation, plan.recovery.selection,
              { planId: plan.id, planFile: file, planSha256: supervisorTransitionIntentDigest(plan) });
            plan.phase = 'retired';
            await writePrivateRecord(file, plan);
          } else {
            plan.phase = 'preparing'; await writePrivateRecord(file, plan);
            const prepared = state.ticketId ? { ticketId: state.ticketId, file: path.join(plan.before.directory, `handoff-${state.ticketId}.json`) }
              : await control.service.prepare({ candidateId: plan.id });
            try {
              if (!/^[0-9a-f-]{36}$/i.test(prepared.ticketId) ||
                  prepared.file !== path.join(plan.before.directory, `handoff-${prepared.ticketId}.json`)) {
                throw Error('Unexpected private checkpoint path for this guardian transition');
              }
              const record = await readBackendBootRecord(prepared.file), ticket = record.state.ticket;
              if (ticket.id !== prepared.ticketId || ticket.to.controllerId !== plan.id || ticket.ownerId !== plan.owner.id ||
                  ticket.from.ownerId !== plan.owner.id || ticket.to.ownerId !== plan.owner.id || record.previousPid !== plan.backend.pid ||
                  record.state.executionInventory !== plan.owner.inventory) throw Error('Prepared checkpoint does not match the reviewed guardian transition');
              plan.checkpoint = prepared.file; await writePrivateRecord(file, plan);
              const activation = installation.activation();
              if (activation && (activation.checkpoint !== prepared.file || activation.candidate !== plan.backend.runtime || activation.previous !== plan.backend.runtime)) {
                throw Error('Another runtime activation is in progress');
              }
              // The drain can outlive a child process or a change in cgroup membership.
              assertSameOwner(plan, await inventory(plan.before));
              if (process.platform === 'linux') await verifyStopBoundary(plan, false);
              if (!activation) installation.beginActivation(plan.backend.runtime, plan.backend.runtime, prepared.file);
            } catch (refusal) {
              // Only this invocation's new ticket is known not to have been retired.
              // Preserve any existing or ambiguous activation for reconciliation.
              if (!state.ticketId && !intent) {
                try {
                  if (installation.activation()) throw Error('Installation intent requires reconciliation', { cause: refusal });
                  await control.service.abort({ ticketId: prepared.ticketId });
                  plan.phase = 'prepared'; delete plan.checkpoint;
                  await writePrivateRecord(file, plan);
                } catch (recovery) {
                  throw new AggregateError([refusal, recovery], 'Guardian preflight failed after drain; reconcile the checkpoint before continuing', { cause: recovery });
                }
              }
              throw refusal;
            }
            await control.service.retire({ ticketId: prepared.ticketId });
            plan.phase = 'retired'; await writePrivateRecord(file, plan);
          }
        } finally { await control.close(); }
      }
      if (plan.phase === 'retired') {
        // After a crash during bootout, both recorded processes may already be gone.
        if (PidManager.isProcessAlive(plan.guardianPid)) {
          if (await managedJobPid(plan.before, 'backend') !== plan.guardianPid) throw new Error('A different guardian now owns the OS job');
          if (process.platform === 'darwin') await native('/bin/launchctl', ['bootout', `${domain()}/${plan.before.backend.label}`]);
          else {
            if (plan.before.scope === 'system') await systemGuardianFile(plan.before, true);
            assertSameOwner(plan, await inventory(plan.before));
            await verifyStopBoundary(plan, true);
            await native('systemctl', [...systemctlScope(plan.before), 'stop', plan.before.backend.unit]);
          }
        }
        const stoppedBy = Date.now() + 35_000;
        while ((PidManager.isProcessAlive(plan.guardianPid) || PidManager.isProcessAlive(plan.backend.pid)) && Date.now() < stoppedBy) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (PidManager.isProcessAlive(plan.guardianPid) || PidManager.isProcessAlive(plan.backend.pid)) throw new Error('Old guardian/backend still exists; no replacement will be started');
        if (process.platform === 'linux') await assertGuardianStopped(plan.before, plan.linuxStop);
        assertSameOwner(plan, await inventory(plan.before));
        plan.phase = 'stopped'; await writePrivateRecord(file, plan);
      }
      if (plan.phase === 'stopped') {
        if (process.platform === 'linux') {
          if (PidManager.isProcessAlive(plan.guardianPid) || PidManager.isProcessAlive(plan.backend.pid)) {
            throw Error('The recorded guardian/backend still exists. Reconcile before replacing its unit.');
          }
          await assertGuardianStopped(plan.before, plan.linuxStop);
        }
        await replaceUnit(plan.unit.file, [plan.unit.before, plan.unit.after], plan.unit.after);
        await writePrivateRecord(managedRuntimeFile(plan.before.instanceHome), plan.after);
        plan.phase = 'configured'; await writePrivateRecord(file, plan);
      }
      if (plan.phase === 'configured') {
        // Publish intent before bootstrapping. If the CLI dies, resume observes
        // the same job before deciding whether another start is necessary.
        plan.phase = 'started'; await writePrivateRecord(file, plan);
      }
    };
    if (options.checkOnly) {
      await inspectOrApply();
      return { ...summarize(plan), checked: true };
    }
    await installation.exclusive(inspectOrApply);
  } finally { await installation.close(); }
  plan = await readSupervisorTransition(file);
  if (plan.phase === 'complete') return summarize(plan);
  // The installation lease is released before the new guardian recovers the backend.
  let guardianPid = await managedJobPid(plan.after, 'backend').catch(() => null);
  if (!guardianPid) {
    if (PidManager.isProcessAlive(plan.guardianPid) || PidManager.isProcessAlive(plan.backend.pid)) throw new Error('Recorded old processes still exist; refusing bootstrap');
    if (process.platform === 'darwin') await native('/bin/launchctl', ['bootstrap', domain(), plan.unit.file]);
    else {
      await assertGuardianStopped(plan.after, plan.linuxStop);
      const scope = systemctlScope(plan.after);
      await native('systemctl', [...scope, 'daemon-reload']);
      if (plan.after.scope === 'system') await systemGuardianFile(plan.after, true);
      await native('systemctl', [...scope, 'start', plan.after.backend.unit]);
    }
  }
  const client = createDaemonClient(plan.backend.socket, 4000);
  try {
    let until = Date.now() + 150_000;
    let reason = 'Guardian has not reported readiness';
    let recoveryRequested = false;
    while (Date.now() < until) {
      let state: Awaited<ReturnType<BackendSupervisorService['status']>> | undefined;
      let supervisor: Awaited<ReturnType<typeof privateControlClient<BackendSupervisorService>>> | undefined;
      try {
        guardianPid = await managedJobPid(plan.after, 'backend');
        supervisor = await privateControlClient<BackendSupervisorService>(managedSupervisorSocket(plan.after), 'OmnitronSupervisor', 4000);
        state = await withControlDeadline(supervisor.service.status(), 4000, 'Guardian status timed out');
        reason = state.reason ?? state.state;
      } catch (error) { reason = error instanceof Error ? error.message : String(error); }
      finally { await supervisor?.close(); }
      if (state) {
        if (state.pid !== guardianPid || guardianPid === plan.guardianPid) throw new Error('Guardian identity disagrees with the replacement OS job');
        if (plan.recovery && state.state === 'blocked' && !recoveryRequested) {
          if (state.reviewedRecovery !== 1) throw Error('The installed guardian cannot atomically verify reviewed recovery; no recovery was requested');
          recoveryRequested = true;
          // One receiver-owned attempt. A lost response or refusal leaves its
          // durable hold observable; never replay it with a freshly read grant.
          const receiver = await privateControlClient<BackendSupervisorService>(managedSupervisorSocket(plan.after), 'OmnitronSupervisor', 600_000);
          try { await receiver.service.recoverReviewed({ plan: file, sha256: supervisorTransitionIntentDigest(plan) }); }
          finally { await receiver.close(); }
          until = Date.now() + 60_000;
          continue;
        }
        if (state.state === 'ready' && state.backendPid && state.backendPid !== plan.backend.pid && guardianPid) {
          if (plan.after.scope === 'system') await assertSystemGuardianProcess(plan.after, guardianPid);
          const status = await client.status();
          if (status.pid !== state.backendPid) throw new Error('Public backend identity disagrees with the guardian');
          assertSameOwner(plan, await inventory(plan.after));
          await verifyManagedIsolation(plan.after, plan.owner.pid, guardianPid);
          const selected = await RuntimeInstallation.open(plan.after.instanceHome, { existing: true });
          try {
            if (!selected || selected.selection()?.current !== plan.backend.runtime || selected.activation()) {
              throw new Error('Guardian has not committed the expected backend selection');
            }
            if (hash(await readManagedRuntime(plan.after.instanceHome)) !== hash(plan.after)) throw new Error('Guardian configuration changed during transition');
          } finally { await selected?.close(); }
          plan.phase = 'complete'; plan.result = { backendPid: status.pid, guardianPid, ownerPid: plan.owner.pid };
          await writePrivateRecord(file, plan);
          return summarize(plan);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Guardian transition did not become ready: ${reason}. Applications remain with their owner. Inspect and resume ${file}`);
  } finally { await client.disconnect(); }
}
