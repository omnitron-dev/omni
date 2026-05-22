/**
 * AppHandle — Runtime handle for a managed application process
 *
 * Stores the PM supervisor (bootstrap mode) or raw ChildProcess (classic mode)
 * along with app-level metadata.
 */

import type { ChildProcess } from 'node:child_process';
import type { IProcessMetrics, IHealthStatus, IProcessPool } from '@omnitron-dev/titan-pm';
import type { ProcessSupervisor } from '@omnitron-dev/titan-pm';
import type { AppStatus, IEcosystemAppEntry, IProcessEntry } from '../config/types.js';
import type { ServiceRouter } from './service-router.js';

/**
 * Last-known exit context retained on the AppHandle after a child
 * dies. Pre-fix nothing about a crashed app was preserved past the
 * `IWorkerExitInfo` event emission — operators saw "errored" + PID=null
 * with zero hint at WHY. This struct fills the gap so `omnitron inspect`
 * + `omnitron logs --file` can answer the question.
 */
export interface LastExitInfo {
  /** ISO timestamp of the exit. */
  atIso: string;
  /** Process exit code (null when killed by signal). */
  code: number | null;
  /** Signal name (e.g. 'SIGKILL', 'SIGSEGV') when applicable. */
  signal: string | null;
  /** True for deliberate `terminate()` calls, false for crashes. */
  expected: boolean;
  /**
   * Last N (default 80) lines of stderr captured before the child
   * exited. The single most useful diagnostic — pre-fix this was
   * collected during `waitForReady` but discarded once the app
   * went online, and never written to disk.
   */
  stderrTail: string[];
  /**
   * Human-readable summary the supervisor produced for the
   * `child:crash` event (typically the underlying Error message).
   */
  message?: string;
}

export class AppHandle {
  public pid: number | null = null;
  public status: AppStatus = 'stopped';
  public startedAt: number = 0;
  public restarts: number = 0;
  public port: number | null = null;
  public lastMetrics: IProcessMetrics | null = null;
  public lastHealth: IHealthStatus | null = null;

  /** PM supervisor managing this app's processes (bootstrap mode) */
  public supervisor: ProcessSupervisor | null = null;

  /** The raw child_process.ChildProcess (classic mode only) */
  public childProcess: ChildProcess | null = null;

  /** Instance count for scaling */
  public instanceCount: number = 1;

  /** Netron-native service router for topology */
  public serviceRouter: ServiceRouter | null = null;

  /** Process topology entries from defineSystem() */
  public topologyProcesses: IProcessEntry[] | null = null;

  /**
   * Pool refs keyed by topology entry `name` (only for entries with
   * `instances > 1` — single-instance topology runs as a supervisor
   * child instead). Populated when the pool is created in
   * `OrchestratorService.startBootstrapApp`; consumed by `getInfo()`
   * so per-pool status reflects actual worker count instead of
   * defaulting to 'stopped' (supervisor knows nothing about pool
   * workers, so without this map the orchestrator would always
   * report pool-managed topology entries as stopped even when they
   * have N live workers).
   */
  public topologyPools: Map<string, IProcessPool<unknown>> = new Map();

  /** Timer for classic-mode crash restart backoff (cleared on explicit stop) */
  public crashRestartTimer: ReturnType<typeof setTimeout> | null = null;

  /** Stdout/stderr log buffer (ring buffer) */
  private logBuffer: string[] = [];
  private readonly maxLogLines = 1000;

  /**
   * Stderr-only ring buffer. Kept distinct from `logBuffer` so a
   * crash diagnosis is not drowned in stdout noise. Snapshotted
   * into `lastExit.stderrTail` on death.
   */
  private stderrRing: string[] = [];
  private readonly maxStderrLines = 80;

  /**
   * What happened the last time this app died. `null` between
   * a successful start and the next exit. Set by `recordExit()`.
   */
  public lastExit: LastExitInfo | null = null;

  constructor(
    public readonly entry: IEcosystemAppEntry,
    public readonly mode: 'classic' | 'bootstrap'
  ) {}

  get name(): string {
    return this.entry.name;
  }

  get uptime(): number {
    if (this.status !== 'online' || !this.startedAt) return 0;
    return Date.now() - this.startedAt;
  }

  get cpu(): number {
    return this.lastMetrics?.cpu ?? 0;
  }

  get memory(): number {
    return this.lastMetrics?.memory ?? 0;
  }

  appendLog(line: string): void {
    this.logBuffer.push(line);
    if (this.logBuffer.length > this.maxLogLines) {
      this.logBuffer.shift();
    }
  }

  /**
   * Append a stderr line into the crash-diagnosis ring. Cheap +
   * bounded — the orchestrator's log-capture hook calls this for
   * every line tagged `stream='stderr'` regardless of how the app
   * is faring.
   */
  appendStderr(line: string): void {
    this.stderrRing.push(line);
    if (this.stderrRing.length > this.maxStderrLines) {
      this.stderrRing.shift();
    }
  }

  getLogs(lines?: number): string[] {
    if (!lines) return [...this.logBuffer];
    return this.logBuffer.slice(-lines);
  }

  /**
   * Snapshot the current stderr tail and persist it alongside the
   * exit metadata. Called from the orchestrator's exit hook so the
   * info survives past the WorkerHandle being GC'd.
   */
  recordExit(info: {
    code: number | null;
    signal: NodeJS.Signals | string | null;
    expected: boolean;
    message?: string;
  }): void {
    this.lastExit = {
      atIso: new Date().toISOString(),
      code: info.code,
      signal: info.signal === null ? null : String(info.signal),
      expected: info.expected,
      stderrTail: [...this.stderrRing],
      ...(info.message !== undefined && { message: info.message }),
    };
  }

  /** Drop the lastExit context — called once the app comes back online. */
  clearLastExit(): void {
    this.lastExit = null;
    this.stderrRing = [];
  }

  markStarting(): void {
    this.status = 'starting';
    this.startedAt = Date.now();
  }

  markOnline(pid: number): void {
    this.status = 'online';
    this.pid = pid;
  }

  markStopping(): void {
    this.status = 'stopping';
  }

  markStopped(): void {
    this.status = 'stopped';
    this.pid = null;
    this.childProcess = null;
    this.supervisor = null;
    if (this.crashRestartTimer) {
      clearTimeout(this.crashRestartTimer);
      this.crashRestartTimer = null;
    }
  }

  markErrored(): void {
    this.status = 'errored';
  }

  markCrashed(): void {
    this.status = 'crashed';
    this.restarts++;
  }
}
