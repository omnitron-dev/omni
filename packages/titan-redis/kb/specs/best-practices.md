---
module: titan-redis
title: "Redis Best Practices"
tags: [redis, cache, pubsub, lua, best-practices, performance]
summary: "Production Redis patterns: connection management, caching, Lua scripts, pub/sub, error handling"
depends_on: [overview]
---

# Redis Best Practices

## Connection Management

### DO: One module registration per app
```typescript
// CORRECT — single RedisModule at app root
@Module({
  imports: [
    TitanRedisModule.forRoot({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      db: 0,  // Explicit DB index
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    }),
  ],
})
export class AppModule {}
```

### DON'T: Multiple Redis connections
```typescript
// WRONG — creates separate connections per module
TitanRedisModule.forRoot({ db: 0 })  // in ModuleA
TitanRedisModule.forRoot({ db: 0 })  // in ModuleB — duplicate!

// CORRECT — register once, inject everywhere
@Inject(REDIS_DEFAULT_NAMESPACE) private redis: IRedisClient;
```

## DB Index Discipline

**NEVER rely on default DB 0.** Always set explicitly:

| DB | App | Content |
|----|-----|---------|
| 0 | Main | Auth sessions, general cache |
| 1 | Storage | Bucket metadata, presigned URLs |
| 2 | Messaging | Pub/sub channels, room state |
| 3 | Priceverse | Price data cache |
| 4 | PaySys | Payment idempotency keys |

## Caching Patterns

### DO: Use @RedisCache for method-level caching
```typescript
@RedisCache({
  key: (userId: string) => `user:profile:${userId}`,
  ttl: 300,  // 5 minutes
  strategy: 'cache-aside',
})
async getProfile(userId: string): Promise<UserProfile> {
  return this.repo.findById(userId); // Only called on cache miss
}
```

### DO: Invalidate on writes
```typescript
async updateProfile(userId: string, dto: UpdateProfileDto): Promise<void> {
  await this.repo.update(userId, dto);
  await this.redis.del(`user:profile:${userId}`); // Explicit invalidation
}
```

### DON'T: Cache mutable state without TTL
```typescript
// WRONG — stale data forever
await redis.set(`user:${id}`, JSON.stringify(user));

// CORRECT — always set TTL
await redis.set(`user:${id}`, JSON.stringify(user), 'EX', 300);
```

## Pub/Sub

### DO: Use for cross-process events
```typescript
// Publisher
await redis.publish('order:created', JSON.stringify({ orderId, userId }));

// Subscriber (separate connection — Redis pub/sub requirement)
const sub = redis.duplicate();
await sub.subscribe('order:created');
sub.on('message', (channel, message) => {
  const data = JSON.parse(message);
  // Handle event
});
```

### DON'T: Use pub/sub for reliable messaging
Redis pub/sub is fire-and-forget — messages are lost if no subscriber is connected.
Use Rotif or a queue for guaranteed delivery.

## Lua Scripts

### DO: Use for atomic operations
```typescript
// Atomic increment-and-check (rate limiting)
const script = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return current
`;
const count = await redis.eval(script, 1, `rate:${ip}`, '60');
```

### DON'T: Long-running Lua scripts
Redis is single-threaded — long scripts block ALL other operations.
Keep Lua scripts under 5ms execution time.

## Distributed Locking

### DO: Use @RedisLock for mutual exclusion
```typescript
@RedisLock({ key: 'migration', ttl: 30_000 })
async runMigration(): Promise<void> {
  // Only one instance runs at a time across the cluster
}
```

### DO: Set reasonable TTL (prevent deadlocks)
```typescript
// TTL should be > expected operation time but bounded
// If operation takes 10s normally, set TTL to 30s
@RedisLock({ key: 'sync', ttl: 30_000 })
```

## Error Handling

### DO: Handle connection loss gracefully
```typescript
redis.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
  // Don't throw — ioredis auto-reconnects
});

redis.on('reconnecting', (delay) => {
  logger.warn({ delay }, 'Redis reconnecting');
});
```

### DON'T: Crash on transient Redis errors
```typescript
// WRONG — kills the app on temporary Redis outage
try {
  return await redis.get(key);
} catch {
  process.exit(1);
}

// CORRECT — degrade gracefully
try {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);
} catch {
  // Cache miss or Redis down — fall through to DB
}
return this.repo.findById(id);
```

## Key Naming Convention

```
{app}:{entity}:{id}              → main:user:clz4k7m...
{app}:{entity}:{id}:{field}      → main:user:clz4k7m:profile
{app}:cache:{scope}:{key}        → storage:cache:bucket:list
{app}:lock:{resource}            → main:lock:migration
{app}:rate:{identifier}          → main:rate:ip:192.168.1.1
{app}:session:{sessionId}        → main:session:abc123
```
