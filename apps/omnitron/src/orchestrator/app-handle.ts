/**
 * AppHandle — Runtime handle for a managed application process
 *
 * Stores the PM supervisor (bootstrap mode) or raw ChildProcess (classic mode)
 * along with app-level metadata.
 */

import type { ChildProcess } from 'node:child_process';
import type { IProcessMetrics, IHealthStatus } from '@omnitron-dev/titan-pm';
import type { ProcessSupervisor } from '@omnitron-dev/titan-pm';
import type { AppStatus, IEcosystemAppEntry, IProcessEntry } from '../config/types.js';
import type { ServiceRouter } from './service-router.js';

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

  /** Timer for classic-mode crash restart backoff (cleared on explicit stop) */
  public crashRestartTimer: ReturnType<typeof setTimeout> | null = null;

  /** Stdout/stderr log buffer (ring buffer) */
  private logBuffer: string[] = [];
  private readonly maxLogLines = 1000;

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

  getLogs(lines?: number): string[] {
    if (!lines) return [...this.logBuffer];
    return this.logBuffer.slice(-lines);
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
