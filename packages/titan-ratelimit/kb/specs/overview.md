---
module: titan-ratelimit
title: "Rate Limiting Module"
tags: [ratelimit, throttle, algorithms, redis, middleware]
summary: "Token bucket, sliding window, fixed window rate limiters with Redis storage and decorators"
depends_on: [titan/nexus, titan-redis]
---

## Algorithms
- **Token Bucket** — Smooth rate limiting with burst allowance
- **Sliding Window** — Precise window-based counting
- **Fixed Window** — Simple counter per time window

## Decorator Usage
```typescript
@RateLimit({ limit: 100, window: '1m', key: 'ip' })
async apiEndpoint(): Promise<Response> { /* ... */ }

@Throttle({ calls: 5, period: '10s' })
async sensitiveOperation(): Promise<void> { /* ... */ }
```

## Middleware Integration
Integrates with Netron HTTP middleware for automatic rate limiting on RPC endpoints.
