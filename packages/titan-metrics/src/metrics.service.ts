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
  MetricsStorageStatus,
  MetricsWriteReceipt,
} from './types.js';
import { MetricsRegistry } from './registry.js';
import { MetricsCollector } from './collector.js';
import { parseMaxAge } from './storage.js';
import { prepareMetricSample } from './sql-storage.js';

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

/**
 * Live-app staleness window applied by `getSnapshot()`.
 *
 * Defaults to `max(3 × collection.interval, 30s)`. A heartbeat sample
 * (`app_status`) older than this means the orchestrator has stopped reporting
 * the app — we treat it as a ghost and drop it from the snapshot.
 *
 * 3× is the smallest multiplier that survives the normal flush/jitter:
 *   collector tick + flush interval + clock skew ≈ 2.x × interval worst case.
 */
const DEFAULT_STALE_MULTIPLIER = 3;
const MIN_STALE_MS = 30_000;

export class MetricsService implements IMetricsService {
  private readonly registry: MetricsRegistry;
  private readonly collector: MetricsCollector | null;
  private readonly storage: IMetricsStorage;
  private readonly syncConfig: IMetricsSyncConfig | undefined;
  private readonly maxAgeMs: number;
  private readonly flushIntervalMs: number;
  private readonly cleanupIntervalMs: number;
  private readonly batchSize: number;
  /** Pre-computed staleness window for `getSnapshot()`. */
  private readonly snapshotStaleAfterMs: number;

  private storageBuffer: MetricSample[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> | null = null;
  private readonly durableWrites = new Set<Promise<MetricsWriteReceipt>>();
  private readonly capacity: number;
  private readonly capacityBytes: number;
  private pendingBytes = 0;
  private readonly queuedMetadata = new Map<MetricSample, { at: number; bytes: number }>();
  private readonly onError: IMetricsModuleOptions['onError'];
  private queued = 0;
  private completed = 0;
  private dropped = 0;
  private failedWrites = 0;
  private writtenSamples = 0;
  private lastWriteAt: string | null = null;
  private lastError: string | null = null;
  private cleanupError: string | null = null;
  private syncError: string | null = null;
  private started = false;

  constructor(
    options: IMetricsModuleOptions,
    storage: IMetricsStorage,
    orchestrator?: unknown,
  ) {
    this.registry = new MetricsRegistry();
    this.storage = storage;
    this.capacity = options.storage?.maxBufferSize ?? 50_000;
    this.capacityBytes = options.storage?.maxBufferBytes ?? 16 * 1024 * 1024;
    this.onError = options.onError;
    if (!Number.isSafeInteger(this.capacity) || this.capacity < 1) throw new RangeError('Metrics maxBufferSize must be a positive integer');
    if (!Number.isSafeInteger(this.capacityBytes) || this.capacityBytes < 1) throw new RangeError('Metrics maxBufferBytes must be a positive integer');
    this.syncConfig = options.sync;
    this.maxAgeMs = parseMaxAge(options.retention?.maxAge ?? DEFAULT_MAX_AGE);
    this.batchSize = options.storage?.batchSize ?? DEFAULT_BATCH_SIZE;
    // Both intervals are declared options with documented defaults
    // (`storage.flushInterval` "default: 5000", `retention.cleanupInterval`
    // "default: 3600000 = 1h") and `start()` used the constants directly, so
    // neither could be tuned: a caller who set them got the defaults with no
    // sign that their value had been dropped.
    this.flushIntervalMs = options.storage?.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
    this.cleanupIntervalMs = options.retention?.cleanupInterval ?? DEFAULT_CLEANUP_INTERVAL;
    if ([this.batchSize, this.flushIntervalMs, this.cleanupIntervalMs, this.maxAgeMs].some(value => !Number.isSafeInteger(value) || value <= 0)) throw new RangeError('Metrics batch size, intervals and retention must be positive integers');

    // Build collection config with defaults
    const collConfig: Required<IMetricsCollectionConfig> = {
      ...DEFAULT_COLLECTION,
      ...options.collection,
    };

    this.snapshotStaleAfterMs = Math.max(
      collConfig.interval * DEFAULT_STALE_MULTIPLIER,
      MIN_STALE_MS,
    );

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
    this.enqueue([sample]);
    this.autoFlush();
  }

  recordBatch(samples: MetricSample[]): void {
    for (const s of samples) {
      this.registry.record(s);
    }
    this.enqueue(samples);
    this.autoFlush();
  }

  /**
   * T#74: typed record entry point — the SINGLE source of truth that
   * keeps the Prometheus exposition registry and the long-term
   * storage layer in sync. Pre-T#74, callers had two ways to
   * write metrics:
   *
   *   1. `metrics.record(sample)` — wrote to BOTH registry and
   *      storage. But the registry routes by previously-registered
   *      type, defaulting to gauge — wrong for counters and
   *      histograms unless someone else pre-registered them.
   *   2. `metrics.getRegistry().counter(...)` etc — wrote to ONLY
   *      the registry. The metrics-bridge used this path for
   *      ~20 omnitron_* metrics, which then appeared in
   *      `/metrics` (Prometheus) but were INVISIBLE to
   *      `querySeries()` (storage) — every dashboard query for
   *      them returned empty.
   *
   * The unified entry point takes an explicit type, writes to
   * the registry via the type-specific method (correct semantics
   * — counter increments, histogram observes, gauge sets), and
   * ALSO pushes the sample to the storage buffer.
   */
  recordTyped(
    type: 'counter' | 'gauge' | 'histogram',
    name: string,
    labels: Record<string, string>,
    value: number,
  ): void {
    switch (type) {
      case 'counter':
        this.registry.counter(name, labels, value);
        break;
      case 'histogram':
        this.registry.histogram(name, labels, value);
        break;
      case 'gauge':
      default:
        this.registry.gauge(name, labels, value);
        break;
    }
    this.enqueue([{ name, value, timestamp: Date.now(), labels }]);
    this.autoFlush();
  }

  async getSnapshot(): Promise<MetricsSnapshot> {
    return this.storage.getLatest(undefined, { staleAfterMs: this.snapshotStaleAfterMs });
  }

  async evictApp(app: string): Promise<void> {
    await this.flush();
    this.registry.evictApp(app);
    await this.storage.evictApp(app);
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
    const flushMs = this.flushIntervalMs;
    this.flushTimer = setInterval(() => { if (!this.flushing) void this.flush().catch(() => { /* reported in flush */ }); }, flushMs);
    if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
      this.flushTimer.unref();
    }

    // Start periodic cleanup
    const cleanupMs = this.cleanupIntervalMs;
    this.cleanupTimer = setInterval(() => { void this.cleanup().catch(() => { /* reported in cleanup */ }); }, cleanupMs);
    if (this.cleanupTimer && typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  async stop(): Promise<void> {
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
      this.enqueue(collectorSamples);
    }

    // Final flush
    await this.flush();
    await Promise.all(this.durableWrites);
  }

  async flush(): Promise<void> {
    if (this.collector) this.enqueue(this.collector.drain());
    const target = this.queued;
    if (this.flushing) await this.flushing;
    // Each caller waits for all samples accepted before its call, including a
    // previous writer. A boolean guard used to resolve while its write ran.
    while (this.completed < target) {
      if (!this.flushing) {
        const batch = this.storageBuffer.slice(0, Math.max(this.batchSize, 1));
        this.flushing = this.writeBatch(batch).finally(() => { this.flushing = null; });
      }
      await this.flushing;
    }
  }

  async cleanup(): Promise<void> {
    try {
      await this.storage.cleanup(this.maxAgeMs);
      this.cleanupError = null;
    } catch (error) {
      this.cleanupError = this.report(error, 'cleanup');
      throw error;
    }
  }

  async recordDurable(samples: MetricSample[]): Promise<MetricsWriteReceipt> {
    if (this.storage.capabilities?.durability !== 'persistent') throw new Error('Metrics storage cannot confirm durable writes');
    const prepared = samples.map(prepareMetricSample);
    const operation = this.writeDurable(prepared);
    this.durableWrites.add(operation);
    try { return await operation; }
    finally { this.durableWrites.delete(operation); }
  }

  private async writeDurable(prepared: MetricSample[]): Promise<MetricsWriteReceipt> {
    try {
      await this.storage.write(prepared);
      this.writtenSamples += prepared.length;
      this.lastWriteAt = new Date().toISOString();
      this.lastError = null;
      for (const sample of prepared) this.registry.record(sample);
      return { durability: 'persistent', samples: prepared.length, committedAt: this.lastWriteAt };
    } catch (error) {
      this.failedWrites++;
      this.lastError = this.report(error, 'write');
      throw error;
    }
  }

  getStorageStatus(): MetricsStorageStatus {
    return {
      ...this.storage.capabilities ?? { type: 'custom', durability: 'unknown' },
      pendingSamples: this.storageBuffer.length, capacity: this.capacity, writing: this.flushing !== null || this.durableWrites.size > 0,
      pendingBytes: this.pendingBytes, capacityBytes: this.capacityBytes,
      oldestPendingAt: this.storageBuffer.length ? new Date(this.queuedMetadata.get(this.storageBuffer[0]!)!.at).toISOString() : null,
      writtenSamples: this.writtenSamples, droppedSamples: this.dropped + (this.collector?.totalDropped ?? 0),
      failedWrites: this.failedWrites, lastWriteAt: this.lastWriteAt, lastError: this.lastError,
      cleanupError: this.cleanupError, syncError: this.syncError,
    };
  }

  private enqueue(samples: MetricSample[]): void {
    for (const sample of samples) {
      // Keep the in-flight prefix intact; neither overflow nor retry may
      // change an already-issued write. Loss is cumulative and visible.
      if (this.storageBuffer.length >= this.capacity) { this.dropped++; continue; }
      try {
        const prepared = prepareMetricSample(sample);
        const bytes = Buffer.byteLength(JSON.stringify(prepared));
        if (this.pendingBytes + bytes > this.capacityBytes) { this.dropped++; continue; }
        this.storageBuffer.push(prepared);
        this.queuedMetadata.set(prepared, { at: Date.now(), bytes });
        this.pendingBytes += bytes;
        this.queued++;
      } catch (error) {
        this.dropped++;
        this.lastError = this.report(error, 'write');
      }
    }
  }

  private autoFlush(): void {
    if (!this.flushing && this.storageBuffer.length >= this.batchSize) void this.flush().catch(() => { /* reported in writeBatch */ });
  }

  private async writeBatch(batch: MetricSample[]): Promise<void> {
    try {
      await this.storage.write(batch);
    } catch (error) {
      this.failedWrites++;
      this.lastError = this.report(error, 'write');
      throw error;
    }
    this.storageBuffer.splice(0, batch.length);
    for (const sample of batch) {
      this.pendingBytes -= this.queuedMetadata.get(sample)!.bytes;
      this.queuedMetadata.delete(sample);
    }
    this.completed += batch.length;
    this.writtenSamples += batch.length;
    this.lastWriteAt = new Date().toISOString();
    this.lastError = null;
    // This hook is an observation, not a transactional outbox. A callback
    // failure must never retry an already committed storage write.
    if (this.syncConfig?.enabled && this.syncConfig.onFlush) {
      try { await this.syncConfig.onFlush(batch); this.syncError = null; }
      catch (error) { this.syncError = this.report(error, 'sync'); }
    }
  }

  private report(error: unknown, operation: 'write' | 'cleanup' | 'sync'): string {
    const failure = error instanceof Error ? error : new Error(String(error));
    try { this.onError?.(failure, operation); } catch { /* reporting must not change storage outcome */ }
    return failure.message || failure.name;
  }

  // -------------------------------------------------------------------------
  // Extra accessors (for module/decorator use)
  // -------------------------------------------------------------------------

  /** Direct access to the in-memory registry */
  getRegistry(): MetricsRegistry {
    return this.registry;
  }
}
