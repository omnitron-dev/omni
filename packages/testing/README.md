# @omnitron-dev/testing

> Cross-runtime testing utilities for the Omni ecosystem

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add -D @omnitron-dev/testing
```

## Overview

Shared testing helpers, fixtures, and utilities used across Omni packages. Provides runtime-agnostic test infrastructure that works with both Vitest and Jest.

## Redis fixtures

`createRedisTestFixture` from `@omnitron-dev/testing/titan` uses the same
`resolveTestRedisEndpoint()` as the integration suites. It reads the endpoint
published by global setup, then the test environment. Without setup, configure
`TEST_REDIS_HOST` and `TEST_REDIS_PORT`; the default test port is **16379**, never
the developer's Redis on 6379.

```ts
import { createRedisTestFixture } from '@omnitron-dev/testing/titan';

const fixture = await createRedisTestFixture({ withManager: true, db: 15 });
try {
  await fixture.client.ping();
} finally {
  await fixture.cleanup();
}
```

Cleanup flushes the selected scratch database and closes the clients even when
flushing fails. Use a dedicated test Redis. Initialization failure also closes
allocated connections. Mock mode requires a mock fixture or an explicit real
endpoint; it does not silently connect to a developer service.

## License

MIT
