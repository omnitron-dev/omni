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
import { readBackendBootRecord, type BackendBootRecord } from './backend-handoff-types.js';
import { writePrivateRecord } from './execution-journal.js';
import { ExecutionClient } from './execution-client.js';
import { executionDirectory } from './execution-launcher.js';
import { PidManager } from './pid-manager.js';
import type { BackendRuntimeStatus } from '../shared/dto/backend.js';

export interface BackendReplacementResult {
  pid: number;
  ownerPid: number;
  ownerId: string;
  epoch: number;
  checkpoint: string;
  build: BackendArtifact['build'];
}

async function spawnReplacement(artifact: BackendArtifact, file: string, record: BackendBootRecord,
  onSpawn: (child: ChildProcess) => void): Promise<BackendReplacementResult> {
  await verifyBackendEntry(artifact);
  const log = await fs.open(path.join(executionDirectory(record.daemonConfig), `backend-${record.state.ticket.to.controllerId}.log`), 'a', 0o600);
  let child: ChildProcess;
  try {
    // Resolve tsx from the candidate installation, not the operator's cwd.
    child = fork(artifact.entry, ['--backend-handoff', file], {
      cwd: path.dirname(artifact.directory), env: record.environment, detached: true,
      execPath: artifact.execPath,
      execArgv: ['--import', 'tsx/esm'], stdio: ['ignore', log.fd, log.fd, 'ipc'],
    });
  } finally { await log.close(); }
  onSpawn(child);
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
async function stopFailedCandidate(child: ChildProcess | null): Promise<void> {
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

/** No network artifacts, installs, schema migrations or application restarts occur in this operation. */
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
    progress('Validating candidate and rollback artifacts');
    const artifact = await checkBackendCandidate(directory, previous.entry);
    const rollback = await checkBackendCandidate(path.dirname(path.dirname(previous.entry)));
    if (options.checkOnly) return { checked: true, build: artifact.build };
    progress('Draining backend requests and execution mutations');
    const prepared = await control.service.prepare({ candidateId: randomUUID() });
    const record = await readBackendBootRecord(prepared.file);
    // All fallible pre-retirement checks still have an abort path.
    try { await verifyBackendEntry(artifact); await verifyBackendEntry(rollback); }
    catch (error) { await control.service.abort({ ticketId: prepared.ticketId }); throw error; }
    progress('Retiring the old backend; application processes remain with their owner');
    await control.service.retire({ ticketId: prepared.ticketId });
    let candidate: ChildProcess | null = null;
    let result: BackendReplacementResult;
    try {
      result = await spawnReplacement(artifact, prepared.file, record, child => { candidate = child; });
    } catch (error) {
      progress('Candidate failed; restoring the previous backend with a fresh controller epoch');
      await stopFailedCandidate(candidate);
      const recovery = await freshRecoveryRecord(record);
      let restored: ChildProcess | null = null;
      try { await spawnReplacement(rollback, recovery.file, recovery.record, child => { restored = child; }); }
      catch (restoreError) {
        await stopFailedCandidate(restored);
        throw new AggregateError([error, restoreError], `Backend restoration failed. Applications remain with the resident owner. Recovery checkpoint: ${recovery.file}`, { cause: restoreError });
      }
      await control.service.complete({ ticketId: prepared.ticketId });
      throw new Error('Candidate activation failed; the previous backend was restored. Application ownership was preserved.', { cause: error });
    }
    // This is an operator receipt, not a cold-start selector. Startup must use
    // the activated artifact's CLI; it must never silently replay old ownership.
    try {
      await writePrivateRecord(path.join(executionDirectory(record.daemonConfig), 'active-backend.json'), { protocol: 1, artifact, checkpoint: prepared.file });
    } catch (error) {
      progress(`Replacement is running, but its activation receipt could not be saved: ${error instanceof Error ? error.message : String(error)}`);
    }
    await control.service.complete({ ticketId: prepared.ticketId });
    progress('Replacement backend is ready');
    return result;
  } finally { await control.close(); }
}

/** Explicit recovery for an interrupted upgrade. Never preempts a live backend. */
export async function recoverBackend(file: string): Promise<BackendReplacementResult> {
  const previous = await readBackendBootRecord(file);
  const artifact = await checkBackendCandidate(path.dirname(path.dirname(previous.previousEntry)));
  const recovery = await freshRecoveryRecord(previous);
  let candidate: ChildProcess | null = null;
  try { return await spawnReplacement(artifact, recovery.file, recovery.record, child => { candidate = child; }); }
  catch (error) { await stopFailedCandidate(candidate); throw error; }
}

/** Undo preparation while the original backend still owns its private channel. */
export async function abortBackendReplacement(file: string): Promise<void> {
  const record = await readBackendBootRecord(file);
  if (new PidManager(record.daemonConfig.pidFile).getPid() !== record.previousPid) {
    throw new Error('The original backend no longer owns the daemon marker; use recovery after inspecting the checkpoint');
  }
  const socket = path.join(executionDirectory(record.daemonConfig), `c-${record.state.ticket.from.controllerId}.sock`);
  const control = await privateControlClient<BackendControlService>(socket, 'OmnitronBackendControl');
  try { await control.service.abort({ ticketId: record.state.ticket.id }); }
  finally { await control.close(); }
}
