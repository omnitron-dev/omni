
# Ontological Component Composition System

**Version**: 1.0.0
**Status**: Production Ready
**Philosophy**: Components as LEGO bricks with compile-time and runtime safety

---

## Table of Contents

1. [Overview](#overview)
2. [Core Concepts](#core-concepts)
3. [Type System](#type-system)
4. [Protocol System](#protocol-system)
5. [Capability System](#capability-system)
6. [Composition Engine](#composition-engine)
7. [LLM Integration](#llm-integration)
8. [Examples](#examples)
9. [API Reference](#api-reference)
10. [Best Practices](#best-practices)

---

## Overview

The Ontological Component Composition System provides a **type-safe, protocol-aware, capability-constrained** framework for composing components like LEGO bricks. Components can only be connected if they are **ontologically compatible** at multiple levels:

1. **Type Level**: Semantic types with brand types ensure nominal typing
2. **Protocol Level**: Communication protocols must match
3. **Capability Level**: Required capabilities must be provided

This prevents incorrect compositions at **compile-time** and **runtime**, with full **LLM integration** for semantic understanding.

### Key Features

- ✅ **Compile-Time Safety**: TypeScript types prevent invalid compositions
- ✅ **Runtime Validation**: Additional safety checks at runtime
- ✅ **Protocol Matching**: Automatic protocol adaptation where possible
- ✅ **Capability Checking**: Ensure all requirements are satisfied
- ✅ **LLM-Friendly**: Natural language queries and semantic search
- ✅ **Self-Documenting**: Components describe their own semantics
- ✅ **Composable**: Build complex pipelines from simple components

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Natural Language Interface                │
│              (LLM-powered semantic understanding)            │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   Component Registry Layer                   │
│         (Semantic search, discovery, recommendations)        │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                  Composition Validation Layer                │
│     (Type checking, protocol matching, capability checks)    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     Execution Layer                          │
│          (Component execution with full observability)       │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Concepts

### 1. Components

A **Component** is a composable unit that:
- Has **clear input and output types**
- Implements **specific protocols**
- Provides **capabilities** (what it can do)
- Requires **capabilities** (what it needs)
- Can be **composed** with compatible components

```typescript
interface Component<In, Out> {
  readonly id: string;
  readonly name: string;
  readonly inputType: TypeDescriptor;
  readonly outputType: TypeDescriptor;
  readonly inputProtocol: ProtocolName;
  readonly outputProtocol: ProtocolName;
  readonly capabilities: CapabilitySet;
  readonly requirements: CapabilityRequirements;
  execute(input: In, context: ExecutionContext): Out | Promise<Out>;
}
```

### 2. Ontological Compatibility

Two components are **ontologically compatible** if:

1. **Type Compatibility**: Output type of A matches input type of B
   - Same nominal type (brand)
   - Or structural compatibility

2. **Protocol Compatibility**: Output protocol of A matches input protocol of B
   - Same protocol
   - Or automatically adaptable

3. **Capability Compatibility**: A provides what B requires
   - All required capabilities satisfied
   - Optional capabilities are nice-to-have

### 3. Composition Safety

Composition is safe when:

```typescript
// ✅ Valid composition
const pipeline = compose(
  dataSource,    // Provides: READ capability, Outputs: JSON protocol
  transformer,   // Requires: READ capability, Inputs: JSON protocol
);

// ❌ Invalid composition (caught at compile-time AND runtime)
const invalid = compose(
  numberSource,  // Outputs: number[]
  stringProcessor // Inputs: string[]  ← TYPE MISMATCH
);
```

---

## Type System

### Brand Types (Nominal Typing)

Brand types create **semantic types** that are not structurally compatible:

```typescript
import { Brand, Semantic } from './ontology/core/brand-types.js';

// Define semantic types
type UserId = Brand<string, 'UserId'>;
type ProductId = Brand<string, 'ProductId'>;

// Create values with validation
const userId = Semantic.userId('user-123');
const productId = Semantic.userId('prod-456'); // ✅ Type-safe

// Compile error: Type 'UserId' is not assignable to type 'ProductId'
const invalid: ProductId = userId; // ❌
```

### Built-in Semantic Types

```typescript
// Identity & References
UserId, SessionId, ResourceId, CorrelationId

// Temporal
Timestamp, Duration, Interval

// Measurements
Bytes, Percentage, Temperature

// Network
URL, IPAddress, Port

// Security
SecretToken, PublicKey, PrivateKey, Hash

// Data Structures
JSON, Base64, Hex
```

### Custom Semantic Types

```typescript
import { brandSafe } from './ontology/core/brand-types.js';

type OrderId = Brand<string, 'OrderId'>;

// Create with validation
function createOrderId(value: string): OrderId {
  return brandSafe(
    value,
    'OrderId',
    (v) => /^ORD-\d{6}$/.test(v) // Validator function
  );
}

const orderId = createOrderId('ORD-123456'); // ✅
const invalid = createOrderId('invalid'); // ❌ Throws TypeError
```

---

## Protocol System

### Protocol Definition

Protocols define **how components communicate**:

```typescript
import { Protocols } from './ontology/core/protocols.js';

// Data Protocols
Protocols.JSON        // JSON serialization
Protocols.MSGPACK     // MessagePack binary
Protocols.PROTOBUF    // Protocol Buffers

// Communication Protocols
Protocols.HTTP        // HTTP requests
Protocols.WEBSOCKET   // WebSocket
Protocols.GRPC        // gRPC

// Stream Protocols
Protocols.REACTIVE    // RxJS-style observables
Protocols.ASYNC_ITERABLE // Async iterators

// RPC Protocols
Protocols.NETRON      // Netron RPC
Protocols.JSON_RPC    // JSON-RPC 2.0
```

### Protocol Compatibility

Protocols can be automatically converted:

```typescript
import { isProtocolCompatible } from './ontology/core/protocols.js';

// Check compatibility
isProtocolCompatible(Protocols.REACTIVE, Protocols.ASYNC_ITERABLE); // true
isProtocolCompatible(Protocols.JSON, Protocols.MSGPACK); // false

// Automatic adaptation
const adapted = composer.composeWithAdaptation(
  reactiveSource,      // Outputs: REACTIVE protocol
  asyncIterableConsumer // Inputs: ASYNC_ITERABLE protocol
);
// ✅ Automatically inserts adapter component
```

### Custom Protocols

```typescript
import { Protocol, withProtocol } from './ontology/core/protocols.js';

// Define custom protocol
const MY_PROTOCOL = 'protocol:custom:my-protocol';

interface MyProtocol {
  readonly __protocol: typeof MY_PROTOCOL;
  customMethod(): void;
}

// Create protocol-compliant value
const myValue = withProtocol({ customMethod: () => {} }, MY_PROTOCOL);
```

---

## Capability System

### Capability Definition

Capabilities define **what a component can do**:

```typescript
import { Capabilities, capability } from './ontology/core/capabilities.js';

// Data Capabilities
Capabilities.READ
Capabilities.WRITE
Capabilities.STREAM
Capabilities.TRANSFORM

// Network Capabilities
Capabilities.HTTP_CLIENT
Capabilities.WEBSOCKET_SERVER

// Storage Capabilities
Capabilities.DATABASE
Capabilities.CACHE
Capabilities.FILESYSTEM

// Processing Capabilities
Capabilities.CPU_INTENSIVE
Capabilities.GPU
Capabilities.ASYNC

// Security Capabilities
Capabilities.ENCRYPT
Capabilities.AUTHENTICATE

// Reliability Capabilities
Capabilities.RETRY
Capabilities.CIRCUIT_BREAKER
```

### Capability Requirements

Components declare what they **provide** and **require**:

```typescript
import { capability, requirements } from './ontology/core/capabilities.js';

const myComponent = component()
  // What this component can do
  .addCapability(capability(Capabilities.READ))
  .addCapability(capability(Capabilities.TRANSFORM))

  // What this component needs
  .addRequirement(Capabilities.DATABASE)
  .build();
```

### Advanced Requirements

```typescript
import { requirements } from './ontology/core/capabilities.js';

const advancedRequirements = requirements(
  // Must have these
  ['cap:data:read'],
  {
    // Nice to have
    optional: ['cap:caching'],

    // At least one of these
    anyOf: [
      ['cap:storage:database'],
      ['cap:storage:filesystem']
    ],

    // All of these together
    allOf: [
      ['cap:security:encrypt', 'cap:security:decrypt']
    ]
  }
);
```

---

## Composition Engine

### Basic Composition

```typescript
import { component, composer } from './ontology/core/composition.js';

// Define components
const source = component<void, Data>()
  .setId('source')
  .setName('Data Source')
  // ... configure ...
  .build();

const transform = component<Data, ProcessedData>()
  .setId('transform')
  .setName('Transformer')
  // ... configure ...
  .build();

// Compose safely
const pipeline = composer.compose(source, transform);

// Execute
const result = await pipeline.execute(undefined, context);
```

### Pipeline Composition

```typescript
// Compose multiple components
const fullPipeline = composer.composePipeline(
  dataSource,
  validator,
  transformer,
  enricher,
  dataSink
);

console.log(fullPipeline.visualize());
// Output: "Data Source → Validator → Transformer → Enricher → Data Sink"
```

### Automatic Adaptation

```typescript
// Try to compose with automatic protocol/type adaptation
const adapted = composer.composeWithAdaptation(
  componentA, // Outputs: JSON protocol
  componentB  // Inputs: MSGPACK protocol
);

if (adapted) {
  // ✅ Adapter inserted automatically
  console.log('Composed with adaptation');
} else {
  // ❌ No adapter available
  console.log('Cannot adapt');
}
```

### Error Handling

```typescript
import { CompositionError } from './ontology/core/composition.js';

try {
  const invalid = composer.compose(incompatibleA, incompatibleB);
} catch (error) {
  if (error instanceof CompositionError) {
    console.error('Composition failed:', error.message);
    console.error('Reason:', error.reason.type);
    console.error('Details:', error.reason.details);
    console.error('Suggestion:', error.reason.suggestion);
  }
}
```

---

## LLM Integration

### Semantic Search

```typescript
import { SemanticComponentRegistry } from './ontology/llm/semantic-understanding.js';

const registry = new SemanticComponentRegistry(llmProvider);

// Register components
await registry.register(myComponent);

// Natural language search
const results = await registry.search('find a component that processes user data');

for (const result of results) {
  console.log(`${result.component.name} (score: ${result.score})`);
}
```

### Natural Language Queries

```typescript
import { OntologyQueryLanguage } from './ontology/llm/semantic-understanding.js';

const query = new OntologyQueryLanguage(registry);

// Natural language query
const result = await query.query('find components that can transform JSON to MessagePack');

console.log('Results:', result.results?.map(c => c.name));
```

### Semantic Explanation

```typescript
import { ComponentSemanticAnalyzer } from './ontology/llm/semantic-understanding.js';

const analyzer = new ComponentSemanticAnalyzer(llmProvider);

// Generate human-readable description
const description = await analyzer.describe(myComponent);
console.log(description);

// Explain composition compatibility
const explanation = await analyzer.explainComposition(
  componentA,
  componentB,
  canComposeFlag
);
console.log(explanation);

// Suggest bridging components
const suggestions = await analyzer.suggestBridge(incompatibleA, incompatibleB);
for (const suggestion of suggestions) {
  console.log(`${suggestion.name}: ${suggestion.purpose}`);
}
```

---

## Examples

### Example 1: Data Processing Pipeline

```typescript
// Source → Transform → Sink
const pipeline = composer.composePipeline(
  userDataSource,      // Reads from database
  userDataTransformer, // Processes data
  userDataSink         // Writes to database
);

await pipeline.execute(undefined, executionContext);
```

See: [`examples/basic-composition.ts`](./examples/basic-composition.ts)

### Example 2: Infrastructure as Code

```typescript
// Build → Configure → Deploy
const k8sPipeline = composer.composePipeline(
  applicationBuilder,     // Builds Docker image
  containerConfigurator,  // Configures container
  k8sManifestGenerator,   // Generates K8s manifest
  k8sDeployer            // Deploys to cluster
);

const deployment = await k8sPipeline.execute(undefined, context);
console.log('Deployed to:', deployment.endpoint);
```

See: [`examples/infrastructure-composition.ts`](./examples/infrastructure-composition.ts)

### Example 3: Service Communication

```typescript
// Request → RPC → Response
const serviceCall = composer.compose(
  requestBuilder,  // Builds RPC request
  rpcClient       // Makes RPC call
);

const response = await serviceCall.execute(params, context);
```

---

## API Reference

### Core Types

```typescript
// Brand Types
Brand<T, B extends string>
Unbrand<T>
GetBrand<T>
brandSafe<T, B>(value: T, brand: B, validator?: (value: T) => boolean): Brand<T, B>

// Protocols
Protocol<T, P extends string>
GetProtocol<T>
ProtocolCompatible<A, B>
isProtocolCompatible(from: ProtocolName, to: ProtocolName): boolean

// Capabilities
Capability
CapabilitySet
CapabilityRequirements
capability(name: string, parameters?: Record<string, any>): Capability
capabilitySet(capabilities: Capability[]): CapabilitySet
requirements(required: string[], options?: {...}): CapabilityRequirements

// Components
Component<In, Out>
ComponentBuilder<In, Out>
ComposedComponent<In, Out>
component<In, Out>(): ComponentBuilder<In, Out>

// Composition
ComponentComposer
composer.compose<A, B, C>(from: Component<A, B>, to: Component<B, C>): ComposedComponent<A, C>
composer.composeWithAdaptation<A, B, C>(...): ComposedComponent<A, C> | null
composer.composePipeline(...components: Component[]): ComposedComponent

// LLM Integration
SemanticComponentRegistry
ComponentSemanticAnalyzer
OntologyQueryLanguage
```

### Component Builder API

```typescript
component<In, Out>()
  .setId(id: string)
  .setName(name: string)
  .setVersion(version: string)
  .setInputType(type: TypeDescriptor)
  .setOutputType(type: TypeDescriptor)
  .setInputProtocol(protocol: ProtocolName)
  .setOutputProtocol(protocol: ProtocolName)
  .addCapability(capability: Capability)
  .addRequirement(requirement: string)
  .setExecute(fn: (input: In, context: ExecutionContext) => Out | Promise<Out>)
  .setMetadata(metadata: ComponentMetadata)
  .build()
```

---

## Best Practices

### 1. Use Semantic Types

```typescript
// ❌ Avoid primitive obsession
function processUser(id: string) { ... }

// ✅ Use semantic types
function processUser(id: UserId) { ... }
```

### 2. Declare Capabilities Accurately

```typescript
// ❌ Don't over-promise
.addCapability(capability(Capabilities.GPU)) // But doesn't use GPU

// ✅ Declare only what you actually provide
.addCapability(capability(Capabilities.CPU_INTENSIVE))
.addCapability(capability(Capabilities.ASYNC))
```

### 3. Use Protocol Compatibility

```typescript
// ❌ Don't force protocol mismatches
const invalid = composer.compose(jsonSource, msgpackSink);

// ✅ Use adaptation or matching protocols
const adapted = composer.composeWithAdaptation(jsonSource, msgpackSink);
```

### 4. Provide Rich Metadata

```typescript
// ✅ Good metadata helps LLM understanding
.setMetadata({
  description: 'Transforms user data by enriching with profile information',
  tags: ['user', 'transform', 'enrichment'],
  author: 'Data Team',
  documentation: 'https://docs.example.com/components/user-transformer',
  examples: [{ input: {...}, output: {...} }]
})
```

### 5. Design for Composability

```typescript
// ❌ Monolithic component
const processEverything = component()
  .setExecute(async (data) => {
    const validated = validate(data);
    const transformed = transform(validated);
    const enriched = enrich(transformed);
    return enriched;
  })
  .build();

// ✅ Composable components
const validator = component().setExecute(validate).build();
const transformer = component().setExecute(transform).build();
const enricher = component().setExecute(enrich).build();

const pipeline = composer.composePipeline(validator, transformer, enricher);
```

### 6. Use Execution Context

```typescript
.setExecute(async (input, context) => {
  // ✅ Use logger
  context.logger?.info('Processing input', { size: input.length });

  // ✅ Record metrics
  context.metrics?.counter('items_processed', input.length);

  // ✅ Use correlation ID
  const result = await process(input, context.correlationId);

  return result;
})
```

---

## Advanced Topics

### Custom Type Validators

```typescript
const emailType: TypeDescriptor = {
  name: 'Email',
  brand: 'Email',
  validate: (value: unknown): value is string => {
    return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
};
```

### Protocol Adapters

```typescript
import { ProtocolAdapter } from './ontology/core/protocols.js';

const myAdapter: ProtocolAdapter<'protocol:from', 'protocol:to'> = {
  from: 'protocol:from',
  to: 'protocol:to',
  adapt: (value) => {
    // Transform value from one protocol to another
    return transformedValue;
  }
};

protocolTransformer.register(myAdapter);
```

### Capability Inference

```typescript
import { CapabilityInferrer } from './ontology/core/capabilities.js';

const inferrer = new CapabilityInferrer();

// Automatically infer capabilities from function
const inferred = inferrer.inferFromFunction(myFunction);
```

---

## FAQ

**Q: Why use brand types instead of structural typing?**
A: Brand types provide **semantic safety**. A `UserId` and `ProductId` are both strings structurally, but they represent different concepts. Brand types prevent accidental misuse.

**Q: Can I compose components with different protocols?**
A: Yes! The system will automatically insert protocol adapters if the protocols are compatible. Use `composeWithAdaptation()` for automatic adaptation.

**Q: How does LLM integration work?**
A: Components are embedded into vector space based on their semantics. Natural language queries are also embedded, and cosine similarity is used to find matching components.

**Q: What happens if I try to compose incompatible components?**
A: A `CompositionError` is thrown with:
- The reason for incompatibility (type/protocol/capability)
- Detailed explanation
- Suggestions for fixing

**Q: Can I use this in production?**
A: Yes! The system provides both compile-time and runtime safety. Start with simple compositions and gradually build more complex pipelines.

---

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](../../LICENSE) for details.

---

**Built with ❤️ for the Omnitron ecosystem**
