# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript monorepo for the DevGrid project, containing distributed systems libraries and data processing tools. The monorepo uses Turborepo for build orchestration and Yarn 4.9.2 for package management.

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
yarn workspace @devgrid/[package-name] test

# Run a single test file
yarn workspace @devgrid/[package-name] test path/to/test.spec.ts
```

## Architecture Overview

### Monorepo Structure
- `/packages/*` - Reusable libraries
- `/scripts` - Build and utility scripts
- `/experiments` - Experimental code and documentation

### Current Packages

**@devgrid/common** - Essential utilities and helper functions
- Promise utilities (defer, delay, retry, timeout)
- Object manipulation (omit, entries, keys, values)
- Type predicates and guards
- Data structures (ListBuffer, TimedMap)
- Bun runtime support

**@devgrid/eventemitter** - Universal event emitter with sync and async patterns
- Standard EventEmitter API (on, off, emit, once)
- Parallel and sequential async event execution
- Reduce patterns for event accumulation
- Concurrency control with p-limit
- Promise-based event handling
- Works in Node.js, Bun, and browsers
- Bun runtime support

**@devgrid/smartbuffer** - Enhanced binary data manipulation
- Efficient buffer operations
- Support for various data types (int8-64, float, double, varint)
- Big-endian and little-endian support
- String encoding/decoding utilities
- Bun runtime support

**@devgrid/messagepack** - High-performance MessagePack serialization
- Full MessagePack specification support
- Custom type extensions
- Efficient binary serialization
- Stream processing capabilities
- Bun runtime support

**@devgrid/netron** - WebSocket-based distributed systems framework
- Type-safe RPC with decorators
- Event bus with multiple emission patterns
- Service discovery via Redis
- Automatic reconnection and versioning
- Streaming support for large data transfers
- Bun runtime support (with test coverage)

**@devgrid/netron-nest** - NestJS integration for Netron framework
- Seamless NestJS dependency injection
- Service decorators for easy exposure
- Module configuration
- Health checks and graceful shutdown

**@devgrid/rotif** - Redis-based reliable notification and messaging system
- Exactly-once processing with deduplication
- Configurable retry mechanisms with exponential backoff
- Delayed message delivery and scheduling
- Dead Letter Queue (DLQ) for failed messages
- Built-in statistics and monitoring
- Extensible middleware system
- Consumer groups for horizontal scaling
- Full TypeScript support

**@devgrid/rotif-nest** - NestJS integration for Rotif messaging
- Seamless NestJS DI integration
- Decorator-based message handlers (@RotifSubscribe)
- Automatic dependency injection
- Health checks and monitoring
- Custom exception filters
- Built-in interceptors for logging and metrics
- NestJS-style middleware support
- Auto-discovery of decorated handlers

### Recently Moved/Removed Packages

The following packages have been moved to separate repositories:
- **@devgrid/bitcoin-core** - Bitcoin Core RPC client (moved to separate repo)
- **@devgrid/onix** - Infrastructure orchestration (removed)
- **omnitron** codebase (removed)
- **ts-rest** forks (removed)

### Technology Stack
- **Language**: TypeScript 5.8.3 - 5.9.2 with strict mode
- **Runtime**: Node.js 22+ and Bun support
- **Build**: Turborepo
- **Package Manager**: Yarn 4.9.2 with workspaces
- **Testing**: Jest 30.x with ts-jest
- **Linting**: ESLint v9 with flat config
- **Formatting**: Prettier
- **Serialization**: MessagePack
- **Messaging**: Redis for service discovery

### Development Patterns

**Service Definition**: Use decorators for declarative service exposure
```typescript
@Service('calculator@1.0.0')
export class CalculatorService {
  @Public()
  add(a: number, b: number): number {
    return a + b;
  }
}
```

**Event-Driven Architecture**: Both Netron and Rotif use event-driven patterns extensively

**Message Handler Definition**: Use decorators for declarative message handling with Rotif
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
"@devgrid/common": "workspace:*"
```

### Important Configuration

**TypeScript**: Each package has:
- `tsconfig.json` - Base configuration
- `tsconfig.build.json` - Build-specific config
- Some packages also have `tsconfig.esm.json` for ESM builds

**Jest**: Each package has its own `jest.config.ts` with coverage enabled
- Note: Jest 30.x requires ES module compatibility for config files

**Turbo Pipeline**: Defined in `turbo.json` with proper task dependencies and caching

**Bun Support**: Several packages now include:
- `bunfig.toml` - Bun configuration
- Bun-specific test files for compatibility testing

### Code Quality Standards

- ESLint enforces import sorting and unused import removal
- Prettier enforces consistent formatting (2 spaces, single quotes, semicolons)
- All code must pass linting and formatting checks before committing
- Tests should be written for new functionality
- Use existing patterns and utilities from `@devgrid/common`

### Working with the Monorepo

1. When adding dependencies, add them to the specific package, not the root
2. Use `yarn workspace @devgrid/[package-name] add [dependency]`
3. Follow existing package structure when creating new packages
4. Ensure all packages build successfully before committing
5. Use changesets for version management when making changes

### Recent Breaking Changes

**Pino Logger v9.9.x**: The logger methods now require object parameters first, then message string:
```typescript
// Old (v9.7.x and below)
logger.info('message', { data });

// New (v9.9.x)
logger.info({ data }, 'message');
```

### Notes for AI Assistants

- The repository focuses on core distributed systems utilities
- Rotif and Rotif-Nest packages have been restored to the monorepo for Redis-based messaging functionality
- Bun support is being actively added across packages
- TypeScript versions may vary slightly between packages (5.8.3 - 5.9.2)
- When fixing compilation errors after dependency updates, check for breaking changes in logger libraries (especially Pino)

execute these command each time for session:
```
export PATH="/Users/taaliman/.bun/bin:/Users/taaliman/.deno/bin:/Users/taaliman/.cargo/bin:/opt/homebrew/bin:$PATH"
```