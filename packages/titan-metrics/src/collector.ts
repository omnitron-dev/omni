/**
 * Titan Metrics — Process Metrics Collector
 *
 * Periodically pulls metrics from the current process and PM-supervised children.
 * Records samples into MetricsRegistry and a storage buffer.
 *
 * @module titan-metrics
 */

import type { IMetricsCollectionConfig, MetricSample } from './types.js';
import type { MetricsRegistry } from './registry.js';

// ---------------------------------------------------------------------------
// CPU delta tracker
// ---------------------------------------------------------------------------

interface CpuSnapshot {
  user: number;
  system: number;
  hrtime: [number, number];
}

function cpuPercentage(prev: CpuSnapshot, curr: CpuSnapshot): number {
  const elapsedUser = curr.user - prev.user;
  const elapsedSystem = curr.system - prev.system;
  const elapsedCpu = (elapsedUser + elapsedSystem) / 1e6; // µs → seconds
  const elapsedWall =
    (curr.hrtime[0] - prev.hrtime[0]) + (curr.hrtime[1] - prev.hrtime[1]) / 1e9;
  if (elapsedWall <= 0) return 0;
  return Math.min((elapsedCpu / elapsedWall) * 100, 100);
}

// ---------------------------------------------------------------------------
// Orchestrator metrics shape (loose type to avoid hard dep on omnitron)
// ---------------------------------------------------------------------------

interface OrchestratorLike {
  getMetrics?(): Promise<Array<{
    app: string;
    pid?: number;
    cpu?: number;
    memory?: number;
    requests?: number;
    errors?: number;
    status?: string;
    uptime?: number;
  }>>;
  /** Drain pre-built MetricSample[] from child processes (push-via-pull pattern) */
  drainChildSamples?(): Promise<Array<{ app: string; samples: MetricSample[] }>>;
}

// ---------------------------------------------------------------------------
// MetricsCollector
// ---------------------------------------------------------------------------

export class MetricsCollector {
  private timer: ReturnType<typeof setInterval> | null = null;
  private prevCpu: CpuSnapshot | null = null;
  private readonly buffer: MetricSample[] = [];

  constructor(
    private readonly registry: MetricsRegistry,
    private readonly appName: string,
    private readonly config: Required<IMetricsCollectionConfig>,
    private readonly orchestrator: OrchestratorLike | null,
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (!this.config.enabled || this.timer) return;
    // Initial snapshot for CPU delta
    const usage = process.cpuUsage();
    this.prevCpu = { user: usage.user, system: usage.system, hrtime: process.hrtime() };
    // First collection immediately
    void this.collect();
    this.timer = setInterval(() => void this.collect(), this.config.interval);
    // Ensure timer doesn't prevent exit
    if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Drain buffered samples (empties the buffer) */
  drain(): MetricSample[] {
    return this.buffer.splice(0);
  }

  /** Record an external metric sample into the drain buffer + registry. */
  record(sample: MetricSample): void {
    this.push(sample);
  }

  // -------------------------------------------------------------------------
  // Collection
  // -------------------------------------------------------------------------

  private async collect(): Promise<void> {
    const now = Date.now();

    if (this.config.process) {
      this.collectProcessMetrics(now);
    }
    if (this.config.system && this.orchestrator?.getMetrics) {
      await this.collectChildMetrics(now);
    }
    // Drain pre-built MetricSample[] from children (push-via-pull pattern)
    if (this.config.system && this.orchestrator?.drainChildSamples) {
      await this.collectChildSamples();
    }
  }

  // -------------------------------------------------------------------------
  // Daemon self-metrics
  // -------------------------------------------------------------------------

  private collectProcessMetrics(now: number): void {
    const labels = { app: this.appName, source: 'daemon' };

    // Memory
    const mem = process.memoryUsage();
    this.push({ name: 'heap_used_bytes', value: mem.heapUsed, timestamp: now, labels });
    this.push({ name: 'heap_total_bytes', value: mem.heapTotal, timestamp: now, labels });
    this.push({ name: 'rss_bytes', value: mem.rss, timestamp: now, labels });
    this.push({ name: 'external_bytes', value: mem.external, timestamp: now, labels });

    // CPU
    const usage = process.cpuUsage();
    const curr: CpuSnapshot = { user: usage.user, system: usage.system, hrtime: process.hrtime() };
    if (this.prevCpu) {
      const pct = cpuPercentage(this.prevCpu, curr);
      this.push({ name: 'cpu_percent', value: pct, timestamp: now, labels });
    }
    this.prevCpu = curr;

    // Event loop lag (rough estimate via setTimeout drift)
    // We don't measure here — that would require a separate timer. Instead the service
    // can call registry.gauge() from outside if it sets up an event-loop lag probe.

    // Uptime
    this.push({ name: 'uptime_seconds', value: process.uptime(), timestamp: now, labels });
  }

  // -------------------------------------------------------------------------
  // Child process metrics (via orchestrator)
  // -------------------------------------------------------------------------

  private async collectChildMetrics(now: number): Promise<void> {
    if (!this.orchestrator?.getMetrics) return;
    try {
      const children = await this.orchestrator.getMetrics();
      for (const child of children) {
        const labels: Record<string, string> = {
          app: child.app,
          source: 'child',
          ...(child.pid != null ? { pid: String(child.pid) } : {}),
        };
        if (child.cpu != null) {
          this.push({ name: 'cpu_percent', value: child.cpu, timestamp: now, labels });
        }
        if (child.memory != null) {
          this.push({ name: 'memory_bytes', value: child.memory, timestamp: now, labels });
        }
        if (child.requests != null) {
          this.push({ name: 'rpc_requests_total', value: child.requests, timestamp: now, labels });
        }
        if (child.errors != null) {
          this.push({ name: 'rpc_errors_total', value: child.errors, timestamp: now, labels });
        }
        if (child.status) {
          this.push({ name: 'app_status', value: child.status === 'online' ? 1 : 0, timestamp: now, labels });
        }
        if (child.uptime != null) {
          this.push({ name: 'uptime_seconds', value: child.uptime, timestamp: now, labels });
        }
      }
    } catch {
      // Orchestrator may not be available — silently skip
    }
  }

  // -------------------------------------------------------------------------
  // Child samples (push-via-pull — rich MetricSample[] from children)
  // -------------------------------------------------------------------------

  private async collectChildSamples(): Promise<void> {
    if (!this.orchestrator?.drainChildSamples) return;
    try {
      const batches = await this.orchestrator.drainChildSamples();
      for (const batch of batches) {
        for (const sample of batch.samples) {
          this.push(sample);
        }
      }
    } catch {
      // Child may not support drainChildSamples yet — silently skip
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private push(sample: MetricSample): void {
    this.registry.record(sample);
    this.buffer.push(sample);
  }
}
