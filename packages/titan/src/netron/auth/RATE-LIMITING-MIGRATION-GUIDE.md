# Rate Limiting Migration Guide

## Overview

This guide covers common migration scenarios for Netron's rate limiting implementations, including:

- Upgrading from simple middleware to advanced rate limiting
- Migrating from inline policy implementation to RateLimiter-based policy
- Moving between different strategies
- Adding tiered limits to existing implementations
- Distributed rate limiting preparation

---

## Table of Contents

1. [Migration Scenario 1: Simple to Advanced (Middleware → Policy)](#scenario-1-simple-to-advanced-middleware--policy)
2. [Migration Scenario 2: Adding User Awareness](#scenario-2-adding-user-awareness)
3. [Migration Scenario 3: Introducing Tiered Limits](#scenario-3-introducing-tiered-limits)
4. [Migration Scenario 4: Old Inline Policy → RateLimiter-Based](#scenario-4-old-inline-policy--ratelimiter-based)
5. [Migration Scenario 5: Changing Strategies](#scenario-5-changing-strategies)
6. [Migration Scenario 6: Adding Queue Support](#scenario-6-adding-queue-support)
7. [Breaking Changes and Deprecations](#breaking-changes-and-deprecations)

---

## Scenario 1: Simple to Advanced (Middleware → Policy)

### When to Migrate

You should migrate from middleware to policy-based rate limiting when:
- You need different limits for different users
- You want to track rate limits per authenticated user
- You need detailed statistics and monitoring
- You want automatic cleanup (avoid memory leaks)

### Before: Simple Middleware

```typescript
import { NetronBuiltinMiddleware, MiddlewareStage } from '@omnitron-dev/titan/netron';

// Global rate limiting for all services
netron.use(
  NetronBuiltinMiddleware.rateLimit({
    maxRequests: 100,
    window: 60000  // 100 requests per minute
  }),
  {},
  MiddlewareStage.PRE_PROCESS
);
```

**Characteristics:**
- Same limit for all clients
- Connection/IP-based tracking (via clientId)
- No automatic cleanup
- No statistics

### After: Policy-Based Rate Limiting

```typescript
import { BuiltInPolicies } from '@omnitron-dev/titan/netron/auth';
import { logger } from './your-logger';

// Create rate limit policy
const rateLimitPolicy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'fixed',  // Similar to middleware behavior
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
});

// Apply to specific service
@Service('api@1.0.0')
@UsePolicy(rateLimitPolicy)
class ApiService {
  @Public()
  async getData() {
    // Rate-limited per user
  }
}
```

**Benefits:**
- ✅ User-aware (uses auth context)
- ✅ Automatic cleanup every 5 minutes
- ✅ Detailed statistics tracking
- ✅ Can be applied selectively per service

### Migration Steps

1. **Create the logger instance** (required for RateLimiter)
   ```typescript
   import { logger } from '@omnitron-dev/titan/module/logger';
   ```

2. **Define the rate limit policy**
   ```typescript
   const rateLimitPolicy = BuiltInPolicies.requireRateLimit(logger, {
     strategy: 'fixed',
     window: 60000,
     defaultTier: { name: 'default', limit: 100 }
   });
   ```

3. **Remove global middleware** (if replacing entirely)
   ```typescript
   // Remove this:
   // netron.use(NetronBuiltinMiddleware.rateLimit(...));
   ```

4. **Apply policy to services**
   ```typescript
   @Service('api@1.0.0')
   @UsePolicy(rateLimitPolicy)
   class ApiService { ... }
   ```

5. **Test thoroughly** - Ensure auth context is available

### Common Pitfalls

❌ **Forgetting to provide logger:**
```typescript
// Wrong - will fail
const policy = BuiltInPolicies.requireRateLimit({
  strategy: 'fixed',
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
});
```

✅ **Correct:**
```typescript
const policy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'fixed',
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
});
```

---

## Scenario 2: Adding User Awareness

### When to Migrate

Migrate to user-aware rate limiting when:
- You have authentication in place
- You need per-user tracking instead of per-IP
- You want to identify abusive users
- You need audit trails per user

### Before: IP-Based Middleware

```typescript
netron.use(
  NetronBuiltinMiddleware.rateLimit({
    maxRequests: 1000,
    window: 60000
  }),
  {},
  MiddlewareStage.PRE_PROCESS
);
```

**Issue:** Tracks by `clientId` (often IP), so multiple users behind same NAT share limits.

### After: User-Based Policy

```typescript
const rateLimitPolicy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'default', limit: 1000 }
});

@Service('api@1.0.0')
@UsePolicy(rateLimitPolicy)  // Applied after authentication
class ApiService { ... }
```

**Improvement:** Tracks by `context.auth.userId`, so each user has independent limit.

### Migration Steps

1. **Ensure authentication middleware is in place**
   ```typescript
   netron.use(authenticationMiddleware, {}, MiddlewareStage.PRE_INVOKE);
   ```

2. **Create user-aware policy**
   ```typescript
   const policy = BuiltInPolicies.requireRateLimit(logger, {
     strategy: 'sliding',
     window: 60000,
     defaultTier: { name: 'default', limit: 1000 }
   });
   ```

3. **Apply to authenticated services**
   ```typescript
   @Service('api@1.0.0')
   @UsePolicy(BuiltInPolicies.requireAuth(), policy)
   class ApiService { ... }
   ```

4. **Handle anonymous users** (if needed)
   - Policy automatically falls back to `context.environment.ip` for anonymous users
   - Or require authentication with `requireAuth()` policy first

---

## Scenario 3: Introducing Tiered Limits

### When to Migrate

Add tiered limits when:
- Launching pricing tiers (free, premium, enterprise)
- Need different limits based on user roles
- Want to incentivize upgrades
- Need to support burst traffic for premium users

### Before: Single-Tier Rate Limiting

```typescript
const policy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
});
```

**Limitation:** All users get same 100 requests/minute limit.

### After: Multi-Tier Rate Limiting

```typescript
const policy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',
  window: 60000,
  queue: true,  // Queue premium/enterprise requests
  defaultTier: { name: 'free', limit: 100 },
  tiers: {
    premium: {
      name: 'premium',
      limit: 1000,
      burst: 50,      // Allow temporary bursts
      priority: 5     // Higher priority in queue
    },
    enterprise: {
      name: 'enterprise',
      limit: 10000,
      burst: 200,
      priority: 10    // Highest priority
    }
  },
  getTier: (ctx) => {
    // Determine tier from auth context
    if (ctx.auth?.roles.includes('enterprise')) return 'enterprise';
    if (ctx.auth?.roles.includes('premium')) return 'premium';
    return undefined; // Uses defaultTier (free)
  }
});
```

### Migration Steps

1. **Define tier structure**
   ```typescript
   const tiers = {
     free: { name: 'free', limit: 100 },
     premium: { name: 'premium', limit: 1000, burst: 50 },
     enterprise: { name: 'enterprise', limit: 10000, burst: 200 }
   };
   ```

2. **Implement tier selector function**
   ```typescript
   const getTier = (ctx: ExecutionContext): string | undefined => {
     const userRoles = ctx.auth?.roles || [];

     if (userRoles.includes('enterprise')) return 'enterprise';
     if (userRoles.includes('premium')) return 'premium';

     // Return undefined to use defaultTier
     return undefined;
   };
   ```

3. **Update policy configuration**
   ```typescript
   const policy = BuiltInPolicies.requireRateLimit(logger, {
     strategy: 'sliding',
     window: 60000,
     defaultTier: tiers.free,
     tiers: {
       premium: tiers.premium,
       enterprise: tiers.enterprise
     },
     getTier
   });
   ```

4. **Update auth context to include subscription/role info**
   ```typescript
   // In your authentication middleware
   ctx.auth = {
     userId: user.id,
     roles: user.subscription === 'enterprise' ? ['enterprise'] :
            user.subscription === 'premium' ? ['premium'] : [],
     // ... other auth fields
   };
   ```

### Advanced: Database-Driven Tiers

For dynamic tier configuration:

```typescript
import { db } from './database';

const policy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'free', limit: 100 },
  tiers: {
    premium: { name: 'premium', limit: 1000 },
    enterprise: { name: 'enterprise', limit: 10000 }
  },
  getTier: async (ctx) => {
    // Fetch subscription from database
    const user = await db.users.findById(ctx.auth?.userId);
    return user?.subscription; // 'free', 'premium', or 'enterprise'
  }
});
```

---

## Scenario 4: Old Inline Policy → RateLimiter-Based

### Background

The old `BuiltInPolicies.rateLimit()` implementation had a memory leak issue (no cleanup). It has been **refactored** to use `RateLimiter` internally.

### Before: Old Inline Implementation (Deprecated)

```typescript
// Old implementation (had memory leak)
const policy = BuiltInPolicies.rateLimit(100, 60000);
```

**Issues:**
- ❌ Memory leak (Map grew indefinitely)
- ❌ No automatic cleanup
- ❌ No statistics
- ❌ Manual sliding window implementation

### After: Refactored Implementation (Current)

```typescript
// Current implementation (uses RateLimiter internally)
const policy = BuiltInPolicies.rateLimit(100, 60000);
```

**Improvements:**
- ✅ Uses RateLimiter internally (production-ready)
- ✅ Automatic cleanup every 5 minutes
- ✅ Statistics tracking
- ✅ Proper resource cleanup via `onDestroy`

### Migration Steps

**Good news:** The API is unchanged! The refactoring maintains backward compatibility.

If you were using:
```typescript
const policy = BuiltInPolicies.rateLimit(100, 60000);
```

No code changes needed. The implementation now:
1. Creates a `RateLimiter` internally
2. Provides automatic cleanup
3. Tracks statistics
4. Cleans up on policy destroy

### Recommended: Upgrade to Advanced Version

For full control, migrate to `requireRateLimit()`:

```typescript
// Before
const policy = BuiltInPolicies.rateLimit(100, 60000);

// After (with more control)
const policy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',  // Explicitly choose strategy
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
});
```

**Benefits of upgrading:**
- Explicit strategy selection
- Access to statistics via logger
- Ability to add tiers later
- Can enable queuing
- Better monitoring

---

## Scenario 5: Changing Strategies

### Fixed → Sliding Window

**When:** Need more accurate rate limiting, prevent boundary abuse

```typescript
// Before: Fixed window
const policy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'fixed',
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
});

// After: Sliding window
const policy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',  // Changed
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
});
```

**Impact:**
- More accurate limiting
- Prevents double-dipping at window boundaries
- Slightly higher memory usage
- Minimal performance impact

### Fixed → Token Bucket

**When:** Need to support burst traffic

```typescript
// Before: Fixed window
const policy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'fixed',
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
});

// After: Token bucket with burst
const policy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'token-bucket',  // Changed
  window: 60000,
  defaultTier: {
    name: 'default',
    limit: 100,
    burst: 20  // Allow 120 total (100 base + 20 burst)
  }
});
```

**Impact:**
- Allows temporary bursts
- Tokens refill gradually
- Better for variable workloads
- Slightly more complex logic

---

## Scenario 6: Adding Queue Support

### When to Add Queues

Add queue support when:
- You don't want to reject requests immediately
- Users can tolerate slight delays
- You want to smooth traffic spikes
- Premium users should get priority processing

### Before: Immediate Rejection

```typescript
const policy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'free', limit: 100 }
});
```

**Behavior:** Requests exceeding limit are rejected immediately.

### After: Queue with Priority

```typescript
const policy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',
  window: 60000,
  queue: true,           // Enable queuing
  maxQueueSize: 1000,    // Maximum queue size
  defaultTier: {
    name: 'free',
    limit: 100,
    priority: 1          // Low priority
  },
  tiers: {
    premium: {
      name: 'premium',
      limit: 1000,
      priority: 5,       // Medium priority
      burst: 50
    },
    enterprise: {
      name: 'enterprise',
      limit: 10000,
      priority: 10,      // High priority
      burst: 200
    }
  },
  getTier: (ctx) => {
    if (ctx.auth?.roles.includes('enterprise')) return 'enterprise';
    if (ctx.auth?.roles.includes('premium')) return 'premium';
    return undefined;
  }
});
```

**Behavior:**
- Requests exceeding limit are queued
- Queue processed every 100ms
- Higher priority requests processed first
- Queue size limited to 1000

### Migration Steps

1. **Enable queue in configuration**
   ```typescript
   queue: true,
   maxQueueSize: 1000
   ```

2. **Add priority to tiers**
   ```typescript
   tiers: {
     free: { name: 'free', limit: 100, priority: 1 },
     premium: { name: 'premium', limit: 1000, priority: 5 },
     enterprise: { name: 'enterprise', limit: 10000, priority: 10 }
   }
   ```

3. **Handle queue errors in application**
   ```typescript
   try {
     await service.call();
   } catch (error) {
     if (error.message.includes('queued')) {
       // Request was queued, inform user
       return { status: 'queued', message: 'Request is being processed' };
     }
     throw error;
   }
   ```

4. **Monitor queue statistics**
   ```typescript
   // Access via RateLimiter if using directly
   const stats = limiter.getStats();
   console.log('Queue size:', stats.currentQueueSize);
   console.log('Queued requests:', stats.totalQueued);
   ```

---

## Breaking Changes and Deprecations

### Version History

#### v2.0.0 (Current)

**Refactored:**
- `BuiltInPolicies.rateLimit()` now uses `RateLimiter` internally
- No API changes, but implementation is completely different
- Automatic cleanup added
- Statistics tracking added

**No breaking changes** - Backward compatible!

#### Deprecated Features

None currently. All three implementations are maintained:
1. `RateLimiter` class - Production-ready advanced
2. `NetronBuiltinMiddleware.rateLimit()` - Simple middleware
3. `BuiltInPolicies.rateLimit()` - Simple policy wrapper
4. `BuiltInPolicies.requireRateLimit()` - Advanced policy

### Future Deprecation Notice

No current deprecation plans. However, we recommend:

- **New projects:** Use `requireRateLimit()` for policies or `rateLimit()` middleware for simple cases
- **Existing projects:** Migrate from simple `rateLimit()` to `requireRateLimit()` for better control
- **Production apps:** Always use policies with `requireRateLimit()` for full features

---

## Common Pitfalls and Solutions

### Pitfall 1: Applying Multiple Rate Limiters

❌ **Wrong:**
```typescript
// Global middleware
netron.use(NetronBuiltinMiddleware.rateLimit({ maxRequests: 100 }));

// Per-service policy
@Service('api@1.0.0')
@UsePolicy(BuiltInPolicies.requireRateLimit(logger, {
  defaultTier: { name: 'default', limit: 50 }
}))
class ApiService { ... }
```

**Issue:** Requests are rate-limited twice (once by middleware, once by policy).

✅ **Solution:** Choose one approach
```typescript
// Remove global middleware, use only policy
@Service('api@1.0.0')
@UsePolicy(BuiltInPolicies.requireRateLimit(logger, {
  defaultTier: { name: 'default', limit: 100 }
}))
class ApiService { ... }
```

### Pitfall 2: Missing Logger

❌ **Wrong:**
```typescript
const policy = BuiltInPolicies.requireRateLimit({
  strategy: 'sliding',
  defaultTier: { name: 'default', limit: 100 }
});
// TypeError: logger is required
```

✅ **Solution:** Provide logger
```typescript
import { logger } from '@omnitron-dev/titan/module/logger';

const policy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',
  defaultTier: { name: 'default', limit: 100 }
});
```

### Pitfall 3: getTier Returns Invalid Tier

❌ **Wrong:**
```typescript
getTier: (ctx) => {
  return ctx.auth?.subscription; // Might return 'basic', which isn't in tiers
}
```

**Issue:** Unknown tier name causes fallback to defaultTier with warning.

✅ **Solution:** Validate tier names
```typescript
getTier: (ctx) => {
  const subscription = ctx.auth?.subscription;
  const validTiers = ['premium', 'enterprise'];

  if (subscription && validTiers.includes(subscription)) {
    return subscription;
  }

  return undefined; // Use defaultTier
}
```

### Pitfall 4: Not Cleaning Up RateLimiter

❌ **Wrong:**
```typescript
// Creating RateLimiter without cleanup
const limiter = new RateLimiter(logger, { ... });
// Timers keep running even after app shutdown
```

✅ **Solution:** Always destroy
```typescript
const limiter = new RateLimiter(logger, { ... });

// On app shutdown
app.onStop(async () => {
  limiter.destroy();
});
```

**Note:** When using `requireRateLimit()` policy, cleanup is automatic via `onDestroy` hook.

---

## Testing After Migration

### Unit Tests

```typescript
import { RateLimiter } from '@omnitron-dev/titan/netron/auth';

describe('Rate Limiting', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(mockLogger, {
      strategy: 'fixed',
      window: 1000,
      defaultTier: { name: 'default', limit: 3 }
    });
  });

  afterEach(() => {
    limiter.destroy();
  });

  it('should enforce rate limit', async () => {
    // Use up limit
    await limiter.consume('user-1');
    await limiter.consume('user-1');
    await limiter.consume('user-1');

    // Should be denied
    await expect(limiter.consume('user-1')).rejects.toThrow('Rate limit exceeded');
  });
});
```

### Integration Tests

```typescript
describe('API Rate Limiting', () => {
  it('should rate limit API calls', async () => {
    const client = new NetronClient('ws://localhost:3000');

    // Make requests up to limit
    for (let i = 0; i < 100; i++) {
      await client.call('api', 'getData', {});
    }

    // 101st request should fail
    await expect(
      client.call('api', 'getData', {})
    ).rejects.toThrow('Rate limit exceeded');
  });
});
```

---

## Rollback Plan

If you need to rollback a migration:

### From Policy → Middleware

```typescript
// Remove policy
// @UsePolicy(rateLimitPolicy)  // Remove this

// Add middleware back
netron.use(
  NetronBuiltinMiddleware.rateLimit({
    maxRequests: 100,
    window: 60000
  }),
  {},
  MiddlewareStage.PRE_PROCESS
);
```

### From Tiered → Single-Tier

```typescript
// Simplified configuration
const policy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'fixed',
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
  // Remove tiers and getTier
});
```

---

## Next Steps

- Review [Decision Tree](./RATE-LIMITING-DECISION-TREE.md) to choose the right approach
- Check [README](./README.md) for complete API reference
- See test files for comprehensive examples
- Monitor statistics after migration to ensure proper behavior
