# @omnitron-dev/eventemitter

Synchronous and asynchronous event delivery for application code. The implementation owns its listener registry and supports Node.js, Bun and browser callers.

## Capabilities

- Parallel, serial and reduction-based asynchronous emission.
- Optional concurrency limits and unsubscribe functions.
- Separate enhanced emitter, history, wildcard, scheduling and metrics APIs.

## Quick start

```sh
pnpm add @omnitron-dev/eventemitter
```

```ts
import { EventEmitter } from '@omnitron-dev/eventemitter';

const events = new EventEmitter(4);
events.on('saved', async (id: string) => {
  console.log('Saved', id);
});
await events.emitParallel('saved', 'record-42');
```

Await asynchronous emission when the producer needs completion or failure from its listeners. Delivery within a process does not provide a durable queue or roll back side effects.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
