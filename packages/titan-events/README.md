# @omnitron-dev/titan-events

An application event bus integrated with Titan's dependency injection and lifecycle.

## Capabilities

- Decorator-based handlers and programmatic subscriptions.
- Event validation, wildcard matching and scheduled emission.
- Awaitable asynchronous delivery with explicit error policies.

## Quick start

```sh
pnpm add @omnitron-dev/titan-events
```

```ts
import { EventsModule } from '@omnitron-dev/titan-events';

export const events = EventsModule.forRoot({});
```

Add this dynamic module to the `imports` of an existing Titan application.

Await `emitAsync` when the producer must observe handler failures. Regular and wildcard handlers propagate failures; multiple failed groups use `AggregateError`. Handler error policies still apply. Event delivery is not a transaction and cannot undo completed side effects.

Decorated methods on resolved singleton providers are registered during application startup. Each `@BatchEvents({ event, maxSize, maxWait })` subscriber receives an array of payloads in arrival order. The first limit reached triggers delivery. Other handlers on the same event continue to receive individual payloads. Removing the provider’s handlers discards its pending partial batches. Applications that resolve further listeners after startup can call `EventDiscoveryService.discoverAllHandlers()` to register them.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
