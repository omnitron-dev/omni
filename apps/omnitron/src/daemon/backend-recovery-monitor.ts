import type { BackendArtifact } from './backend-candidate.js';
import { BackendRecoveryJournal, type BackendRecoveryRecord } from './backend-recovery-journal.js';
import { recoveryState, RecoveryBusyError } from './recovery-state.js';
import type { ExecutionClient } from './execution-client.js';
import type { IEcosystemConfig, IDaemonConfig } from '../config/types.js';
import type { ProjectService } from '../services/project.service.js';
import type { InfrastructureService } from '../infrastructure/infrastructure.service.js';
import { runtimeDiagnostics } from '../monitoring/runtime-diagnostics.js';
import { backendSnapshot } from './backend-handoff-types.js';
import type { ExecutionSnapshot } from './execution-host.js';

interface RecoverySource { watchConfig: IEcosystemConfig; projects: ProjectService; infrastructure: InfrastructureService | null }

/** Certify quiet controller state without draining public ingress or Docker. */
export class BackendRecoveryMonitor {
  private readonly journal: BackendRecoveryJournal;
  private readonly detach: () => void;
  private readonly startedAt = new Date().toISOString();
  private timer: NodeJS.Timeout | null = null;
  private busyRetry: NodeJS.Timeout | null = null;
  private capturePromise: Promise<void> | null = null;
  private closed = false;
  private lastRecord: string | null = null;
  private state: { status: 'pending' | 'ready' | 'unavailable'; at: string | null; reason: string | null } = {
    status: 'pending', at: null, reason: 'Waiting for a stable ownership snapshot',
  };

  constructor(directory: string, private readonly artifact: BackendArtifact,
    private readonly config: IDaemonConfig, private readonly execution: ExecutionClient,
    private readonly snapshot: () => RecoverySource,
  ) {
    this.journal = new BackendRecoveryJournal(directory);
    this.detach = recoveryState.attach(reason => {
      this.journal.invalidate(reason);
      this.lastRecord = null;
      this.state = { ...this.state, status: 'pending', reason: `Ownership mutation: ${reason}` };
    });
  }

  status() {
    const pending = recoveryState.pendingOperations();
    // A completed reconciler tick must not obscure a still-running backup.
    // This observation changes no journal or admission fence.
    if (this.state.status === 'pending' && pending.length) return { ...this.state,
      reason: `Waiting for ownership operations: ${pending.map(({ reason, count }) =>
        count > 1 ? `${reason} (${count})` : reason).join('; ')}` };
    return { ...this.state };
  }

  async start(): Promise<void> {
    await this.capture();
    if (this.closed) return;
    this.timer = setInterval(() => { void this.capture(); }, 5000);
    this.timer.unref();
  }

  capture(retryBusy = true): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.capturePromise) return this.capturePromise;
    const capture = this.captureOnce(retryBusy).finally(() => { if (this.capturePromise === capture) this.capturePromise = null; });
    this.capturePromise = capture;
    return capture;
  }

  /** Caller must bracket this read with the canonical ownership token and
   * controlled owner observations. It never publishes a ready certificate. */
  snapshotRecord(owner: ExecutionSnapshot, source: RecoverySource): BackendRecoveryRecord {
    if (this.closed || owner.status.phase !== 'active' || owner.status.inFlight !== 0)
      throw new RecoveryBusyError('Execution mutations have not settled');
    return { ...backendSnapshot({ protocol: 1, watchConfig: source.watchConfig,
      projects: source.projects.captureRecoveryState(), infrastructure: source.infrastructure?.captureRecoveryState() ?? null,
      executionInventory: owner.inventoryDigest }, this.config, this.artifact.entry, this.startedAt),
    controller: structuredClone(owner.status.controller), runtimeHash: this.artifact.runtimeHash,
    registryDigest: source.projects.recoveryRegistryDigest() };
  }

  private async captureOnce(retryBusy: boolean): Promise<void> {
    const token = recoveryState.token();
    if (token === null) return;
    try {
      const owner = await this.execution.recoverySnapshot();
      if (owner.status.phase !== 'active' || owner.status.inFlight !== 0) throw new RecoveryBusyError('Execution mutations have not settled');
      const record = this.snapshotRecord(owner, this.snapshot());
      if (this.closed || !recoveryState.unchanged(token)) return;
      const serialized = JSON.stringify(record);
      if (serialized !== this.lastRecord) {
        this.journal.publish(record);
        this.lastRecord = serialized;
      }
      this.state = { status: 'ready', at: new Date().toISOString(), reason: null };
      runtimeDiagnostics.resolve('execution.recovery-checkpoint');
    } catch (error) {
      if (!this.closed) {
        this.state = { ...this.state, status: error instanceof RecoveryBusyError ? 'pending' : 'unavailable', reason: error instanceof Error ? error.message : String(error) };
        if (error instanceof RecoveryBusyError) {
          // Sampling drains and this monitor can share a five-second period.
          // One offset retry avoids repeatedly observing the same brief mutation,
          // without polling a genuinely busy owner continuously or relaxing its fence.
          if (retryBusy && !this.busyRetry) {
            this.busyRetry = setTimeout(() => {
              this.busyRetry = null;
              void this.capture(false);
            }, 250);
            this.busyRetry.unref();
          }
          return;
        }
        runtimeDiagnostics.record({ id: 'execution.recovery-checkpoint', severity: 'warning',
          title: 'A current automatic backend recovery checkpoint is unavailable', evidence: [this.state.reason!],
          remedy: 'Inspect ownership operations and the private recovery journal. Applications remain with their execution owner.' });
      }
    }
  }

  async close(invalidate: boolean): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.busyRetry) clearTimeout(this.busyRetry);
    this.busyRetry = null;
    if (invalidate) this.journal.invalidate('Explicit application shutdown or backend replacement');
    this.detach();
    await this.journal.close();
  }
}
