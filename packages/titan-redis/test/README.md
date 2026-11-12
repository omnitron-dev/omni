# Redis tests

The suite covers Redis service and manager behavior, connection budgets, decorators, shutdown, and Redis command semantics. Some tests use mocks; integration and topology tests require real Redis.

From the repository root:

```sh
pnpm --filter @omnitron-dev/titan-redis test
pnpm --filter @omnitron-dev/titan-redis exec vitest run test/module-stop-closes-clients.spec.ts
```

[Vitest configuration](../vitest.config.ts) disables file parallelism because a test file may own a multi-node Docker topology. [Global setup](../globalSetup.ts) reuses Titan's shared Redis setup. It selects the configured test endpoint or managed test infrastructure and fails when required infrastructure is unavailable.

`USE_MOCK_REDIS=true` explicitly selects unit-test mode; it is not evidence that real Redis behavior passed. Use a dedicated test endpoint: [the shared helper](utils/redis-test-utils.ts) cleans its scratch database.

- [Service tests](redis.service.spec.ts): mocked service behavior.
- [Real service tests](redis.service.real.spec.ts): Redis-backed behavior.
- [Test utilities](utils/redis-test-utils.ts): connections and Docker-managed fixtures.
- [Package README](../README.md): public configuration and module usage.

Keep cleanup scoped to each fixture's clients, containers, and data. Do not point these tests at an application's Redis database.
