# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript monorepo for the Omnitron ecosystem - a collection of minimalist, high-performance libraries for building distributed systems. At its core is **Titan**, a lightweight framework designed for distributed, runtime-agnostic applications with enterprise reliability. The monorepo uses Turborepo for build orchestration and Yarn 4.9.2 for package management.

### Runtime Support
- **Node.js**: >=22.0.0 (primary runtime)
- **Bun**: >=1.2.0 (fully supported with test coverage)
- **Deno**: Experimental support in some packages
- All packages work in both Node.js and Bun environments

## Key Commands

### Development Workflow
```bash
# Install dependencies
yarn install

# Build all packages
yarn build

# Run development mode
yarn dev

# Run tests
yarn test

# Fix linting and formatting issues before committing
yarn fix:all

# Run linting only
yarn lint
yarn lint:fix

# Run formatting only
yarn fm:check
yarn fm:fix

# Create changesets for version management
yarn changeset

# Clean up all node_modules
yarn cleanup
```

### Testing Commands
```bash
# Run all tests
yarn test

# Run tests for a specific package
yarn workspace @omnitron-dev/[package-name] test

# Run a single test file
yarn workspace @omnitron-dev/[package-name] test path/to/test.spec.ts

# Run Bun tests for compatible packages
yarn workspace @omnitron-dev/[package-name] test:bun

# Run Deno tests (experimental)
yarn workspace @omnitron-dev/[package-name] test:deno
```

## Architecture Overview

### Monorepo Structure
- `/packages/*` - Reusable libraries
- `/scripts` - Build and utility scripts
- No `/apps` directory currently (referenced in package.json but not present)

### Current Packages

**@omnitron-dev/common** - Essential utilities and helper functions
- Promise utilities (defer, delay, retry, timeout)
- Object manipulation (omit, entries, keys, values)
- Type predicates and guards
- Data structures (ListBuffer, TimedMap)
- ✅ Full Bun runtime support
- ✅ Node.js 22+ support

**@omnitron-dev/eventemitter** - Universal event emitter with sync and async patterns
- Standard EventEmitter API (on, off, emit, once)
- Parallel and sequential async event execution
- Reduce patterns for event accumulation
- Concurrency control with p-limit
- Promise-based event handling
- ✅ Works in Node.js, Bun, and browsers
- ✅ Full test coverage for all runtimes

**@omnitron-dev/smartbuffer** - Enhanced binary data manipulation
- Efficient buffer operations
- Support for various data types (int8-64, float, double, varint)
- Big-endian and little-endian support
- String encoding/decoding utilities
- ✅ Bun runtime support
- ✅ Node.js support

**@omnitron-dev/messagepack** - High-performance MessagePack serialization
- Full MessagePack specification support
- Custom type extensions
- Efficient binary serialization
- Stream processing capabilities
- ✅ Bun runtime support
- ✅ Node.js support

**@omnitron-dev/titan** - A minimalist TypeScript framework for building distributed, runtime-agnostic applications with enterprise reliability
- **Core Philosophy**: Essential features without bloat, designed for distributed systems
- **Integrated Components**:
  - Nexus DI: Full dependency injection container built-in
  - Netron: WebSocket RPC framework integrated
  - Rotif: Reliable messaging system support
- **Built-in Modules**:
  - Config: Multi-source configuration management
  - Events: Async event bus with decorators
  - Scheduler: Cron and interval task scheduling
  - Redis: Redis integration module
  - Logger: Pino-based structured logging
- **Key Features**:
  - Minimalist decorator-based API
  - Application lifecycle management
  - Graceful shutdown with timeout control
  - Modular architecture with dependency resolution
  - Concurrent operation handling (start/stop)
  - Process signal handling
  - Health checks and metrics
- **Runtime Support**:
  - ✅ Node.js 22+ (full support)
  - ✅ Bun 1.2+ (full support with tests)
  - 🚧 Deno 2.0+ (experimental)

**@omnitron-dev/rotif** - Redis-based reliable notification and messaging system
- Exactly-once processing with deduplication
- Configurable retry mechanisms with exponential backoff
- Delayed message delivery and scheduling
- Dead Letter Queue (DLQ) for failed messages
- Built-in statistics and monitoring
- Extensible middleware system
- Consumer groups for horizontal scaling
- Full TypeScript support

**@omnitron-dev/cuid** - Collision-resistant unique identifiers
- Secure random ID generation
- Timestamp-based ordering
- URL-safe characters
- ✅ Bun runtime support
- ✅ Node.js support

**@omnitron-dev/testing** - Testing utilities and helpers
- Mock factories
- Test fixtures
- Async test utilities
- Container testing helpers
- Redis test utilities

**@omnitron-dev/titan-module-template** - Template for creating Titan modules
- Boilerplate for new modules
- Example implementations
- Best practices guide

### Integrated into Titan

The following packages have been integrated directly into @omnitron-dev/titan:
- **nexus** - Dependency injection container (now at `titan/src/nexus`)
- **netron** - WebSocket RPC framework (now at `titan/src/netron`)
- These are accessible via exports: `@omnitron-dev/titan/nexus` and `@omnitron-dev/titan/netron`

### Removed Packages

The following packages have been removed from the monorepo:
- **priceverse** - Crypto price aggregation (moved to separate repo)
- **vibra** - Vitest-based testing framework (removed)
- **bitcoin-core** - Bitcoin Core RPC client (moved to separate repo)
- **onix** - Infrastructure orchestration (removed)
- **rotif-nest** - NestJS integration for Rotif (removed)
- **netron-nest** - NestJS integration for Netron (functionality merged into Titan)

### Technology Stack
- **Language**: TypeScript 5.8.3 - 5.9.2 with strict mode
- **Runtime**: Node.js 22+ and Bun 1.2+ (both fully supported)
- **Build**: Turborepo for orchestration, TSC for compilation
- **Package Manager**: Yarn 4.9.2 with workspaces
- **Testing**: Jest 30.x with ts-jest (Node.js), Bun test (Bun runtime)
- **Linting**: ESLint v9 with flat config
- **Formatting**: Prettier with consistent style
- **Serialization**: MessagePack for efficient data transfer
- **Messaging**: Redis for service discovery and reliable messaging

### Development Patterns

**Titan Application Structure**:
```typescript
import { Application, Module, Injectable } from '@omnitron-dev/titan';

@Injectable()
class MyService {
  doSomething() { /* ... */ }
}

@Module({
  providers: [MyService],
  exports: [MyService]
})
class MyModule {}

const app = await Application.create(MyModule);
await app.start();
```

**Service Definition with Decorators**:
```typescript
@Service('calculator@1.0.0')
export class CalculatorService {
  @Public()
  add(a: number, b: number): number {
    return a + b;
  }
}
```

**Event-Driven Architecture**: Titan provides built-in event handling
```typescript
@OnEvent('user.created')
async handleUserCreated(data: any) {
  // Handle event
}
```

**Message Handler with Rotif**:
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

**Type Safety**: All packages maintain strict TypeScript types with proper exports

**Dependency Management**: Internal packages use workspace protocol:
```json
"@omnitron-dev/common": "workspace:*"
```

### Important Configuration

**TypeScript**: Each package has:
- `tsconfig.json` - Base configuration
- `tsconfig.build.json` - Build-specific config
- Some packages also have `tsconfig.esm.json` for ESM builds

**Jest**: Each package has its own `jest.config.ts` with coverage enabled
- Note: Jest 30.x requires ES module compatibility for config files

**Turbo Pipeline**: Defined in `turbo.json` with proper task dependencies and caching

**Runtime Support Configuration**:
- `bunfig.toml` - Bun-specific configuration
- Runtime detection in code for compatibility
- Separate test files for Bun compatibility testing

### Code Quality Standards

- ESLint enforces import sorting and unused import removal
- Prettier enforces consistent formatting (2 spaces, single quotes, semicolons)
- All code must pass linting and formatting checks before committing
- Tests should be written for new functionality
- Use existing patterns and utilities from `@omnitron-dev/common`
- Ensure Bun compatibility when adding new features

### Working with the Monorepo

1. When adding dependencies, add them to the specific package, not the root
2. Use `yarn workspace @omnitron-dev/[package-name] add [dependency]`
3. Follow existing package structure when creating new packages
4. Ensure all packages build successfully before committing
5. Use changesets for version management when making changes
6. Test with both Node.js and Bun runtimes when possible

### Recent Breaking Changes

**Pino Logger v9.9.x**: The logger methods now require object parameters first, then message string:
```typescript
// Old (v9.7.x and below)
logger.info('message', { data });

// New (v9.9.x)
logger.info({ data }, 'message');
```

### Titan-Specific Notes

**Application State Management**:
- Application has strict state transitions (Created → Starting → Started → Stopping → Stopped)
- Concurrent start/stop operations are properly queued
- Force shutdown is supported with timeout options

**Module System**:
- Modules can have dependencies on other modules
- Lifecycle hooks: onRegister, onStart, onStop, onDestroy
- Modules are started in dependency order, stopped in reverse

**Error Handling**:
- Graceful error handling in event handlers
- Module stop failures don't prevent cleanup by default
- Timeout errors are treated as critical

### Notes for AI Assistants

- The repository has transitioned from @devgrid to @omnitron-dev namespace
- Nexus and Netron are now integrated into Titan, not separate packages
- Focus is on runtime compatibility (Node.js and Bun)
- Titan is the main framework package that integrates all core functionality
- When working with Titan tests, be aware of state management quirks
- TypeScript versions may vary slightly between packages (5.8.3 - 5.9.2)
- Always check for breaking changes in dependencies (especially Pino logger)

### Environment Setup

Execute these commands each time for session to ensure all tools are available:
```bash
export PATH="/Users/taaliman/.bun/bin:/Users/taaliman/.deno/bin:/Users/taaliman/.cargo/bin:/opt/homebrew/bin:$PATH"
```

### Testing Best Practices

1. **Runtime Testing**: Always test with both Node.js and Bun
2. **State Management**: Use `disableGracefulShutdown: true` in tests
3. **Module Testing**: Use `disableCoreModules: true` for isolated testing
4. **Async Operations**: Properly await all promises to avoid hanging tests
5. **Cleanup**: Ensure proper cleanup in afterEach blocks

### Current Focus Areas

- ✅ Full Bun runtime support across all packages
- ✅ Titan framework stabilization and testing
- 🚧 Deno support (experimental)
- 🚧 Documentation improvements
- 🚧 Performance optimizations
- 🚧 Decorator cleanup and minimization

### Planned Projects

**Tron** (apps/tron) - Process manager for Titan applications
- Deep integration with Titan architecture
- Multi-process orchestration
- Health monitoring and auto-restart
- Load balancing and scaling
- Configuration management
- Log aggregation and monitoring
- Zero-downtime deployments

This will complement Titan as the operational layer, similar to how PM2 complements Node.js applications but with native Titan integration.