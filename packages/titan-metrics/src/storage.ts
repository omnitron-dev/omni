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
  IMetricsLatestOptions,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a human-readable interval string ('1m', '5m', '1h', '1d') to ms */
export function parseIntervalMs(interval: string): number {
  const match = interval.match(/^(\d+)(s|m|h|d)$/);
  if (!match || Number(match[1]) <= 0) throw new TypeError('Metric duration must be positive with s, m, h or d units');
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

/**
 * Stable label value for metrics emitted by the daemon itself
 * rather than an app (T#63). Pre-T#63, daemon-scoped collectors
 * (Netron internals, the health monitor, the orphan reaper)
 * wrote samples without an `app` label. The storage layer
 * uniformly coerced missing-or-empty to `''`, which then leaked
 * into per-app rollups: `sum by (app) (...)` grew a phantom group
 * labelled `app=""` whose contents were daemon traffic mixed
 * into app totals.
 *
 * The fix normalises every inbound sample at `write()` time so
 * daemon samples carry `app='__daemon__'`. Callers that want
 * "apps only" rollups can filter with `apps: someAppList` or
 * exclude `__daemon__` explicitly; the schema is now honest about
 * scope.
 */
export const DAEMON_APP_LABEL = '__daemon__';

/**
 * Promote daemon-scoped samples to a stable sentinel label
 * (T#63). Idempotent — re-running on an already-normalised
 * sample is a no-op. Returns a new sample only when the label
 * actually needed correction; otherwise hands back the original
 * reference to avoid allocations on the hot path.
 */
export function normaliseAppScope(sample: MetricSample): MetricSample {
  const a = sample.labels?.['app'];
  if (a && a !== '') return sample;
  return {
    ...sample,
    labels: { ...sample.labels, app: DAEMON_APP_LABEL },
  };
}

// ---------------------------------------------------------------------------
// MemoryMetricsStorage
// ---------------------------------------------------------------------------

const DEFAULT_RING_CAPACITY = 10_000;

export class MemoryMetricsStorage implements IMetricsStorage {
  readonly capabilities = { type: 'memory', durability: 'volatile' } as const;
  private readonly ring: MetricSample[];
  private readonly capacity: number;
  private head = 0;
  private size = 0;

  constructor(capacity = DEFAULT_RING_CAPACITY) {
    this.capacity = capacity;
    this.ring = new Array<MetricSample>(capacity);
  }

  async write(samples: MetricSample[]): Promise<void> {
    // T#63: normalise the `app` label BEFORE indexing. Samples
    // emitted from daemon-scoped collectors (Netron internals,
    // health monitor, etc.) historically arrived with no `app`
    // label, which the read paths translated to the empty string.
    // Empty-string app then leaked into per-app rollups: a panel
    // like `sum by (app) (rate(rpc_requests_total[1m]))` grew a
    // phantom group labelled `app=""`. Coercing to a stable
    // `__daemon__` sentinel keeps daemon traffic out of app rollups
    // (callers filter on it explicitly) and makes the storage
    // schema honest about scope.
    for (const s of samples) {
      this.ring[this.head] = normaliseAppScope(s);
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
        g.points = bucketAggregate(g.name, g.points, intervalMs);
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

  async getLatest(apps?: string[], opts?: IMetricsLatestOptions): Promise<MetricsSnapshot> {
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

    // Ghost-eviction: drop apps whose freshest `app_status` is older than the
    // staleness window. We use app_status as the liveness signal because the
    // collector emits it on every tick (so a fresh reading proves the
    // orchestrator still knows about the app). Counters like
    // `rpc_requests_total` are not reliable — they tick at the request rate,
    // not the heartbeat rate.
    if (opts?.staleAfterMs != null) {
      const cutoff = now - opts.staleAfterMs;
      for (const [app, metrics] of appMap) {
        const status = metrics.get('app_status');
        // Be conservative: if there's no app_status sample at all, keep the
        // app (some custom collectors may not emit it). Only evict when we
        // have a definitive "stale" reading.
        if (status && status.timestamp < cutoff) {
          appMap.delete(app);
        }
      }
    }

    return buildSnapshot(now, appMap);
  }

  async evictApp(app: string): Promise<void> {
    if (this.size === 0) return;
    // Compact the ring in-place: walk all live samples, copy only the ones
    // that aren't from the evicted app back into a fresh buffer.
    const surviving: MetricSample[] = [];
    for (let i = 0; i < this.size; i++) {
      const idx = (this.head - this.size + i + this.capacity) % this.capacity;
      const s = this.ring[idx]!;
      if ((s.labels['app'] ?? '') !== app) surviving.push(s);
    }
    this.head = 0;
    this.size = 0;
    for (const s of surviving) {
      this.ring[this.head] = s;
      this.head = (this.head + 1) % this.capacity;
      if (this.size < this.capacity) this.size++;
    }
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

// Database adapters load Kysely only when used; memory-only applications need no SQL dependency.
export { PostgresMetricsStorage, SQLiteMetricsStorage } from './sql-storage.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Detect a counter metric by the Prometheus naming convention.
 *
 * Pre-T#70 the bucket aggregator averaged every value type. Averaging
 * a counter — which is monotonically increasing — produces a value
 * roughly equal to the bucket's mid-point, which is meaningless: a
 * counter's bucket value should be its LAST observation so subsequent
 * `rate()` / `increase()` calculations work. Heuristic detection from
 * the metric name avoids threading type metadata through the storage
 * layer, which is intentionally type-agnostic.
 */
function isCounterName(name: string): boolean {
  return name.endsWith('_total') || name.endsWith('_count');
}

/**
 * Aggregate points into time buckets.
 *
 *   - Counter metrics (`*_total`, `*_count`): take LAST value in each
 *     bucket so subsequent `rate()` calculations work.
 *   - Other metrics (gauges, latencies): take AVG.
 *
 * T#70: the unconditional AVG was a silent bug — counter dashboards
 * (request rate, error rate, etc.) showed values an order of magnitude
 * smaller than reality whenever an `interval:` parameter was supplied.
 */
function bucketAggregate(
  name: string,
  points: Array<{ timestamp: number; value: number }>,
  intervalMs: number,
): Array<{ timestamp: number; value: number }> {
  if (points.length === 0 || intervalMs <= 0) return points;
  const counter = isCounterName(name);

  // For counters we keep `{ ts, last }` per bucket; for others we keep
  // `{ sum, count }`. The discriminant is the same for both shapes —
  // a counter bucket stores `count = -1` as a sentinel so the read
  // path can branch.
  interface Bucket { sum: number; count: number; last: number; lastTs: number }
  const buckets = new Map<number, Bucket>();
  for (const p of points) {
    const bucket = Math.floor(p.timestamp / intervalMs) * intervalMs;
    const b = buckets.get(bucket);
    if (b) {
      b.sum += p.value;
      b.count++;
      if (p.timestamp >= b.lastTs) {
        b.last = p.value;
        b.lastTs = p.timestamp;
      }
    } else {
      buckets.set(bucket, { sum: p.value, count: 1, last: p.value, lastTs: p.timestamp });
    }
  }

  const result: Array<{ timestamp: number; value: number }> = [];
  for (const [ts, b] of buckets) {
    result.push({ timestamp: ts, value: counter ? b.last : b.sum / b.count });
  }
  return result.sort((a, b) => a.timestamp - b.timestamp);
}

/** Build a MetricsSnapshot from a per-app map of latest samples */
export function buildSnapshot(
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
