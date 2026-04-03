---
module: cross-cutting
title: "Authentication & Authorization Chain"
tags: [auth, jwt, rls, invocation-wrapper, cross-service, chain]
summary: "Complete auth flow: JWT issuance → HTTP middleware → invocationWrapper → RLS AsyncLocalStorage → PostgreSQL"
depends_on: [titan/netron-rpc, titan-auth]
---

# Authentication & Authorization Chain

## Full Flow

```
Frontend                    Backend (per-request)
   │
   ├─ signIn(user, pass) ──────► Auth RPC
   │                              │
   │  ◄── { accessToken, session } ──┘
   │
   ├─ Bearer: <token> ─────────► HTTP Middleware
   │                              │
   │                     AuthenticationManager.validateToken()
   │                              │
   │                     AuthContext { userId, roles, permissions }
   │                              │
   │                     invocationWrapper()
   │                              │
   │                     AsyncLocalStorage.run(authContext)
   │                              │
   │                     @Public({ auth: { roles: ['admin'] } })
   │                              │
   │                     PolicyEngine.check(context, metadata)
   │                              │
   │                     Service method executes
   │                              │
   │                     getCurrentAuth() ← from AsyncLocalStorage
   │                              │
   │                     PostgreSQL SET LOCAL (RLS)
   │                              │
   │  ◄── response ──────────────┘
```

## JWT Issuance (Main App)

Main backend issues JWT on successful authentication:

```typescript
// Auth service creates JWT with user claims
const token = await this.jwtService.sign({
  sub: user.id,
  username: user.username,
  roles: user.roles,
}, { expiresIn: '1h' });
```

## HTTP Middleware (Every Backend)

Each backend validates the Bearer token in HTTP middleware:

```typescript
// Titan AuthenticationManager validates JWT
const authContext = await authManager.validateToken(bearerToken);
// Returns: { userId, username, roles, permissions, sessionId }
```

## invocationWrapper (Titan Core)

Bridges HTTP auth into AsyncLocalStorage for every Netron RPC call:

```typescript
// This is automatic — configured in Application setup
// Every RPC invocation runs inside:
asyncLocalStorage.run({ auth: authContext }, async () => {
  // Service code runs here
  // getCurrentAuth() works because of this wrapper
});
```

## @Public Decorator (Method-Level Auth)

```typescript
// Anonymous — no auth required
@Public({ auth: { allowAnonymous: true } })

// Any authenticated user
@Public({ auth: { roles: ['user'] } })

// Specific role
@Public({ auth: { roles: ['admin'] } })

// Multiple roles (OR)
@Public({ auth: { roles: ['admin', 'moderator'] } })

// Policy-based
@Public({ auth: { policies: [BuiltInPolicies.OWNER_ONLY] } })

// Combined roles + policies (AND)
@Public({ auth: { roles: ['user'], policies: ['canEditProfile'] } })
```

## getCurrentAuth() in Services

```typescript
import { getCurrentAuth } from '@kysera/rls';

@Injectable()
export class FileService {
  async getMyFiles(): Promise<File[]> {
    const auth = getCurrentAuth();
    // auth = { userId, username, roles, permissions, sessionId }
    // or null if anonymous
    return this.repo.findByOwner(auth!.userId);
  }
}
```

## Cross-Service Auth

When Service A calls Service B via Netron RPC, the JWT propagates:

1. Main app issues JWT → stored in portal sessionStorage
2. Portal sends JWT as Bearer header → Main validates
3. Main calls Storage via Netron → JWT forwarded in RPC context
4. Storage's AuthenticationManager validates same JWT
5. Storage RPC methods get auth context from AsyncLocalStorage

## MFA Chain (if enabled)

```
signIn(user, pass)
   │
   ├── Password valid? → NO → error
   │
   ├── TOTP enabled?
   │     └── YES → return pendingSession + mfaRequired: 'totp'
   │               │
   │               ├── verifyMfa(session, code)
   │               │     └── TOTP valid?
   │               │           └── PGP enabled?
   │               │                 └── YES → return pendingSession + mfaRequired: 'pgp'
   │               │                 └── NO → issue JWT, return session
   │               │
   │               └── verifyPgp(session, signature)
   │                     └── issue JWT, return session
   │
   └── NO → issue JWT, return session
```

## Session Auto-Renewal

- Sessions expire in 15 minutes
- JWT accessToken expires in 1 hour
- SessionManager schedules refresh 2 minutes before expiry
- On tab visibility change: check expiry, refresh if needed
- On 401 response: refresh + retry (once, with promise coalescing)
- Auth methods (signin/signup/signout/refreshSession) are NEVER retried

## Critical Rules

1. **invocationWrapper is MANDATORY** — without it, getCurrentAuth() returns null
2. **@Public on EVERY RPC method** — methods without it are security holes
3. **Never pass auth as method parameter** — use getCurrentAuth()
4. **JWT secret must match across all backends** — same HS256 key
5. **AuthenticationClient uses SessionTokenStorage** — not cookies
