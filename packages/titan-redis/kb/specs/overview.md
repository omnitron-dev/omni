---
module: titan-redis
title: "TitanRedisModule - Redis Integration"
tags: [redis, cache, lock, rate-limit, ioredis, clustering, decorators]
summary: "Redis module with connection management, multi-namespace support, forRoot/forFeature pattern, caching/locking/rate-limiting decorators, pub/sub, Lua scripting, and health indicators."
depends_on: ["@omnitron-dev/titan/nexus", "ioredis"]
---

# TitanRedisModule

Package: `@omnitron-dev/titan-redis`
Import: `@omnitron-dev/titan/module/redis`

Redis integration built on ioredis. Provides connection management with multi-namespace support, clustering, health monitoring, and method decorators for caching, distributed locking, and rate limiting.

## Module Setup

### forRoot (Single Connection)

```typescript
import { RedisModule } from '@omnitron-dev/titan/module/redis';

@Module({
  imports: [
    RedisModule.forRoot({
      config: {
        host: 'localhost',
        port: 6379,
        db: 0,
        namespace: 'default',
      },
      isGlobal: true,
    }),
  ],
})
export class AppModule {}
```

### forRoot (Multiple Connections)

```typescript
RedisModule.forRoot({
  clients: [
    { namespace: 'main', host: 'localhost', port: 6379, db: 0 },
    { namespace: 'cache', host: 'localhost', port: 6379, db: 1 },
    { namespace: 'pubsub', host: 'localhost', port: 6379, db: 2 },
  ],
  isGlobal: true,
})
```

### forRootAsync

```typescript
RedisModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (config: ConfigService) => ({
    config: {
      host: config.get('redis.host'),
      port: config.get('redis.port'),
      db: config.get('redis.db'),
      password: config.get('redis.password'),
    },
  }),
  inject: [CONFIG_SERVICE_TOKEN],
  isGlobal: true,
})
```

### forFeature (Named Clients)

Register additional named client tokens in feature modules:

```typescript
@Module({
  imports: [
    RedisModule.forFeature(['cache', 'sessions']),
  ],
})
export class CacheModule {}
```

## DI Tokens

```typescript
import {
  REDIS_MANAGER,            // RedisManager instance
  REDIS_MODULE_OPTIONS,     // Module options
  REDIS_DEFAULT_NAMESPACE,  // 'default'
  getRedisClientToken,      // Get token for named client
} from '@omnitron-dev/titan/module/redis';
```

## Injection Decorators

### @InjectRedis(namespace?)

Inject an `IRedisClient` for a specific namespace.

```typescript
import { InjectRedis, InjectRedisManager } from '@omnitron-dev/titan/module/redis';

@Injectable()
class CacheService {
  constructor(
    @InjectRedis()              // Default namespace
    private readonly redis: IRedisClient,

    @InjectRedis('cache')       // Named namespace
    private readonly cacheRedis: IRedisClient,
  ) {}

  async get(key: string) {
    return this.redis.get(key);
  }
}
```

### @InjectRedisManager()

Inject the `RedisManager` for multi-connection management.

```typescript
@Injectable()
class MultiDbService {
  constructor(
    @InjectRedisManager()
    private readonly manager: RedisManager
  ) {}

  getClient(namespace: string) {
    return this.manager.getClient(namespace);
  }
}
```

## RedisService

High-level service wrapping RedisManager. Injected by class reference.

```typescript
import { RedisService } from '@omnitron-dev/titan/module/redis';

@Injectable()
class MyService {
  constructor(private readonly redis: RedisService) {}

  // Client access
  getClient(namespace?: string): IRedisClient
  getOrThrow(namespace?: string): IRedisClient       // Throws NotFoundError
  getOrNil(namespace?: string): IRedisClient | null   // Returns null

  // Health
  async ping(namespace?: string): Promise<boolean>
  isReady(namespace?: string): boolean

  // Convenience operations
  async get(key: string, namespace?: string): Promise<string | null>
  async set(key: string, value: string, namespace?: string): Promise<void>

  // Lua scripts
  async loadScript(name: string, content: string, namespace?: string): Promise<string>
  async runScript<T>(name: string, keys: string[], args: (string|number)[], namespace?: string): Promise<T>

  // Pub/Sub
  createSubscriber(namespace?: string): IRedisClient   // Duplicate client for subscriptions
  async publish(channel: string, message: unknown, namespace?: string): Promise<number>

  // Batch operations
  pipeline(namespace?: string): IRedisPipeline
  multi(namespace?: string): IRedisPipeline            // Atomic transactions
}
```

## Method Decorators

All decorators gracefully fall back to uncached/unlocked/unlimited execution if no Redis client is found. They auto-discover the Redis client from `this.redisManager`, `this.redisService`, or `this.redis`.

### @RedisCache(options?)

```typescript
import { RedisCache } from '@omnitron-dev/titan/module/redis';

@Injectable()
class UserService {
  constructor(
    @InjectRedisManager()
    private readonly redisManager: RedisManager
  ) {}

  @RedisCache({ ttl: 3600 })  // 1 hour TTL
  async getUser(id: string) {
    return db.users.findById(id);
    // Key: "cache:getUser:<id>"
  }

  @RedisCache({
    ttl: 300,
    keyFn: (...args) => `user:profile:${args[0]}`,  // Custom key
    condition: (...args) => args[0] !== 'admin',     // Skip cache for admin
    namespace: 'cache',                               // Use named client
  })
  async getUserProfile(id: string) { /* ... */ }

  @RedisCache({ ttl: 60, refresh: true })  // Always refresh, cache for next caller
  async getLeaderboard() { /* ... */ }
}
```

**CacheOptions:**
| Option | Type | Description |
|---|---|---|
| `ttl` | `number` | Time-to-live in seconds (default: 3600) |
| `keyFn` | `(...args) => string` | Custom cache key function |
| `key` | `string` | Static key prefix |
| `condition` | `(...args) => boolean` | Skip cache when false |
| `refresh` | `boolean` | Always execute, cache result |
| `namespace` | `string` | Redis client namespace |

### @RedisLock(options?)

Distributed locking with retry and automatic release.

```typescript
@RedisLock({ ttl: 10, retries: 5, retryDelay: 200 })
async processPayment(paymentId: string) {
  // Lock key: "lock:<className>:processPayment:<paymentId>"
  // Automatically released after method completes (or on error)
}

@RedisLock({
  keyFn: (...args) => `order:${args[0]}`,
  ttl: 30,       // Lock expires in 30 seconds
  retries: 10,   // 10 retry attempts
  retryDelay: 100, // 100ms between retries
})
async fulfillOrder(orderId: string) { /* ... */ }
```

**LockOptions:**
| Option | Type | Default | Description |
|---|---|---|---|
| `ttl` | `number` | `10` | Lock TTL in seconds |
| `retries` | `number` | `10` | Max retry attempts |
| `retryDelay` | `number` | `100` | ms between retries |
| `keyFn` | `(...args) => string` | auto | Custom lock key |
| `key` | `string` | auto | Static key prefix |
| `namespace` | `string` | `'default'` | Redis client namespace |

Lock uses `SET NX EX` for atomic acquisition and cryptographically secure lock values to prevent collision attacks.

### @RedisRateLimit(options)

Sliding window rate limiting using Redis sorted sets.

```typescript
@RedisRateLimit({
  points: 100,          // Max 100 requests
  duration: 60000,      // Per 60 seconds
  blockDuration: 30000, // Block for 30s on limit exceed
  keyPrefix: 'api:v1',
})
async handleApiRequest(userId: string) { /* ... */ }
```

**RateLimitOptions:**
| Option | Type | Description |
|---|---|---|
| `points` / `limit` | `number` | Max requests in window |
| `duration` | `number` | Window in milliseconds |
| `window` | `number` | Window in seconds (alternative) |
| `blockDuration` | `number` | Block duration on exceed (ms) |
| `keyPrefix` | `string` | Key prefix for rate counter |
| `namespace` | `string` | Redis client namespace |

## DB Index Separation Convention

Omnitron services use separate Redis DB indices to avoid key collisions:

| Service | DB Index |
|---|---|
| Main | 0 (default) |
| Storage | 1 |
| Messaging | 2 |
| Priceverse | 3 |
| PaySys | 4 |

Titan modules (scheduler, cache) use the app-level `RedisModule` config -- no hardcoded DB indices.

## Health Indicator

```typescript
import { RedisHealthIndicator } from '@omnitron-dev/titan/module/redis';

// Auto-registered when using forRoot
// Prefer importing from '@omnitron-dev/titan/module/health' for new code
```

> **Deprecation**: `RedisHealthIndicator` and `HealthIndicator` from the redis module are deprecated. Use the versions from `@omnitron-dev/titan/module/health` instead.

## Type Guards

```typescript
import {
  isRedisClientReady,       // status === 'ready'
  isRedisClientAlive,       // connected or ready
  isRedisClientConnecting,  // status === 'connecting'
} from '@omnitron-dev/titan/module/redis';

if (isRedisClientReady(client)) {
  await client.ping();
}
```

## IRedisClient Interface

The module provides an abstraction layer (`IRedisClient`) over ioredis. Key properties:

```typescript
interface IRedisClient {
  status: string;                  // 'connecting' | 'ready' | 'close' | ...
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: any[]): Promise<any>;
  setex(key: string, seconds: number, value: string): Promise<string>;
  del(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  pipeline(): IRedisPipeline;
  multi(): IRedisPipeline;
  publish(channel: string, message: string): Promise<number>;
  subscribe(...channels: string[]): Promise<number>;
  script(command: string, ...args: any[]): Promise<any>;
  // ... full ioredis API
}
```

## Clustering Support

```typescript
RedisModule.forRoot({
  config: {
    cluster: {
      nodes: [
        { host: 'redis-1', port: 6379 },
        { host: 'redis-2', port: 6379 },
        { host: 'redis-3', port: 6379 },
      ],
      options: {
        scaleReads: 'slave',
        redisOptions: { password: 'secret' },
      },
    },
  },
})
```

## Utilities

```typescript
import { createRetryStrategy, getClientNamespace } from '@omnitron-dev/titan/module/redis';

// Custom retry strategy for connection failures
const retryStrategy = createRetryStrategy({ maxRetries: 10, baseDelay: 100 });
```
