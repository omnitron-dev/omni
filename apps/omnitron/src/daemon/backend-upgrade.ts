import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { createDaemonClient } from './daemon-client.js';
import type { BackendRpcService } from './backend.rpc-service.js';
import type { BackendControlService } from './backend-control.js';
import { privateControlClient, withControlDeadline } from './private-control-client.js';
import { checkBackendCandidate, verifyBackendEntry, type BackendArtifact } from './backend-candidate.js';
import { readBackendBootRecord, checkpointInstanceHome, type BackendBootRecord } from './backend-handoff-types.js';
import { writePrivateRecord } from './execution-journal.js';
import { ExecutionClient } from './execution-client.js';
import { executionDirectory } from './execution-launcher.js';
import { PidManager } from './pid-manager.js';
import type { BackendRuntimeStatus } from '../shared/dto/backend.js';
import { OMNITRON_HOME } from '../config/defaults.js';
import { RuntimeInstallation } from './runtime-installation.js';
import { observeBackendChild, supervisesBackendChildren } from './backend-child.js';
import { readManagedRuntime, managedSupervisorSocket } from './managed-runtime.js';
import type { BackendSupervisorService } from './backend-supervisor.js';

export interface BackendReplacementResult {
  pid: number;
  ownerPid: number;
  ownerId: string;
  epoch: number;
  checkpoint: string;
  build: BackendArtifact['build'];
}

export async function spawnReplacement(artifact: BackendArtifact, file: string, record: BackendBootRecord,
  onSpawn: (child: ChildProcess) => void): Promise<BackendReplacementResult> {
  await verifyBackendEntry(artifact);
  const log = await fs.open(path.join(executionDirectory(record.daemonConfig), `backend-${record.state.ticket.to.controllerId}.log`), 'a', 0o600);
  let child: ChildProcess;
  try {
    // Resolve tsx from the candidate installation, not the operator's cwd.
    child = fork(artifact.entry, ['--backend-handoff', file], {
      cwd: path.dirname(artifact.directory), env: record.environment, detached: !supervisesBackendChildren(),
      execPath: artifact.execPath,
      execArgv: ['--import', 'tsx/esm'], stdio: ['ignore', log.fd, log.fd, 'ipc'],
    });
  } finally { await log.close(); }
  onSpawn(child);
  observeBackendChild(child);
  const ready = new Promise<BackendRuntimeStatus>((resolve, reject) => {
    const cleanup = () => { child.off('message', message); child.off('exit', exited); child.off('error', failed); };
    const failed = (error: Error) => { cleanup(); reject(error); };
    const exited = (code: number | null, signal: string | null) => failed(new Error(`Candidate backend exited (${code ?? signal}); inspect its private startup log`));
    const message = (input: unknown) => {
      const value = input as { type?: string; pid?: number; execution?: BackendRuntimeStatus; build?: BackendArtifact['build'] };
      if (value.type !== 'backend-ready') return;
      if (value.pid !== child.pid || value.build?.commit !== artifact.build.commit || !value.execution?.owner) {
        failed(new Error('Candidate readiness identity does not match its validated artifact')); return;
      }
      cleanup(); resolve(value.execution);
    };
    child.once('error', failed); child.once('exit', exited); child.on('message', message);
  });
  const execution = await withControlDeadline(ready, 120_000, 'Candidate backend did not become ready within 120 seconds');
  if (!execution.owner || !execution.epoch || execution.owner.id !== record.state.ticket.ownerId || execution.epoch !== record.state.ticket.to.epoch || execution.phase !== 'active') {
    throw new Error('Candidate did not acquire the expected execution owner and epoch');
  }
  // A child IPC message alone cannot prove public control-plane readiness.
  const client = createDaemonClient(record.daemonConfig.socketPath, 15_000);
  try {
    const status = await client.status();
    if (status.pid !== child.pid || status.execution?.owner?.id !== execution.owner.id || status.execution.epoch !== execution.epoch) {
      throw new Error('Public backend status disagrees with the replacement readiness acknowledgment');
    }
  } finally { await client.disconnect(); }
  const observation = new ExecutionClient(path.join(executionDirectory(record.daemonConfig), 'owner.sock'), createNullLogger());
  try {
    const inventory = await observation.connect();
    if (inventory.inventoryDigest !== record.state.executionInventory) {
      throw new Error('Application identities changed during backend replacement; inspect owner diagnostics before acknowledging preservation');
    }
  } finally { await observation.close(); }
  child.unref(); child.channel?.unref();
  return { pid: child.pid!, ownerPid: execution.owner.pid, ownerId: execution.owner.id,
    epoch: execution.epoch, checkpoint: file, build: artifact.build };
}

/** Only a process this coordinator spawned can be terminated on failed activation. */
export async function stopFailedCandidate(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  try { await withControlDeadline(exited, 30_000, 'Candidate graceful exit timed out'); }
  catch {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await withControlDeadline(exited, 5000, 'Failed candidate is still alive; refusing a concurrent controller');
  }
}

async function freshRecoveryRecord(record: BackendBootRecord): Promise<{ file: string; record: BackendBootRecord }> {
  const marker = new PidManager(record.daemonConfig.pidFile);
  if (marker.isRunning()) throw new Error('A backend still owns the daemon marker; recovery is refused');
  const execution = new ExecutionClient(path.join(executionDirectory(record.daemonConfig), 'owner.sock'), createNullLogger());
  try {
    const snapshot = await execution.connect();
    if (snapshot.inventoryDigest !== record.state.executionInventory) {
      throw new Error('The execution inventory changed since this checkpoint. Recovery would restore stale project ownership and is refused; inspect the resident owner.');
    }
    const ticket = await execution.prepareReplacement(record.state.ticket.ownerId, randomUUID());
    const recovered = { ...record, state: { ...record.state, ticket, executionInventory: snapshot.inventoryDigest } };
    const file = path.join(executionDirectory(record.daemonConfig), `handoff-${ticket.id}.json`);
    await writePrivateRecord(file, recovered);
    return { file, record: recovered };
  } finally { await execution.close(); }
}

/** Installs verified local artifacts; never downloads packages, migrates schemas or restarts applications. */
export async function replaceBackend(directory: string, options: {
  socket?: string; checkOnly?: boolean; progress?: (message: string) => void;
} = {}): Promise<BackendReplacementResult | { checked: true; build: BackendArtifact['build'] }> {
  const progress = options.progress ?? (() => {});
  const client = createDaemonClient(options.socket, 15_000);
  let address: { socket: string };
  try {
    const rpc = await client.service<BackendRpcService>('OmnitronBackend');
    const capability = await rpc.status();
    if (!capability.handoffSupported) throw new Error(capability.reason ?? 'This backend cannot transfer execution ownership');
    address = await rpc.controlAddress();
  } finally { await client.disconnect(); }
  const control = await privateControlClient<BackendControlService>(address.socket, 'OmnitronBackendControl');
  try {
    const previous = await control.service.status();
    if (typeof previous.instanceHome !== 'string' || !path.isAbsolute(previous.instanceHome)) {
      throw new Error('The selected backend did not provide an absolute instance identity');
    }
    // A custom public socket can belong to a different instance than this CLI.
    // Resolve its private control identity before choosing any OS supervisor.
    const managed = await readManagedRuntime(previous.instanceHome);
    if (managed && path.resolve(managed.directory) !== path.dirname(path.resolve(address.socket))) {
      throw new Error('The selected backend control socket belongs to a different supervised instance');
    }
    if (supervisesBackendChildren() && path.resolve(previous.instanceHome) !== path.resolve(OMNITRON_HOME)) {
      throw new Error('A guardian cannot replace another instance');
    }
    if (managed && !supervisesBackendChildren()) {
      const supervisor = await privateControlClient<BackendSupervisorService>(managedSupervisorSocket(managed), 'OmnitronSupervisor', 600_000);
      try { return await supervisor.service.upgrade({ directory, checkOnly: options.checkOnly === true }); }
      finally { await supervisor.close(); }
    }
    progress('Validating candidate and rollback artifacts');
    const artifact = await checkBackendCandidate(directory, previous.entry);
    const rollback = await checkBackendCandidate(path.dirname(path.dirname(previous.entry)));
    if (options.checkOnly) return { checked: true, build: artifact.build };
    const installation = await RuntimeInstallation.open(previous.instanceHome);
    if (!installation) throw new Error('Could not open the runtime installation');
    try { return await installation.exclusive(async () => {
      if (installation.activation()) throw new Error('A previous activation is unfinished; inspect its recovery checkpoint first');
      progress('Installing verified candidate and rollback releases in permanent storage');
      const installedCandidate = await installation.install(artifact.runtimeRoot);
      const installedRollback = await installation.install(rollback.runtimeRoot);
      const selection = installation.selection();
      if (selection && selection.current !== installedRollback.runtimeHash) {
        throw new Error('The running backend differs from the startup selection; reconcile the installation before upgrading');
      }
      const selected = selection ?? await installation.select(installedRollback.runtimeHash, 0);
      await installation.writeLauncher(installedCandidate.runtimeHash);
      progress('Draining backend requests and execution mutations');
      const prepared = await control.service.prepare({ candidateId: randomUUID() });
      let record: BackendBootRecord;
      // All fallible pre-retirement checks still have an abort path.
      try {
        record = await readBackendBootRecord(prepared.file);
        record.previousEntry = installedRollback.entry;
        await writePrivateRecord(prepared.file, record);
        await verifyBackendEntry(installedCandidate); await verifyBackendEntry(installedRollback);
        installation.beginActivation(installedCandidate.runtimeHash, installedRollback.runtimeHash, prepared.file);
      }
      catch (error) { await control.service.abort({ ticketId: prepared.ticketId }); throw error; }
      progress('Retiring the old backend; application processes remain with their owner');
      try { await control.service.retire({ ticketId: prepared.ticketId }); }
      catch (error) {
        // Retirement can fail after stopping part of the controller. Keep the
        // activation journal: a cold start must not guess which phase committed.
        throw new Error(`Backend retirement was not acknowledged; inspect ${prepared.file} before recovery`, { cause: error });
      }
      let candidate: ChildProcess | null = null;
      let result: BackendReplacementResult;
      try {
        result = await spawnReplacement(installedCandidate, prepared.file, record, child => { candidate = child; });
      } catch (error) {
        progress('Candidate failed; restoring the previous backend with a fresh controller epoch');
        await stopFailedCandidate(candidate);
        const recovery = await freshRecoveryRecord(record);
        let restored: ChildProcess | null = null;
        try { await spawnReplacement(installedRollback, recovery.file, recovery.record, child => { restored = child; }); }
        catch (restoreError) {
          await stopFailedCandidate(restored);
          throw new AggregateError([error, restoreError], `Backend restoration failed. Applications remain with the resident owner. Recovery checkpoint: ${recovery.file}`, { cause: restoreError });
        }
        await control.service.complete({ ticketId: prepared.ticketId });
        await installation.select(installedRollback.runtimeHash, selected.revision);
        throw new Error('Candidate activation failed; the previous backend was restored. Application ownership was preserved.', { cause: error });
      }
      // Selection commits only after public readiness and application identity
      // checks. A failed commit leaves the activation journal, blocking cold boot.
      await control.service.complete({ ticketId: prepared.ticketId });
      // The proven ready management code becomes the recovery bootstrap.
      // A failed candidate never replaces management, and legacy rollback
      // retains this capable bootstrap instead of losing service delegation.
      await installation.select(installedCandidate.runtimeHash, selected.revision, true);
      // The private checkpoint remains a receipt, never a cold-start project snapshot.
      try {
        await writePrivateRecord(path.join(executionDirectory(record.daemonConfig), 'active-backend.json'), { protocol: 1, artifact: installedCandidate, checkpoint: prepared.file });
      } catch (error) {
        progress(`Replacement is running, but its activation receipt could not be saved: ${error instanceof Error ? error.message : String(error)}`);
      }
      progress('Replacement backend is ready');
      return result;
    }); } finally { await installation.close(); }
  } finally { await control.close(); }
}

/** Explicit recovery for an interrupted upgrade. Never preempts a live backend. */
export async function recoverBackend(file: string): Promise<BackendReplacementResult> {
  const previous = await readBackendBootRecord(file);
  const instanceHome = checkpointInstanceHome(previous);
  const directory = executionDirectory(previous.daemonConfig);
  if (path.dirname(path.resolve(file)) !== path.resolve(directory)) throw new Error('Checkpoint is outside its execution directory');
  if (supervisesBackendChildren() && instanceHome !== path.resolve(OMNITRON_HOME)) throw new Error('A guardian cannot recover another instance');
  const managed = await readManagedRuntime(instanceHome);
  if (managed && path.resolve(managed.directory) !== path.resolve(directory)) throw new Error('Checkpoint belongs to a different supervised execution directory');
  if (managed && !supervisesBackendChildren()) {
    const supervisor = await privateControlClient<BackendSupervisorService>(managedSupervisorSocket(managed), 'OmnitronSupervisor', 600_000);
    try { return await supervisor.service.recover({ checkpoint: file }); }
    finally { await supervisor.close(); }
  }
  const installation = await RuntimeInstallation.open(instanceHome);
  if (!installation) throw new Error('Cannot open runtime installation for recovery');
  try { return await installation.exclusive(async () => {
    const activation = installation.activation();
    const selected = installation.selection();
    const currentPid = new PidManager(previous.daemonConfig.pidFile).getPid();
    if (currentPid) {
      if (!activation || currentPid === previous.previousPid) throw new Error('A backend still owns the daemon marker; recovery is refused');
      // The coordinator may have died after readiness but before committing
      // selection. Reconcile that result; never launch a second controller.
      const client = createDaemonClient(previous.daemonConfig.socketPath, 15_000);
      let address: { socket: string };
      try { address = await (await client.service<BackendRpcService>('OmnitronBackend')).controlAddress(); }
      finally { await client.disconnect(); }
      const control = await privateControlClient<BackendControlService>(address.socket, 'OmnitronBackendControl');
      try {
        const state = await control.service.status();
        const artifact = await checkBackendCandidate(path.dirname(path.dirname(state.entry)));
        const owner = state.runtime.owner;
        if ((artifact.runtimeHash !== activation.candidate && artifact.runtimeHash !== activation.previous) ||
            !owner || owner.id !== previous.state.ticket.ownerId || state.runtime.phase !== 'active' ||
            !state.runtime.epoch || state.runtime.epoch <= previous.state.ticket.from.epoch) {
          throw new Error('Live backend identity does not match the unfinished activation; refusing reconciliation');
        }
        const observer = new ExecutionClient(path.join(executionDirectory(previous.daemonConfig), 'owner.sock'), createNullLogger());
        try {
          if ((await observer.connect()).inventoryDigest !== previous.state.executionInventory) throw new Error('Execution inventory changed; automatic activation reconciliation is refused');
        } finally { await observer.close(); }
        await completeRetiredBackend(await readBackendBootRecord(activation.checkpoint));
        await installation.select(artifact.runtimeHash, selected?.revision ?? 0);
        return { pid: currentPid, ownerPid: owner.pid, ownerId: owner.id, epoch: state.runtime.epoch, checkpoint: file, build: artifact.build };
      } finally { await control.close(); }
    }
    const artifact = activation ? await installation.artifact(activation.previous)
      : await installation.install(path.resolve(path.dirname(path.dirname(previous.previousEntry)), '../../..'));
    const recovery = await freshRecoveryRecord(previous);
    let candidate: ChildProcess | null = null;
    let result: BackendReplacementResult;
    try { result = await spawnReplacement(artifact, recovery.file, recovery.record, child => { candidate = child; }); }
    catch (error) { await stopFailedCandidate(candidate); throw error; }
    await completeRetiredBackend(activation ? await readBackendBootRecord(activation.checkpoint) : previous);
    await installation.select(artifact.runtimeHash, selected?.revision ?? 0);
    return result;
  }); } finally { await installation.close(); }
}

async function completeRetiredBackend(record: BackendBootRecord): Promise<void> {
  if (!PidManager.isProcessAlive(record.previousPid)) return;
  const socket = path.join(executionDirectory(record.daemonConfig), `c-${record.state.ticket.from.controllerId}.sock`);
  const control = await privateControlClient<BackendControlService>(socket, 'OmnitronBackendControl');
  try { await control.service.complete({ ticketId: record.state.ticket.id }); }
  finally { await control.close(); }
}

/** Undo preparation while the original backend still owns its private channel. */
export async function abortBackendReplacement(file: string): Promise<void> {
  const record = await readBackendBootRecord(file);
  if (new PidManager(record.daemonConfig.pidFile).getPid() !== record.previousPid) {
    throw new Error('The original backend no longer owns the daemon marker; use recovery after inspecting the checkpoint');
  }
  const socket = path.join(executionDirectory(record.daemonConfig), `c-${record.state.ticket.from.controllerId}.sock`);
  const control = await privateControlClient<BackendControlService>(socket, 'OmnitronBackendControl');
  const installation = await RuntimeInstallation.open(checkpointInstanceHome(record), { existing: true });
  try {
    if (installation) {
      await installation.exclusive(async () => {
        const activation = installation.activation();
        if (activation && activation.checkpoint !== file) throw new Error('Another activation checkpoint owns the installation');
        await control.service.abort({ ticketId: record.state.ticket.id });
        installation.abortActivation();
      });
    } else await control.service.abort({ ticketId: record.state.ticket.id });
  }
  finally { await installation?.close(); await control.close(); }
}
