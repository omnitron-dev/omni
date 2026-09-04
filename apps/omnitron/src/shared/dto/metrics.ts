/**
 * Metrics DTOs — wire shapes of the OmnitronMetrics service.
 *
 * The service itself is implemented by `MetricsRpcService` in
 * `@omnitron-dev/titan-metrics`, but these shapes are declared here rather
 * than imported from it. That package's `exports.types` points at its SOURCE
 * (`./src/index.ts`), so importing a type from it pulls the implementation —
 * decorators and all — into whatever program does the importing. In the
 * console's build that is an immediate `TS1241` on every `@Public()`.
 *
 * Structural duplication is the lesser cost: a DTO's job is to describe the
 * wire, and the wire is what both sides agree on regardless of which package
 * happens to implement the server half. If titan-metrics ever points its
 * `types` at `dist`, these can become re-exports.
 */

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

export interface MetricsTimeSeries {
  name: string;
  app: string;
  labels: Record<string, string>;
  points: Array<{ timestamp: number; value: number }>;
}

export interface MetricsAppSnapshot {
  cpu: number;
  memory: number;
  requests: number;
  errors: number;
  instances: number;
  status: string;
  latency?: { p50: number; p95: number; p99: number; mean: number };
}

export interface MetricsSnapshot {
  timestamp: number;
  apps: Record<string, MetricsAppSnapshot>;
  totals: {
    cpu: number;
    memory: number;
    apps: number;
    onlineApps: number;
  };
}
