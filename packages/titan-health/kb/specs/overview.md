---
module: titan-health
title: "Health Check Module"
tags: [health, indicators, monitoring, readiness, liveness]
summary: "Extensible health checks with built-in indicators for memory, event loop, disk, DB, Redis"
depends_on: [titan/nexus]
---

## Built-in Indicators

| Indicator | Checks | Optional Dep |
|-----------|--------|-------------|
| **MemoryHealthIndicator** | Heap usage vs threshold | — |
| **EventLoopHealthIndicator** | Event loop lag | — |
| **DiskHealthIndicator** | Disk usage percentage | — |
| **DatabaseHealthIndicator** | DB connectivity + query | kysely |
| **RedisHealthIndicator** | Redis PING | ioredis |

## Custom Indicators
```typescript
@Injectable()
export class ApiHealthIndicator extends HealthIndicator {
  async check(): Promise<HealthIndicatorResult> {
    const isHealthy = await this.ping('https://api.example.com');
    return this.getStatus('external-api', isHealthy);
  }
}
```

## RPC Integration
`HealthRpcService` exposes health checks as Netron RPC endpoints for monitoring.
