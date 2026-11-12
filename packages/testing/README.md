# @omnitron-dev/testing

Shared test utilities for Omni packages, including runtime adapters, asynchronous assertions and isolated infrastructure fixtures.

## Capabilities

- Explicit Vitest, Bun, Deno and Node test entry points.
- Titan application helpers, performance tools and test environment configuration.
- Docker and Redis fixtures for integration tests.

## Quick start

```sh
pnpm add -D @omnitron-dev/testing
```

```ts
import { createRedisTestFixture } from '@omnitron-dev/testing/titan';

const fixture = await createRedisTestFixture({ withManager: true, db: 15 });
try {
  await fixture.client.ping();
} finally {
  await fixture.cleanup();
}
```

Use a dedicated test Redis: cleanup flushes the selected database. The fixture reads the endpoint published by global setup, then `TEST_REDIS_HOST` and `TEST_REDIS_PORT`; its default test port is `16379`. Mock mode requires a mock fixture or an explicit real endpoint and does not connect to a developer service silently.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
