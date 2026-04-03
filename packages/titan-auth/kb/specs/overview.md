---
module: titan-auth
title: "TitanAuthModule - JWT Authentication"
tags: [auth, jwt, middleware, guards, decorators, signed-urls]
summary: "Unified JWT authentication module with multi-algorithm support, token caching, HTTP middleware, decorators, guards, and signed URL tokens."
depends_on: ["@omnitron-dev/titan/nexus", "@omnitron-dev/titan/decorators"]
---

# TitanAuthModule

Package: `@omnitron-dev/titan-auth`
Import: `@omnitron-dev/titan/module/auth`

Unified JWT authentication for distributed Titan services. Supports HS256, RS256, ES256 algorithms with token caching, HTTP middleware, and Netron integration.

## Module Setup

### Static Configuration (forRoot)

```typescript
import { TitanAuthModule } from '@omnitron-dev/titan/module/auth';

@Module({
  imports: [
    TitanAuthModule.forRoot({
      algorithm: 'HS256',
      jwtSecret: process.env.JWT_SECRET,
      serviceKey: process.env.SERVICE_KEY,
      anonKey: process.env.ANON_KEY,
      cacheEnabled: true,       // default: true
      cacheMaxSize: 1000,       // default: 1000
      cacheTTL: 300000,         // default: 5 min
      isGlobal: true,           // register globally
    }),
  ],
})
export class AppModule {}
```

### Async Configuration (forRootAsync)

```typescript
TitanAuthModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (config: ConfigService) => ({
    algorithm: 'RS256',
    jwksUrl: config.get('auth.jwksUrl'),
    issuer: config.get('auth.issuer'),
    audience: config.get('auth.audience'),
  }),
  inject: [CONFIG_SERVICE_TOKEN],
  isGlobal: true,
})
```

### IAuthModuleOptions

| Option | Type | Default | Description |
|---|---|---|---|
| `algorithm` | `'HS256' \| 'RS256' \| 'ES256'` | `'HS256'` | JWT signing algorithm |
| `jwtSecret` | `string` | - | Secret for HS256 |
| `jwksUrl` | `string` | - | JWKS URL for RS256/ES256 |
| `issuer` | `string` | - | JWT issuer validation |
| `audience` | `string` | - | JWT audience validation |
| `serviceKey` | `string` | - | API key for service-to-service auth |
| `anonKey` | `string` | - | API key for anonymous access |
| `defaultTenantId` | `string` | `'default'` | Multi-tenant default |
| `cacheEnabled` | `boolean` | `true` | Enable token cache |
| `cacheMaxSize` | `number` | `1000` | Max cached tokens |
| `cacheTTL` | `number` | `300000` | Cache TTL in ms |
| `urlSigningKey` | `string` | jwtSecret | Secret for signed URLs |
| `isGlobal` | `boolean` | `false` | Register module globally |

## DI Tokens

```typescript
import {
  JWT_SERVICE_TOKEN,        // IJWTService
  AUTH_MIDDLEWARE_TOKEN,     // IAuthMiddleware
  SIGNED_URL_SERVICE_TOKEN, // ISignedUrlService
  AUTH_OPTIONS_TOKEN,       // IAuthModuleOptions
} from '@omnitron-dev/titan/module/auth';
```

## IJWTService

Injected via `JWT_SERVICE_TOKEN`. Verifies tokens and creates auth contexts.

```typescript
@Injectable()
class AuthService {
  constructor(
    @Inject(JWT_SERVICE_TOKEN)
    private readonly jwtService: IJWTService
  ) {}

  async verifyToken(token: string) {
    // Returns IJWTPayload: { sub, role, aud, iss, tenant_id, exp, iat, ... }
    const payload = await this.jwtService.verify(token);
    console.log(payload.sub, payload.role);
  }

  async getAuthContext(token: string) {
    // Returns IAuthContext: { userId, role, tenantId, isServiceRole, claims }
    const ctx = await this.jwtService.createContext(token);
    console.log(ctx.userId, ctx.isServiceRole);
  }

  checkCache() {
    const stats = this.jwtService.getCacheStats();
    // { size, maxSize, hits, misses, hitRate }
    console.log(`Cache hit rate: ${stats.hitRate}`);
  }
}
```

## IAuthMiddleware

Injected via `AUTH_MIDDLEWARE_TOKEN`. Authenticates HTTP requests.

```typescript
@Injectable()
class ApiHandler {
  constructor(
    @Inject(AUTH_MIDDLEWARE_TOKEN)
    private readonly authMiddleware: IAuthMiddleware
  ) {}

  // Falls back to anonymous context if no credentials
  async handlePublic(request: IRequestLike) {
    const ctx = await this.authMiddleware.authenticate(request);
    // ctx.role may be 'anon'
  }

  // Throws UnauthorizedError if no valid credentials
  async handleProtected(request: IRequestLike) {
    const ctx = await this.authMiddleware.authenticateRequired(request);
    console.log(`User: ${ctx.userId}`);
  }

  // Extract Bearer token from Authorization header
  extractToken(request: IRequestLike) {
    const token = this.authMiddleware.extractToken(request);
    // Returns string | null
  }

  // Validate service/anon API keys (constant-time comparison)
  validateKey(apiKey: string) {
    const result = this.authMiddleware.validateApiKey(apiKey);
    // { valid, type: 'service' | 'anon', context?: IAuthContext }
  }
}
```

### IRequestLike

The middleware accepts any object with a `headers` property -- works with both Web API `Headers` and Node.js-style `Record<string, string>`.

```typescript
interface IRequestLike {
  headers:
    | { get(name: string): string | null }
    | Record<string, string | string[] | undefined>;
}
```

## Decorators

### @RequireAuth(options?)

Method decorator that authenticates the request before method execution. The class MUST inject `AUTH_MIDDLEWARE_TOKEN` as `__authMiddleware__`.

```typescript
@Injectable()
class UserService {
  constructor(
    @Inject(AUTH_MIDDLEWARE_TOKEN)
    private readonly __authMiddleware__: IAuthMiddleware
  ) {}

  @RequireAuth()
  async getProfile(request: IRequestLike) {
    // this.__authContext__ is populated after auth
    const userId = this.__authContext__!.userId;
  }

  @RequireAuth({ roles: ['admin'] })
  async deleteUser(request: IRequestLike, userId: string) {
    // Only admins
  }

  @RequireAuth({ allowAnonymous: true })
  async getPublicData(request: IRequestLike) {
    // Auth context available if token provided, anon otherwise
  }
}
```

### Shorthand Decorators

```typescript
@RequireServiceAuth()   // Equivalent to @RequireAuth({ roles: ['service_role'] })
@RequireAdminAuth()     // Equivalent to @RequireAuth({ roles: ['admin', 'service_role'] })
@RequireRole(['mod'])   // Equivalent to @RequireAuth({ roles: ['mod'] })
```

### @Public()

Marks a method or class as public (bypasses guards).

```typescript
@Public()  // Class-level: all methods public
@Injectable()
class HealthController {
  async check() { return { status: 'ok' }; }
}

// Or method-level:
@Public()
async healthCheck() { return { status: 'ok' }; }
```

## Guards

Guards provide route-level authentication/authorization, composable for complex access control.

### AuthGuard

```typescript
const guard = new AuthGuard(authMiddleware);
const result = await guard.execute({ request, handler, methodName: 'getProfile' });
// result: { allowed, authContext?, reason? }
```

### RoleGuard

```typescript
const guard = new RoleGuard(authMiddleware, ['admin', 'moderator']);
const result = await guard.execute({ request, handler, methodName });
```

### ApiKeyGuard

```typescript
const guard = new ApiKeyGuard({
  headerName: 'X-API-Key',  // default
  validateKey: async (key) => {
    const apiKey = await db.apiKeys.findByKey(key);
    return apiKey ? { userId: apiKey.userId, scopes: apiKey.scopes } : null;
  },
});
```

### CompositeGuard

```typescript
// Require ALL guards to pass
const strictGuard = new CompositeGuard([authGuard, roleGuard], 'all');

// Require ANY guard to pass
const flexGuard = new CompositeGuard([jwtGuard, apiKeyGuard], 'any');
```

## Signed URL Service

The `SIGNED_URL_SERVICE_TOKEN` aliases the same JWTService instance, exposing `ISignedUrlService` for pre-signed resource URLs.

```typescript
@Injectable()
class StorageService {
  constructor(
    @Inject(SIGNED_URL_SERVICE_TOKEN)
    private readonly signedUrls: ISignedUrlService
  ) {}

  async createDownloadUrl(bucketId: string, path: string) {
    const token = await this.signedUrls.createSignedToken(
      { resourceId: bucketId, resourcePath: path, operation: 'read' },
      3600  // expires in 1 hour
    );
    return `https://storage.example.com/object?token=${token}`;
  }

  async verifyDownload(token: string) {
    const payload = await this.signedUrls.verifySignedToken(token);
    // { resourceId, resourcePath, operation, transform? }
  }
}
```

## JWT Cross-Service Auth Pattern

In the Omnitron distributed system, JWT tokens bridge authentication across services:

1. **Main app** issues JWT (HS256, 1h expiry) on sign-in
2. **Frontend** stores token in sessionStorage
3. **Per-backend auth**: Each service imports `TitanAuthModule.forRoot()` with the same `jwtSecret`
4. **Netron middleware**: `AuthenticationManager.validateToken()` validates Bearer JWT in HTTP middleware
5. **RLS bridge**: Titan's `invocationWrapper` bridges `authContext` into AsyncLocalStorage for every RPC call
6. **Service RPC methods** use `getCurrentAuth()` from the RLS context (no explicit ctx parameter)

```typescript
// In any backend service module:
TitanAuthModule.forRoot({
  algorithm: 'HS256',
  jwtSecret: process.env.JWT_SECRET,  // Same secret across services
  isGlobal: true,
})
```

## Key Types

```typescript
interface IJWTPayload {
  sub: string;           // User ID
  role: string;          // User role
  aud?: string;          // Audience
  iss?: string;          // Issuer
  tenant_id?: string;    // Tenant ID
  exp?: number;          // Expiration (Unix)
  iat?: number;          // Issued at (Unix)
  username?: string;
  display_name?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface IAuthContext {
  userId: string;
  role: string;
  tenantId: string;
  isServiceRole: boolean;
  claims: IJWTPayload;
}
```

## Error Classes

- `InvalidTokenError` -- token is malformed or signature invalid
- `TokenExpiredError` -- token has expired
- `UnauthorizedError` -- no valid credentials provided (from middleware)
