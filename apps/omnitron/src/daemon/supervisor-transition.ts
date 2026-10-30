import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { renderLaunchdPlist, renderSystemdUnit } from '../commands/service-units.js';
import { RuntimeInstallation } from './runtime-installation.js';
import { readManagedRuntime, managedRuntimeFile, managedSupervisorSocket, managedJobPid, verifyManagedIsolation, type ManagedRuntime } from './managed-runtime.js';
import { privateControlClient, withControlDeadline } from './private-control-client.js';
import { createDaemonClient } from './daemon-client.js';
import type { BackendRpcService } from './backend.rpc-service.js';
import type { BackendControlService } from './backend-control.js';
import type { BackendSupervisorService } from './backend-supervisor.js';
import { checkBackendCandidate } from './backend-candidate.js';
import { readBackendBootRecord } from './backend-handoff-types.js';
import { readPrivateRecord, writePrivateRecord } from './execution-journal.js';
import { ExecutionClient } from './execution-client.js';
import { PidManager } from './pid-manager.js';
import { expandPath } from '../shared/paths.js';

interface SupervisorTransition {
  protocol: 1;
  id: string;
  phase: 'prepared' | 'preparing' | 'retired' | 'stopped' | 'configured' | 'started' | 'complete';
  createdAt: string;
  before: ManagedRuntime;
  after: ManagedRuntime;
  unit: { file: string; before: string; after: string };
  backend: { runtime: string; pid: number; control: string; socket: string };
  owner: { id: string; pid: number; inventory: string };
  guardianPid: number;
  checkpoint?: string;
  result?: { backendPid: number; guardianPid: number; ownerPid: number };
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const execute = promisify(execFile);
async function native(command: string, args: string[]): Promise<string> {
  return (await execute(command, args, { encoding: 'utf8', timeout: 40_000, maxBuffer: 1024 * 1024 })).stdout;
}
const domain = () => `gui/${process.getuid!()}`;

async function unitFile(config: ManagedRuntime): Promise<string> {
  let file: string | undefined;
  if (process.platform === 'darwin') {
    file = (await native('/bin/launchctl', ['print', `${domain()}/${config.backend.label}`])).match(/^\s*path = (.+)$/m)?.[1];
  } else if (process.platform === 'linux') {
    file = (await native('systemctl', ['--user', 'show', config.backend.unit, '--property=FragmentPath', '--value'])).trim();
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
    throw new Error('Execution owner or application inventory changed; automatic guardian transition is refused');
  }
}

async function readPlan(file: string): Promise<SupervisorTransition> {
  const stat = await fs.lstat(file);
  if (stat.size > 1024 * 1024) throw new Error('Supervisor transition record exceeds its size limit');
  const plan = await readPrivateRecord<SupervisorTransition>(file);
  if (!plan || plan.protocol !== 1 || !/^[0-9a-f-]{36}$/.test(plan.id) || !Number.isFinite(Date.parse(plan.createdAt)) ||
      !['prepared', 'preparing', 'retired', 'stopped', 'configured', 'started', 'complete'].includes(plan.phase) ||
      !path.isAbsolute(plan.before?.instanceHome ?? '') || plan.after?.instanceHome !== plan.before.instanceHome ||
      plan.before.scope !== 'user' || plan.after.scope !== 'user' ||
      !path.isAbsolute(plan.unit?.file ?? '') || typeof plan.unit.before !== 'string' || typeof plan.unit.after !== 'string' ||
      !/^[a-f0-9]{64}$/.test(plan.backend?.runtime ?? '') || !Number.isSafeInteger(plan.backend.pid) || plan.backend.pid < 1 ||
      !path.isAbsolute(plan.backend.control ?? '') || !path.isAbsolute(plan.backend.socket ?? '') ||
      !plan.owner?.id || !Number.isSafeInteger(plan.owner.pid) || plan.owner.pid < 1 || !/^[a-f0-9]{64}$/.test(plan.owner.inventory ?? '') ||
      !Number.isSafeInteger(plan.guardianPid) || plan.guardianPid < 1 ||
      (plan.checkpoint !== undefined && !path.isAbsolute(plan.checkpoint)) ||
      hash({ ...plan.before, backend: plan.after.backend }) !== hash(plan.after) ||
      plan.before.backend.label !== plan.after.backend.label || plan.before.backend.unit !== plan.after.backend.unit) {
    throw new Error('Invalid supervisor transition record');
  }
  if (path.resolve(file) !== path.join(plan.before.instanceHome, 'runtime', `supervisor-transition-${plan.id}.json`)) {
    throw new Error('Supervisor transition record is outside its instance');
  }
  return plan;
}

/** Install a management artifact and save a reviewable plan; running services are untouched. */
export async function prepareSupervisorTransition(directory: string, socket?: string): Promise<{ file: string; plan: ReturnType<typeof summarize> }> {
  const client = createDaemonClient(socket, 15_000);
  let controlAddress: { socket: string };
  let backendPid: number;
  try {
    backendPid = (await client.ping()).pid;
    controlAddress = await (await client.service<BackendRpcService>('OmnitronBackend')).controlAddress();
  }
  finally { await client.disconnect(); }
  const control = await privateControlClient<BackendControlService>(controlAddress.socket, 'OmnitronBackendControl');
  let installation: RuntimeInstallation | null = null;
  try {
    const current = await control.service.status();
    const config = await readManagedRuntime(current.instanceHome);
    if (!config || config.scope !== 'user') throw new Error('Automatic guardian replacement requires independent user services; system units require a separately reviewed administrator transition');
    if (path.dirname(controlAddress.socket) !== config.directory || !current.runtime.owner || current.retired || current.ticketId) {
      throw new Error('The backend is not ready for a guardian transition in this instance');
    }
    const guardianPid = await managedJobPid(config, 'backend');
    await verifyManagedIsolation(config, current.runtime.owner.pid, guardianPid);
    const file = await unitFile(config);
    installation = await RuntimeInstallation.open(config.instanceHome, { existing: true });
    if (!installation) throw new Error('No permanent installation exists');
    return await installation.exclusive(async () => {
      if (installation!.activation()) throw new Error('Finish the pending backend activation first');
      const selected = installation!.selection();
      const running = await checkBackendCandidate(path.dirname(path.dirname(current.entry)));
      if (selected?.current !== running.runtimeHash) throw new Error('Running backend does not match the startup selection');
      const candidate = await installation!.install(path.resolve(directory));
      await fs.access(path.join(candidate.directory, 'daemon/managed-entry.js'));
      await fs.access(path.join(candidate.directory, 'daemon/backend-supervisor-entry.js'));
      const view = await inventory(config);
      const after: ManagedRuntime = { ...config, backend: { ...config.backend, artifact: candidate.runtimeHash } };
      const inputs = { scope: 'user' as const, execPath: candidate.execPath,
        entryPath: path.join(candidate.directory, 'daemon/managed-entry.js'), nodeArgs: [], args: ['backend'],
        workdir: path.dirname(candidate.directory), path: config.environment['PATH'] ?? process.env['PATH'] ?? '/usr/bin:/bin',
        environment: { OMNITRON_HOME: config.instanceHome }, label: config.backend.label,
        stderrLog: path.join(config.directory, 'supervisor.log') };
      const plan: SupervisorTransition = { protocol: 1, id: randomUUID(), phase: 'prepared', createdAt: new Date().toISOString(),
        before: config, after, unit: { file, before: await fs.readFile(file, 'utf8'), after: process.platform === 'darwin' ? renderLaunchdPlist(inputs) : renderSystemdUnit(inputs) },
        backend: { runtime: running.runtimeHash, pid: backendPid, control: controlAddress.socket, socket: (await readCertificateSocket(config, backendPid)) },
        owner: { id: view.status.owner.id, pid: view.status.owner.pid, inventory: view.inventoryDigest }, guardianPid };
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

function summarize(plan: SupervisorTransition) {
  return { id: plan.id, phase: plan.phase, instanceHome: plan.before.instanceHome,
    from: plan.before.backend.artifact, to: plan.after.backend.artifact, backendRuntime: plan.backend.runtime,
    ownerPid: plan.owner.pid, backendPid: plan.backend.pid, guardianPid: plan.guardianPid,
    unit: plan.unit.file, checkpoint: plan.checkpoint ?? null, result: plan.result ?? null };
}

/** Resume a private plan. Only the backend OS job is stopped; its owner is never signalled. */
export async function applySupervisorTransition(file: string) {
  file = path.resolve(file);
  let plan = await readPlan(file);
  if (plan.phase === 'complete') return summarize(plan);
  const installation = await RuntimeInstallation.open(plan.before.instanceHome, { existing: true });
  if (!installation) throw new Error('No permanent installation exists');
  try {
    await installation.exclusive(async () => {
      plan = await readPlan(file);
      if (plan.phase === 'complete') return;
      const active = await readManagedRuntime(plan.before.instanceHome);
      if (hash(active) !== hash(plan.before) && hash(active) !== hash(plan.after)) throw new Error('Supervision configuration changed since preparation');
      await installation.artifact(plan.backend.runtime);
      await installation.artifact(plan.after.backend.artifact);
      if (installation.selection()?.current !== plan.backend.runtime) throw new Error('Backend selection changed since preparation');
      assertSameOwner(plan, await inventory(plan.before));
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
          plan.phase = 'preparing'; await writePrivateRecord(file, plan);
          const prepared = state.ticketId ? { ticketId: state.ticketId, file: path.join(plan.before.directory, `handoff-${state.ticketId}.json`) }
            : await control.service.prepare({ candidateId: plan.id });
          const record = await readBackendBootRecord(prepared.file);
          if (record.state.ticket.to.controllerId !== plan.id || record.previousPid !== plan.backend.pid) throw new Error('Another handoff owns the backend');
          plan.checkpoint = prepared.file; await writePrivateRecord(file, plan);
          const activation = installation.activation();
          if (activation && (activation.checkpoint !== prepared.file || activation.candidate !== plan.backend.runtime || activation.previous !== plan.backend.runtime)) {
            throw new Error('Another runtime activation is in progress');
          }
          if (!activation) installation.beginActivation(plan.backend.runtime, plan.backend.runtime, prepared.file);
          await control.service.retire({ ticketId: prepared.ticketId });
          plan.phase = 'retired'; await writePrivateRecord(file, plan);
        } finally { await control.close(); }
      }
      if (plan.phase === 'retired') {
        // After a crash during bootout, both recorded processes may already be gone.
        if (PidManager.isProcessAlive(plan.guardianPid)) {
          if (await managedJobPid(plan.before, 'backend') !== plan.guardianPid) throw new Error('A different guardian now owns the OS job');
          if (process.platform === 'darwin') await native('/bin/launchctl', ['bootout', `${domain()}/${plan.before.backend.label}`]);
          else await native('systemctl', ['--user', 'stop', plan.before.backend.unit]);
        }
        const stoppedBy = Date.now() + 35_000;
        while ((PidManager.isProcessAlive(plan.guardianPid) || PidManager.isProcessAlive(plan.backend.pid)) && Date.now() < stoppedBy) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (PidManager.isProcessAlive(plan.guardianPid) || PidManager.isProcessAlive(plan.backend.pid)) throw new Error('Old guardian/backend still exists; no replacement will be started');
        assertSameOwner(plan, await inventory(plan.before));
        plan.phase = 'stopped'; await writePrivateRecord(file, plan);
      }
      if (plan.phase === 'stopped') {
        await replaceUnit(plan.unit.file, [plan.unit.before, plan.unit.after], plan.unit.after);
        await writePrivateRecord(managedRuntimeFile(plan.before.instanceHome), plan.after);
        plan.phase = 'configured'; await writePrivateRecord(file, plan);
      }
      if (plan.phase === 'configured') {
        // Publish intent before bootstrapping. If the CLI dies, resume observes
        // the same job before deciding whether another start is necessary.
        plan.phase = 'started'; await writePrivateRecord(file, plan);
      }
    });
  } finally { await installation.close(); }
  plan = await readPlan(file);
  if (plan.phase === 'complete') return summarize(plan);
  // The installation lease is released before the new guardian recovers the backend.
  let guardianPid = await managedJobPid(plan.after, 'backend').catch(() => null);
  if (!guardianPid) {
    if (PidManager.isProcessAlive(plan.guardianPid) || PidManager.isProcessAlive(plan.backend.pid)) throw new Error('Recorded old processes still exist; refusing bootstrap');
    if (process.platform === 'darwin') await native('/bin/launchctl', ['bootstrap', domain(), plan.unit.file]);
    else { await native('systemctl', ['--user', 'daemon-reload']); await native('systemctl', ['--user', 'start', plan.after.backend.unit]); }
  }
  const client = createDaemonClient(plan.backend.socket, 4000);
  try {
    const until = Date.now() + 150_000;
    let reason = 'Guardian has not reported readiness';
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
        if (state.state === 'ready' && state.backendPid && state.backendPid !== plan.backend.pid && guardianPid) {
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
