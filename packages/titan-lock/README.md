# @omnitron-dev/titan-lock

Redis-backed lock ownership, expiry and renewal for cooperating Titan services.

## Capabilities

- Atomic acquisition, release and extension with ownership IDs.
- Configurable TTL, retries and backoff.
- `withLock` and decorators for protected operations.

## Quick start

```sh
pnpm add @omnitron-dev/titan-lock
```

```ts
import { TitanLockModule } from '@omnitron-dev/titan-lock';

export const lock = TitanLockModule.forRoot({ keyPrefix: 'app:locks', defaultTtl: 30_000 });
```

Add this dynamic module to the `imports` of an existing Titan application.

Register Titan Redis first; the lock module resolves its client through `REDIS_MANAGER`. `withLock` renews by default while its callback runs. Applications still own transaction boundaries and reconciliation after a lost response or expired lease. A lock does not provide a universal deadlock-prevention guarantee.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
