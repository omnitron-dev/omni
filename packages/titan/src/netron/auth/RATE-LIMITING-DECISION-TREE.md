# Rate Limiting Decision Tree

## Overview

Netron provides three distinct rate limiting implementations, each optimized for different use cases:

1. **RateLimiter Class** (`rate-limiter.ts`) - Advanced, production-ready with tiered limits and sophisticated strategies
2. **Middleware rateLimit()** (`middleware/builtin.ts`) - Simple, fast connection-level protection
3. **Policy requireRateLimit()** (`built-in-policies.ts`) - Auth-integrated rate limiting with full context awareness

This guide helps you choose the right approach for your needs.

---

## Decision Flow

```
START: Do I need rate limiting?
         |
         YES
         |
         v
┌────────────────────────────────────────────────────────────────┐
│ Q1: Do different users need different rate limits?             │
│     (e.g., free vs premium vs enterprise tiers)                │
└────────────────────────────────────────────────────────────────┘
         |
    ┌────┴────┐
    |         |
   YES        NO
    |         |
    v         v
 Use RateLimiter   ┌────────────────────────────────────────────┐
 (Advanced)        │ Q2: Do you need user/auth context for      │
                   │     rate limiting decisions?               │
                   └────────────────────────────────────────────┘
                            |
                       ┌────┴────┐
                       |         |
                      YES        NO
                       |         |
                       v         v
                  Use Policy    Use Middleware
                  requireRateLimit()  rateLimit()
                  (Auth-aware)  (Simple)
```

---

## Scenario-Based Selection

### Scenario 1: Different Limits for Different User Tiers

**Indicators:**
- SaaS application with pricing tiers
- Need to enforce different limits based on subscription level
- Want burst allowance for premium users
- Need queue support with priority handling

**Solution:** **RateLimiter Class** with tiered configuration

**Example:**
```typescript
import { RateLimiter } from '@omnitron-dev/titan/netron/auth';

const limiter = new RateLimiter(logger, {
  strategy: 'sliding',
  window: 60000, // 1 minute
  queue: true,
  defaultTier: { name: 'free', limit: 100 },
  tiers: {
    premium: { name: 'premium', limit: 1000, burst: 50, priority: 5 },
    enterprise: { name: 'enterprise', limit: 10000, burst: 200, priority: 10 }
  }
});

// Use in policy
const policy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'free', limit: 100 },
  tiers: {
    premium: { name: 'premium', limit: 1000, burst: 50 },
    enterprise: { name: 'enterprise', limit: 10000, burst: 200 }
  },
  getTier: (ctx) => {
    if (ctx.auth?.roles.includes('enterprise')) return 'enterprise';
    if (ctx.auth?.roles.includes('premium')) return 'premium';
    return undefined; // Uses defaultTier (free)
  }
});

@Service('api@1.0.0')
@UsePolicy(policy)
class ApiService { ... }
```

**Benefits:**
- ✅ Different limits per tier
- ✅ Burst traffic handling
- ✅ Queue with priority
- ✅ Detailed statistics
- ✅ Auto cleanup (no memory leaks)

---

### Scenario 2: User-Aware Rate Limiting After Authentication

**Indicators:**
- Need to track limits per authenticated user
- Rate limiting is part of authorization flow
- Want to use user ID from auth context
- Need rate limit info in audit logs

**Solution:** **Policy requireRateLimit()** with auth integration

**Example:**
```typescript
import { BuiltInPolicies } from '@omnitron-dev/titan/netron/auth';

const rateLimitPolicy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
});

@Service('orders@1.0.0')
@UsePolicy(rateLimitPolicy)
class OrderService {
  @Public()
  async createOrder(data: OrderData) {
    // This method is rate-limited per user
    // Uses context.auth.userId for tracking
  }
}
```

**Benefits:**
- ✅ Integrates with auth subsystem
- ✅ Uses authenticated user ID for tracking
- ✅ Part of policy evaluation chain
- ✅ Automatic cleanup via RateLimiter
- ✅ Detailed error responses with retry-after

---

### Scenario 3: Simple Global Rate Limiting (No Auth Required)

**Indicators:**
- Public endpoints without authentication
- Same limit for all clients
- Want basic DDoS protection
- Need fast, minimal overhead solution
- Connection/IP-based limiting

**Solution:** **Middleware rateLimit()**

**Example:**
```typescript
import { NetronBuiltinMiddleware } from '@omnitron-dev/titan/netron';

// Apply globally to all services
netron.use(
  NetronBuiltinMiddleware.rateLimit({
    maxRequests: 100,
    window: 60000  // 100 requests per minute for everyone
  }),
  {},
  MiddlewareStage.PRE_PROCESS
);
```

**Benefits:**
- ✅ One-liner setup
- ✅ Minimal overhead
- ✅ Executes before authentication
- ✅ Fast rejection of excessive requests
- ✅ No dependencies on auth context

**Limitations:**
- ❌ Same limit for all clients
- ❌ No automatic cleanup (relies on GC)
- ❌ No statistics tracking
- ❌ Fixed window only

---

## Strategy Selection Guide

Once you've chosen RateLimiter or requireRateLimit(), pick the right strategy:

### Sliding Window
**Best for:** Most accurate rate limiting, prevents burst at window boundaries

```typescript
{
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
}
```

**Characteristics:**
- ✅ Most accurate (tracks individual timestamps)
- ✅ No burst at window boundaries
- ⚠️ Higher memory usage (stores timestamps)
- ⚠️ Slightly slower than fixed window

**Use when:**
- Accuracy is critical
- You want to prevent window boundary abuse
- Memory usage is acceptable

---

### Fixed Window
**Best for:** Simple, efficient rate limiting with lower memory usage

```typescript
{
  strategy: 'fixed',
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
}
```

**Characteristics:**
- ✅ Lower memory usage (stores count + reset time)
- ✅ Faster than sliding window
- ⚠️ Allows burst at window boundaries
- ⚠️ Less accurate

**Use when:**
- Performance is priority
- Memory efficiency is important
- Window boundary bursts are acceptable

---

### Token Bucket
**Best for:** Supporting burst traffic while maintaining steady-state limits

```typescript
{
  strategy: 'token-bucket',
  window: 60000,
  defaultTier: { name: 'default', limit: 100, burst: 20 }
}
```

**Characteristics:**
- ✅ Supports burst traffic naturally
- ✅ Tokens refill gradually
- ✅ Flexible for variable workloads
- ⚠️ Moderate complexity

**Use when:**
- You need to allow temporary bursts
- Users have variable usage patterns
- You want smooth rate limiting over time

---

## Quick Reference Table

| Scenario | Solution | Where Applied | Auth Required | Tiered Limits | Memory |
|----------|----------|---------------|---------------|---------------|--------|
| **Different user tiers** | RateLimiter + Policy | Auth subsystem | ✅ Yes | ✅ Yes | High |
| **User-aware limiting** | requireRateLimit() | Auth subsystem | ✅ Yes | ⚠️ Optional | Medium |
| **Simple DDoS protection** | Middleware rateLimit() | Middleware layer | ❌ No | ❌ No | Low |
| **Public API endpoint** | Middleware rateLimit() | Middleware layer | ❌ No | ❌ No | Low |
| **Internal service mesh** | Middleware rateLimit() | Middleware layer | ❌ No | ❌ No | Low |
| **SaaS with pricing tiers** | requireRateLimit() | Auth subsystem | ✅ Yes | ✅ Yes | High |
| **Multi-tenant API** | requireRateLimit() | Auth subsystem | ✅ Yes | ✅ Yes | High |

---

## Anti-Patterns to Avoid

### ❌ Don't Use Middleware rateLimit() for User-Specific Limits

**Wrong:**
```typescript
// This won't work - same limit for everyone!
netron.use(NetronBuiltinMiddleware.rateLimit({
  maxRequests: 100,
  window: 60000
}));
```

**Right:**
```typescript
// Use policy for user-specific limits
const policy = BuiltInPolicies.requireRateLimit(logger, {
  defaultTier: { name: 'free', limit: 100 },
  tiers: {
    premium: { name: 'premium', limit: 1000 }
  },
  getTier: (ctx) => ctx.auth?.subscription
});
```

---

### ❌ Don't Use RateLimiter for Simple Cases

**Wrong:**
```typescript
// Overkill for simple global limiting
const limiter = new RateLimiter(logger, {
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
});
// Then wrap in middleware manually...
```

**Right:**
```typescript
// Just use the simple middleware
netron.use(NetronBuiltinMiddleware.rateLimit({
  maxRequests: 100,
  window: 60000
}));
```

---

### ❌ Don't Mix Multiple Rate Limiters on Same Endpoint

**Wrong:**
```typescript
// Applying both middleware and policy rate limiting
netron.use(NetronBuiltinMiddleware.rateLimit({ maxRequests: 100 }));

@Service('api@1.0.0')
@UsePolicy(BuiltInPolicies.requireRateLimit(logger, { ... }))
class ApiService { ... }
// Now requests are rate-limited twice!
```

**Right:**
```typescript
// Choose one approach - usually policy for granular control
@Service('api@1.0.0')
@UsePolicy(BuiltInPolicies.requireRateLimit(logger, {
  defaultTier: { name: 'default', limit: 100 }
}))
class ApiService { ... }
```

---

## Performance Considerations

| Implementation | Throughput | Latency | Memory/User | Cleanup |
|----------------|------------|---------|-------------|---------|
| **Middleware rateLimit()** | Highest | Lowest | ~16 bytes | None (GC) |
| **RateLimiter (fixed)** | High | Low | ~32 bytes | Auto (5 min) |
| **RateLimiter (sliding)** | Medium | Medium | ~80 bytes* | Auto (5 min) |
| **RateLimiter (token-bucket)** | High | Low | ~48 bytes | Auto (5 min) |

*Memory per user depends on request rate and window size

**Benchmarks (from test suite):**
- RateLimiter: 12,000+ checks/sec
- Middleware: ~15,000+ checks/sec (estimated)
- Both handle concurrent requests safely

---

## Migration Paths

### From Middleware to Policy

**Before:**
```typescript
netron.use(NetronBuiltinMiddleware.rateLimit({
  maxRequests: 100,
  window: 60000
}));
```

**After:**
```typescript
const policy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'fixed', // Similar to middleware behavior
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
});

@Service('api@1.0.0')
@UsePolicy(policy)
class ApiService { ... }
```

**When to migrate:**
- Need user-specific limits
- Want to add tiered pricing
- Need detailed statistics
- Require automatic cleanup

---

## Next Steps

- See [Migration Guide](./RATE-LIMITING-MIGRATION-GUIDE.md) for detailed migration instructions
- See [README](./README.md) for complete API reference and examples
- Check test files for comprehensive usage examples
