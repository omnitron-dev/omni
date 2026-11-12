# @omnitron-dev/titan-redis

Lifecycle-managed Redis clients for Titan applications.

## Capabilities

- Named clients, common connection settings and Redis Cluster options.
- Client injection, scripts, health checks and error callbacks.
- Bounded shutdown through the owning application lifecycle.

## Quick start

```sh
pnpm add @omnitron-dev/titan-redis
```

```ts
import { TitanRedisModule } from '@omnitron-dev/titan-redis';

export const redis = TitanRedisModule.forRoot({
  config: { host: '127.0.0.1', port: 6379 },
});
```

Add this dynamic module to the `imports` of an existing Titan application.

The module uses Titan's logger provider and exposes `RedisManager`, `RedisService` and injection tokens. Choose namespaces, credentials and database indexes for your application; this package does not impose an application-wide database-number convention. Redis Cluster uses database zero.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
