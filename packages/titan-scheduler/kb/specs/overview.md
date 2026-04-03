---
module: titan-scheduler
title: "Scheduler Module"
tags: [cron, interval, timeout, jobs, persistence]
summary: "Cron jobs, intervals, timeouts with decorator discovery, metrics, and optional persistence"
depends_on: [titan/nexus, titan-redis]
---

## Decorators

```typescript
@Injectable()
export class MaintenanceService {
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async dailyBackup(): Promise<void> { /* ... */ }

  @Interval(60_000) // every 60 seconds
  async healthPing(): Promise<void> { /* ... */ }

  @Timeout(5_000) // 5 seconds after module init
  async warmupCache(): Promise<void> { /* ... */ }
}
```

## Persistence Providers
- **InMemoryPersistenceProvider** — Default, no persistence
- **RedisPersistenceProvider** — Survives restarts, distributed-safe
- **DatabasePersistenceProvider** — Audit trail of job executions

## Module Setup
```typescript
@Module({
  imports: [
    SchedulerModule.forRoot({
      persistence: { provider: 'redis' },
    }),
  ],
})
export class AppModule {}
```
