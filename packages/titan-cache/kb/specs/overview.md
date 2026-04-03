---
module: titan-cache
title: "Multi-Tier Caching Module"
tags: [cache, lru, lfu, multi-tier, ttl, decorators]
summary: "In-memory caching with LRU/LFU eviction, TTL, multi-tier support, and decorator integration"
depends_on: [titan/nexus, titan-redis]
---

## Cache Types

| Type | Eviction | Best For |
|------|----------|----------|
| **LRUCache** | Least Recently Used | General purpose, hot data |
| **LFUCache** | Least Frequently Used | Skewed access patterns |
| **MultiTierCache** | L1 (memory) → L2 (Redis) | Distributed systems |

## Module Setup
```typescript
import { CacheModule } from '@omnitron-dev/titan-cache';

@Module({
  imports: [CacheModule.forRoot({ ttl: 60_000, max: 1000 })],
})
export class AppModule {}
```

## Decorator Usage
```typescript
@Cache({ ttl: 30_000, key: (id) => `user:${id}` })
async getUser(id: string): Promise<User> {
  return this.db.findUser(id);
}
```
