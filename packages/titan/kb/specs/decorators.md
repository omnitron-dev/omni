---
module: titan
title: "Decorators Reference"
tags: [decorators, di, auth, validation, lifecycle, metadata]
summary: "Complete reference for all Titan decorators — DI, auth, validation, lifecycle, and utilities"
depends_on: [philosophy, nexus-di]
---

# Decorators Reference

All Titan decorators are exported from `@omnitron-dev/titan/decorators`. They use `reflect-metadata` to store configuration that the framework reads at boot time.

## DI Decorators

### @Injectable(options?)

Marks a class for dependency injection. Constructor parameters are auto-resolved.

```typescript
import { Injectable } from '@omnitron-dev/titan';

// Default (no explicit scope — container uses its default)
@Injectable()
class UserRepository { ... }

// With explicit scope
@Injectable({ scope: 'singleton' })
class ConfigService { ... }

// With custom token
@Injectable({ token: CACHE_TOKEN })
class RedisCacheService implements ICache { ... }

// With providedIn (auto-register scope)
@Injectable({ providedIn: 'root' })
class GlobalService { ... }
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `scope` | `'singleton' \| 'transient' \| 'scoped' \| 'request'` | Lifecycle scope |
| `token` | `symbol \| string \| Constructor` | Custom injection token |
| `providedIn` | `'root' \| 'any' \| string` | Auto-registration scope |

### @Inject(token)

Specifies which token to use for resolving a dependency. Works on constructor params, properties, and method params.

```typescript
import { Inject, createToken } from '@omnitron-dev/titan';

const DB_TOKEN = createToken<IDatabase>('Database');
const LOGGER_TOKEN = createToken<ILogger>('Logger');

@Injectable()
class UserService {
  // Constructor parameter injection
  constructor(
    @Inject(DB_TOKEN) private readonly db: IDatabase,
    @Inject(LOGGER_TOKEN) private readonly logger: ILogger,
  ) {}

  // Property injection
  @Inject(CACHE_TOKEN)
  private cache!: ICache;
}
```

### @Optional()

Marks a constructor parameter as optional. If the token is not registered, `undefined` is injected instead of throwing.

```typescript
@Injectable()
class NotificationService {
  constructor(
    @Inject(EMAIL_TOKEN) @Optional() private email?: IEmailService,
  ) {}
}
```

### @InjectAll(token)

Injects all instances registered under a multi-token.

```typescript
@Injectable()
class PluginManager {
  constructor(
    @InjectAll(PLUGIN_TOKEN) private plugins: IPlugin[],
  ) {}
}
```

### @Value(path, defaultValue?)

Injects a configuration value by dot-path from the ConfigService.

```typescript
@Injectable()
class ServerConfig {
  constructor(
    @Value('server.port', 3000) private port: number,
    @Value('server.host', '0.0.0.0') private host: string,
  ) {}
}
```

### @Lazy(token)

Defers resolution until the property is first accessed. Useful for breaking circular dependencies or delaying heavy initialization.

```typescript
@Injectable()
class ReportService {
  @Lazy(ANALYTICS_TOKEN)
  private analytics!: IAnalyticsService;
  // Not resolved until `this.analytics` is first read
}
```

## Scope Decorators

Shorthand decorators that combine `@Injectable` with a specific scope:

```typescript
@Singleton()   // Equivalent to @Injectable({ scope: 'singleton' })
class AppConfig { ... }

@Transient()   // Equivalent to @Injectable({ scope: 'transient' })
class RequestContext { ... }

@Scoped()      // One instance per child scope
class ScopedCache { ... }

@Request()     // One instance per request
class RequestLogger { ... }
```

## @Module(options?)

Defines a DI module that groups providers, imports other modules, and exports tokens. See [module-system.md](module-system.md) for full details.

```typescript
import { Module } from '@omnitron-dev/titan';

@Module({
  imports: [DatabaseModule],
  providers: [
    [USER_REPO_TOKEN, { useClass: UserRepository }],
    [USER_SERVICE_TOKEN, { useClass: UserService }],
  ],
  exports: [USER_SERVICE_TOKEN],
})
class UserModule {}
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | Module name (defaults to class name) |
| `version` | `string` | Module version |
| `imports` | `any[]` | Modules to import |
| `providers` | `any[]` | Provider definitions (tuple format) |
| `exports` | `any[]` | Tokens to make available to importing modules |
| `global` | `boolean` | If true, exports are available to all modules |

Note: `@Module()` internally applies `@Injectable({ scope: 'singleton' })` to the class.

### @Global()

Marks a module's exports as available to all modules without explicit imports.

```typescript
@Global()
@Module({
  providers: [[LOGGER_TOKEN, { useClass: PinoLogger }]],
  exports: [LOGGER_TOKEN],
})
class LoggerModule {}
```

## @Service(options)

Defines a Netron RPC service. Processes the class to extract metadata about `@Public` methods.

```typescript
import { Service } from '@omnitron-dev/titan';

// String form (name only, no version)
@Service({ name: 'Auth' })
class AuthRpcService { ... }

// With transport config
@Service({
  name: 'StreamData',
  transports: [wsTransport],
  transportConfig: { timeout: 30000, compression: true },
})
class StreamDataService { ... }
```

**IMPORTANT**: Use plain names without version suffixes:

```typescript
// CORRECT
@Service({ name: 'Auth' })

// WRONG
@Service({ name: 'Auth@1.0.0' })
```

`@Service` internally applies `@Injectable({ scope: 'singleton' })`.

**Service name validation**: Only latin letters, numbers, and dots (`/^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*$/`). Dots enable namespacing: `storage.Buckets`, `payments.Crypto`.

## @Public(options?)

Marks a method or property as publicly accessible via Netron RPC. Only `@Public` methods are exposed to remote peers.

```typescript
@Service({ name: 'Users' })
class UsersRpcService {
  // Simple public method
  @Public()
  async getUser(id: string): Promise<User> { ... }

  // With auth configuration
  @Public({
    auth: {
      roles: ['admin'],
      permissions: ['users:write'],
    },
  })
  async deleteUser(id: string): Promise<void> { ... }

  // Anonymous access
  @Public({ auth: { allowAnonymous: true } })
  async getPublicProfile(id: string): Promise<PublicProfile> { ... }

  // NOT exposed (no @Public decorator)
  private async validateInput(data: unknown): Promise<void> { ... }
}
```

### Auth Configuration via @Public

The `auth` option on `@Public` is the primary authorization mechanism:

```typescript
@Public({
  auth: {
    // RBAC: ANY of these roles grants access
    roles: ['admin', 'moderator'],

    // Permissions: ALL required
    permissions: ['documents:read', 'documents:write'],

    // OAuth2 scopes: ALL required
    scopes: ['write:documents'],

    // Policy expressions
    policies: ['resource:owner'],                    // All policies must pass
    policies: { all: ['policy1', 'policy2'] },       // Explicit all
    policies: { any: ['resource:owner', 'role:admin'] }, // Any policy passes

    // Anonymous access (no auth required)
    allowAnonymous: true,

    // Inheritance
    inherit: true,    // Merge with class-level policies
    override: true,   // Replace class-level policies
  },
})
```

### Rate Limiting via @Public

```typescript
@Public({
  rateLimit: {
    defaultTier: { name: 'free', limit: 10, burst: 20 },
    tiers: { premium: { limit: 100, burst: 150 } },
    window: 60000, // 1 minute window
  },
})
async searchDocuments(query: string): Promise<Document[]> { ... }
```

### Caching via @Public

```typescript
@Public({
  cache: {
    ttl: 60000,                    // 60s cache TTL
    keyGenerator: (args) => `user:${args[0]}`,
    invalidateOn: ['user:updated'],
    maxSize: 1000,
  },
})
async getUser(id: string): Promise<User> { ... }
```

### Audit via @Public

```typescript
@Public({
  audit: {
    includeArgs: true,
    includeResult: false,
    includeUser: true,
  },
})
async transferFunds(from: string, to: string, amount: number): Promise<void> { ... }
```

### Composable Method Decorators

For cleaner code, use standalone decorators alongside `@Public()`:

```typescript
import { Public, Auth, RateLimit, Cache } from '@omnitron-dev/titan/decorators';

@Public()
@Auth({ roles: ['user'] })
@RateLimit({ limit: 100, window: 60000 })
@Cache({ ttl: 30000 })
async getProfile(userId: string): Promise<Profile> { ... }
```

## RLS Guard Decorators

For backend domain services (not RPC services), use RLS guard decorators that read from `@kysera/rls` context:

```typescript
import {
  RequireRlsContext,
  RequireUser,
  RequireTenant,
  RequireRole,
  RequirePermission,
} from '@omnitron-dev/titan/netron/auth';

class UserService {
  @RequireUser()
  async getMyProfile(): Promise<UserProfile> {
    const ctx = rlsContext.getContextOrNull();
    return this.repo.findById(ctx!.auth.userId);
  }

  @RequireRole('admin')
  async deleteUser(id: string): Promise<void> { ... }

  @RequirePermission('users:write')
  async updateUser(id: string, data: UpdateDto): Promise<void> { ... }

  @RequireTenant()
  async listTenantUsers(): Promise<User[]> { ... }

  // Custom composite guard
  @RequireRlsContext({
    requireUser: true,
    roles: ['admin', 'moderator'],
    permissions: ['audit:read'],
    message: 'Admin or moderator with audit permission required',
  })
  async getAuditLog(): Promise<AuditEntry[]> { ... }
}
```

**Note**: System users (`ctx.auth.isSystem === true`) bypass all RLS guard checks.

## Lifecycle Decorators

### @PostConstruct()

Called after the instance is constructed and all dependencies are injected.

```typescript
@Injectable()
class DatabasePool {
  @PostConstruct()
  async init(): Promise<void> {
    await this.pool.connect();
    this.logger.info('Database pool initialized');
  }
}
```

### @PreDestroy()

Called before the instance is destroyed during container disposal.

```typescript
@Injectable()
class DatabasePool {
  @PreDestroy()
  async cleanup(): Promise<void> {
    await this.pool.end();
    this.logger.info('Database pool closed');
  }
}
```

## Validation Decorators

Titan provides Zod-based validation decorators:

### @Contract(schema)

Defines input/output validation schemas for a service method:

```typescript
import { Contract, contract } from '@omnitron-dev/titan/decorators';
import { z } from 'zod';

const createUserContract = contract({
  input: z.object({
    username: z.string().min(3).max(50),
    password: z.string().min(8),
  }),
  output: z.object({
    id: z.string().uuid(),
    username: z.string(),
  }),
});

@Service({ name: 'Users' })
class UsersService {
  @Public()
  @Contract(createUserContract)
  async createUser(data: z.infer<typeof createUserContract.input>): Promise<z.infer<typeof createUserContract.output>> {
    // Input is validated before this runs, output is validated before returning
  }
}
```

### @Validate / @ValidateInput / @ValidateOutput

Granular validation decorators:

```typescript
import { ValidateInput, ValidateOutput } from '@omnitron-dev/titan/decorators';

@ValidateInput(z.object({ id: z.string().uuid() }))
async getUser(params: { id: string }): Promise<User> { ... }

@ValidateOutput(UserSchema)
async findUser(id: string): Promise<User> { ... }
```

### @NoValidation()

Explicitly opts out of validation for a method (useful when validation is handled elsewhere):

```typescript
@NoValidation()
async rawQuery(sql: string): Promise<any> { ... }
```

## Utility Decorators

### @Memoize(options?)

Caches method results based on arguments:

```typescript
import { Memoize } from '@omnitron-dev/titan/decorators';

@Memoize({ ttl: 60000 })
async getExchangeRate(currency: string): Promise<number> { ... }
```

### @Retry(options)

Automatically retries failed method calls:

```typescript
import { Retry } from '@omnitron-dev/titan/decorators';

@Retry({ maxAttempts: 3, delay: 1000, backoff: 'exponential' })
async sendNotification(userId: string, message: string): Promise<void> { ... }
```

### @Deprecated(message?)

Marks a method as deprecated. Logs a warning on each call:

```typescript
import { Deprecated } from '@omnitron-dev/titan/decorators';

@Deprecated('Use getUser() instead')
async findUserById(id: string): Promise<User> { ... }
```

## Custom Decorators

Titan provides a decorator factory for creating custom decorators:

```typescript
import { createDecorator, createMethodInterceptor } from '@omnitron-dev/titan/decorators';

// Custom class decorator
const Cacheable = createDecorator('Cacheable', (target, options) => {
  // Apply caching behavior
});

// Custom method interceptor
const LogExecution = createMethodInterceptor('LogExecution', async (context, next) => {
  console.log(`Calling ${context.methodName}`);
  const start = Date.now();
  const result = await next();
  console.log(`${context.methodName} took ${Date.now() - start}ms`);
  return result;
});
```

## Metadata Keys

All metadata keys are defined in `METADATA_KEYS`:

```typescript
import { METADATA_KEYS } from '@omnitron-dev/titan/decorators';

// DI metadata
METADATA_KEYS.INJECTABLE        // 'nexus:injectable'
METADATA_KEYS.CONSTRUCTOR_PARAMS // 'nexus:constructor-params'
METADATA_KEYS.PROPERTY_PARAMS   // 'nexus:property-params'
METADATA_KEYS.SCOPE             // 'nexus:scope'
METADATA_KEYS.TOKEN             // 'nexus:token'
METADATA_KEYS.OPTIONAL          // 'nexus:optional'
METADATA_KEYS.MODULE            // 'nexus:module'
METADATA_KEYS.GLOBAL            // 'nexus:global'
METADATA_KEYS.SERVICE_NAME      // 'nexus:service:name'

// Lifecycle
METADATA_KEYS.POST_CONSTRUCT    // 'nexus:post-construct'
METADATA_KEYS.PRE_DESTROY       // 'nexus:pre-destroy'

// Netron
METADATA_KEYS.SERVICE_ANNOTATION // 'netron:service'
METADATA_KEYS.METHOD_ANNOTATION  // 'netron:method'

// Method-level config
METADATA_KEYS.METHOD_AUTH        // 'method:auth'
METADATA_KEYS.METHOD_RATE_LIMIT  // 'method:rateLimit'
METADATA_KEYS.METHOD_CACHE       // 'method:cache'
METADATA_KEYS.METHOD_AUDIT       // 'method:audit'
```

## Gotchas

1. **@Public is required for RPC exposure**: Without `@Public()`, a method on a `@Service` class is private and inaccessible to remote peers.

2. **@Service applies @Injectable internally**: Do not double-apply `@Injectable()` and `@Service()` on the same class.

3. **@Module applies @Injectable internally**: Same as above.

4. **Decorator order matters for composable decorators**: `@Public()` should be the outermost (first listed) decorator. `@Auth`, `@RateLimit`, etc. apply metadata that `@Public` reads.

5. **Constructor parameter injection requires `@Inject`**: TypeScript's `emitDecoratorMetadata` provides design:paramtypes, but for token-based injection (interfaces), you must use `@Inject(TOKEN)` on each parameter.
