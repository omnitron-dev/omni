# Omnitron Development Guide

**Version**: 1.0.0
**Status**: Active
**Last Updated**: 2025-10-19

Complete development guidelines for the Omnitron ecosystem, including Titan framework, package structure, testing, and runtime compatibility.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Omnitron Packages](#omnitron-packages)
3. [Development Guidelines](#development-guidelines)
4. [Titan Development Patterns](#titan-development-patterns)
5. [Module Import/Export Rules](#module-import-export-rules)
6. [Code Quality Standards](#code-quality-standards)
7. [Working with Monorepo](#working-with-monorepo)
8. [Testing](#testing)
9. [Docker Redis Testing](#docker-redis-testing)
10. [Recent Breaking Changes](#recent-breaking-changes)
11. [Key Commands](#key-commands)

---

## Project Overview

**Omnitron** - TypeScript monorepo for minimalist, high-performance distributed systems.

**Core Technology:**
- **Titan**: Lightweight backend framework with Nexus DI, Netron RPC, Rotif messaging
- **Aether**: Frontend framework (in development, see `specs/frontend/`)
- **Build**: Turborepo + TSC
- **Package Manager**: pnpm 9.15.0
- **Runtime Support**: Node.js >=22.0.0 (primary), Bun >=1.2.0 (fully supported), Deno (experimental)

---

## Omnitron Packages

### Core Packages

#### @omnitron-dev/titan

Minimalist framework for distributed, runtime-agnostic applications.

**Features:**
- Integrated: Nexus DI, Netron RPC, Rotif messaging
- Modules: Config, Events, Scheduler, Redis, Logger
- Decorator-based API with lifecycle management
- Runtime support: Node.js 22+, Bun 1.2+, Deno (experimental)

**Basic Usage:**
```typescript
import { Application, Module, Injectable } from '@omnitron-dev/titan';

@Injectable()
class MyService {
  doSomething() {
    return 'Hello from MyService';
  }
}

@Module({
  providers: [MyService],
  exports: [MyService]
})
class MyModule {}

const app = await Application.create(MyModule);
await app.start();
```

#### @omnitron-dev/rotif

Redis-based reliable messaging system.

**Features:**
- Exactly-once processing with deduplication
- Retry with exponential backoff
- Dead Letter Queue (DLQ) for failures
- Consumer groups for horizontal scaling

**Usage:**
```typescript
@Injectable()
export class OrderService {
  @RotifSubscribe('orders.created')
  async handleOrderCreated(message: RotifMessage) {
    await this.processOrder(message.payload);
    await message.ack();
  }
}
```

#### @omnitron-dev/common

Essential utilities for all packages.

**Includes:**
- Promise utilities: defer, delay, retry, timeout
- Data structures: ListBuffer, TimedMap
- Type predicates and guards

#### @omnitron-dev/eventemitter

Universal event emitter that works across runtimes.

**Features:**
- Sync/async patterns
- Parallel/sequential execution
- Works in Node.js, Bun, browsers

#### Other Packages

- **@omnitron-dev/smartbuffer** - Enhanced binary data manipulation
- **@omnitron-dev/messagepack** - High-performance MessagePack serialization
- **@omnitron-dev/cuid** - Collision-resistant unique identifiers
- **@omnitron-dev/testing** - Testing utilities and helpers

### Frontend Framework (In Development)

#### Aether

Minimalist, high-performance frontend framework.

**Features:**
- Fine-grained reactivity with signals (inspired by SolidJS)
- File-based routing
- Islands architecture
- SSR/SSG support
- Contract-based Titan integration via Netron RPC
- Separate DI system (lightweight, tree-shakeable)
- ~6KB gzipped core runtime

**Status:** Specs complete in `specs/frontend/`

**Key Decision:** Aether and Titan use **separate DI systems** connected via TypeScript interface contracts for security and optimization.

---

## Development Guidelines

### Technology Stack

- **Language**: TypeScript 5.8.3-5.9.2 with strict mode
- **Runtime**: Node.js 22+, Bun 1.2+ (both fully supported)
- **Build**: Turborepo + TSC
- **Package Manager**: pnpm 9.15.0
- **Testing**: Jest 30.x (Node.js), Bun test (Bun)
- **Linting**: ESLint v9 flat config
- **Serialization**: MessagePack
- **Messaging**: Redis

### Architectural Principles

1. **Runtime Agnostic**: Code should work on Node.js, Bun, and Deno
2. **Minimalist**: Keep dependencies small and focused
3. **Type Safety**: Strict TypeScript mode, no `any`
4. **Testable**: All code should have tests
5. **Tree-shakeable**: Proper ESM exports for optimal bundling

---

## Titan Development Patterns

### Application Structure

```typescript
import { Application, Module, Injectable } from '@omnitron-dev/titan';

@Injectable()
class MyService {
  doSomething() {
    // Service logic
  }
}

@Module({
  providers: [MyService],
  exports: [MyService]
})
class MyModule {}

const app = await Application.create(MyModule);
await app.start();
```

### Service with Decorators

```typescript
@Service('calculator@1.0.0')
export class CalculatorService {
  @Public()
  add(a: number, b: number): number {
    return a + b;
  }

  @Public()
  subtract(a: number, b: number): number {
    return a - b;
  }
}
```

### Event Handling

```typescript
import { OnEvent } from '@omnitron-dev/titan/module/events';

@Injectable()
export class UserEventHandler {
  @OnEvent('user.created')
  async handleUserCreated(data: UserCreatedEvent) {
    console.log('User created:', data.userId);
    // Handle event
  }

  @OnEvent('user.deleted')
  async handleUserDeleted(data: UserDeletedEvent) {
    console.log('User deleted:', data.userId);
    // Cleanup logic
  }
}
```

### Message Handler (Rotif)

```typescript
import { RotifSubscribe } from '@omnitron-dev/rotif';

@Injectable()
export class OrderService {
  @RotifSubscribe('orders.created')
  async handleOrderCreated(message: RotifMessage) {
    try {
      await this.processOrder(message.payload);
      await message.ack();
    } catch (error) {
      // Will retry with exponential backoff
      await message.nack();
    }
  }

  @RotifSubscribe('orders.cancelled')
  async handleOrderCancelled(message: RotifMessage) {
    await this.cancelOrder(message.payload);
    await message.ack();
  }
}
```

### Lifecycle Hooks

```typescript
import { OnModuleInit, OnModuleDestroy } from '@omnitron-dev/titan';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private connection: Connection;

  async onModuleInit() {
    this.connection = await createConnection();
    console.log('Database connected');
  }

  async onModuleDestroy() {
    await this.connection.close();
    console.log('Database disconnected');
  }
}
```

---

## Module Import/Export Rules

### CRITICAL RULE

**NEVER re-export modules from `packages/titan/src/index.ts`** - This causes circular dependencies and breaks tree-shaking.

### ✅ CORRECT - Use package.json exports

```typescript
import { ConfigModule } from '@omnitron-dev/titan/module/config';
import { LoggerModule } from '@omnitron-dev/titan/module/logger';
import { EventsModule } from '@omnitron-dev/titan/module/events';
import { SchedulerModule } from '@omnitron-dev/titan/module/scheduler';
import { TitanRedisModule } from '@omnitron-dev/titan/module/redis';
```

### ❌ WRONG - Don't import modules from root

```typescript
// DON'T DO THIS
import { ConfigModule } from '@omnitron-dev/titan';
import { LoggerModule } from '@omnitron-dev/titan';
```

### Module System

- All modules implement unified `IModule` interface from `nexus/types.ts`
- No wrappers or adapters needed
- Each module's exports defined ONLY in package.json

**Example package.json exports:**
```json
{
  "exports": {
    ".": "./dist/index.js",
    "./module/config": "./dist/modules/config/index.js",
    "./module/logger": "./dist/modules/logger/index.js",
    "./module/events": "./dist/modules/events/index.js"
  }
}
```

---

## Code Quality Standards

### ESLint Configuration

- Import sorting enforced
- Unused import removal enforced
- No `any` types allowed
- Strict TypeScript mode

### Prettier Configuration

- 2 spaces indentation
- Single quotes
- Semicolons required
- Trailing commas (ES5)

### Pre-commit Checklist

```bash
# Always run before committing
pnpm fix:all  # Fix linting and formatting
pnpm build    # Ensure all packages build
pnpm test     # Ensure all tests pass
```

### Testing Standards

- Write tests for new functionality
- Maintain >80% code coverage
- Test with both Node.js and Bun when possible
- Use existing patterns from `@omnitron-dev/testing`

---

## Working with Monorepo

### Adding Dependencies

```bash
# Add to specific package
pnpm --filter @omnitron-dev/[package] add [dependency]

# Add dev dependency
pnpm --filter @omnitron-dev/[package] add -D [dependency]
```

### Internal Package Dependencies

Use workspace protocol:

```json
{
  "dependencies": {
    "@omnitron-dev/common": "workspace:*",
    "@omnitron-dev/eventemitter": "workspace:*"
  }
}
```

### Creating New Package

1. Follow existing package structure
2. Add to `turbo.json` pipeline
3. Use workspace dependencies for internal packages
4. Ensure package builds successfully
5. Add tests
6. Update root README.md if needed

### Version Management

Use changesets for versioning:

```bash
# Create changeset
pnpm changeset

# Version packages
pnpm changeset version

# Publish (after versioning)
pnpm changeset publish
```

---

## Testing

### Best Practices

1. **Runtime Testing**: Test with both Node.js and Bun
2. **State Management**: Use `disableGracefulShutdown: true` in tests
3. **Module Testing**: Use `disableCoreModules: true` for isolation
4. **Async Operations**: Properly await all promises
5. **Cleanup**: Ensure proper cleanup in `afterEach` blocks

### Test Structure

```typescript
import { Application } from '@omnitron-dev/titan';

describe('MyService', () => {
  let app: Application;
  let service: MyService;

  beforeEach(async () => {
    app = await Application.create(TestModule, {
      disableGracefulShutdown: true,
      disableCoreModules: true
    });
    await app.start();
    service = app.get(MyService);
  });

  afterEach(async () => {
    await app.stop();
  });

  it('should do something', async () => {
    const result = await service.doSomething();
    expect(result).toBe('expected');
  });
});
```

### Running Tests

```bash
# Run all tests
pnpm test

# Test specific package
pnpm --filter @omnitron-dev/[package] test

# Run Bun tests
pnpm --filter @omnitron-dev/[package] test:bun

# Run tests in watch mode
pnpm --filter @omnitron-dev/[package] test -- --watch
```

---

## Docker Redis Testing

### Important Paths

- **Docker binary**: `/usr/local/bin/docker`
- **Docker Compose**: Use `docker compose` (v2)
- **Test utilities**: `packages/titan/test/utils/`
  - `redis-test-manager.ts` - Docker container management
  - `redis-fallback.ts` - Fallback to local Redis
- **Compose file**: `packages/titan/test/docker/docker-compose.test.yml`

### Running Redis Tests

```bash
cd packages/titan

# Run Redis tests
npm test -- test/modules/redis/

# Specific test file
npm test -- test/modules/redis/redis.service.spec.ts

# Use real Redis (not Docker)
USE_REAL_REDIS=true npm test -- test/modules/redis/
```

### Manual Container Management

```bash
# Start test container
npm run redis:start

# Stop test container
npm run redis:stop

# Cleanup all containers
npm run redis:cleanup
```

### Configuration

- Uses **ioredis** (not redis package)
- Dynamic port allocation for parallel runs
- Automatic cleanup after tests
- Fallback to local Redis if Docker unavailable

---

## Recent Breaking Changes

### Pino Logger v9.9.x - Object Parameter Order Change

**BREAKING**: Object parameter now comes first.

#### ❌ Old (v9.7.x)

```typescript
logger.info('message', { data: 'value' });
logger.error('error occurred', { error: err });
```

#### ✅ New (v9.9.x)

```typescript
logger.info({ data: 'value' }, 'message');
logger.error({ error: err }, 'error occurred');
```

### Migration Guide

```bash
# Find all logger calls that need updating
grep -r "logger\.(info|error|warn|debug)" packages/
```

**Pattern to fix:**
```typescript
// Before
logger.info('User created', { userId: user.id });

// After
logger.info({ userId: user.id }, 'User created');
```

---

## Key Commands

### Development Workflow

```bash
pnpm install          # Install dependencies
pnpm build            # Build all packages
pnpm dev              # Development mode (watch)
pnpm test             # Run all tests
pnpm fix:all          # Fix linting and formatting
pnpm changeset        # Create changesets for version management
pnpm cleanup          # Clean up all node_modules
```

### Package-Specific Commands

```bash
# Build specific package
pnpm --filter @omnitron-dev/[package] build

# Test specific package
pnpm --filter @omnitron-dev/[package] test

# Run Bun tests
pnpm --filter @omnitron-dev/[package] test:bun

# Add dependency
pnpm --filter @omnitron-dev/[package] add [dependency]
```

### Turborepo Commands

```bash
# Build with cache
turbo build

# Test with cache
turbo test

# Clean cache
turbo clean

# Run specific task
turbo run [task] --filter @omnitron-dev/[package]
```

---

## Architecture Notes

### Namespace

- **Current**: @omnitron-dev
- **Previous**: @devgrid (transitioned)

### Key Concepts

- **Nexus** = DI system inside Titan (backend)
- **Netron** = RPC system integrated into Titan
- **Rotif** = Redis-based messaging integrated into Titan
- **Aether** = Frontend framework (separate from Titan)
- **Titan** = Backend framework
- **Aether** = Frontend framework

### DI Systems

- **Titan/Nexus**: Full-featured DI for backend
- **Aether DI**: Lightweight, tree-shakeable DI for frontend
- **Integration**: Via TypeScript interface contracts (not shared DI)

---

## Planned Projects

### Tron (apps/tron)

Process manager for Titan applications.

**Features:**
- Deep Titan integration with multi-process orchestration
- Health monitoring, auto-restart, load balancing
- Configuration management, log aggregation
- Zero-downtime deployments
- Similar to PM2 but with native Titan integration

**Status:** Planned

---

**Note:** For Meridian MCP tool usage, see `mcp-tools-reference.md`. For workflows, see `workflows-and-patterns.md`.
