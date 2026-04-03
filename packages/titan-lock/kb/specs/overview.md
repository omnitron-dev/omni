---
module: titan-lock
title: "Distributed Lock Module"
tags: [lock, distributed, redis, mutex]
summary: "Redis-backed distributed locking with TTL, auto-renewal, and decorator support"
depends_on: [titan/nexus, titan-redis]
---

## Usage

```typescript
// Declarative
@Lock({ key: 'migration', ttl: 30_000 })
async runMigration(): Promise<void> {
  // Only one instance runs at a time
}

// Imperative
const lock = await this.lockService.acquire('resource:123', { ttl: 10_000 });
try {
  await this.doWork();
} finally {
  await lock.release();
}
```
