# @omnitron-dev/titan-ratelimit

Request and operation rate limits for Titan services.

## Capabilities

- Fixed-window, sliding-window and token-bucket strategies.
- Memory or Redis storage selected by configuration.
- Optional bounded waiting for an available slot, with per-tier priority and cancellation.
- Service decorators and HTTP middleware.

## Quick start

```sh
pnpm add @omnitron-dev/titan-ratelimit
```

```ts
import { TitanRateLimitModule } from '@omnitron-dev/titan-ratelimit';

export const ratelimit = TitanRateLimitModule.forRoot({
  storageType: 'memory',
  strategy: 'sliding-window',
  defaultLimit: 100,
  defaultWindowMs: 60_000,
});
```

Add this dynamic module to the `imports` of an existing Titan application.

Memory limits belong to one process. Configure Redis when multiple instances must share a budget, and derive keys from admitted identity rather than untrusted headers. Rate limiting supplements authentication and resource authorization.

Set `queueEnabled`, `maxQueueSize` and `queueTimeoutMs` to let consuming requests wait for capacity. Each instance bounds its own waiters. Every admission still consumes a slot in the configured storage backend. `getStatus` returns immediately. Pass an `AbortSignal` to withdraw a waiter. If storage loses an acquisition response, the caller receives that error.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
