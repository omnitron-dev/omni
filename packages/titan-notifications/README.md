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

Delivery rejects if no consumer accepts the event or a matching stream fails to acknowledge publication. Reuse stable event identities when retrying partial fan-out. A broker receipt confirms queue acceptance, not end-user delivery; consumers must make external effects idempotent.

Importing `./diagnostics` does not enable a messenger or publish events. Pass an explicitly configured notification module to its adapter. Observer failures are reported without resending notifications whose delivery already committed.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
