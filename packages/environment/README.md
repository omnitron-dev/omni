# @omnitron-dev/environment

Universal configuration and workspace management system for TypeScript applications.

## Overview

Environment is a programmable, composable configuration container that unifies workspace management, configuration, and runtime state. It provides a type-safe, validated, and observable approach to managing application settings.

## Features

### Phase 1 (Implemented) ✅

- **Core Environment Class**: Full CRUD operations with type safety
- **Storage Backends**:
  - Memory storage (for testing)
  - File system storage (JSON/YAML)
- **Configuration Layer**:
  - JSON Schema validation
  - Zod schema validation
  - Variable interpolation
- **Algebraic Operations**:
  - Merge: Deep merge with custom strategies
  - Diff: Compute differences between environments
  - Patch: Apply diffs to environments
  - Clone: Create independent copies
- **Lifecycle Management**:
  - Activate/deactivate environments
  - Validation before activation
  - Change callbacks and watchers
- **Serialization**:
  - JSON export
  - YAML export
  - File persistence

## Installation

```bash
pnpm add @omnitron-dev/environment
```

## Quick Start

```typescript
import { Environment } from '@omnitron-dev/environment';
import { z } from 'zod';

// Define schema
const schema = z.object({
  app: z.object({
    name: z.string(),
    port: z.number()
  }),
  database: z.object({
    host: z.string(),
    port: z.number()
  })
});

// Create environment
const env = Environment.create({
  name: 'production',
  schema,
  config: {
    app: {
      name: 'MyApp',
      port: 3000
    },
    database: {
      host: 'db.example.com',
      port: 5432
    }
  }
});

// Access configuration
console.log(env.get('app.name')); // 'MyApp'
console.log(env.get('database.port')); // 5432

// Modify configuration
env.set('app.port', 8080);

// Validate
const result = await env.validate();
console.log(result.valid); // true

// Save to file
await env.save('.environment/production.yaml');

// Load from file
const loaded = await Environment.fromFile('.environment/production.yaml');
```

## Core Concepts

### Environment

An Environment is a semantic container that encapsulates:
- Configuration data with schema validation
- Metadata about the environment
- Lifecycle management (activate/deactivate)
- Change observation and callbacks

### Storage Backends

Environments can persist to different storage backends:
- **MemoryStorage**: In-memory storage for testing
- **FileSystemStorage**: JSON/YAML files
- Custom backends implementing `IStorageBackend`

### Algebraic Operations

Environments support mathematical operations:

```typescript
// Merge two environments
const merged = env1.merge(env2);

// Compute diff
const diff = env1.diff(env2);

// Apply patch
const patched = env1.patch(diff);

// Clone
const clone = env.clone();
```

## Examples

### Hierarchical Configuration

```typescript
// Base configuration
const base = Environment.create({
  name: 'base',
  config: {
    app: { name: 'MyApp', version: '1.0.0' },
    features: { auth: true, analytics: false }
  }
});

// Development overrides
const dev = Environment.create({
  name: 'development',
  config: {
    app: { debug: true },
    database: { host: 'localhost', port: 5432 }
  }
});

// Merge configurations
const devEnv = base.merge(dev);
console.log(devEnv.get('app.name')); // 'MyApp'
console.log(devEnv.get('database.host')); // 'localhost'
```

### Variable Interpolation

```typescript
const env = Environment.create({
  name: 'app',
  config: {
    title: '${app_name} v${app_version}',
    url: 'https://${domain}:${port}'
  }
});

// Resolve variables
await env.config.resolve({
  variables: {
    app_name: 'MyApp',
    app_version: '1.0.0',
    domain: 'example.com',
    port: '3000'
  }
});

console.log(env.get('title')); // 'MyApp v1.0.0'
console.log(env.get('url')); // 'https://example.com:3000'
```

### Change Callbacks

```typescript
const env = Environment.create({
  name: 'app',
  config: { port: 3000 }
});

// Watch for changes
env.onChange('port', (newValue, oldValue) => {
  console.log(`Port changed from ${oldValue} to ${newValue}`);
});

env.set('port', 8080);
// Output: Port changed from 3000 to 8080
```

## API Reference

### Environment Class

#### Static Methods

- `Environment.create(options)` - Create new environment
- `Environment.fromFile(path, options?)` - Load from file
- `Environment.fromObject(data, options?)` - Create from object

#### Instance Methods

- `get(key)` - Get value at path
- `set(key, value)` - Set value at path
- `has(key)` - Check if path exists
- `delete(key)` - Delete path
- `merge(other, strategy?)` - Merge with another environment
- `diff(other)` - Compute diff
- `patch(diff)` - Apply diff
- `clone()` - Create independent copy
- `validate()` - Validate configuration
- `activate()` - Activate environment
- `deactivate()` - Deactivate environment
- `save(path?)` - Save to storage
- `load(path)` - Load from storage
- `onChange(key, callback)` - Watch for changes
- `toJSON()` - Export as JSON
- `toYAML()` - Export as YAML

## Testing

```bash
# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Watch mode
pnpm test:watch
```

## Test Results

- **100 tests passing** (100% success rate)
- **86.52% line coverage**
- **84.26% branch coverage**
- **94% function coverage**

## Architecture

```
packages/environment/
├── src/
│   ├── types/          # Core type definitions (7 files)
│   ├── storage/        # Storage backends (4 files)
│   ├── config/         # Configuration layer (4 files)
│   ├── core/           # Environment class (2 files)
│   ├── utils/          # Utility functions (5 files)
│   └── index.ts
└── test/
    └── unit/           # Unit tests (10 files)
```

## Roadmap

### Phase 2 (Planned)
- Secrets layer with encryption
- Variables layer with computed values
- Tasks layer for executable workflows
- Targets layer for multi-environment execution

### Phase 3 (Planned)
- Distributed synchronization
- CRDT-based conflict resolution
- Multi-node replication

### Phase 4 (Planned)
- Cognitive capabilities with Flow-Machine integration
- Learning from usage patterns
- Optimization suggestions

## Contributing

Contributions are welcome! Please follow the monorepo conventions:

1. Use TypeScript strict mode
2. Write tests for new features
3. Ensure all tests pass
4. Follow existing code style

## License

MIT
