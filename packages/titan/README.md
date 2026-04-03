# @omnitron-dev/titan

> Enterprise backend framework — DI, Netron RPC, decorators, and validation

Part of the [Omni](../../README.md) monorepo — Fullstack Type-Safe RPC Framework.

## Installation

```bash
pnpm add @omnitron-dev/titan
```

## Overview

Titan is the core backend framework of the Omni stack. It provides a modular architecture built on dependency injection, with first-class support for Netron RPC services, decorator-based configuration, and runtime validation.

### Key Features

- **Modular architecture** — `@Module`, `@Injectable`, provider scoping
- **Netron RPC** — `@Service`, `@Public` decorators for exposing typed RPC endpoints
- **Dependency injection** — Nexus IoC container with constructor/property injection
- **Configuration** — `@ConfigValue` decorator, typed config objects
- **Event system** — `@EventHandler` decorator, programmatic subscriptions
- **Lifecycle hooks** — `OnInit`, `OnDestroy`, `OnModuleInit` interfaces
- **Logging** — Structured pino-based logging with multistream destinations
- **Authentication** — `AuthConfig`, `PolicyEngine`, method-level authorization via `@Public`

## Quick Start

```typescript
import { Application, Module, Injectable, Service, Public } from '@omnitron-dev/titan';

@Injectable()
@Service({ name: 'Calculator' })
class CalculatorService {
  @Public()
  add(a: number, b: number): number {
    return a + b;
  }
}

@Module({
  providers: [CalculatorService],
})
class AppModule {}

const app = await Application.create({ modules: [AppModule] });
```

## Titan Modules

Titan's functionality is extended through official modules:

| Module | Package | Description |
|--------|---------|-------------|
| Auth | `@omnitron-dev/titan-auth` | JWT authentication |
| Cache | `@omnitron-dev/titan-cache` | Multi-tier caching |
| Database | `@omnitron-dev/titan-database` | Kysely ORM, migrations, RLS |
| Discovery | `@omnitron-dev/titan-discovery` | Service discovery |
| Events | `@omnitron-dev/titan-events` | Event bus |
| Health | `@omnitron-dev/titan-health` | Health checks |
| Lock | `@omnitron-dev/titan-lock` | Distributed locks |
| Metrics | `@omnitron-dev/titan-metrics` | Counters, gauges, histograms |
| Notifications | `@omnitron-dev/titan-notifications` | Multi-channel delivery |
| PM | `@omnitron-dev/titan-pm` | Process management |
| Rate Limit | `@omnitron-dev/titan-ratelimit` | Rate limiting |
| Redis | `@omnitron-dev/titan-redis` | Redis connections |
| Scheduler | `@omnitron-dev/titan-scheduler` | Job scheduling |
| Telemetry | `@omnitron-dev/titan-telemetry-relay` | Telemetry pipeline |

## License

MIT
