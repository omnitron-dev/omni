# @omnitron-dev/titan-notifications

Notification delivery with pluggable channels and Redis-backed Rotif messaging.

## Capabilities

- Durable broker publication, consumer groups and dead-letter queues.
- Configurable notification channels and lifecycle observers.
- A diagnostics adapter through `./diagnostics` using the same transport and queue.

## Quick start

```sh
pnpm add @omnitron-dev/titan-notifications
```

```ts
import { NotificationsModule } from '@omnitron-dev/titan-notifications';

export const notifications = NotificationsModule.forRoot({
  redis: { host: '127.0.0.1', port: 6379 },
});
```

Add this dynamic module to the `imports` of an existing Titan application.

Use a dedicated configured Redis service and register consumers for the channels you publish. The `./rotif` entry exposes the messaging layer directly.

Set `defaultChannels` to route sends without an explicit channel list. Broker acceptance returns `queued` with an empty channel receipt list. A broadcast counts those recipients in `pendingCount`. Registered channels return individual delivery receipts. If quota accounting fails after acceptance, `accountingErrors` identifies the affected channels. The service reports `partial` when some primaries succeeded, and `unconfirmed` when a provider may have accepted a request before its response was lost. Fallback channels run in order after confirmed non-delivery, subject to routing, preferences and quotas.

Rotif stores scheduled jobs and their receipts in Redis. Give replicas of the same notification service the same `deliveryScope`. Give independent services sharing Redis different scopes. To repeat a scheduling request, reuse the original payload ID, content, options and absolute due time. Use the returned `notificationId` with `getStatus` and `cancel`. Cancellation succeeds until a replica claims the job. A claimed job with an uncertain outcome keeps its receipt for reconciliation and does not repeat the external send. Confirmed terminal receipts remain available for seven days.

Await `waitUntilReady()` before handing a Rotif manager to publishers. Shutting down during startup rejects waiting callers and releases background timers. Managers that share a Redis database receive the complete subscription pattern, including colons in channel names.

Delivery rejects if no consumer accepts the event or a matching stream fails to acknowledge publication. Reuse stable event identities when retrying partial fan-out. A broker receipt confirms queue acceptance, not end-user delivery; consumers must make external effects idempotent.

Importing `./diagnostics` does not enable a messenger or publish events. Pass an explicitly configured notification module to its adapter. Observer failures are reported without resending notifications whose delivery already committed.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
