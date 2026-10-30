import path from 'node:path';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { OMNITRON_HOME } from '../config/defaults.js';
import { ProjectRegistry } from '../project/registry.js';
import { DaemonStateStore } from './daemon-state-store.service.js';
import { BackendRecoveryJournal } from './backend-recovery-journal.js';
import { RuntimeInstallation } from './runtime-installation.js';
import { ExecutionClient } from './execution-client.js';
import { ExecutionJournal, writePrivateRecord } from './execution-journal.js';
import { PidManager } from './pid-manager.js';
import { spawnReplacement, stopFailedCandidate, type BackendReplacementResult } from './backend-upgrade.js';
import { checkpointInstanceHome, type BackendBootRecord } from './backend-handoff-types.js';
import { executionDirectory } from './execution-launcher.js';
import { expandPath } from '../shared/paths.js';
import { readManagedRuntime, managedSupervisorSocket } from './managed-runtime.js';
import { supervisesBackendChildren } from './backend-child.js';
import { privateControlClient } from './private-control-client.js';
import type { BackendSupervisorService } from './backend-supervisor.js';

/** Recover only a dead controller with a certified, unchanged resident owner. */
export async function recoverBackendAfterCrash(directory: string): Promise<BackendReplacementResult> {
  // Read only the requested instance before looking up any supervisor. In
  // particular, a missing checkpoint must not create a default installation.
  await fs.access(path.join(directory, 'recovery.db'));
  const journal = new BackendRecoveryJournal(directory);
  let saved;
  try { saved = journal.read(); } finally { await journal.close(); }
  if (!saved || saved.status !== 'ready') throw new Error(`No certified backend recovery checkpoint: ${saved?.status === 'invalid' ? saved.reason : 'none recorded'}`);
  const record = saved.record;
  const instanceHome = checkpointInstanceHome(record);
  if (path.resolve(executionDirectory(record.daemonConfig)) !== path.resolve(directory)) throw new Error('Recovery checkpoint belongs to a different execution directory');
  if (supervisesBackendChildren() && instanceHome !== path.resolve(OMNITRON_HOME)) throw new Error('A guardian cannot recover another instance');
  const managed = await readManagedRuntime(instanceHome);
  if (managed && path.resolve(managed.directory) !== path.resolve(directory)) throw new Error('Recovery checkpoint belongs to a different supervised execution directory');
  if (managed && !supervisesBackendChildren()) {
    const supervisor = await privateControlClient<BackendSupervisorService>(managedSupervisorSocket(managed), 'OmnitronSupervisor', 600_000);
    try { return await supervisor.service.recover({}); } finally { await supervisor.close(); }
  }
  const installation = await RuntimeInstallation.open(instanceHome, { existing: true });
  if (!installation) throw new Error('No permanent runtime is installed for automatic recovery');
  try { return await installation.exclusive(async () => {
    const activation = installation.activation();
    if (activation) throw new Error(`An activation is unfinished; recover its checkpoint first: ${activation.checkpoint}`);
    const current = new BackendRecoveryJournal(directory);
    try {
      if (JSON.stringify(current.read()) !== JSON.stringify(saved)) throw new Error('Recovery checkpoint changed while acquiring the installation lease; retry after inspecting its current state');
    } finally { await current.close(); }
    if (new PidManager(expandPath(record.daemonConfig.pidFile)).isRunning() || PidManager.isProcessAlive(record.previousPid)) {
      throw new Error('The checkpoint controller or another backend is still alive; automatic recovery is refused');
    }
    const selection = installation.selection();
    if (!selection || selection.current !== record.runtimeHash) throw new Error('Recovery checkpoint does not match the selected runtime');
    const artifact = await installation.artifact(record.runtimeHash);
    const store = new DaemonStateStore(createNullLogger(), path.join(instanceHome, 'data/daemon-state.db'));
    try {
      if (new ProjectRegistry(store).recoveryDigest() !== record.registryDigest) throw new Error('Project registry changed since the recovery checkpoint');
    } finally { await store.dispose(); }

    const observer = new ExecutionClient(path.join(directory, 'owner.sock'), createNullLogger());
    let boot: BackendBootRecord;
    let file: string;
    try {
      const snapshot = await observer.connect();
      const durable = await new ExecutionJournal(path.join(directory, 'controller.json')).read();
      const ownerPid = new PidManager(path.join(directory, 'owner.pid')).getPid();
      if (!durable || snapshot.status.owner.id !== record.controller.ownerId ||
          durable.owner.id !== snapshot.status.owner.id || durable.owner.pid !== ownerPid || ownerPid !== snapshot.status.owner.pid ||
          snapshot.status.controller.controllerId !== record.controller.controllerId ||
          snapshot.status.controller.epoch !== record.controller.epoch ||
          snapshot.status.phase !== 'active' || snapshot.status.inFlight !== 0 ||
          snapshot.inventoryDigest !== record.state.executionInventory) {
        throw new Error('Owner, controller grant or execution inventory changed; automatic recovery would adopt uncertain state and is refused');
      }
      const ticket = await observer.prepareReplacement(snapshot.status.owner.id, randomUUID());
      boot = { protocol: 1, state: { ...record.state, ticket }, daemonConfig: record.daemonConfig,
        previousEntry: artifact.entry, previousPid: record.previousPid, createdAt: new Date().toISOString(),
        cwd: record.cwd, environment: record.environment };
      file = path.join(directory, `handoff-${ticket.id}.json`);
      try {
        await writePrivateRecord(file, boot);
        // An interrupted recovery now has the same durable restart/rollback
        // path as a planned replacement. No second recovery can race it.
        installation.beginActivation(record.runtimeHash, record.runtimeHash, file);
      } catch (error) {
        await observer.cancelReplacement(ticket);
        if (installation.activation()?.checkpoint === file) installation.abortActivation();
        throw error;
      }
    } finally { await observer.close(); }
    let candidate: ChildProcess | null = null;
    try {
      const result = await spawnReplacement(artifact, file, boot, child => { candidate = child; });
      await installation.select(record.runtimeHash, selection.revision);
      return result;
    } catch (error) {
      await stopFailedCandidate(candidate);
      throw error;
    }
  }); } finally { await installation.close(); }
}
