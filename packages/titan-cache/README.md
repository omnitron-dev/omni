# @omnitron-dev/titan-cache

Configurable caching for Titan services, with in-memory policies and optional multiple tiers.

## Capabilities

- LRU, LFU and TTL behavior.
- Named caches, cache decorators and statistics.
- Optional compression and an application-supplied second-tier adapter.

## Quick start

```sh
pnpm add @omnitron-dev/titan-cache
```

```ts
import { TitanCacheModule } from '@omnitron-dev/titan-cache';

export const cache = TitanCacheModule.forRoot({
  maxSize: 1000,
  defaultTtl: 300,
  evictionPolicy: 'lru',
});
```

Add this dynamic module to the `imports` of an existing Titan application.

Configure the second-tier client explicitly when sharing cache state between processes. Cache entries are derived data; applications own invalidation and access-sensitive cache keys.

## Documentation

[Public API](src/index.ts) · [Package exports](package.json) · [Omni](../../README.md)

## License

[MIT](../../LICENSE).
