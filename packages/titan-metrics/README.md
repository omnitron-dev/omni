# @omnitron-dev/titan-metrics

> Counters, gauges, histograms, and time-series storage for Titan

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/titan-metrics
```

## Overview

Native metrics collection module for Titan applications. Provides counters, gauges, and histograms with time-series storage. Integrates with Titan's DI system for automatic instrumentation.

## Persistence

Memory storage is the default and needs no SQL runtime dependency. For persistent
history, provide `METRICS_STORAGE_TOKEN` with `PostgresMetricsStorage` or
`SQLiteMetricsStorage` and your existing Kysely connection. Install Kysely and the
chosen database driver. `forRootAsync` accepts a `storage` factory; a persistent
configuration never falls back to memory silently.

SQL adapters write to `metrics_samples`. Register the immutable
`METRICS_POSTGRES_SCHEMA_V1` statements in your migration runner before using
PostgreSQL. SQLite initializes its schema idempotently unless
`initializeSchema: false` is set. Existing `metrics_raw` data is not erased or
implicitly migrated. The caller owns connection shutdown.

`write(samples)` resolves after commit and rejects database errors. There is no
second hidden buffer. All chunks and the optional `afterWrite(transaction, samples)`
outbox callback share one transaction. The callback receives newly inserted
samples only. `writeInTransaction` joins an outer transaction; its caller must
await that transaction's commit. Initialize SQLite before using this method.

PostgreSQL requires a logged table, `fsync=on` and `full_page_writes=on`; writes set
transaction-local `synchronous_commit=on`. Persistent SQLite requires
`synchronous=FULL` or `EXTRA`. An in-memory SQLite database remains volatile.

```ts
const metrics = new MetricsService(
  { appName: 'api', collection: { enabled: false }, storage: { type: 'postgres' } },
  new PostgresMetricsStorage(db), // your migrated Kysely connection
);
await metrics.recordDurable([{
  id: 'measurement-42', name: 'queue_depth', value: 12,
  timestamp: Date.now(), labels: { app: 'api' },
}]);
```

Preserve IDs across caller retries after an uncertain response. Reusing an ID
with different data rejects the write. `recordDurable` issues a persistent commit
receipt; memory/unknown storage cannot issue one. A commit is not backup or replica
availability evidence.

## Collection and diagnosis

`record`, `recordBatch` and `recordTyped` queue measurements; they are not commit
acknowledgements. The service assigns stable IDs before enqueueing. `flush` awaits
the writes accepted before the call, including a writer already in progress.
`stop` stops collection and awaits the final flush and active durable writes.
Titan DI invokes `onDestroy` to await that stop before disposing storage providers.
Call `stop` yourself when constructing the service outside DI. Failed batches remain queued
for retry. Before commit the collection buffer is volatile.

The queue includes in-flight data and is bounded by `storage.maxBufferSize`
(50,000 samples) and `storage.maxBufferBytes` (16 MiB). Overflow rejects new
samples from persistence and increments a cumulative loss counter. Collector
losses are included. `getStorageStatus()` exposes pending counts/bytes, oldest
enqueue time, completed writes, failed attempts, losses and write/cleanup/callback
errors. Counts describe the current process. Background failures reach `onError`;
explicit write, flush and cleanup calls reject.

`sync.onFlush` is a post-write notification. Its failure never duplicates a
committed write and is reported as `syncError`. Use the transactional `afterWrite`
callback when reliable outbox enqueueing is required.

SQL queries filter names, apps and labels before applying per-series limits and
aggregate the full time window. Gauges are averaged; `*_total`/`*_count` use the
last bucket value. Defaults: last 24 hours, 120 newest points per series, 1,024
series and 100,000 total points. `limit` supports 1–2,000. Budget exhaustion
rejects instead of silently truncating. Labels are returned once per series.
PostgreSQL query/write statement timeout defaults to 10 seconds.

Retention defaults to seven days. Cleanup uses bounded batches and a time budget;
later sweeps resume remaining work. Outbox retention belongs to its owner and is
independent of chart history.

See the [metrics guide](https://omnitron.dev/docs/titan/modules/metrics) for DI,
migrations, diagnostics and the Omnitron replication contract.

## License

MIT
