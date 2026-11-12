# @omnitron-dev/titan-ratelimit

Request and operation rate limits for Titan services.

## Capabilities

- Fixed-window, sliding-window and token-bucket strategies.
- Memory or Redis storage selected by configuration.
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

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
