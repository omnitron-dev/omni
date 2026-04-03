---
module: titan-events
title: "Event Bus Module"
tags: [events, bus, decorators, scheduling, validation]
summary: "Domain event bus with decorators, event validation (Zod), scheduling, and history"
depends_on: [titan/nexus]
---

## Key Services

- **EventBusService** — Core pub/sub: emit, listen, once
- **EventSchedulerService** — Delayed and periodic events
- **EventValidationService** — Zod schema validation on events
- **EventHistoryService** — Event audit trail

## Decorator-Driven Events
```typescript
@Injectable()
export class OrderHandler {
  @OnEvent('order.created')
  async handleOrderCreated(order: Order): Promise<void> { /* ... */ }

  @OnceEvent('system.initialized')
  async onStartup(): Promise<void> { /* runs once */ }

  @ScheduleEvent('cleanup', { cron: '0 3 * * *' })
  async dailyCleanup(): Promise<void> { /* ... */ }

  @BatchEvents('metrics.collect', { batchSize: 100, flushInterval: 5000 })
  async processBatch(events: MetricEvent[]): Promise<void> { /* ... */ }
}
```
