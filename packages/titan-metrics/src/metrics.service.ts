/**
 * Titan Metrics — Main Service
 *
 * Composes MetricsRegistry, MetricsCollector, and IMetricsStorage into
 * a single injectable service implementing IMetricsService.
 *
 * @module titan-metrics
 */

import type {
  IMetricsService,
  IMetricsModuleOptions,
  IMetricsStorage,
  IMetricsCollectionConfig,
  IMetricsSyncConfig,
  MetricSample,
  MetricsSnapshot,
  MetricsQueryFilter,
  MetricsTimeSeries,
} from './types.js';
import { MetricsRegistry } from './registry.js';
import { MetricsCollector } from './collector.js';
import { parseMaxAge } from './storage.js';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_COLLECTION: Required<IMetricsCollectionConfig> = {
  enabled: true,
  interval: 5_000,
  process: true,
  system: true,
  rpc: true,
  custom: true,
};

const DEFAULT_MAX_AGE = '7d';
const DEFAULT_CLEANUP_INTERVAL = 3_600_000; // 1h
const DEFAULT_FLUSH_INTERVAL = 5_000;
const DEFAULT_BATCH_SIZE = 200;

// ---------------------------------------------------------------------------
// MetricsService
// ---------------------------------------------------------------------------

export class MetricsService implements IMetricsService {
  private readonly registry: MetricsRegistry;
  private readonly collector: MetricsCollector | null;
  private readonly storage: IMetricsStorage;
  private readonly syncConfig: IMetricsSyncConfig | undefined;
  private readonly maxAgeMs: number;
  private readonly batchSize: number;

  private storageBuffer: MetricSample[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private started = false;

  constructor(
    options: IMetricsModuleOptions,
    storage: IMetricsStorage,
    orchestrator?: unknown,
  ) {
    this.registry = new MetricsRegistry();
    this.storage = storage;
    this.syncConfig = options.sync;
    this.maxAgeMs = parseMaxAge(options.retention?.maxAge ?? DEFAULT_MAX_AGE);
    this.batchSize = options.storage?.batchSize ?? DEFAULT_BATCH_SIZE;

    // Build collection config with defaults
    const collConfig: Required<IMetricsCollectionConfig> = {
      ...DEFAULT_COLLECTION,
      ...options.collection,
    };

    if (collConfig.enabled) {
      this.collector = new MetricsCollector(
        this.registry,
        options.appName,
        collConfig,
        orchestrator as Parameters<typeof MetricsCollector extends new (...a: infer P) => unknown ? (...a: P) => void : never>[3] ?? null,
      );
    } else {
      this.collector = null;
    }
  }

  // -------------------------------------------------------------------------
  // IMetricsService
  // -------------------------------------------------------------------------

  record(sample: MetricSample): void {
    this.registry.record(sample);
    this.storageBuffer.push(sample);
    // Auto-flush when buffer is large
    if (this.storageBuffer.length >= this.batchSize) {
      void this.flush();
    }
  }

  recordBatch(samples: MetricSample[]): void {
    for (const s of samples) {
      this.registry.record(s);
    }
    this.storageBuffer.push(...samples);
    if (this.storageBuffer.length >= this.batchSize) {
      void this.flush();
    }
  }

  async getSnapshot(): Promise<MetricsSnapshot> {
    return this.storage.getLatest();
  }

  async querySeries(filter: MetricsQueryFilter): Promise<MetricsTimeSeries[]> {
    return this.storage.query(filter);
  }

  async getPrometheusText(): Promise<string> {
    return this.registry.toPrometheusText();
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    // Start collector
    this.collector?.start();

    // Start periodic flush
    const flushMs = DEFAULT_FLUSH_INTERVAL;
    this.flushTimer = setInterval(() => void this.flush(), flushMs);
    if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
      this.flushTimer.unref();
    }

    // Start periodic cleanup
    const cleanupMs = DEFAULT_CLEANUP_INTERVAL;
    this.cleanupTimer = setInterval(() => void this.cleanup(), cleanupMs);
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    this.collector?.stop();

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Drain collector buffer
    if (this.collector) {
      const collectorSamples = this.collector.drain();
      this.storageBuffer.push(...collectorSamples);
    }

    // Final flush
    await this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      // Drain collector buffer first
      if (this.collector) {
        const collectorSamples = this.collector.drain();
        this.storageBuffer.push(...collectorSamples);
      }

      if (this.storageBuffer.length === 0) return;

      const batch = this.storageBuffer.splice(0);
      await this.storage.write(batch);

      // Slave → master sync
      if (this.syncConfig?.enabled && this.syncConfig.onFlush) {
        try {
          await this.syncConfig.onFlush(batch);
        } catch {
          // Sync failure should not break local metrics
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  async cleanup(): Promise<void> {
    await this.storage.cleanup(this.maxAgeMs);
  }

  // -------------------------------------------------------------------------
  // Extra accessors (for module/decorator use)
  // -------------------------------------------------------------------------

  /** Direct access to the in-memory registry */
  getRegistry(): MetricsRegistry {
    return this.registry;
  }
}
