# @omnitron-dev/titan-metrics

Application measurements, time-series queries and storage diagnostics for Titan.

## Capabilities

- Counters, gauges, histograms and configurable collection.
- Memory storage or explicit PostgreSQL/SQLite adapters.
- Commit receipts, bounded buffering and observable write failures.

## Quick start

```sh
pnpm add @omnitron-dev/titan-metrics
```

```ts
import { TitanMetricsModule } from '@omnitron-dev/titan-metrics';

export const metrics = TitanMetricsModule.forRoot({
  appName: 'api',
  storage: { type: 'memory' },
});
```

Add this dynamic module to the `imports` of an existing Titan application.

For persistent history, provide `METRICS_STORAGE_TOKEN` with a SQL adapter and your existing Kysely connection. Apply the adapter's schema through the application's migration workflow. A persistent configuration never silently falls back to memory.

`record` and `recordBatch` enqueue measurements; `flush` awaits accepted writes. `recordDurable` requires persistent storage and returns commit evidence. Preserve measurement IDs across uncertain replies; reusing an ID with different content rejects.

`getStorageStatus()` reports queued and in-flight work, losses and errors. Await `stop()` before disposing an independently constructed service. SQL adapters enforce their durability settings; a database commit is not proof of backups or replica availability.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
