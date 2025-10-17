# Quick Start Guide

Get started with the Ontological Component Composition System in 5 minutes.

---

## Installation

```bash
# Install dependencies
pnpm install

# Build the project
pnpm build
```

---

## Your First Component (5 minutes)

### Step 1: Import the system

```typescript
import {
  component,
  composer,
  Protocols,
  Capabilities,
  capability,
  Semantic,
  type UserId,
  type ExecutionContext,
} from '@omnitron-dev/holon-flow/ontology';
```

### Step 2: Define your first component

```typescript
// Define semantic types for your domain
type UserData = {
  id: UserId;
  name: string;
  email: string;
};

// Create a component that reads user data
const userReader = component<void, UserData[]>()
  .setId('user-reader')
  .setName('User Reader')
  .setVersion('1.0.0')
  .setInputType({ name: 'void' })
  .setOutputType({
    name: 'UserData[]',
    brand: 'UserData',
  })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.READ))
  .addCapability(capability(Capabilities.DATABASE))
  .setExecute(async (_, context: ExecutionContext) => {
    context.logger?.info('Reading users from database');

    // Your implementation here
    return [
      {
        id: Semantic.userId('user-1'),
        name: 'Alice',
        email: 'alice@example.com',
      },
    ];
  })
  .setMetadata({
    description: 'Reads users from the database',
    tags: ['user', 'database', 'read'],
  })
  .build();

console.log('✓ Component created:', userReader.name);
```

### Step 3: Create a second component

```typescript
// Create a component that transforms user data
const userTransformer = component<UserData[], UserData[]>()
  .setId('user-transformer')
  .setName('User Transformer')
  .setVersion('1.0.0')
  .setInputType({ name: 'UserData[]', brand: 'UserData' })
  .setOutputType({ name: 'UserData[]', brand: 'UserData' })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.TRANSFORM))
  .addRequirement(Capabilities.READ) // Requires a data source
  .setExecute(async (users: UserData[], context: ExecutionContext) => {
    context.logger?.info(`Transforming ${users.length} users`);

    // Transform users (e.g., uppercase names)
    return users.map((user) => ({
      ...user,
      name: user.name.toUpperCase(),
    }));
  })
  .setMetadata({
    description: 'Transforms user data',
    tags: ['user', 'transform'],
  })
  .build();

console.log('✓ Component created:', userTransformer.name);
```

### Step 4: Compose the components

```typescript
// Compose the two components into a pipeline
const pipeline = composer.compose(userReader, userTransformer);

console.log('✓ Pipeline created:', pipeline.visualize());
// Output: "User Reader → User Transformer"
```

### Step 5: Execute the pipeline

```typescript
// Create execution context
const context: ExecutionContext = {
  correlationId: 'demo-123',
  timestamp: Date.now(),
  environment: {},
  logger: {
    debug: (msg, meta) => console.log('[DEBUG]', msg, meta),
    info: (msg, meta) => console.log('[INFO]', msg, meta),
    warn: (msg, meta) => console.warn('[WARN]', msg, meta),
    error: (msg, meta) => console.error('[ERROR]', msg, meta),
  },
};

// Execute the pipeline
const result = await pipeline.execute(undefined, context);

console.log('✓ Pipeline executed successfully');
console.log('Result:', result);
```

---

## Complete Example

Put it all together:

```typescript
import {
  component,
  composer,
  Protocols,
  Capabilities,
  capability,
  Semantic,
  type UserId,
  type ExecutionContext,
} from '@omnitron-dev/holon-flow/ontology';

// Define types
type UserData = {
  id: UserId;
  name: string;
  email: string;
};

// Create components
const userReader = component<void, UserData[]>()
  .setId('user-reader')
  .setName('User Reader')
  .setVersion('1.0.0')
  .setInputType({ name: 'void' })
  .setOutputType({ name: 'UserData[]', brand: 'UserData' })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.READ))
  .addCapability(capability(Capabilities.DATABASE))
  .setExecute(async (_, context) => {
    context.logger?.info('Reading users');
    return [
      {
        id: Semantic.userId('user-1'),
        name: 'Alice',
        email: 'alice@example.com',
      },
    ];
  })
  .build();

const userTransformer = component<UserData[], UserData[]>()
  .setId('user-transformer')
  .setName('User Transformer')
  .setVersion('1.0.0')
  .setInputType({ name: 'UserData[]', brand: 'UserData' })
  .setOutputType({ name: 'UserData[]', brand: 'UserData' })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.TRANSFORM))
  .addRequirement(Capabilities.READ)
  .setExecute(async (users, context) => {
    context.logger?.info(`Transforming ${users.length} users`);
    return users.map((user) => ({ ...user, name: user.name.toUpperCase() }));
  })
  .build();

// Compose and execute
async function main() {
  const pipeline = composer.compose(userReader, userTransformer);

  const context: ExecutionContext = {
    correlationId: 'demo-123',
    timestamp: Date.now(),
    environment: {},
    logger: {
      debug: (msg, meta) => console.log('[DEBUG]', msg, meta || ''),
      info: (msg, meta) => console.log('[INFO]', msg, meta || ''),
      warn: (msg, meta) => console.warn('[WARN]', msg, meta || ''),
      error: (msg, meta) => console.error('[ERROR]', msg, meta || ''),
    },
  };

  const result = await pipeline.execute(undefined, context);
  console.log('Result:', result);
}

main().catch(console.error);
```

Run it:
```bash
ts-node quick-start-example.ts
```

Output:
```
[INFO] Reading users
[INFO] Transforming 1 users
Result: [ { id: 'user-1', name: 'ALICE', email: 'alice@example.com' } ]
```

---

## Try Invalid Compositions

### Example: Type Mismatch

```typescript
// Create incompatible components
const numberSource = component<void, number[]>()
  .setId('number-source')
  .setName('Number Source')
  .setInputType({ name: 'void' })
  .setOutputType({ name: 'number[]' })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.READ))
  .setExecute(async () => [1, 2, 3])
  .build();

const stringProcessor = component<string[], string[]>()
  .setId('string-processor')
  .setName('String Processor')
  .setInputType({ name: 'string[]' })
  .setOutputType({ name: 'string[]' })
  .setInputProtocol(Protocols.JSON)
  .setOutputProtocol(Protocols.JSON)
  .addCapability(capability(Capabilities.TRANSFORM))
  .setExecute(async (strings) => strings.map((s) => s.toUpperCase()))
  .build();

// Try to compose (will fail)
try {
  const invalid = composer.compose(numberSource, stringProcessor);
  console.log('This should not happen!');
} catch (error: any) {
  console.error('✗ Composition failed:', error.message);
  console.error('  Reason:', error.reason?.details);
  console.error('  Suggestion:', error.reason?.suggestion);
}
```

Output:
```
✗ Composition failed: Cannot compose 'Number Source' with 'String Processor':
  Output type 'number[]' is not compatible with input type 'string[]'
  Reason: Output type 'number[]' is not compatible with input type 'string[]'
  Suggestion: Add a type transformer component between them
```

---

## Next Steps

### 1. Learn More Concepts

- **Brand Types**: [README.md#type-system](./README.md#type-system)
- **Protocols**: [README.md#protocol-system](./README.md#protocol-system)
- **Capabilities**: [README.md#capability-system](./README.md#capability-system)

### 2. Explore Examples

- **Basic Composition**: [`examples/basic-composition.ts`](./examples/basic-composition.ts)
- **Infrastructure**: [`examples/infrastructure-composition.ts`](./examples/infrastructure-composition.ts)

### 3. Visual Guide

- **Diagrams**: [VISUAL_GUIDE.md](./VISUAL_GUIDE.md)

### 4. Full Documentation

- **Complete Guide**: [README.md](./README.md)
- **Architecture**: [docs/ONTOLOGICAL_COMPOSITION_ARCHITECTURE.md](../docs/ONTOLOGICAL_COMPOSITION_ARCHITECTURE.md)

---

## Common Patterns

### Pattern 1: Data Pipeline

```typescript
const pipeline = composer.composePipeline(
  dataSource,   // Reads data
  validator,    // Validates data
  transformer,  // Transforms data
  enricher,     // Enriches data
  dataSink      // Writes data
);
```

### Pattern 2: Request/Response

```typescript
const handler = composer.compose(
  requestParser,   // Parse incoming request
  businessLogic    // Process and respond
);
```

### Pattern 3: Multi-Target Deployment

```typescript
// Same source, different targets
const k8sPipeline = composer.composePipeline(builder, configurator, k8sGenerator, k8sDeployer);
const dockerPipeline = composer.composePipeline(builder, configurator, dockerGenerator);
const ecsPipeline = composer.composePipeline(builder, configurator, ecsGenerator);
```

---

## Tips

1. **Use Semantic Types**: Always use brand types like `UserId` instead of plain `string`
2. **Declare Capabilities Accurately**: Only declare what your component actually provides
3. **Add Rich Metadata**: Good metadata helps with LLM understanding and documentation
4. **Use Execution Context**: Log, track metrics, and use correlation IDs
5. **Handle Errors**: Wrap execute logic in try-catch for better error messages

---

## Troubleshooting

### Problem: "Type mismatch" error

**Solution**: Ensure output type of Component A matches input type of Component B, including the brand.

```typescript
// ❌ Wrong
outputType: { name: 'Data' }
inputType: { name: 'Data', brand: 'Data' }

// ✅ Correct
outputType: { name: 'Data', brand: 'Data' }
inputType: { name: 'Data', brand: 'Data' }
```

### Problem: "Protocol mismatch" error

**Solution**: Use the same protocol or use `composeWithAdaptation()` for automatic adaptation.

```typescript
// ❌ Won't work directly
composer.compose(jsonComponent, msgpackComponent);

// ✅ Works with adaptation
composer.composeWithAdaptation(jsonComponent, msgpackComponent);
```

### Problem: "Missing capabilities" error

**Solution**: Ensure Component A provides all capabilities required by Component B.

```typescript
// Component B requires DATABASE capability
.addRequirement(Capabilities.DATABASE)

// Component A must provide it
.addCapability(capability(Capabilities.DATABASE))
```

---

## Get Help

- **Documentation**: [README.md](./README.md)
- **Examples**: [`examples/`](./examples/)
- **Issues**: Create an issue on GitHub

---

**You're ready to build ontologically-safe component systems! 🚀**
