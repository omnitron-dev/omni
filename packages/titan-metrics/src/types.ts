/**
 * Titan Metrics — Type definitions
 *
 * Pure Titan-native metrics module. No prom-client. No external dependencies.
 *
 * @module titan-metrics
 */

// ---------------------------------------------------------------------------
// Metric primitives
// ---------------------------------------------------------------------------

/** Supported metric kinds */
export type MetricType = 'counter' | 'gauge' | 'histogram';

/** A single metric data point */
export interface MetricSample {
  /** Metric name (e.g., 'cpu_percent', 'rpc_requests_total') */
  name: string;
  /** Metric value */
  value: number;
  /** Timestamp (ms since epoch) */
  timestamp: number;
  /** Source labels */
  labels: Record<string, string>;
}

/** Schema for a registered metric */
export interface MetricDefinition {
  name: string;
  type: MetricType;
  help: string;
  labelNames?: string[];
}

// ---------------------------------------------------------------------------
// Histogram internals
// ---------------------------------------------------------------------------

/** Distribution state tracked per label-set */
export interface HistogramState {
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Collection config */
export interface IMetricsCollectionConfig {
  /** Enable metrics collection (default: true) */
  enabled?: boolean;
  /** Collection interval in ms (default: 5000) */
  interval?: number;
  /** Collect Node.js process metrics: heap, GC, event loop (default: true) */
  process?: boolean;
  /** Collect OS-level CPU/memory per child (default: true) */
  system?: boolean;
  /** Collect RPC request count/latency (default: true) */
  rpc?: boolean;
  /** Collect custom app-specific metrics (default: true) */
  custom?: boolean;
}

/** Storage backend config */
export interface IMetricsStorageConfig {
  /** Storage backend: memory (dev/testing), sqlite (slave), postgres (master) */
  type: 'postgres' | 'sqlite' | 'memory';
  /** Batch size for writes (default: 200) */
  batchSize?: number;
  /** Flush interval in ms (default: 5000) */
  flushInterval?: number;
}

/** Data retention config */
export interface IMetricsRetentionConfig {
  /** Max age of metrics data (default: '7d') */
  maxAge?: string;
  /** Cleanup interval in ms (default: 3600000 = 1h) */
  cleanupInterval?: number;
}

/** Sync config for slave → master replication */
export interface IMetricsSyncConfig {
  /** Enable sync (default: false, true on slaves) */
  enabled?: boolean;
  /** Callback invoked on each flush with batch for sync */
  onFlush?: (batch: MetricSample[]) => Promise<void>;
}

/** Root module options for TitanMetricsModule.forRoot() */
export interface IMetricsModuleOptions {
  /** Application / daemon name */
  appName: string;
  /** Collection configuration */
  collection?: IMetricsCollectionConfig;
  /** Storage configuration */
  storage?: IMetricsStorageConfig;
  /** Retention configuration */
  retention?: IMetricsRetentionConfig;
  /** Sync configuration for slave → master */
  sync?: IMetricsSyncConfig;
  /** Register as global DI module */
  isGlobal?: boolean;
}

// ---------------------------------------------------------------------------
// Query types
// ---------------------------------------------------------------------------

/** Filter / aggregation params for time-series queries */
export interface MetricsQueryFilter {
  /** Filter by metric name(s) */
  names?: string[];
  /** Filter by app name(s) */
  apps?: string[];
  /** Start time (ISO string or ms) */
  from?: string | number;
  /** End time (ISO string or ms) */
  to?: string | number;
  /** Label filters */
  labels?: Record<string, string>;
  /** Time bucket interval for aggregation (e.g., '1m', '5m', '1h') */
  interval?: string;
  /** Max data points to return */
  limit?: number;
}

/** A named time-series with data points */
export interface MetricsTimeSeries {
  name: string;
  app: string;
  labels: Record<string, string>;
  points: Array<{ timestamp: number; value: number }>;
}

/** Real-time snapshot — one per app plus totals */
export interface MetricsSnapshot {
  timestamp: number;
  apps: Record<string, {
    cpu: number;
    memory: number;
    requests: number;
    errors: number;
    instances: number;
    status: string;
    latency?: { p50: number; p95: number; p99: number; mean: number };
  }>;
  totals: {
    cpu: number;
    memory: number;
    apps: number;
    onlineApps: number;
  };
}

// ---------------------------------------------------------------------------
// Storage interface
// ---------------------------------------------------------------------------

/** Pluggable storage backend contract */
export interface IMetricsStorage {
  /** Persist a batch of samples */
  write(samples: MetricSample[]): Promise<void>;
  /** Query time-series (supports time-bucket aggregation) */
  query(filter: MetricsQueryFilter): Promise<MetricsTimeSeries[]>;
  /** Latest snapshot per app */
  getLatest(apps?: string[]): Promise<MetricsSnapshot>;
  /** Delete data older than maxAgeMs */
  cleanup(maxAgeMs: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

/** Public contract for the metrics service */
export interface IMetricsService {
  /** Record a single metric sample */
  record(sample: MetricSample): void;
  /** Record a batch of samples */
  recordBatch(samples: MetricSample[]): void;
  /** Get current snapshot (latest values per app) */
  getSnapshot(): Promise<MetricsSnapshot>;
  /** Query time-series data with optional bucketing */
  querySeries(filter: MetricsQueryFilter): Promise<MetricsTimeSeries[]>;
  /** Get metrics in Prometheus text format */
  getPrometheusText(): Promise<string>;
  /** Start periodic collection */
  start(): void;
  /** Stop collection and flush buffers */
  stop(): Promise<void>;
  /** Force flush buffered samples to storage */
  flush(): Promise<void>;
  /** Run retention cleanup */
  cleanup(): Promise<void>;
}
