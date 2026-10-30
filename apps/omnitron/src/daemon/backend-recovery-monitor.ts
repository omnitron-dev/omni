import type { BackendArtifact } from './backend-candidate.js';
import { BackendRecoveryJournal, type BackendRecoveryRecord } from './backend-recovery-journal.js';
import { recoveryState, RecoveryBusyError } from './recovery-state.js';
import type { ExecutionClient } from './execution-client.js';
import type { IEcosystemConfig, IDaemonConfig } from '../config/types.js';
import type { ProjectService } from '../services/project.service.js';
import type { InfrastructureService } from '../infrastructure/infrastructure.service.js';
import { runtimeDiagnostics } from '../monitoring/runtime-diagnostics.js';
import { OMNITRON_HOME } from '../config/defaults.js';

/** Certify quiet controller state without draining public ingress or Docker. */
export class BackendRecoveryMonitor {
  private readonly journal: BackendRecoveryJournal;
  private readonly detach: () => void;
  private readonly startedAt = new Date().toISOString();
  private timer: NodeJS.Timeout | null = null;
  private capturing = false;
  private closed = false;
  private lastRecord: string | null = null;
  private state: { status: 'pending' | 'ready' | 'unavailable'; at: string | null; reason: string | null } = {
    status: 'pending', at: null, reason: 'Waiting for a stable ownership snapshot',
  };

  constructor(directory: string, private readonly artifact: BackendArtifact,
    private readonly config: IDaemonConfig, private readonly execution: ExecutionClient,
    private readonly snapshot: () => { watchConfig: IEcosystemConfig; projects: ProjectService; infrastructure: InfrastructureService | null },
  ) {
    this.journal = new BackendRecoveryJournal(directory);
    this.detach = recoveryState.attach(reason => {
      this.journal.invalidate(reason);
      this.lastRecord = null;
      this.state = { ...this.state, status: 'pending', reason: `Ownership mutation: ${reason}` };
    });
  }

  status() { return { ...this.state }; }

  async start(): Promise<void> {
    await this.capture();
    if (this.closed) return;
    this.timer = setInterval(() => { void this.capture(); }, 5000);
    this.timer.unref();
  }

  async capture(): Promise<void> {
    if (this.closed || this.capturing) return;
    const token = recoveryState.token();
    if (token === null) return;
    this.capturing = true;
    try {
      const owner = await this.execution.recoverySnapshot();
      if (owner.status.phase !== 'active' || owner.status.inFlight !== 0) throw new RecoveryBusyError('Execution mutations have not settled');
      const source = this.snapshot();
      const record: BackendRecoveryRecord = {
        protocol: 1, state: { protocol: 1, watchConfig: structuredClone(source.watchConfig),
          projects: source.projects.captureRecoveryState(), infrastructure: source.infrastructure?.captureRecoveryState() ?? null,
          executionInventory: owner.inventoryDigest },
        controller: owner.status.controller, runtimeHash: this.artifact.runtimeHash,
        registryDigest: source.projects.recoveryRegistryDigest(),
        daemonConfig: this.config, previousEntry: this.artifact.entry, previousPid: process.pid,
        createdAt: this.startedAt, cwd: process.cwd(),
        environment: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), OMNITRON_HOME },
      };
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
        if (error instanceof RecoveryBusyError) return;
        runtimeDiagnostics.record({ id: 'execution.recovery-checkpoint', severity: 'warning',
          title: 'A current automatic backend recovery checkpoint is unavailable', evidence: [this.state.reason!],
          remedy: 'Inspect ownership operations and the private recovery journal. Applications remain with their execution owner.' });
      }
    } finally { this.capturing = false; }
  }

  async close(invalidate: boolean): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (invalidate) this.journal.invalidate('Explicit application shutdown or backend replacement');
    this.detach();
    await this.journal.close();
  }
}
