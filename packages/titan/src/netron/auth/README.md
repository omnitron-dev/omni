# Netron Rate Limiting

## Overview

Netron provides comprehensive, production-ready rate limiting capabilities for your distributed applications. Whether you need simple DDoS protection or sophisticated tiered limits with burst support, Netron has you covered.

### Why Rate Limiting?

- **Security:** Protect against DDoS attacks and API abuse
- **Fairness:** Ensure equitable resource distribution among users
- **Monetization:** Enforce different limits for pricing tiers
- **Reliability:** Prevent system overload and cascading failures

---

## Quick Start

### 1. Simple Global Rate Limiting

Perfect for basic DDoS protection on public endpoints:

```typescript
import { NetronBuiltinMiddleware, MiddlewareStage } from '@omnitron-dev/titan/netron';

// Apply to all services globally
netron.use(
  NetronBuiltinMiddleware.rateLimit({
    maxRequests: 100,
    window: 60000  // 100 requests per minute
  }),
  {},
  MiddlewareStage.PRE_PROCESS
);
```

### 2. User-Aware Rate Limiting

For authenticated APIs with per-user tracking:

```typescript
import { BuiltInPolicies } from '@omnitron-dev/titan/netron/auth';
import { logger } from '@omnitron-dev/titan/module/logger';

const rateLimitPolicy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
});

@Service('api@1.0.0')
@UsePolicy(rateLimitPolicy)
class ApiService {
  @Public()
  async getData() {
    // Rate-limited per authenticated user
  }
}
```

### 3. Tiered Rate Limiting (SaaS)

For applications with pricing tiers:

```typescript
const rateLimitPolicy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'token-bucket',
  window: 60000,
  queue: true,
  defaultTier: { name: 'free', limit: 100 },
  tiers: {
    premium: {
      name: 'premium',
      limit: 1000,
      burst: 50,
      priority: 5
    },
    enterprise: {
      name: 'enterprise',
      limit: 10000,
      burst: 200,
      priority: 10
    }
  },
  getTier: (ctx) => {
    if (ctx.auth?.roles.includes('enterprise')) return 'enterprise';
    if (ctx.auth?.roles.includes('premium')) return 'premium';
    return undefined; // Uses defaultTier (free)
  }
});
```

---

## Available Implementations

Netron provides three complementary rate limiting implementations:

### 1. Middleware `rateLimit()` - Simple & Fast

**Location:** `NetronBuiltinMiddleware.rateLimit()`

**Best for:**
- Global rate limiting
- Public endpoints without authentication
- Basic DDoS protection
- Simple use cases

**Features:**
- ✅ One-liner setup
- ✅ Minimal overhead
- ✅ Connection-level limiting
- ❌ No tiered limits
- ❌ No automatic cleanup

**Example:**
```typescript
netron.use(
  NetronBuiltinMiddleware.rateLimit({ maxRequests: 100, window: 60000 }),
  {},
  MiddlewareStage.PRE_PROCESS
);
```

### 2. Policy `requireRateLimit()` - Advanced & Production-Ready

**Location:** `BuiltInPolicies.requireRateLimit(logger, config)`

**Best for:**
- SaaS applications with pricing tiers
- User-specific rate limiting
- Advanced strategies (sliding, token-bucket)
- Production environments

**Features:**
- ✅ Multiple strategies (sliding, fixed, token-bucket)
- ✅ Tiered limits (free, premium, enterprise, etc.)
- ✅ Burst support
- ✅ Queue mode with priority
- ✅ Automatic cleanup
- ✅ Detailed statistics
- ✅ User-aware (uses auth context)

**Example:**
```typescript
const policy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'free', limit: 100 },
  tiers: {
    premium: { name: 'premium', limit: 1000, burst: 50 }
  }
});
```

### 3. Policy `rateLimit()` - Simple Policy Wrapper

**Location:** `BuiltInPolicies.rateLimit(maxRequests, windowMs)`

**Best for:**
- Quick policy-based rate limiting
- Migration from old implementations
- Simple use cases without tiers

**Features:**
- ✅ Simple API (just 2 parameters)
- ✅ Uses RateLimiter internally (production-ready)
- ✅ Automatic cleanup
- ❌ No tiered limits
- ❌ No burst support

**Example:**
```typescript
const policy = BuiltInPolicies.rateLimit(100, 60000);

@Service('api@1.0.0')
@UsePolicy(policy)
class ApiService { ... }
```

---

## Architecture

### Request Flow with Rate Limiting

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENT REQUEST                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    TRANSPORT LAYER                           │
│              (WebSocket, HTTP, etc.)                         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              MIDDLEWARE: PRE_PROCESS                         │
│   ★ RATE LIMIT CHECKPOINT #1 (Optional)                     │
│   NetronBuiltinMiddleware.rateLimit()                       │
│   - Connection-level throttling                             │
│   - No auth context available                               │
│   - Fast rejection before auth                              │
└─────────────────────────────────────────────────────────────┘
                            ↓
                      ALLOWED? ───NO──> [Reject: 429 Too Many Requests]
                            ↓
                           YES
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              MIDDLEWARE: PRE_INVOKE                          │
│              Authentication Middleware                       │
│              (Creates AuthContext)                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  AUTH SUBSYSTEM                              │
│   ★ RATE LIMIT CHECKPOINT #2 (Primary)                      │
│   BuiltInPolicies.requireRateLimit()                        │
│   - User-aware rate limiting                                │
│   - Tiered limits (free/premium/enterprise)                 │
│   - Advanced strategies                                     │
│   - Queue support                                           │
└─────────────────────────────────────────────────────────────┘
                            ↓
                      ALLOWED? ───NO──> [Reject: 429 Too Many Requests]
                            ↓           [With retryAfter, tier info]
                           YES
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              Authorization (Other Policies)                  │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  SERVICE INVOCATION                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  CLIENT RESPONSE                             │
└─────────────────────────────────────────────────────────────┘
```

### Architecture Layers

| Layer | Implementation | Purpose | Context Available |
|-------|---------------|---------|-------------------|
| **Middleware** | `NetronBuiltinMiddleware.rateLimit()` | Basic DDoS protection | `clientId`, `metadata` |
| **Auth Subsystem** | `BuiltInPolicies.requireRateLimit()` | User-aware enforcement | `auth`, `environment`, `resource` |
| **Application** | Direct `RateLimiter` usage | Custom logic | Full context |

---

## Rate Limiting Strategies

### 1. Sliding Window

**Algorithm:** Tracks individual request timestamps within a moving time window.

**Characteristics:**
- ✅ Most accurate
- ✅ Prevents window boundary abuse
- ⚠️ Higher memory usage
- ⚠️ Slightly slower

**Best for:** Production APIs where accuracy is critical

**Example:**
```typescript
{
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
}
```

**How it works:**
```
Window: 60 seconds
Limit: 100 requests

Timeline:
0s     30s    60s    90s    120s
|------|------|------|------|
  50req  50req
       ^ Check at 30s: 50 requests in last 60s ✅ ALLOW
                60req 40req
                    ^ Check at 90s: 100 requests in last 60s ✅ ALLOW
                          50req 51req
                              ^ Check at 120s: 101 requests in last 60s ❌ DENY
```

### 2. Fixed Window

**Algorithm:** Counts requests within fixed time intervals.

**Characteristics:**
- ✅ Lower memory usage
- ✅ Faster than sliding
- ⚠️ Allows burst at boundaries
- ⚠️ Less accurate

**Best for:** High-throughput scenarios where performance matters

**Example:**
```typescript
{
  strategy: 'fixed',
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
}
```

**How it works:**
```
Window: 60 seconds
Limit: 100 requests

Timeline:
0s              60s             120s
|---------------|---------------|
  100 requests    100 requests
                ^
              Reset
  ⚠️ Issue: 100 requests at 59s + 100 at 61s = 200 in 2 seconds
```

### 3. Token Bucket

**Algorithm:** Tokens refill at a steady rate; requests consume tokens.

**Characteristics:**
- ✅ Supports burst traffic naturally
- ✅ Smooth rate limiting
- ✅ Flexible for variable workloads
- ⚠️ More complex

**Best for:** APIs with variable traffic patterns, burst allowance needed

**Example:**
```typescript
{
  strategy: 'token-bucket',
  window: 60000,
  defaultTier: { name: 'default', limit: 100, burst: 20 }
}
```

**How it works:**
```
Bucket Capacity: 120 tokens (100 base + 20 burst)
Refill Rate: 100 tokens per 60 seconds

Start: 120 tokens
Request 1-120: ✅ ALLOW (consume all tokens)
Request 121: ❌ DENY (no tokens)
Wait 30s: +50 tokens refilled (now 50 tokens)
Request 122-171: ✅ ALLOW (consume 50 tokens)
```

---

## Configuration Reference

### RateLimiter Configuration

```typescript
interface RateLimitConfig {
  /** Default tier for unauthenticated users */
  defaultTier?: RateLimitTier;

  /** Tiers by role or custom key */
  tiers?: Record<string, RateLimitTier>;

  /** Time window in milliseconds (default: 60000 = 1 minute) */
  window?: number;

  /** Rate limiting strategy (default: 'sliding') */
  strategy?: 'sliding' | 'fixed' | 'token-bucket';

  /** Queue requests instead of rejecting (FIFO) */
  queue?: boolean;

  /** Max queue size (default: 1000) */
  maxQueueSize?: number;

  /** Custom tier selector function */
  getTier?: (ctx: ExecutionContext) => string | Promise<string>;
}
```

### Tier Configuration

```typescript
interface RateLimitTier {
  /** Tier name (e.g., 'free', 'premium', 'enterprise') */
  name: string;

  /** Base limit (requests per window) */
  limit: number;

  /** Burst allowance (temporary spike tolerance) */
  burst?: number;

  /** Priority (higher = processed first when queued) */
  priority?: number;
}
```

---

## Performance Characteristics

### Benchmarks

From test suite (`rate-limiter.spec.ts`):

| Implementation | Throughput | Memory/User | Cleanup | Concurrent-Safe |
|----------------|------------|-------------|---------|-----------------|
| **Middleware rateLimit()** | ~15,000/sec* | ~16 bytes | None (GC) | ✅ Yes |
| **RateLimiter (fixed)** | 12,000+/sec | ~32 bytes | Auto (5min) | ✅ Yes |
| **RateLimiter (sliding)** | 12,000+/sec | ~80 bytes** | Auto (5min) | ✅ Yes |
| **RateLimiter (token-bucket)** | 12,000+/sec | ~48 bytes | Auto (5min) | ✅ Yes |

*Estimated based on similar fixed window implementation
**Depends on request rate and window size

### Scalability

**Test Results:**
- ✅ Handles 10,000+ checks/second
- ✅ Safe with 100 concurrent requests for same user
- ✅ Tested with 1,000+ active users
- ✅ Memory efficient (no crashes with many users)

**Production Considerations:**
- Automatic cleanup runs every 5 minutes
- Expired entries removed after 2x window duration
- Queue processed every 100ms (if enabled)
- Thread-safe concurrent operations

---

## Best Practices

### 1. Choose the Right Strategy

```typescript
// ✅ Good: Sliding window for accuracy
const apiPolicy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'default', limit: 100 }
});

// ✅ Good: Fixed window for performance
const internalPolicy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'fixed',
  window: 60000,
  defaultTier: { name: 'default', limit: 1000 }
});

// ✅ Good: Token bucket for burst tolerance
const uploadPolicy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'token-bucket',
  window: 60000,
  defaultTier: { name: 'default', limit: 50, burst: 20 }
});
```

### 2. Layer Your Rate Limits

```typescript
// Layer 1: Basic DDoS protection (middleware)
netron.use(
  NetronBuiltinMiddleware.rateLimit({
    maxRequests: 1000,  // High limit
    window: 60000
  }),
  {},
  MiddlewareStage.PRE_PROCESS
);

// Layer 2: User-specific limits (policy)
const userPolicy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'free', limit: 100 },
  tiers: {
    premium: { name: 'premium', limit: 500 }
  }
});

@Service('api@1.0.0')
@UsePolicy(userPolicy)
class ApiService { ... }
```

### 3. Provide Clear Error Messages

```typescript
// ✅ Good: Clear error with retry info
{
  allowed: false,
  reason: 'Rate limit exceeded for tier premium. Retry after 45000ms',
  metadata: {
    retryAfter: 45000,
    resetAt: new Date('2025-10-09T12:30:00Z'),
    tier: 'premium',
    limit: 1000
  }
}
```

### 4. Monitor Statistics

```typescript
// Get statistics for monitoring
const stats = limiter.getStats();

logger.info({
  totalChecks: stats.totalChecks,
  totalAllowed: stats.totalAllowed,
  totalDenied: stats.totalDenied,
  activeKeys: stats.activeKeys,
  queueSize: stats.currentQueueSize
}, 'Rate limiter stats');

// Per-user statistics
const userStats = limiter.getStats('user-123');
logger.info({ userId: 'user-123', stats: userStats }, 'User rate limit stats');
```

### 5. Handle Errors Gracefully

```typescript
@Service('api@1.0.0')
class ApiService {
  @Public()
  async getData() {
    try {
      // Your logic here
    } catch (error) {
      if (error.message.includes('Rate limit exceeded')) {
        // Extract retry-after from error
        const retryAfter = error.metadata?.retryAfter || 60000;

        return {
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests',
          retryAfter: retryAfter,
          retryAt: new Date(Date.now() + retryAfter)
        };
      }
      throw error;
    }
  }
}
```

### 6. Use Queuing for Critical Operations

```typescript
// For important operations that shouldn't be dropped
const criticalPolicy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'token-bucket',
  window: 60000,
  queue: true,           // Enable queuing
  maxQueueSize: 1000,
  defaultTier: {
    name: 'default',
    limit: 100,
    priority: 1
  },
  tiers: {
    premium: {
      name: 'premium',
      limit: 500,
      priority: 5,       // Higher priority in queue
      burst: 50
    }
  }
});
```

### 7. Clean Up Resources

```typescript
// When using RateLimiter directly
const limiter = new RateLimiter(logger, { ... });

// On application shutdown
app.onStop(async () => {
  limiter.destroy();  // Stop timers, clear state
  logger.info('Rate limiter destroyed');
});

// Note: When using policies, cleanup is automatic
```

---

## Common Use Cases

### Use Case 1: Public API with Free/Paid Tiers

```typescript
const apiPolicy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'free', limit: 60 },  // 1 req/sec
  tiers: {
    basic: { name: 'basic', limit: 300 },     // 5 req/sec
    pro: { name: 'pro', limit: 1200 },        // 20 req/sec
    enterprise: {
      name: 'enterprise',
      limit: 6000,                             // 100 req/sec
      burst: 1000,                             // Burst up to 7000
      priority: 10
    }
  },
  getTier: (ctx) => {
    const subscription = ctx.auth?.subscription;
    if (['basic', 'pro', 'enterprise'].includes(subscription)) {
      return subscription;
    }
    return undefined; // Free tier
  }
});

@Service('api@1.0.0')
@UsePolicy(BuiltInPolicies.requireAuth(), apiPolicy)
class PublicApiService { ... }
```

### Use Case 2: Internal Microservices

```typescript
// High limits for internal services
const internalPolicy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'fixed',
  window: 60000,
  defaultTier: { name: 'internal', limit: 10000 }
});

@Service('internal-api@1.0.0')
@UsePolicy(internalPolicy)
class InternalService { ... }
```

### Use Case 3: File Upload Service

```typescript
// Token bucket with burst for uploads
const uploadPolicy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'token-bucket',
  window: 60000,
  defaultTier: {
    name: 'default',
    limit: 10,      // 10 uploads per minute normally
    burst: 5        // Up to 15 if bucket is full
  }
});

@Service('upload@1.0.0')
@UsePolicy(uploadPolicy)
class UploadService {
  @Public()
  async uploadFile(file: Buffer) {
    // Rate-limited uploads
  }
}
```

### Use Case 4: Multi-Tenant Application

```typescript
const tenantPolicy = BuiltInPolicies.requireRateLimit(logger, {
  strategy: 'sliding',
  window: 60000,
  defaultTier: { name: 'starter', limit: 500 },
  tiers: {
    growth: { name: 'growth', limit: 2000 },
    business: { name: 'business', limit: 10000, burst: 2000 }
  },
  getTier: async (ctx) => {
    const tenantId = ctx.auth?.metadata?.tenantId;
    if (!tenantId) return undefined;

    // Fetch tenant plan from database
    const tenant = await db.tenants.findById(tenantId);
    return tenant?.plan; // 'starter', 'growth', or 'business'
  }
});
```

---

## Monitoring and Observability

### Logging

RateLimiter uses structured logging:

```typescript
// Automatic logs (debug level)
{
  component: 'RateLimiter',
  config: { strategy: 'sliding', window: 60000 },
  message: 'Rate limiter initialized'
}

{
  component: 'RateLimiter',
  key: 'user-123',
  tier: 'premium',
  priority: 5,
  queueSize: 1,
  message: 'Request queued'
}

{
  component: 'RateLimiter',
  cleaned: 42,
  remaining: 158,
  message: 'Cleaned up expired entries'
}
```

### Metrics Collection

```typescript
// Collect metrics periodically
setInterval(() => {
  const stats = limiter.getStats();

  metrics.gauge('rate_limiter.active_keys', stats.activeKeys);
  metrics.gauge('rate_limiter.queue_size', stats.currentQueueSize);
  metrics.counter('rate_limiter.total_checks', stats.totalChecks);
  metrics.counter('rate_limiter.total_allowed', stats.totalAllowed);
  metrics.counter('rate_limiter.total_denied', stats.totalDenied);

  // Per-tier metrics
  for (const [tier, tierStats] of stats.byTier) {
    metrics.counter(`rate_limiter.tier.${tier}.allowed`, tierStats.allowed);
    metrics.counter(`rate_limiter.tier.${tier}.denied`, tierStats.denied);
  }
}, 60000);
```

### Health Checks

```typescript
// Health check endpoint
@Service('health@1.0.0')
class HealthService {
  @Public()
  async getRateLimiterHealth() {
    const stats = limiter.getStats();

    return {
      status: stats.currentQueueSize > 900 ? 'degraded' : 'healthy',
      activeUsers: stats.activeKeys,
      queueSize: stats.currentQueueSize,
      queueCapacity: 1000,
      allowRate: stats.totalAllowed / (stats.totalAllowed + stats.totalDenied)
    };
  }
}
```

---

## Troubleshooting

### Problem: Rate limits not enforced

**Symptoms:**
- Users exceed configured limits
- No rate limit errors

**Solutions:**
1. Check policy is applied to service
   ```typescript
   @UsePolicy(rateLimitPolicy)  // Must be present
   class ApiService { ... }
   ```

2. Verify authentication middleware is running
   ```typescript
   netron.use(authenticationMiddleware, {}, MiddlewareStage.PRE_INVOKE);
   ```

3. Check getTier returns valid tier names
   ```typescript
   getTier: (ctx) => {
     const tier = ctx.auth?.subscription;
     console.log('Selected tier:', tier); // Debug
     return tier;
   }
   ```

### Problem: Memory leak

**Symptoms:**
- Memory grows over time
- Never decreases

**Solutions:**
1. If using middleware `rateLimit()`, consider switching to policy (has auto cleanup)
2. Ensure `limiter.destroy()` is called on shutdown
3. Check for custom RateLimiter instances without cleanup

### Problem: Requests queued indefinitely

**Symptoms:**
- Queue size keeps growing
- Requests never processed

**Solutions:**
1. Check rate limits aren't too restrictive
2. Verify queue processor is running (auto-starts with `queue: true`)
3. Increase queue size or limits
   ```typescript
   {
     queue: true,
     maxQueueSize: 2000,  // Increase if needed
     defaultTier: { name: 'default', limit: 200 }  // Increase limit
   }
   ```

### Problem: High latency

**Symptoms:**
- Slow request processing
- Rate limiting adds significant delay

**Solutions:**
1. Use fixed window instead of sliding (faster)
   ```typescript
   { strategy: 'fixed' }  // Instead of 'sliding'
   ```

2. Reduce cleanup frequency (if needed)
3. Disable queue if not needed
   ```typescript
   { queue: false }
   ```

---

## API Reference

### NetronBuiltinMiddleware.rateLimit()

```typescript
static rateLimit(options?: {
  maxRequests?: number;  // Default: 100
  window?: number;       // Default: 60000 (1 minute)
}): MiddlewareFunction
```

### BuiltInPolicies.rateLimit()

```typescript
rateLimit(
  maxRequests: number,
  windowMs: number
): PolicyDefinition
```

### BuiltInPolicies.requireRateLimit()

```typescript
requireRateLimit(
  logger: ILogger,
  config: RateLimitConfig
): PolicyDefinition
```

### RateLimiter Class

```typescript
class RateLimiter {
  constructor(logger: ILogger, config?: RateLimitConfig);

  // Check if request is allowed (non-consuming)
  async check(key: string, tier?: string): Promise<RateLimitResult>;

  // Consume a request (marks as used)
  async consume(key: string, tier?: string): Promise<void>;

  // Reset rate limit for a key
  reset(key: string): void;

  // Get statistics
  getStats(key?: string): RateLimitStats;

  // Clean up resources
  destroy(): void;
}
```

For detailed type definitions, see:
- `rate-limiter.ts` - RateLimiter class and types
- `built-in-policies.ts` - Policy implementations
- `middleware/builtin.ts` - Middleware implementation

---

## Documentation Links

- **[Decision Tree](./RATE-LIMITING-DECISION-TREE.md)** - Choose the right rate limiting approach
- **[Migration Guide](./RATE-LIMITING-MIGRATION-GUIDE.md)** - Upgrade from simple to advanced implementations
- **Test Examples** - See `test/netron/auth/rate-limiter.spec.ts` for comprehensive usage examples

---

## Security Considerations

### 1. User Identification

```typescript
// ✅ Good: Use authenticated user ID
getTier: (ctx) => {
  const userId = ctx.auth?.userId;  // Authenticated user
  // Fetch tier from database using userId
}

// ⚠️ Be careful: IP-based (can be spoofed)
const key = ctx.environment?.ip || 'anonymous';
```

### 2. Tier Validation

```typescript
// ✅ Good: Validate tier from trusted source (database)
getTier: async (ctx) => {
  const user = await db.users.findById(ctx.auth?.userId);
  return user?.verifiedSubscription;  // From database
}

// ❌ Bad: Trust client-provided tier
getTier: (ctx) => {
  return ctx.metadata?.get('tier');  // User can manipulate!
}
```

### 3. Rate Limit Bypass Prevention

```typescript
// ✅ Good: Layer defenses
netron.use(NetronBuiltinMiddleware.rateLimit({ maxRequests: 10000 }));

@UsePolicy(
  BuiltInPolicies.requireAuth(),
  BuiltInPolicies.requireRateLimit(logger, { ... })
)
class ApiService { ... }

// ❌ Bad: Single point of failure
@UsePolicy(rateLimitPolicy)  // Only defense
class ApiService { ... }
```

### 4. DDoS Protection

```typescript
// ✅ Good: Apply global limits before auth
netron.use(
  NetronBuiltinMiddleware.rateLimit({
    maxRequests: 1000,  // Reject excessive traffic early
    window: 60000
  }),
  {},
  MiddlewareStage.PRE_PROCESS  // Before expensive auth
);
```

---

## Contributing

Found a bug or want to improve rate limiting? Contributions welcome!

1. Check existing issues and tests
2. Add tests for new features
3. Ensure all tests pass: `npm test`
4. Follow existing code style

---

## License

Part of the Omnitron Titan framework.

---

**Last Updated:** 2025-10-09
**Version:** 2.0.0
