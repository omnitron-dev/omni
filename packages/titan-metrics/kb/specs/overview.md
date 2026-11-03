---
module: titan-metrics
title: "Metrics Module"
tags: [metrics, prometheus, counters, gauges, histograms]
summary: "Native metrics collection: counters, gauges, histograms with in-memory, Postgres, and SQLite storage"
depends_on: [titan/nexus]
---

## Metric Types

```typescript
// Counter (monotonically increasing)
metrics.recordTyped('counter', 'http_requests_total', { method: 'GET', path: '/api/users' }, 1);

// Gauge (can go up and down)
metrics.recordTyped('gauge', 'active_connections', {}, 42);

// Histogram (distribution of values)
metrics.recordTyped('histogram', 'request_duration_ms', {}, 23.5);
```

A counter observation is an increment, a histogram observation is one measured
value, and a gauge observation replaces its previous value. Every label set of
a metric name belongs to the same family. A conflicting typed write or
declaration throws before changing a series.

For a sample that is already durable, `metrics.getRegistry().record(sample)`
updates only the in-memory exposition. It uses the registered family and keeps
the sample's labels. Unknown names initially expose their latest value as a
gauge. A later explicit gauge declaration retains those values. A later counter
or histogram declaration starts a new aggregate with typed observations.
Historical raw samples remain available in storage.

## Decorator
```typescript
@Metrics('users.get')
async getUser(id: string): Promise<User> { /* auto-instrumented */ }
```

## Storage Backends
- **MemoryMetricsStorage** — Default, in-process
- **PostgresMetricsStorage** — For persistent historical metrics
- **SQLiteMetricsStorage** — For lightweight persistence

SQL `write()` awaits commit; `writeInTransaction()` participates in a caller's
transaction. An optional transactional `afterWrite` callback can enqueue an
outbox without a second commit. Preserve sample IDs across retries. Register
`METRICS_POSTGRES_SCHEMA_V1` with the application's migration runner; SQLite has
idempotent initialization. The new table is `metrics_samples`.

Synchronous `record*` methods use a bounded volatile queue. `recordDurable()`
returns a persistent receipt or rejects; `getStorageStatus()` exposes pending
samples/bytes, last completed write, errors and losses. `flush()` and `stop()` wait
for in-flight writes. SQL adapters have no independent queue. Optional Kysely
and driver dependencies are needed only for SQL storage.
