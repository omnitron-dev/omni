import fs from 'node:fs/promises';
import path from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { Service, Public } from '@omnitron-dev/titan/decorators';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { ADMIN_ROLES } from '../shared/roles.js';
import { DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { readSavedDaemonConfig, savedDaemonOverrides } from '../commands/up.js';
import { expandPath } from '../shared/paths.js';
import { createDaemonClient } from './daemon-client.js';
import { PidManager } from './pid-manager.js';
import { ExecutionClient } from './execution-client.js';
import { RuntimeInstallation } from './runtime-installation.js';
import { ownBackendChildren } from './backend-child.js';
import { replaceBackend, recoverBackend, type BackendReplacementResult } from './backend-upgrade.js';
import { recoverBackendAfterCrash } from './backend-crash-recovery.js';
import { writePrivateRecord } from './execution-journal.js';
import { managedJobPid, verifyManagedIsolation, type ManagedRuntime } from './managed-runtime.js';
import type { BackendArtifact } from './backend-candidate.js';
import { checkBackendCandidate, verifyBackendEntry } from './backend-candidate.js';

export interface SupervisorStatus {
  pid: number;
  backendPid: number | null;
  ownerPid: number | null;
  state: 'starting' | 'ready' | 'recovering' | 'blocked' | 'stopping';
  reason: string | null;
  at: string;
}

/** Owns every backend generation inside the OS service; never owns applications. */
@Service({ name: 'OmnitronSupervisor' })
export class BackendSupervisorService {
  private busy = false;
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
  async status(): Promise<SupervisorStatus> { return { ...this.state }; }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async upgrade(data: { directory: string; checkOnly?: boolean; schemaPlan?: string }): Promise<BackendReplacementResult | { checked: true; build: BackendArtifact['build'] }> {
    if (!path.isAbsolute(data.directory)) throw new Error('An absolute installed candidate path is required');
    return this.exclusive(async () => {
      await this.isolation();
      const candidate = await checkBackendCandidate(data.directory);
      try { await fs.access(path.join(candidate.directory, 'daemon/managed-entry.js')); }
      catch { throw new Error('This candidate predates independent supervision and cannot replace an OS-managed backend'); }
      const result = await replaceBackend(data.directory, { socket: this.daemonConfig.socketPath, checkOnly: data.checkOnly === true,
        ...(data.schemaPlan ? { schemaPlan: data.schemaPlan } : {}) });
      if (!('checked' in result)) await this.ready(result.pid);
      return result;
    });
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async recover(data: { checkpoint?: string }): Promise<BackendReplacementResult> {
    return this.exclusive(async () => {
      await this.isolation();
      const result = data.checkpoint ? await recoverBackend(data.checkpoint) : await recoverBackendAfterCrash(this.config.directory);
      await this.ready(result.pid);
      return result;
    });
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.stopping || this.busy) throw new Error('The backend supervisor is busy; inspect its current state');
    this.busy = true;
    try { return await work(); }
    finally { this.busy = false; }
  }

  private async publish(state: SupervisorStatus['state'], reason: string | null): Promise<void> {
    this.state = { ...this.state, state, reason, at: new Date().toISOString() };
    await writePrivateRecord(path.join(this.config.directory, 'supervisor-state.json'), this.state);
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
    } finally { await output.close(); }
    this.observe(child);
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
    if (this.stopping || this.busy || Date.now() < this.nextAttempt) return;
    this.busy = true;
    try {
      const marker = new PidManager(expandPath(this.daemonConfig.pidFile));
      const pid = marker.getPid();
      const live = pid && marker.isRunning();
      if (live && this.children.has(pid)) {
        await this.isolation();
        if (this.state.state !== 'ready' || this.state.backendPid !== pid) await this.ready(pid);
        return;
      }
      if (live || this.children.size) throw new Error('A backend process still exists without verified readiness; no concurrent backend will be started');
      if (this.lastExit?.code === 0 && !new PidManager(path.join(this.config.directory, 'owner.pid')).isRunning()) {
        await this.publish('stopping', 'Backend and owner stopped'); this.stopping = true; this.finish(0); return;
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
      if (reason !== this.state.reason) process.stderr.write(`Backend supervisor: ${reason}\n`);
      await this.publish('blocked', reason).catch(failure => { process.stderr.write(`Cannot persist supervisor state: ${String(failure)}\n`); });
    } finally { this.busy = false; }
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
