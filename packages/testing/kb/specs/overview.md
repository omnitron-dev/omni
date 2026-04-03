---
module: testing
title: "Cross-Runtime Testing Utilities"
tags: [testing, vitest, bun, deno, docker, performance]
summary: "Test adapters for Node/Bun/Deno, Docker containers, Titan-specific helpers"
depends_on: [titan, titan-database, titan-pm]
---

## Runtime Adapters

Auto-detects runtime and provides unified test API:

```typescript
import { loadRuntimeAdapter } from '@omnitron-dev/testing';

const adapter = await loadRuntimeAdapter(); // vitest/bun/deno
```

## Sub-exports

| Export | Purpose |
|--------|---------|
| `./runtime/vitest` | Vitest adapter (default for Node) |
| `./runtime/bun` | Bun test adapter |
| `./runtime/deno` | Deno test adapter |
| `./titan` | Titan-specific: DI container testing, PM mocks |
| `./docker` | Docker container lifecycle for integration tests |
| `./async` | Async test utilities (waitFor, eventually, timeout) |
| `./performance` | Performance profiling and benchmarks |
| `./helpers` | Common test helpers |

## Titan Testing

```typescript
import { createTestContainer } from '@omnitron-dev/testing/titan';

const container = await createTestContainer({
  modules: [AuthModule, DatabaseModule],
  overrides: [{ provide: REDIS_TOKEN, useValue: mockRedis }],
});

const authService = container.get(AuthService);
```
