/**
 * Titan Metrics — Pluggable Time-Series Storage
 *
 * Two implementations:
 *  - MemoryMetricsStorage — ring buffer, no external deps
 *  - PostgresMetricsStorage — batch inserts to `metrics_raw` via Kysely
 *
 * @module titan-metrics
 */

import type {
  MetricSample,
  MetricsQueryFilter,
  MetricsTimeSeries,
  MetricsSnapshot,
  IMetricsStorage,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a human-readable interval string ('1m', '5m', '1h', '1d') to ms */
function parseIntervalMs(interval: string): number {
  const match = interval.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 60_000; // default 1m
  const n = Number(match[1]);
  switch (match[2]) {
    case 's': return n * 1_000;
    case 'm': return n * 60_000;
    case 'h': return n * 3_600_000;
    case 'd': return n * 86_400_000;
    default: return 60_000;
  }
}

/** Parse a max-age string ('7d', '24h') to ms */
export function parseMaxAge(age: string): number {
  return parseIntervalMs(age);
}

/** Normalise from/to into epoch ms */
function toEpoch(v: string | number | undefined): number | undefined {
  if (v == null) return undefined;
  if (typeof v === 'number') return v;
  const d = new Date(v).getTime();
  return Number.isFinite(d) ? d : undefined;
}

/** Check if a sample matches a label filter */
function matchesLabels(sample: MetricSample, labels: Record<string, string>): boolean {
  for (const [k, v] of Object.entries(labels)) {
    if (sample.labels[k] !== v) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// MemoryMetricsStorage
// ---------------------------------------------------------------------------

const DEFAULT_RING_CAPACITY = 10_000;

export class MemoryMetricsStorage implements IMetricsStorage {
  private readonly ring: MetricSample[];
  private readonly capacity: number;
  private head = 0;
  private size = 0;

  constructor(capacity = DEFAULT_RING_CAPACITY) {
    this.capacity = capacity;
    this.ring = new Array<MetricSample>(capacity);
  }

  async write(samples: MetricSample[]): Promise<void> {
    for (const s of samples) {
      this.ring[this.head] = s;
      this.head = (this.head + 1) % this.capacity;
      if (this.size < this.capacity) this.size++;
    }
  }

  async query(filter: MetricsQueryFilter): Promise<MetricsTimeSeries[]> {
    const fromMs = toEpoch(filter.from) ?? 0;
    const toMs = toEpoch(filter.to) ?? Date.now();
    const intervalMs = filter.interval ? parseIntervalMs(filter.interval) : 0;
    const limit = filter.limit ?? Number.MAX_SAFE_INTEGER;

    // Collect matching samples
    const matched: MetricSample[] = [];
    for (let i = 0; i < this.size; i++) {
      const idx = (this.head - this.size + i + this.capacity) % this.capacity;
      const s = this.ring[idx]!;
      if (s.timestamp < fromMs || s.timestamp > toMs) continue;
      if (filter.names && !filter.names.includes(s.name)) continue;
      if (filter.apps && !filter.apps.includes(s.labels['app'] ?? '')) continue;
      if (filter.labels && !matchesLabels(s, filter.labels)) continue;
      matched.push(s);
    }

    // Group by (name, app, labels-without-app)
    const groups = new Map<string, { name: string; app: string; labels: Record<string, string>; points: Array<{ timestamp: number; value: number }> }>();

    for (const s of matched) {
      const app = s.labels['app'] ?? '';
      const groupLabels = { ...s.labels };
      delete groupLabels['app'];
      const gk = `${s.name}|${app}|${JSON.stringify(groupLabels)}`;
      let g = groups.get(gk);
      if (!g) {
        g = { name: s.name, app, labels: groupLabels, points: [] };
        groups.set(gk, g);
      }
      g.points.push({ timestamp: s.timestamp, value: s.value });
    }

    // Bucket aggregation if interval specified
    const series: MetricsTimeSeries[] = [];
    for (const g of groups.values()) {
      if (intervalMs > 0) {
        g.points = bucketAggregate(g.points, intervalMs);
      }
      // Sort ascending
      g.points.sort((a, b) => a.timestamp - b.timestamp);
      // Apply limit
      if (g.points.length > limit) {
        g.points = g.points.slice(-limit);
      }
      series.push(g);
    }

    return series;
  }

  async getLatest(apps?: string[]): Promise<MetricsSnapshot> {
    const now = Date.now();
    const appMap = new Map<string, Map<string, MetricSample>>();

    // Walk ring backwards to find latest per (app, name)
    for (let i = this.size - 1; i >= 0; i--) {
      const idx = (this.head - this.size + i + this.capacity) % this.capacity;
      const s = this.ring[idx]!;
      const app = s.labels['app'] ?? '';
      if (apps && !apps.includes(app)) continue;
      let metrics = appMap.get(app);
      if (!metrics) {
        metrics = new Map();
        appMap.set(app, metrics);
      }
      if (!metrics.has(s.name)) {
        metrics.set(s.name, s);
      }
    }

    return buildSnapshot(now, appMap);
  }

  async cleanup(maxAgeMs: number): Promise<void> {
    const cutoff = Date.now() - maxAgeMs;
    // In a ring buffer we can't truly delete — we mark old entries as expired
    // by resetting size. We walk from tail and shrink.
    while (this.size > 0) {
      const tailIdx = (this.head - this.size + this.capacity) % this.capacity;
      if (this.ring[tailIdx]!.timestamp < cutoff) {
        this.size--;
      } else {
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// PostgresMetricsStorage
// ---------------------------------------------------------------------------

/** Loose Kysely-like interface to avoid hard dependency */
interface KyselyLike {
  insertInto(table: string): InsertBuilderLike;
  selectFrom(table: string): SelectBuilderLike;
  deleteFrom(table: string): DeleteBuilderLike;
}

interface InsertBuilderLike {
  values(rows: Record<string, unknown>[]): { execute(): Promise<void> };
}

interface SelectBuilderLike {
  select(expr: string | string[]): SelectBuilderLike;
  where(col: string, op: string, val: unknown): SelectBuilderLike;
  orderBy(col: string, dir?: string): SelectBuilderLike;
  groupBy(cols: string | string[]): SelectBuilderLike;
  limit(n: number): SelectBuilderLike;
  execute(): Promise<Record<string, unknown>[]>;
}

interface DeleteBuilderLike {
  where(col: string, op: string, val: unknown): DeleteBuilderLike;
  execute(): Promise<void>;
}

export class PostgresMetricsStorage implements IMetricsStorage {
  private buffer: MetricSample[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly batchSize: number;
  private readonly flushInterval: number;
  private readonly onFlush: ((batch: MetricSample[]) => Promise<void>) | undefined;
  private flushing = false;

  constructor(
    private readonly db: KyselyLike,
    options: { batchSize?: number; flushInterval?: number; onFlush?: (batch: MetricSample[]) => Promise<void> } = {},
  ) {
    this.batchSize = options.batchSize ?? 200;
    this.flushInterval = options.flushInterval ?? 5_000;
    this.onFlush = options.onFlush;
    this.startFlushTimer();
  }

  async write(samples: MetricSample[]): Promise<void> {
    this.buffer.push(...samples);
    if (this.buffer.length >= this.batchSize) {
      await this.flushBuffer();
    }
  }

  async query(filter: MetricsQueryFilter): Promise<MetricsTimeSeries[]> {
    // Flush pending before reading
    await this.flushBuffer();

    const fromMs = toEpoch(filter.from) ?? 0;
    const toMs = toEpoch(filter.to) ?? Date.now();
    const limit = filter.limit ?? 10_000;

    let q = this.db.selectFrom('metrics_raw')
      .select(['name', 'app', 'labels', 'timestamp', 'value']);

    q = q.where('timestamp', '>=', fromMs);
    q = q.where('timestamp', '<=', toMs);

    if (filter.names && filter.names.length > 0) {
      // Use first name for simple query — full multi-name would need raw SQL
      q = q.where('name', '=', filter.names[0]);
    }
    if (filter.apps && filter.apps.length > 0) {
      q = q.where('app', '=', filter.apps[0]);
    }

    q = q.orderBy('timestamp', 'asc').limit(limit);

    const rows = await q.execute();

    // Group into time-series
    const groups = new Map<string, MetricsTimeSeries>();
    for (const row of rows) {
      const name = String(row['name']);
      const app = String(row['app']);
      const labels = typeof row['labels'] === 'string' ? JSON.parse(row['labels'] as string) as Record<string, string> : (row['labels'] as Record<string, string>) ?? {};
      const gk = `${name}|${app}|${JSON.stringify(labels)}`;
      let g = groups.get(gk);
      if (!g) {
        g = { name, app, labels, points: [] };
        groups.set(gk, g);
      }
      g.points.push({ timestamp: Number(row['timestamp']), value: Number(row['value']) });
    }

    // Time-bucket aggregation if requested
    if (filter.interval) {
      const intervalMs = parseIntervalMs(filter.interval);
      for (const g of groups.values()) {
        g.points = bucketAggregate(g.points, intervalMs);
      }
    }

    return [...groups.values()];
  }

  async getLatest(apps?: string[]): Promise<MetricsSnapshot> {
    await this.flushBuffer();
    const now = Date.now();

    let q = this.db.selectFrom('metrics_raw')
      .select(['name', 'app', 'labels', 'timestamp', 'value'])
      .orderBy('timestamp', 'desc')
      .limit(5_000);

    if (apps && apps.length > 0) {
      q = q.where('app', '=', apps[0]);
    }

    const rows = await q.execute();

    // Deduplicate: keep latest per (app, name)
    const appMap = new Map<string, Map<string, MetricSample>>();
    for (const row of rows) {
      const app = String(row['app']);
      const name = String(row['name']);
      let metrics = appMap.get(app);
      if (!metrics) {
        metrics = new Map();
        appMap.set(app, metrics);
      }
      if (!metrics.has(name)) {
        const labels = typeof row['labels'] === 'string' ? JSON.parse(row['labels'] as string) as Record<string, string> : (row['labels'] as Record<string, string>) ?? {};
        metrics.set(name, {
          name,
          value: Number(row['value']),
          timestamp: Number(row['timestamp']),
          labels,
        });
      }
    }

    return buildSnapshot(now, appMap);
  }

  async cleanup(maxAgeMs: number): Promise<void> {
    const cutoff = Date.now() - maxAgeMs;
    await this.db.deleteFrom('metrics_raw').where('timestamp', '<', cutoff).execute();
  }

  /** Stop the periodic flush timer */
  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => void this.flushBuffer(), this.flushInterval);
    if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
      this.flushTimer.unref();
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    const batch = this.buffer.splice(0);
    try {
      const rows = batch.map(s => ({
        name: s.name,
        app: s.labels['app'] ?? '',
        labels: JSON.stringify(s.labels),
        timestamp: s.timestamp,
        value: s.value,
      }));
      await this.db.insertInto('metrics_raw').values(rows).execute();
      if (this.onFlush) {
        await this.onFlush(batch);
      }
    } catch {
      // On failure, re-enqueue at front
      this.buffer.unshift(...batch);
    } finally {
      this.flushing = false;
    }
  }
}

// ---------------------------------------------------------------------------
// SQLiteMetricsStorage — lightweight local storage for slave daemons
// ---------------------------------------------------------------------------

/**
 * SQLite-backed metrics storage using Kysely (via titan-database).
 *
 * Designed for slave daemons that run without Docker/PostgreSQL:
 * - Uses `better-sqlite3` through Kysely's SqliteDialect
 * - Same query interface as PostgresMetricsStorage
 * - Synchronous writes (SQLite WAL mode for concurrency)
 * - Auto-creates `metrics_raw` table if not exists
 * - `onFlush` callback for slave→master sync integration
 */
export class SQLiteMetricsStorage implements IMetricsStorage {
  private buffer: MetricSample[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly batchSize: number;
  private readonly flushInterval: number;
  private readonly onFlush: ((batch: MetricSample[]) => Promise<void>) | undefined;
  private flushing = false;
  private initialized = false;

  constructor(
    private readonly db: KyselyLike,
    options: { batchSize?: number; flushInterval?: number; onFlush?: (batch: MetricSample[]) => Promise<void> } = {},
  ) {
    this.batchSize = options.batchSize ?? 200;
    this.flushInterval = options.flushInterval ?? 5_000;
    this.onFlush = options.onFlush;
    this.startFlushTimer();
  }

  private async ensureTable(): Promise<void> {
    if (this.initialized) return;
    // Create metrics_raw table if not exists (SQLite DDL via raw query)
    try {
      const raw = this.db as any;
      if (typeof raw.schema?.createTable === 'function') {
        await raw.schema
          .createTable('metrics_raw')
          .ifNotExists()
          .addColumn('id', 'integer', (col: any) => col.primaryKey().autoIncrement())
          .addColumn('timestamp', 'real', (col: any) => col.notNull())
          .addColumn('node_id', 'text')
          .addColumn('app', 'text', (col: any) => col.notNull())
          .addColumn('name', 'text', (col: any) => col.notNull())
          .addColumn('value', 'real', (col: any) => col.notNull())
          .addColumn('labels', 'text')
          .execute();

        // Create index for time-range queries
        await raw.schema
          .createIndex('idx_metrics_raw_ts_app_name')
          .ifNotExists()
          .on('metrics_raw')
          .columns(['timestamp', 'app', 'name'])
          .execute();
      }
    } catch {
      // Table may already exist or schema API not available
    }
    this.initialized = true;
  }

  async write(samples: MetricSample[]): Promise<void> {
    await this.ensureTable();
    this.buffer.push(...samples);
    if (this.buffer.length >= this.batchSize) {
      await this.flushBuffer();
    }
  }

  async query(filter: MetricsQueryFilter): Promise<MetricsTimeSeries[]> {
    await this.ensureTable();
    await this.flushBuffer();

    const fromMs = toEpoch(filter.from) ?? 0;
    const toMs = toEpoch(filter.to) ?? Date.now();
    const limit = filter.limit ?? 10_000;

    let q = this.db.selectFrom('metrics_raw')
      .select(['name', 'app', 'labels', 'timestamp', 'value']);

    q = q.where('timestamp', '>=', fromMs);
    q = q.where('timestamp', '<=', toMs);

    if (filter.names && filter.names.length > 0) {
      q = q.where('name', '=', filter.names[0]);
    }
    if (filter.apps && filter.apps.length > 0) {
      q = q.where('app', '=', filter.apps[0]);
    }

    q = q.orderBy('timestamp', 'asc').limit(limit);

    const rows = await q.execute();

    const groups = new Map<string, MetricsTimeSeries>();
    for (const row of rows) {
      const name = String(row['name']);
      const app = String(row['app']);
      const labels = typeof row['labels'] === 'string' ? JSON.parse(row['labels'] as string) as Record<string, string> : {};
      const gk = `${name}|${app}`;
      let g = groups.get(gk);
      if (!g) {
        g = { name, app, labels, points: [] };
        groups.set(gk, g);
      }
      g.points.push({ timestamp: Number(row['timestamp']), value: Number(row['value']) });
    }

    if (filter.interval) {
      const intervalMs = parseIntervalMs(filter.interval);
      for (const g of groups.values()) {
        g.points = bucketAggregate(g.points, intervalMs);
      }
    }

    return [...groups.values()];
  }

  async getLatest(apps?: string[]): Promise<MetricsSnapshot> {
    await this.ensureTable();
    await this.flushBuffer();
    const now = Date.now();

    let q = this.db.selectFrom('metrics_raw')
      .select(['name', 'app', 'labels', 'timestamp', 'value'])
      .orderBy('timestamp', 'desc')
      .limit(5_000);

    if (apps && apps.length > 0) {
      q = q.where('app', '=', apps[0]);
    }

    const rows = await q.execute();

    const appMap = new Map<string, Map<string, MetricSample>>();
    for (const row of rows) {
      const app = String(row['app']);
      const name = String(row['name']);
      let metrics = appMap.get(app);
      if (!metrics) {
        metrics = new Map();
        appMap.set(app, metrics);
      }
      if (!metrics.has(name)) {
        const labels = typeof row['labels'] === 'string' ? JSON.parse(row['labels'] as string) as Record<string, string> : {};
        metrics.set(name, { name, value: Number(row['value']), timestamp: Number(row['timestamp']), labels });
      }
    }

    return buildSnapshot(now, appMap);
  }

  async cleanup(maxAgeMs: number): Promise<void> {
    await this.ensureTable();
    const cutoff = Date.now() - maxAgeMs;
    await this.db.deleteFrom('metrics_raw').where('timestamp', '<', cutoff).execute();
  }

  dispose(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => void this.flushBuffer(), this.flushInterval);
    if (this.flushTimer && typeof this.flushTimer === 'object' && 'unref' in this.flushTimer) {
      this.flushTimer.unref();
    }
  }

  private async flushBuffer(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    const batch = this.buffer.splice(0);
    try {
      const rows = batch.map(s => ({
        timestamp: s.timestamp,
        app: s.labels['app'] ?? '',
        name: s.name,
        value: s.value,
        labels: JSON.stringify(s.labels),
      }));
      await this.db.insertInto('metrics_raw').values(rows).execute();
      if (this.onFlush) {
        await this.onFlush(batch);
      }
    } catch {
      this.buffer.unshift(...batch);
    } finally {
      this.flushing = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Aggregate points into time buckets using AVG */
function bucketAggregate(
  points: Array<{ timestamp: number; value: number }>,
  intervalMs: number,
): Array<{ timestamp: number; value: number }> {
  if (points.length === 0 || intervalMs <= 0) return points;

  const buckets = new Map<number, { sum: number; count: number }>();
  for (const p of points) {
    const bucket = Math.floor(p.timestamp / intervalMs) * intervalMs;
    const b = buckets.get(bucket);
    if (b) {
      b.sum += p.value;
      b.count++;
    } else {
      buckets.set(bucket, { sum: p.value, count: 1 });
    }
  }

  const result: Array<{ timestamp: number; value: number }> = [];
  for (const [ts, b] of buckets) {
    result.push({ timestamp: ts, value: b.sum / b.count });
  }
  return result.sort((a, b) => a.timestamp - b.timestamp);
}

/** Build a MetricsSnapshot from a per-app map of latest samples */
function buildSnapshot(
  now: number,
  appMap: Map<string, Map<string, MetricSample>>,
): MetricsSnapshot {
  const snapshot: MetricsSnapshot = {
    timestamp: now,
    apps: {},
    totals: { cpu: 0, memory: 0, apps: 0, onlineApps: 0 },
  };

  for (const [app, metrics] of appMap) {
    const cpu = metrics.get('cpu_percent')?.value ?? 0;
    const memory = metrics.get('memory_bytes')?.value ?? metrics.get('rss_bytes')?.value ?? 0;
    const requests = metrics.get('rpc_requests_total')?.value ?? 0;
    const errors = metrics.get('rpc_errors_total')?.value ?? 0;
    const statusVal = metrics.get('app_status')?.value;
    const status = statusVal === 1 ? 'online' : statusVal === 0 ? 'offline' : 'unknown';

    // Latency percentiles if present
    const p50 = metrics.get('rpc_latency_p50')?.value;
    const p95 = metrics.get('rpc_latency_p95')?.value;
    const p99 = metrics.get('rpc_latency_p99')?.value;
    const mean = metrics.get('rpc_latency_mean')?.value;

    snapshot.apps[app] = {
      cpu,
      memory,
      requests,
      errors,
      instances: 1,
      status,
      ...(p50 != null && p95 != null && p99 != null && mean != null
        ? { latency: { p50, p95, p99, mean } }
        : {}),
    };

    snapshot.totals.cpu += cpu;
    snapshot.totals.memory += memory;
    snapshot.totals.apps++;
    if (status === 'online') snapshot.totals.onlineApps++;
  }

  return snapshot;
}
