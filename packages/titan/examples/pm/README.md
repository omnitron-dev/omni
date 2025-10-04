# Process Manager Examples

This directory contains examples demonstrating the Titan Process Manager module with the file-based architecture.

## Structure

```
pm/
├── README.md              # This file
├── usage.example.ts       # Main usage example
└── processes/            # Example process definitions
    ├── calculator.process.ts        # Simple calculator service
    ├── database.process.ts          # Database service with dependencies
    └── image-processor.process.ts   # CPU-intensive image processing
```

## Running Examples

### Prerequisites

1. Build the Titan package:
```bash
npm run build
```

2. Ensure you're in the titan package directory:
```bash
cd packages/titan
```

### Run the Main Example

```bash
node examples/pm/usage.example.js
```

This will demonstrate:
- Spawning processes from files
- Type-safe RPC calls
- Process pools with load balancing
- Health monitoring
- Service discovery
- Graceful shutdown

## Example Processes

### 1. Calculator Process (`processes/calculator.process.ts`)

A simple calculator service demonstrating:
- Basic arithmetic operations (add, subtract, multiply, divide)
- Advanced operations (power, factorial)
- Health checks
- Statistics tracking

**Key Features:**
- Stateful operation counting
- Error handling (division by zero, negative factorials)
- Health status reporting

### 2. Database Process (`processes/database.process.ts`)

A database service demonstrating:
- Dependency injection via `init()` method
- CRUD operations
- Caching with `@Cache` decorator
- Rate limiting with `@RateLimit` decorator
- Graceful shutdown with `@OnShutdown` decorator

**Key Features:**
- User management (create, read, update, delete, search)
- Configuration through dependencies
- Query statistics
- Connection health checks

### 3. Image Processor Process (`processes/image-processor.process.ts`)

A CPU-intensive image processing service demonstrating:
- Resource-intensive operations
- Process pools for parallel processing
- Memory monitoring
- Performance metrics

**Key Features:**
- Multiple image operations (resize, crop, rotate, filter, compress)
- Batch processing
- Thumbnail generation
- Load and error rate tracking

## File-Based Architecture

Each process follows these principles:

### 1. One Process Per File
```typescript
// calculator.process.ts
@Process({ name: 'calculator', version: '1.0.0' })
export default class CalculatorProcess {
  // Implementation
}
```

### 2. Default Export Required
```typescript
// Always use default export
export default class MyProcess { }
```

### 3. Spawn with File Path
```typescript
const calculator = await pm.spawn<CalculatorProcess>(
  resolve(__dirname, './processes/calculator.process.js'),
  { name: 'calculator', version: '1.0.0' }
);
```

### 4. Type Safety
```typescript
// Import type only (not the class)
import type CalculatorProcess from './processes/calculator.process.js';

// Full type safety in RPC calls
const result = await calculator.add(5, 3); // TypeScript knows this returns number
```

## Key Concepts

### Process Lifecycle

1. **Spawn**: Process is loaded from file
2. **Initialize**: Optional `init()` method called with dependencies
3. **Ready**: Process registers with service discovery
4. **Running**: Accepts RPC calls
5. **Shutdown**: `@OnShutdown` methods called
6. **Stopped**: Process terminated

### Decorators

- `@Process(options)`: Marks a class as a process
- `@Public()`: Exposes a method via RPC
- `@HealthCheck()`: Defines health check method
- `@OnShutdown()`: Cleanup method called on shutdown
- `@Cache(options)`: Caches method results
- `@RateLimit(options)`: Limits request rate
- `@Metric()`: Tracks method metrics
- `@Trace()`: Adds tracing

### Dependencies

Pass dependencies during spawn:

```typescript
const database = await pm.spawn<DatabaseProcess>(
  processPath,
  {
    dependencies: {
      config: { host: 'localhost', port: 5432 }
    }
  }
);
```

The process receives them in `init()`:

```typescript
async init(config?: DatabaseConfig) {
  this.config = config;
  await this.connect();
}
```

### Process Pools

For CPU-intensive or high-load services:

```typescript
const pool = await pm.pool<ImageProcessorProcess>(
  processPath,
  {
    size: 4,                    // Number of workers
    strategy: 'least-loaded',   // Load balancing strategy
    autoScale: {
      enabled: true,
      min: 2,
      max: 8,
      targetCPU: 0.7
    }
  }
);

// Calls are automatically load-balanced
const result = await pool['processImage'](job);
```

## Best Practices

1. **Keep processes focused**: One responsibility per process
2. **Use type imports**: Import types only, not actual classes
3. **Handle cleanup**: Use `@OnShutdown` for graceful cleanup
4. **Monitor health**: Implement `@HealthCheck` methods
5. **Handle errors**: Always validate inputs and handle errors
6. **Use pools wisely**: Pool CPU-intensive operations
7. **Configure properly**: Use dependencies for configuration
8. **Test isolation**: Each process should be independently testable

## Troubleshooting

### Process Not Found

```
Error: Process file not found: /path/to/process.js
```

**Solution**: Ensure you're using the compiled `.js` file path, not `.ts`

### No Default Export

```
Error: No default export found in /path/to/process.js
```

**Solution**: Use `export default class` in your process file

### Type Errors

```
Property 'add' does not exist on type 'Proxy<CalculatorProcess>'
```

**Solution**: Ensure you're importing the type: `import type CalculatorProcess from '...'`

### Import Errors

```
Cannot find module '../../../src/modules/pm/decorators.js'
```

**Solution**: Check your relative import paths are correct

## Additional Resources

- [Process Manager README](../../src/modules/pm/README.md) - Full module documentation
- [Titan Examples](../) - Other Titan framework examples
- [Netron Documentation](../../src/netron/README.md) - RPC framework details
