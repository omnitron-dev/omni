# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript monorepo for the DevGrid project, containing distributed systems libraries, data processing tools, and blockchain interaction utilities. The monorepo uses Turborepo for build orchestration and Yarn 4.7.0 for package management.

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
- `/apps/*` - Applications (e.g., onix orchestration system)
- `/packages/*` - Reusable libraries
- `/scripts` - Build and utility scripts

### Core Packages

**@devgrid/netron** - WebSocket-based distributed systems framework
- RPC with type safety
- Event bus with multiple emission patterns
- Service discovery via Redis
- Automatic reconnection and versioning

**@devgrid/rotif** - Redis-based reliable notification system
- Guaranteed message delivery
- Dead Letter Queue support
- Retry mechanisms
- Consumer groups for scaling

**@devgrid/onix** - Infrastructure orchestration (Ansible-like)
- SSH-based task execution
- Playbook and inventory management
- Pluggable task system

### Technology Stack
- **Language**: TypeScript 5.8.3 with strict mode
- **Runtime**: Node.js 22+
- **Build**: Turborepo
- **Package Manager**: Yarn 4.7.0 with workspaces
- **Testing**: Jest with ts-jest
- **Linting**: ESLint v9 with flat config
- **Formatting**: Prettier
- **Serialization**: MessagePack
- **Messaging**: Redis for service discovery and queuing

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

**Turbo Pipeline**: Defined in `turbo.json` with proper task dependencies and caching

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