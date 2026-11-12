# @omnitron-dev/titan-discovery

Redis-backed service registration and lookup for Titan applications.

## Capabilities

- Registration, heartbeats and service lookup.
- Health-aware discovery and optional Netron integration.
- A dedicated Redis connection or a bridge to an existing Redis module.

## Quick start

```sh
pnpm add @omnitron-dev/titan-discovery
```

```ts
import { DiscoveryModule } from '@omnitron-dev/titan-discovery';

export const discovery = DiscoveryModule.forRoot({ redisUrl: 'redis://127.0.0.1:6379' });
```

Add this dynamic module to the `imports` of an existing Titan application.

Use an application-owned Redis endpoint. Omitting standalone Redis settings requires the existing `REDIS_MANAGER` provider. Discovery identifies available services; authentication and authorization remain with the connected transport.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
