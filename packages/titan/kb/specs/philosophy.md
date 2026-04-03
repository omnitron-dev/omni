---
module: titan
title: "Titan Core Design Philosophy"
tags: [architecture, philosophy, design-principles, cross-runtime]
summary: "Core design principles and architectural layers of the Titan framework"
depends_on: []
---

# Titan Core Design Philosophy

## What Titan Is

Titan is a minimal yet powerful application framework built on the Nexus DI container. It provides the foundation for distributed systems in the Omnitron monorepo. Titan is **not** a web framework — it is a service-oriented backend kernel that orchestrates dependency injection, RPC communication, configuration, and lifecycle management.

## Foundational Principles

### 1. DI-Centric Everything

Every service, module, configuration provider, and infrastructure component flows through the Nexus DI container. There are no global singletons, no service locators, no manual wiring. If something exists at runtime, it was resolved through DI.

```typescript
// Every dependency is injected, never imported and instantiated directly
@Injectable()
class OrderService {
  constructor(
    @Inject(USER_SERVICE_TOKEN) private readonly users: IUserService,
    @Inject(LOGGER_TOKEN) private readonly logger: ILogger,
    @Inject(CONFIG_SERVICE_TOKEN) private readonly config: ConfigService,
  ) {}
}
```

### 2. Decorator-Driven Metadata

All wiring is declared via decorators. The framework reads metadata at boot time via `reflect-metadata` and assembles the dependency graph. Decorators are the sole mechanism for:

- Marking classes as injectable (`@Injectable`, `@Service`, `@Module`)
- Declaring lifecycle hooks (`@PostConstruct`, `@PreDestroy`)
- Exposing RPC methods (`@Public`)
- Configuring auth, rate limiting, caching (`@Public({ auth: {...} })`)
- Defining scopes (`@Singleton`, `@Transient`, `@Scoped`, `@Request`)

### 3. Service-Oriented with Typed Interfaces

Backend apps export **service interfaces** and **DTOs** as their public API. Consumers (including frontends) import the interface types and call methods via Netron RPC. This creates a contract-first architecture.

```typescript
// Backend defines the interface
export interface IAuthService {
  signIn(username: string, password: string): Promise<AuthResponse>;
  signOut(sessionId: string): Promise<void>;
}

// Backend implements it
@Service({ name: 'Auth' })
class AuthRpcService implements IAuthService {
  @Public({ auth: { allowAnonymous: true } })
  async signIn(username: string, password: string): Promise<AuthResponse> { ... }

  @Public({ auth: { roles: ['user'] } })
  async signOut(sessionId: string): Promise<void> { ... }
}

// Frontend calls it type-safely via Netron RPC
const result = await authRpc<'signIn'>('signIn', username, password);
```

### 4. Cross-Runtime Support

Titan targets Node.js >=22.0.0 (primary), Bun >=1.2.0 (fully supported), and Deno (experimental). This means:

- No Node.js-specific APIs without cross-runtime fallbacks
- ESM-only (`"type": "module"` in all packages)
- All imports use `.js` extensions (required for ESM resolution)
- No `__dirname`/`__filename` — use `import.meta.url` instead

### 5. Symbol.for() for All DI Tokens (Dual-Package Hazard Prevention)

**CRITICAL**: All Titan DI tokens and metadata keys **must** use `Symbol.for('titan:...')` or `Symbol.for('nexus:...')` instead of plain `Symbol()`. This prevents the dual-package hazard where `tsx` loads the same file from both `src/` and `dist/` paths, creating separate module instances with separate symbol registries.

```typescript
// CORRECT - survives dual-package loading
const SCHEDULER_SERVICE_TOKEN = Symbol.for('titan:SCHEDULER_SERVICE');
const GLOBAL_REGISTRY_KEY = Symbol.for('nexus:global-token-registry');

// WRONG - breaks if loaded from two paths
const MY_TOKEN = Symbol('my-token'); // Each load creates a different symbol
```

The `createToken()` function handles this internally — its `id` field uses `Symbol.for(`nexus:token:${name}`)`.

## Architectural Layers

Titan is organized in clear layers, from highest to lowest abstraction:

```
Application Layer
  └── Application.create(), app.start(), app.use(), graceful shutdown
      └── Handles lifecycle states: Created → Starting → Started → Stopping → Stopped

Decorator Layer
  └── @Module, @Injectable, @Service, @Public, @Inject, @PostConstruct...
      └── Pure metadata declaration via reflect-metadata

Nexus DI Layer
  └── Container, Token, createToken, Provider types, Scope management
      └── The dependency injection engine: register → resolve → dispose

Netron RPC Layer
  └── Netron, LocalPeer, RemotePeer, ServiceStub, Definition
      └── Distributed service communication and method invocation

Transport Layer
  └── HTTP, WebSocket, TCP, Unix socket transports
      └── Physical wire protocol for Netron messages
```

### Layer Rules

1. **Upper layers depend on lower layers, never the reverse.**
2. **Application** orchestrates module loading, Netron startup, config, and logger.
3. **Decorators** only write metadata — they never instantiate or resolve anything.
4. **Nexus** is a pure DI container with no knowledge of networking.
5. **Netron** builds on Nexus for service discovery and RPC invocation.
6. **Transports** are pluggable — Netron doesn't know which transport is in use.

## Key Conventions

### Import Paths

Titan uses package.json `exports` field for subpath imports. **Never import from the root barrel.**

```typescript
// CORRECT — uses subpath exports, enables tree-shaking
import { ConfigModule } from '@omnitron-dev/titan/module/config';
import { Injectable, Service, Public } from '@omnitron-dev/titan/decorators';
import { Application } from '@omnitron-dev/titan/application';

// WRONG — pulls in everything, breaks tree-shaking
import { ConfigModule, Injectable } from '@omnitron-dev/titan';
```

### Service Names

Service names use simple names **without** version suffixes in the `@Service` decorator. Version is tracked separately in metadata.

```typescript
// CORRECT
@Service({ name: 'Auth' })

// WRONG
@Service({ name: 'Auth@1.0.0' })
```

If you do pass a version, it goes through semver validation.

### Module Structure Convention

Each backend feature follows this file pattern:

```
modules/
  auth/
    auth.module.ts        # DI module definition
    auth.service.ts       # Domain logic (business rules)
    auth.rpc-service.ts   # Netron RPC wrapper + @Public + @Service
    auth.repository.ts    # Data access
    auth.types.ts         # Interfaces and DTOs
    auth.errors.ts        # Domain-specific errors
```

### Application Lifecycle

```typescript
const app = await Application.create({
  name: 'my-app',
  version: '1.0.0',
});

// Register modules
app.use(ConfigModule.forRoot({ ... }));
app.use(LoggerModule.forRoot({ ... }));
app.use(MyFeatureModule);

// Start (triggers OnInit hooks, starts Netron, etc.)
await app.start();

// Graceful shutdown (triggers OnDestroy/PreDestroy hooks)
await app.stop();
```

### Application States

The `ApplicationState` enum tracks lifecycle:

| State | Description |
|-------|-------------|
| `Created` | App constructed, not yet started |
| `Starting` | `app.start()` called, modules initializing |
| `Started` | All modules initialized, accepting requests |
| `Stopping` | `app.stop()` called, shutting down |
| `Stopped` | All resources released |
| `Failed` | Fatal error during lifecycle |

### Application Events

Subscribe to lifecycle events via the event emitter:

```typescript
app.on(ApplicationEvent.Started, () => { ... });
app.on(ApplicationEvent.Error, (err) => { ... });
app.on(ApplicationEvent.ShutdownStart, () => { ... });
```

## Feature Flags

Titan exposes `APP_FEATURES` for runtime capability checks:

```typescript
import { APP_FEATURES } from '@omnitron-dev/titan';

if (APP_FEATURES.CONFIG_MODULE) { ... }
if (APP_FEATURES.GRACEFUL_SHUTDOWN) { ... }
```

Available flags: `CONFIG_MODULE`, `LOGGER_MODULE`, `EVENT_SYSTEM`, `LIFECYCLE_HOOKS`, `GRACEFUL_SHUTDOWN`, `HEALTH_CHECKS`, `MODULE_DEPENDENCIES`, `ERROR_HANDLING`, `ENHANCED_MODULES`, `DISCOVERY_MODULE`.
