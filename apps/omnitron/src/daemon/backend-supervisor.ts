import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { fork, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Service, Public } from '@omnitron-dev/titan/decorators';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { ADMIN_ROLES } from '../shared/roles.js';
import { DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { readSavedDaemonConfig, savedDaemonOverrides } from '../config/saved.js';
import { expandPath } from '../shared/paths.js';
import { createDaemonClient } from './daemon-client.js';
import { PidManager } from './pid-manager.js';
import { ExecutionClient } from './execution-client.js';
import { RuntimeInstallation } from './runtime-installation.js';
import { ownBackendChildren } from './backend-child.js';
import { assertKernelHandoffFence, replaceBackend, recoverBackend, type KernelHandoffFence, type BackendReplacementResult } from './backend-upgrade.js';
import { recoverBackendAfterCrash } from './backend-crash-recovery.js';
import { readPrivateRecord, writePrivateRecord } from './execution-journal.js';
import { managedJobPid, verifyManagedIsolation, hostBootIdentity, type ManagedRuntime } from './managed-runtime.js';
import type { BackendArtifact } from './backend-candidate.js';
import { checkBackendCandidate, verifyBackendEntry } from './backend-candidate.js';
import { recoverReviewedBackend } from './reviewed-backend-recovery.js';

export interface SupervisorStatus {
  kernelHandoff?: 1;
  migrationChecksumMetadata?: 1;
  infrastructureAdoptionPreflight?: 1;
  reviewedRecovery?: 1;
  operationPending?: boolean;
  pid: number;
  backendPid: number | null;
  ownerPid: number | null;
  state: 'starting' | 'ready' | 'recovering' | 'blocked' | 'stopping';
  reason: string | null;
  persistenceError?: string;
  at: string;
}

/** Owns every backend generation inside the OS service; never owns applications. */
@Service({ name: 'OmnitronSupervisor' })
export class BackendSupervisorService {
  private busy = false;
  private operationClaimed = false;
  private inspection: Promise<void> | null = null;
  private stopping = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly children = new Map<number, ChildProcess>();
  private detach: (() => void) | null = null;
  private readonly daemonConfig = { ...DEFAULT_DAEMON_CONFIG, ...savedDaemonOverrides(readSavedDaemonConfig()) };
  private state: SupervisorStatus = { pid: process.pid, backendPid: null, ownerPid: null, state: 'starting', reason: null, at: new Date().toISOString() };
  private nextAttempt = 0;
  private failures = 0;
  private lastExit: { code: number | null; signal: string | null } | null = null;

  constructor(private readonly config: ManagedRuntime, private readonly finish: (code: number) => void) {}

  private observe(child: ChildProcess): void {
    this.children.set(child.pid!, child);
    child.once('exit', (code, signal) => {
      this.children.delete(child.pid!);
      if (this.state.backendPid === child.pid && !this.stopping) {
        this.lastExit = { code, signal };
        this.state = { ...this.state, state: 'recovering', reason: `Backend exited (${signal ?? code})` };
      }
    });
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async status(): Promise<SupervisorStatus> {
    return { ...this.state, kernelHandoff: 1, migrationChecksumMetadata: 1, infrastructureAdoptionPreflight: 1, reviewedRecovery: 1,
      operationPending: this.operationClaimed || (this.busy && !this.inspection) };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async upgrade(data: { directory: string; checkOnly?: boolean; schemaPlan?: string }): Promise<BackendReplacementResult | { checked: true; build: BackendArtifact['build'] }> {
    return this.replace(data);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async upgradeIfCurrent(fence: KernelHandoffFence): Promise<BackendReplacementResult | { checked: true; build: BackendArtifact['build'] }> {
    assertKernelHandoffFence(fence);
    return this.replace({ directory: path.join(this.config.instanceHome, 'runtime/releases', fence.candidate, 'packages/0/dist'), fence });
  }

  private async replace(data: { directory: string; checkOnly?: boolean; schemaPlan?: string; fence?: KernelHandoffFence }): Promise<BackendReplacementResult | { checked: true; build: BackendArtifact['build'] }> {
    if (!path.isAbsolute(data.directory)) throw new Error('An absolute installed candidate path is required');
    return this.exclusive(async () => {
      await this.assertNoReviewedRecovery();
      await this.isolation();
      const candidate = await checkBackendCandidate(data.directory);
      try { await fs.access(path.join(candidate.directory, 'daemon/managed-entry.js')); }
      catch { throw new Error('This candidate predates independent supervision and cannot replace an OS-managed backend'); }
      const result = await replaceBackend(data.directory, { socket: this.daemonConfig.socketPath, checkOnly: data.checkOnly === true,
        ...(data.fence ? { fence: data.fence } : {}),
        ...(data.schemaPlan ? { schemaPlan: data.schemaPlan } : {}) });
      if (!('checked' in result)) await this.ready(result.pid);
      return result;
    });
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async recover(data: { checkpoint?: string }): Promise<BackendReplacementResult> {
    return this.exclusive(async () => {
      await this.assertNoReviewedRecovery();
      await this.isolation();
      const result = data.checkpoint ? await recoverBackend(data.checkpoint) : await recoverBackendAfterCrash(this.config.directory);
      await this.ready(result.pid);
      return result;
    });
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async recoverReviewed(data: { plan: string; sha256: string }): Promise<BackendReplacementResult> {
    return this.exclusive(async () => {
      await this.isolation();
      try {
        const result = await recoverReviewedBackend(this.config, data);
        await this.ready(result.pid);
        return result;
      } catch (error) {
        try { await this.publish('blocked', 'Reviewed recovery did not complete; inspect its held activation and private checkpoint'); }
        catch (persistence) { throw new AggregateError([error, persistence],
          `Reviewed recovery and guardian status persistence failed: ${error instanceof Error ? error.message : String(error)}; ${String(persistence)}`, { cause: persistence }); }
        throw error;
      }
    });
  }

  private async reviewedRecoveryHold() {
    const installation = await RuntimeInstallation.openReadOnly(this.config.instanceHome);
    try { return installation?.activation()?.reviewedRecovery ?? null; }
    finally { await installation?.close(); }
  }

  private async assertNoReviewedRecovery(): Promise<void> {
    const hold = await this.reviewedRecoveryHold();
    if (hold) throw Error(`Backend recovery is held for reviewed plan ${hold.planId}; ordinary recovery and upgrade are refused`);
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const inspection = this.inspection;
    if (this.stopping || this.operationClaimed || (this.busy && !inspection)) throw new Error('The backend supervisor is busy; inspect its current state');
    // Reserve exactly one command before yielding. A periodic health observation
    // may finish, but another command or a recovery operation is never queued.
    this.operationClaimed = true;
    try {
      if (inspection) {
        const timer = new AbortController();
        try {
          await Promise.race([inspection, delay(10_000, undefined, { signal: timer.signal, ref: false }).then(() => {
            throw new Error('Supervisor health inspection did not finish within 10 seconds; the requested operation was not started');
          })]);
        } finally { timer.abort(); }
      }
      if (this.stopping || this.busy) throw new Error('The backend supervisor is busy; inspect its current state');
      this.busy = true;
      try { return await work(); }
      finally { this.busy = false; }
    } finally { this.operationClaimed = false; }
  }

  private async publish(state: SupervisorStatus['state'], reason: string | null): Promise<void> {
    this.state = { ...this.state, state, reason, at: new Date().toISOString() };
    const { persistenceError: _previousFailure, ...next } = this.state;
    await writePrivateRecord(path.join(this.config.directory, 'supervisor-state.json'), next);
    this.state = next;
  }

  private reportFailure(message: string): void {
    try { process.stderr.write(message + '\n'); }
    catch { /* The private status still exposes the failure when the output disk is also full. */ }
  }

  private async isolation(): Promise<void> {
    const marker = new PidManager(path.join(this.config.directory, 'owner.pid'));
    const owner = marker.getPid();
    if (!owner || !marker.isRunning()) throw new Error('The execution owner is unavailable. Application ownership requires reconciliation; backend recovery will not start another owner.');
    await verifyManagedIsolation(this.config, owner, process.pid);
    this.state.ownerPid = owner;
  }

  private async ready(pid: number): Promise<void> {
    if (!this.children.has(pid)) throw new Error('The active backend was not spawned by this supervisor');
    const client = createDaemonClient(this.daemonConfig.socketPath, 4000);
    try {
      if ((await client.ping()).pid !== pid) throw new Error('Backend readiness identity disagrees with its owned process');
    } finally { await client.disconnect(); }
    this.state.backendPid = pid;
    this.lastExit = null;
    this.failures = 0;
    this.nextAttempt = 0;
    await this.publish('ready', null);
  }

  private async coldStart(artifact: BackendArtifact): Promise<void> {
    await verifyBackendEntry(artifact);
    const output = await fs.open(path.join(this.config.directory, 'backend-startup.log'), 'a', 0o600);
    let child: ChildProcess;
    try {
      child = fork(artifact.entry, [], { execPath: artifact.execPath, cwd: path.dirname(artifact.directory),
        detached: false, execArgv: ['--import', 'tsx/esm'],
        env: { ...process.env, ...this.config.environment, OMNITRON_CWD: this.config.cwd }, stdio: ['ignore', output.fd, output.fd, 'ipc'] });
      await once(child, 'spawn');
      this.observe(child);
    } finally { await output.close(); }
    const client = createDaemonClient(this.daemonConfig.socketPath, 4000);
    const until = Date.now() + 120_000;
    try {
      while (Date.now() < until) {
        if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Backend startup exited (${child.signalCode ?? child.exitCode}); inspect backend-startup.log`);
        try {
          const status = await client.status();
          if (status.pid !== child.pid) throw new Error('Another backend owns the public listener');
          await this.ready(child.pid!); return;
        } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
      }
      throw new Error('Backend startup did not become ready within 120 seconds; the owned process remains observable and is not duplicated');
    } finally { await client.disconnect(); }
  }

  async start(): Promise<void> {
    if (await managedJobPid(this.config, 'backend') !== process.pid) throw new Error('The guardian must be the configured OS service main process');
    this.detach = ownBackendChildren(child => { this.observe(child); });
    // Keep the guardian alive after recoverable failure so its private status
    // remains available. Backoff is bounded; uncertain ownership is never reset.
    await this.tick();
    if (!this.stopping) this.timer = setInterval(() => { void this.tick(); }, 5000);
  }

  private async tick(): Promise<void> {
    if (this.stopping || this.busy || this.operationClaimed || Date.now() < this.nextAttempt) return;
    this.busy = true;
    let finishInspection: (() => void) | undefined;
    // Reading the durable hold and publishing its status are observations too.
    // Reserve this phase before its first await so one command can wait for it.
    this.inspection = new Promise<void>(resolve => { finishInspection = resolve; });
    try {
      const hold = await this.reviewedRecoveryHold();
      if (hold) {
        await this.publish('blocked', `Pending reviewed recovery ${hold.planId} (${hold.phase}); automatic recovery is disabled`);
        return;
      }
      const marker = new PidManager(expandPath(this.daemonConfig.pidFile));
      const pid = marker.getPid();
      const live = pid && marker.isRunning();
      if (live && this.children.has(pid)) {
        await this.isolation();
        if (this.state.state !== 'ready' || this.state.backendPid !== pid) await this.ready(pid);
        return;
      }
      if (live || this.children.size) throw new Error('A backend process still exists without verified readiness; no concurrent backend will be started');
      // A reserved operator command wins before any automatic lifecycle effect.
      // Otherwise promote this tick synchronously: commands cannot queue behind
      // recovery or shutdown once this observation has become a mutation.
      if (this.stopping || this.operationClaimed) return;
      this.inspection = null;
      if (this.lastExit?.code === 0 && !new PidManager(path.join(this.config.directory, 'owner.pid')).isRunning()) {
        const receipt = await readPrivateRecord<{ clean?: boolean; pid?: number; bootId?: string }>(path.join(this.config.directory, 'managed-owner.json'));
        if (!receipt || receipt.clean !== true || !this.state.ownerPid || receipt.pid !== this.state.ownerPid
          || receipt.bootId !== await hostBootIdentity()) {
          throw new Error('Execution owner stopped without a verified clean shutdown receipt; recovery requires reconciliation of surviving applications. No owner or backend will be started automatically.');
        }
        await this.publish('stopping', 'Backend and owner stopped with a verified clean shutdown receipt'); this.stopping = true; this.finish(0); return;
      }
      await this.isolation();
      const installation = await RuntimeInstallation.open(this.config.instanceHome, { existing: true });
      if (!installation) throw new Error('No permanent runtime is installed');
      let artifact: BackendArtifact;
      let checkpoint: string | undefined;
      try {
        checkpoint = installation.activation()?.checkpoint;
        const selection = installation.selection();
        if (!selection) throw new Error('No backend runtime is selected');
        artifact = await installation.artifact(selection.current);
      } finally { await installation.close(); }
      await this.publish('recovering', checkpoint ? 'Reconciling an interrupted activation' : 'Checking resident ownership');
      if (checkpoint) { await this.ready((await recoverBackend(checkpoint)).pid); return; }
      const observer = new ExecutionClient(path.join(this.config.directory, 'owner.sock'), createNullLogger());
      let unclaimed = false;
      try {
        const snapshot = await observer.connect();
        unclaimed = snapshot.status.controller.controllerId === 'unclaimed' && snapshot.apps.length === 0;
      } finally { await observer.close(); }
      if (unclaimed) await this.coldStart(artifact);
      else await this.ready((await recoverBackendAfterCrash(this.config.directory)).pid);
    } catch (error) {
      this.failures++;
      this.nextAttempt = Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(5, this.failures));
      const reason = error instanceof Error ? error.message : String(error);
      if (reason !== this.state.reason) this.reportFailure(`Backend supervisor: ${reason}`);
      await this.publish('blocked', reason).catch(failure => {
        this.state.persistenceError = String(failure).slice(0, 512);
        this.reportFailure(`Cannot persist supervisor state: ${this.state.persistenceError}`);
      });
    } finally {
      this.busy = false;
      this.inspection = null;
      finishInspection?.();
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.publish('stopping', 'OS service requested shutdown');
    this.detach?.();
    for (const child of this.children.values()) child.kill('SIGTERM');
    // The OS service owns only these backend children. Its ordinary timeout
    // cannot kill the independently supervised execution owner.
    const until = Date.now() + 25_000;
    while (this.children.size && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100));
  }
}
