---
module: titan-auth
title: "Auth Best Practices"
tags: [auth, jwt, best-practices, security, anti-patterns]
summary: "Security best practices and common mistakes when implementing authentication with TitanAuthModule"
depends_on: [overview]
---

# Auth Best Practices

## JWT Configuration

### DO: Use HS256 with strong secret for single-cluster
```typescript
TitanAuthModule.forRoot({
  algorithm: 'HS256',
  jwtSecret: process.env.JWT_SECRET, // Must be ≥32 chars, random
  cacheEnabled: true,
  cacheTtl: 300, // 5 min — reduces DB/Redis lookups
})
```

### DO: Same JWT secret across all backends in the cluster
Main issues JWT, Storage/Messaging/etc validate it — all need the same secret.

### DON'T: Short or predictable secrets
```typescript
// WRONG
jwtSecret: 'secret123'
jwtSecret: 'my-app-key'

// CORRECT — generated with: openssl rand -base64 48
jwtSecret: 'kJ7v2mR9+xY3bQ6wP8cN1dF4gH5jK0lM...'
```

## Token Expiry Strategy

```
Access Token (JWT):  1 hour    — stateless, no revocation
Session:             15 min    — stored server-side, revocable
Refresh:             proactive — 2 min before session expires
```

### DO: Keep access token lifetime short
Shorter tokens = smaller window of compromise. 1h is maximum.

### DO: Implement proactive refresh
Don't wait for 401 — schedule refresh before expiry:
```typescript
// SessionManager schedules setTimeout at (expiresAt - 2min)
setTimeout(() => refreshSession(), expiresAt - 120_000 - Date.now());
```

### DON'T: Store tokens in localStorage
```typescript
// WRONG — XSS vulnerable
localStorage.setItem('token', jwt);

// CORRECT — sessionStorage (per-tab, cleared on close)
sessionStorage.setItem('token', jwt);
```

## @Public Decorator Patterns

### DO: Default to minimum permissions
```typescript
// Start restrictive, loosen only when needed
@Public({ auth: { roles: ['admin'] } })           // Admin only
@Public({ auth: { roles: ['user'] } })             // Any authenticated user
@Public({ auth: { allowAnonymous: true } })        // Public (use sparingly)
```

### DO: Use policies for ownership checks
```typescript
@Public({ auth: {
  roles: ['user'],
  policies: [BuiltInPolicies.OWNER_ONLY],
} })
async deleteMyAccount(): Promise<void> {
  const auth = getCurrentAuth();
  // Policy already verified ownership — safe to proceed
}
```

### DON'T: Auth checks in domain service
```typescript
// WRONG — auth checks belong in RPC layer
@Injectable()
class OrderService {
  async getOrder(orderId: string, auth: AuthContext) {
    if (!auth.roles.includes('admin')) throw new Error('Forbidden');
    // ...
  }
}

// CORRECT — @Public in RPC, service is clean
@Service({ name: 'Order' })
class OrderRpcService {
  @Public({ auth: { roles: ['admin'] } })
  async getOrder(orderId: string) {
    return this.orderService.getOrder(orderId);
  }
}
```

## Cross-Service Auth

### DO: Forward JWT in Netron RPC context
When Main calls Storage, the JWT must propagate:
```typescript
// This is handled automatically by invocationWrapper
// No manual token passing needed between services
```

### DON'T: Create separate auth tokens between services
```typescript
// WRONG — each service has its own auth
const storageToken = await storageAuth.createServiceToken();

// CORRECT — one JWT, validated by all services with same secret
```

## MFA Security

### DO: Cache-backed MFA state (not DB)
MFA pending sessions should be short-lived (5 min max), stored in Redis cache:
```typescript
await this.cache.set(`mfa:${sessionId}`, pendingState, { ttl: 300 });
```

### DON'T: Expose MFA state in JWT claims
```typescript
// WRONG — JWT is not yet authenticated at MFA step
const jwt = await this.jwtService.sign({ userId, mfaPending: true });

// CORRECT — MFA state in cache, JWT issued only after full auth
```

## Common Anti-Patterns

1. **Missing @Public** — RPC method without auth decorator is a backdoor
2. **Auth in wrong layer** — Auth checks in service.ts instead of rpc-service.ts
3. **Token in URL** — JWT as query parameter is logged by proxies
4. **Infinite retry** — Auth methods must never be retried on 401 (prevents loops)
5. **Shared sessions** — Each tab should have its own session (use sessionStorage)
