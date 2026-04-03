---
module: titan
title: "Nexus DI Container"
tags: [di, dependency-injection, nexus, container, tokens, providers, scopes, lifecycle]
summary: "Complete guide to the Nexus dependency injection container — tokens, providers, scopes, and lifecycle hooks"
depends_on: [philosophy]
---

# Nexus DI Container

Nexus is Titan's dependency injection engine. It resolves typed dependencies, manages scopes and lifetimes, supports async factories, and enforces circular dependency detection.

## Tokens

Tokens are type-safe identifiers for dependencies. They decouple consumers from concrete implementations.

### Creating Tokens

```typescript
import { createToken } from '@omnitron-dev/titan';
// or from subpath:
import { createToken } from '@omnitron-dev/titan/nexus';

// Basic typed token
const LOGGER_TOKEN = createToken<ILogger>('Logger');

// Token with metadata
const DB_TOKEN = createToken<IDatabase>('Database', {
  description: 'Primary database connection',
  scope: Scope.Singleton,
  tags: ['infrastructure'],
});
```

**How `createToken` works internally:**

1. Creates a `Symbol.for(`nexus:token:${name}`)` as the `id` (dual-package safe).
2. Creates a unique `Symbol(name)` for equality comparison via `equals()`.
3. Caches tokens by name in a global registry (`Symbol.for('nexus:global-token-registry')`) — calling `createToken('Logger')` twice returns the **same** token object (when no custom metadata is passed).
4. Returns an `EnhancedToken<T>` with `id`, `symbol`, `name`, `metadata`, `equals()`, `withMetadata()`, `toJSON()`.

### Token Variants

```typescript
import { createMultiToken, createOptionalToken, createConfigToken } from '@omnitron-dev/titan/nexus';

// Multi-token: collect multiple providers under one token
const PLUGINS_TOKEN = createMultiToken<IPlugin>('Plugins');

// Optional token: returns undefined instead of throwing if not registered
const OPTIONAL_CACHE = createOptionalToken<ICache>('OptionalCache');

// Config token: for configuration with validation and defaults
const APP_CONFIG = createConfigToken<AppConfig>('AppConfig', {
  validate: (c) => !!c.port,
  defaults: { port: 3000 },
});
```

### Well-Known Tokens

Titan provides built-in tokens for framework services:

```typescript
import { ApplicationToken, NetronToken } from '@omnitron-dev/titan';
import { CONFIG_SERVICE_TOKEN } from '@omnitron-dev/titan/module/config';
import { LOGGER_TOKEN, LOGGER_SERVICE_TOKEN } from '@omnitron-dev/titan/module/logger';

// Resolve the Application instance
const app = container.resolve(ApplicationToken);

// Resolve the Netron instance
const netron = container.resolve(NetronToken);

// Resolve config service
const config = container.resolve(CONFIG_SERVICE_TOKEN);

// Resolve logger
const logger = container.resolve(LOGGER_TOKEN);
```

### Symbol.for Convention (CRITICAL)

When creating ad-hoc tokens outside of `createToken`, always use `Symbol.for`:

```typescript
// CORRECT
const MY_TOKEN = Symbol.for('titan:MY_SERVICE');

// WRONG — breaks dual-package resolution
const MY_TOKEN = Symbol('MY_SERVICE');
```

## Provider Types

Providers tell the container how to create instances. There are four types:

### Class Provider

Creates an instance of a class. Constructor parameters are auto-injected.

```typescript
container.register(LOGGER_TOKEN, {
  useClass: PinoLogger,
  scope: Scope.Singleton,
});

// With explicit injection overrides
container.register(AUTH_SERVICE_TOKEN, {
  useClass: AuthService,
  inject: [DB_TOKEN, LOGGER_TOKEN, CONFIG_SERVICE_TOKEN],
  scope: Scope.Singleton,
});
```

### Value Provider

Provides a pre-existing value directly.

```typescript
container.register(CONFIG_TOKEN, {
  useValue: { port: 3000, host: 'localhost' },
});
```

### Factory Provider

Uses a factory function to create instances. Supports async factories.

```typescript
container.register(DB_TOKEN, {
  useFactory: async (config: ConfigService, logger: ILogger) => {
    const db = new Database(config.get('db.url'));
    await db.connect();
    logger.info('Database connected');
    return db;
  },
  inject: [CONFIG_SERVICE_TOKEN, LOGGER_TOKEN],
  scope: Scope.Singleton,
});

// Factory with retry
container.register(REDIS_TOKEN, {
  useFactory: async () => createRedisClient(),
  retry: { maxAttempts: 3, delay: 1000 },
  scope: Scope.Singleton,
});
```

### Token Provider (Alias)

Aliases one token to another.

```typescript
container.register(ILOGGER_TOKEN, {
  useToken: PINO_LOGGER_TOKEN,
});
```

## Provider Registration Formats

The container supports multiple registration formats:

```typescript
// 1. Token + provider object
container.register(MY_TOKEN, { useClass: MyService });

// 2. Direct constructor (token = constructor itself)
container.register(MyService);

// 3. Tuple format (used in module providers arrays)
[MY_TOKEN, { useClass: MyService, scope: 'singleton' }]

// 4. Tuple with options
[MY_TOKEN, { useFactory: () => new MyService() }, { tags: ['core'] }]
```

### Module Provider Arrays

In `@Module` decorators and dynamic module returns, providers use the tuple format:

```typescript
@Module({
  providers: [
    // Class provider tuple
    [MY_TOKEN, { useClass: MyService, scope: 'singleton' }],

    // Value provider tuple
    [CONFIG_TOKEN, { useValue: defaultConfig }],

    // Factory provider tuple
    [DB_TOKEN, {
      useFactory: async (config: ConfigService) => new Database(config.get('db')),
      inject: [CONFIG_SERVICE_TOKEN],
      scope: 'singleton',
    }],
  ],
  exports: [MY_TOKEN, DB_TOKEN],
})
class MyModule {}
```

**Important**: Provider tuples often need `as any` cast due to TypeScript's strict tuple inference:

```typescript
providers: [
  [MY_TOKEN, { useValue: myValue }] as any,
],
```

## Scopes

Scopes control how many instances of a dependency are created:

| Scope | Behavior |
|-------|----------|
| `Singleton` | One instance per container (default for `@Module`, `@Service`) |
| `Transient` | New instance on every resolution |
| `Scoped` | One instance per child scope |
| `Request` | One instance per request context |

```typescript
import { Scope } from '@omnitron-dev/titan/nexus';

// In provider definition
{ useClass: MyService, scope: Scope.Singleton }
{ useClass: RequestCtx, scope: Scope.Request }

// String literals also accepted
{ useClass: MyService, scope: 'singleton' }
{ useClass: RequestCtx, scope: 'transient' }
```

### DI Singleton Hazard

**CRITICAL**: When factory providers create shared infrastructure (database pools, Redis connections, event bus), always set `scope: Scope.Singleton` explicitly. If a factory runs multiple times due to missing scope, you get duplicate connections, leaked resources, and subtle bugs.

```typescript
// CORRECT
[DB_POOL_TOKEN, {
  useFactory: () => createPool(),
  scope: Scope.Singleton,  // Ensures exactly one pool
}]

// DANGEROUS — may create multiple pools
[DB_POOL_TOKEN, {
  useFactory: () => createPool(),
  // No scope = default (may be transient depending on context)
}]
```

### Child Scopes

Create child containers for request-scoped dependencies:

```typescript
const requestScope = container.createScope({
  metadata: { requestId: '123' },
});

// Singleton providers resolve from parent
// Scoped/Request providers get new instances in this scope
const handler = requestScope.resolve(REQUEST_HANDLER_TOKEN);
```

## Lifecycle Hooks

### Decorator-Based Hooks

```typescript
import { Injectable, PostConstruct, PreDestroy } from '@omnitron-dev/titan';

@Injectable()
class DatabaseService {
  @PostConstruct()
  async onInit(): Promise<void> {
    // Called after construction and injection
    await this.pool.connect();
  }

  @PreDestroy()
  async onDestroy(): Promise<void> {
    // Called during container dispose
    await this.pool.end();
  }
}
```

### Interface-Based Hooks

```typescript
import type { OnInit, OnDestroy } from '@omnitron-dev/titan';

@Injectable()
class CacheService implements OnInit, OnDestroy {
  async onInit(): Promise<void> {
    await this.redis.connect();
  }

  async onDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
```

### Lifecycle Order

1. **Construction** — Constructor called with injected dependencies
2. **PostConstruct / onInit** — Async initialization after construction
3. **Application runtime** — Service handles requests
4. **PreDestroy / onDestroy** — Cleanup before container disposal
5. **Disposal** — Container releases all references

## Container API

### Core Operations

```typescript
// Register
container.register(TOKEN, { useClass: MyService });
container.register(TOKEN, { useValue: myValue });
container.register(TOKEN, { useFactory: () => new MyService(), inject: [...] });

// Resolve (synchronous — throws if async factory)
const service = container.resolve<IMyService>(TOKEN);

// Resolve async (supports async factories)
const service = await container.resolveAsync<IMyService>(TOKEN);

// Resolve optional (returns undefined if not registered)
const cache = container.resolveOptional<ICache>(CACHE_TOKEN);

// Resolve multiple (for multi-tokens)
const plugins = container.resolveMany<IPlugin>(PLUGINS_TOKEN);

// Check registration
if (container.has(TOKEN)) { ... }
```

### Batch Resolution

```typescript
// Resolve multiple tokens in parallel
const [db, cache, logger] = await container.resolveParallel([DB_TOKEN, CACHE_TOKEN, LOGGER_TOKEN]);

// Settled results (no throw on failure)
const results = await container.resolveParallelSettled([DB_TOKEN, RISKY_TOKEN]);
// results[1].status === 'rejected'

// Named batch
const deps = await container.resolveBatch({
  db: DB_TOKEN,
  cache: CACHE_TOKEN,
  logger: LOGGER_TOKEN,
}, { timeout: 5000, failFast: true });
```

### Module Loading

```typescript
// Sync registration (providers registered but singletons not instantiated)
container.loadModule(myModule);

// Async loading with eager singleton initialization
await container.loadModuleAsync(myModule);

// After all modules loaded, eagerly init remaining singletons
await container.eagerlyInitialize();
```

### Disposal

```typescript
// Dispose container — calls PreDestroy on all singletons, clears cache
await container.dispose();
```

## Common Patterns

### Optional Dependencies

```typescript
@Injectable()
class NotificationService {
  constructor(
    @Inject(EMAIL_TOKEN) @Optional() private email?: IEmailService,
    @Inject(SMS_TOKEN) @Optional() private sms?: ISmsService,
  ) {}

  async notify(user: User, message: string) {
    if (this.email) await this.email.send(user.email, message);
    if (this.sms) await this.sms.send(user.phone, message);
  }
}
```

### Multi-Provider Collection

```typescript
const HEALTH_CHECK_TOKEN = createMultiToken<IHealthCheck>('HealthChecks');

// Register multiple providers under the same token
container.register(HEALTH_CHECK_TOKEN, { useClass: DatabaseHealthCheck, multi: true });
container.register(HEALTH_CHECK_TOKEN, { useClass: RedisHealthCheck, multi: true });
container.register(HEALTH_CHECK_TOKEN, { useClass: S3HealthCheck, multi: true });

// Resolve all
const checks = container.resolveMany(HEALTH_CHECK_TOKEN);
// [DatabaseHealthCheck, RedisHealthCheck, S3HealthCheck]
```

### Lazy Injection

```typescript
import { Lazy } from '@omnitron-dev/titan/decorators';

@Injectable()
class ReportService {
  @Lazy(HEAVY_COMPUTATION_TOKEN)
  private computation!: IHeavyComputation;

  // `computation` is only resolved on first property access
}
```

### Configuration Injection

```typescript
import { Value } from '@omnitron-dev/titan/decorators';

@Injectable()
class ServerService {
  constructor(
    @Value('server.port', 3000) private port: number,
    @Value('server.host', 'localhost') private host: string,
  ) {}
}
```

## Gotchas

1. **Circular dependencies**: Nexus detects them at resolution time via `ResolutionState.chain`. Use `@Lazy` or factory providers with `inject` to break cycles.

2. **Async factories vs sync resolve**: `container.resolve()` throws if the provider is an async factory. Use `container.resolveAsync()` or `container.resolveParallel()`.

3. **Missing `@Injectable()`**: If a class has no decorator and is registered as `{ useClass: Foo }`, the container may not be able to resolve its constructor params. Always decorate.

4. **Reflect-metadata import**: Must have `import 'reflect-metadata'` somewhere in the entry point. Titan decorators import it internally, but if you use raw Nexus APIs, ensure it is loaded.

5. **Token identity**: Two calls to `createToken('Foo')` return the same cached token. But `createToken('Foo', { description: 'bar' })` creates a new token (metadata prevents caching). Be consistent.

6. **Scope mismatch**: A singleton that depends on a transient creates a captured dependency — the transient is resolved once and frozen. Design scope hierarchies carefully: singletons should only depend on other singletons.
