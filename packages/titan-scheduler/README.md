# @omnitron-dev/titan-scheduler

Cron, interval and timeout jobs integrated with Titan's lifecycle.

## Capabilities

- Decorator and service APIs for scheduled work.
- Execution metrics and health reporting.
- Optional persistence through the `./persistence` entry.

## Quick start

```sh
pnpm add @omnitron-dev/titan-scheduler
```

```ts
import { SchedulerModule } from '@omnitron-dev/titan-scheduler';

export const scheduler = SchedulerModule.forRoot({ enableMetrics: true });
```

Add this dynamic module to the `imports` of an existing Titan application.

Register schedulable providers with the application and configure persistence when schedules must survive restarts. A persisted schedule is not an exactly-once guarantee for its external effects; jobs must define their retry and idempotency behavior.

Set `preventOverlap: true` for periodic work that updates one resource. An executor reserves the job name as soon as it accepts a run, including time spent in its queue or retry backoff. A handler that is still working after its deadline or cancellation retains the reservation until it settles. During that interval another trigger reports `cancelled` and a timed-out attempt cannot start a concurrent retry. Coordinate effects shared by multiple processes at the resource itself.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
