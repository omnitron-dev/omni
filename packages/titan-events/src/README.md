# Titan event services

`@omnitron-dev/titan-events` integrates application events with Titan modules and dependency injection. Configure `EventsModule.forRoot(options)`, or `forRootAsync` when configuration depends on providers, and resolve services through the exported tokens.

```ts
import { EventsModule } from '@omnitron-dev/titan-events';

export const events = EventsModule.forRoot({
  wildcard: true,
  delimiter: '.',
  history: { enabled: true, maxSize: 500 },
});
```

The module owns listener discovery and cleanup. Await `emitAsync` when completion of asynchronous listeners matters; use `emitSerial` when listeners must run sequentially.

| Source | Responsibility |
| --- | --- |
| [Module](events.module.ts) | Providers and lifecycle |
| [Events service](events.service.ts) | Subscriptions and emission |
| [Decorators](events.decorators.ts) | Listener and emission metadata |
| [Event bus](event-bus.service.ts) | Channels, queues, and backpressure policy |
| [History](event-history.service.ts) | Recording and replay |
| [Scheduler](event-scheduler.service.ts) | Scheduled event jobs |
| [Validation](event-validation.service.ts) | Event schema checks |
| [Health indicator](events.health.ts) | Service health reporting |

Default bus queues and history are held in memory. Enabling history does not make events durable across restarts. Select queue limits and overflow behavior for the workload, and await module shutdown to remove listeners and timers.

See [public exports](index.ts), [option types](types.ts), and the [package README](../README.md) for application integration.
