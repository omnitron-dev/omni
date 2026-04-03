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
const requests = metrics.counter('http_requests_total', { labels: ['method', 'path'] });
requests.inc({ method: 'GET', path: '/api/users' });

// Gauge (can go up and down)
const connections = metrics.gauge('active_connections');
connections.set(42);

// Histogram (distribution of values)
const latency = metrics.histogram('request_duration_ms', { buckets: [10, 50, 100, 500] });
latency.observe(23.5);
```

## Decorator
```typescript
@Metrics({ name: 'user_service', track: ['duration', 'calls', 'errors'] })
async getUser(id: string): Promise<User> { /* auto-instrumented */ }
```

## Storage Backends
- **MemoryMetricsStorage** — Default, in-process
- **PostgresMetricsStorage** — For persistent historical metrics
- **SQLiteMetricsStorage** — For lightweight persistence
