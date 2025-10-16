# @holon/flow

**Universal Flow abstraction for composable, type-safe computation pipelines.**

A Flow is a single, minimal abstraction representing any computation. Everything is a Flow: a function, a service, a system. Flows compose through `pipe()` to build complex architectures from simple building blocks.

[![npm version](https://badge.fury.io/js/@holon%2Fflow.svg)](https://www.npmjs.com/package/@holon/flow)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Key Features

- **Single Abstraction**: `Flow<In, Out>` interface for all computations
- **Immutable Context**: Built-in context management with structural sharing
- **Type-Safe Composition**: Full TypeScript inference through `.pipe()` chains
- **Async Native**: Seamless handling of sync and async operations
- **Zero Dependencies**: Minimal footprint, maximum portability
- **Rich Utilities**: 25+ composition operators for common patterns
- **Metadata System**: Attach performance hints, types, descriptions to Flows
- **Module System**: Extensible architecture with dependency management and lifecycle hooks

## Installation

```bash
npm install @holon/flow
```

## Package Structure

`@holon/flow` is organized as a modular package with separate entry points for optimal tree-shaking and minimal bundle size.

### Main Export (Minimal Core)

The default import provides only the essential Flow functions:

```typescript
import { flow, compose, map, filter, retry, /* ... */ } from '@holon/flow';
```

**Includes**: All Flow utilities for composition, transformation, error handling, performance optimization, and control flow.

**Bundle size**: ~4KB gzipped (minimal core only)

### Context System

Import the immutable Context system separately:

```typescript
import { context, withContext, contextual, ContextKeys } from '@holon/flow/context';
import type { Context } from '@holon/flow/context';
```

**Includes**: Context creation, operations, scoped execution, and context-aware Flows.

### Module System

Import the extensible module system separately:

```typescript
import { createModule, withModules, contextModule } from '@holon/flow/module';
import type { ModuleDefinition, ModularContext } from '@holon/flow/module';
```

**Includes**: Module definition, lifecycle hooks, dependency management, and modular contexts.

### Core Module Definition

Import the core module definition for module-based usage:

```typescript
import { coreModule, createFlowModule } from '@holon/flow/core';
import type { CoreModule } from '@holon/flow/core';
```

**Includes**: Core module with all Flow utilities and helper for creating Flow modules.

### Benefits of Modular Structure

- **Minimal Bundle**: Only import what you need
- **Tree-Shaking**: Unused code is automatically removed
- **Clear Separation**: Each concern has its own import path
- **Progressive Enhancement**: Start minimal, add features as needed

## Core Concepts

### Flow Interface

```typescript
interface Flow<In, Out> {
  // Execute: call as a function
  (input: In): Out | Promise<Out>;

  // Compose: chain with .pipe()
  pipe<Next>(next: Flow<Out, Next>): Flow<In, Next>;

  // Metadata: optional annotations
  readonly meta?: FlowMeta;
}
```

### Creating Flows

```typescript
import { flow } from '@holon/flow';

// Simple Flow
const double = flow((x: number) => x * 2);
console.log(double(5)); // 10

// Async Flow
const fetchUser = flow(async (id: number) => {
  const response = await fetch(`/users/${id}`);
  return response.json();
});

// Flow with metadata
const pureDouble = flow(
  (x: number) => x * 2,
  {
    name: 'double',
    description: 'Multiplies input by 2',
    performance: { pure: true, memoizable: true }
  }
);

// Flow with error handling
const safeDivide = flow({
  fn: ([a, b]: [number, number]) => {
    if (b === 0) throw new Error('Division by zero');
    return a / b;
  },
  onError: () => Infinity
});
```

### Composition

```typescript
// Method chaining with .pipe()
const pipeline = double
  .pipe(flow(x => x + 1))
  .pipe(flow(x => x.toString()));

console.log(pipeline(5)); // "11"

// Or use compose() function
import { compose } from '@holon/flow';

const pipeline2 = compose(
  double,
  flow(x => x + 1),
  flow(x => x.toString())
);
```

## API Reference

### Core Functions

#### `flow(fn, meta?)`

Creates a Flow from a function.

```typescript
const addOne = flow((x: number) => x + 1);
const result = addOne(5); // 6
```

#### `identity()`

Returns input unchanged.

```typescript
const id = identity<number>();
console.log(id(42)); // 42
```

#### `constant(value)`

Always returns the same value, ignoring input.

```typescript
const always42 = constant(42);
console.log(always42('anything')); // 42
```

### Composition

#### `compose(...flows)`

Composes multiple Flows into a pipeline (left-to-right).

```typescript
const pipeline = compose(
  flow((x: number) => x + 1),  // First
  flow((x: number) => x * 2),  // Then
  flow((x: number) => String(x)) // Finally
);
console.log(pipeline(5)); // "12"
```

#### `parallel(flows)`

Executes Flows concurrently, returns all results.

```typescript
const fetchAll = parallel([
  fetchUser,
  fetchPosts,
  fetchComments
]);
const [user, posts, comments] = await fetchAll(userId);
```

#### `race(flows)`

Returns the first Flow to complete.

```typescript
const fastest = race([
  primaryServer,
  backupServer,
  cacheServer
]);
const result = await fastest(request); // First to respond wins
```

### Collection Operations

#### `map(mapper)`

Applies a Flow to each array element.

```typescript
const doubleAll = map(flow((x: number) => x * 2));
console.log(await doubleAll([1, 2, 3])); // [2, 4, 6]
```

#### `filter(predicate)`

Filters array elements matching a predicate Flow.

```typescript
const onlyEven = filter(flow((x: number) => x % 2 === 0));
console.log(await onlyEven([1, 2, 3, 4])); // [2, 4]
```

#### `reduce(reducer, initial)`

Reduces array to single value.

```typescript
const sum = reduce(
  flow(([acc, x]: [number, number]) => acc + x),
  0
);
console.log(await sum([1, 2, 3, 4])); // 10
```

### Error Handling

#### `retry(flow, maxRetries, delay)`

Retries a Flow on failure.

```typescript
const reliableAPI = retry(fetchFromAPI, 3, 1000);
// Retries up to 3 times with 1 second delay
```

#### `fallback(primary, fallback)`

Uses fallback Flow if primary fails.

```typescript
const safeAPI = fallback(
  fetchFromAPI,
  fetchFromCache
);
// Tries API first, falls back to cache on error
```

#### `result(flow)`

Transforms a Flow to use Result type instead of exceptions.

```typescript
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

const safeFlow = result(riskyOperation);
const outcome = await safeFlow(input);
if (outcome.ok) {
  console.log(outcome.value);
} else {
  console.error(outcome.error);
}
```

#### `maybe(flow)`

Handles nullable values, passes through null/undefined.

```typescript
const safeParse = maybe(parseJSON);
console.log(await safeParse(null)); // null
console.log(await safeParse('{"x":1}')); // { x: 1 }
```

### Performance

#### `memoize(flow, keyFn?)`

Caches Flow results.

```typescript
const cachedExpensive = memoize(expensiveCalculation);
// First call computes, subsequent calls with same input return cached result
```

#### `debounce(flow, ms)`

Debounces Flow execution.

```typescript
const debouncedSearch = debounce(searchAPI, 300);
// Only executes after 300ms of no new calls
```

#### `throttle(flow, ms)`

Throttles Flow execution rate.

```typescript
const throttledUpdate = throttle(updateUI, 16); // Max 60fps
```

#### `batch(flow, options)`

Batches multiple inputs together.

```typescript
const batchedSave = batch(
  saveToDatabase,
  { size: 100, delay: 1000 }
);
// Collects up to 100 items or waits 1s before executing
```

#### `timeout(flow, ms)`

Adds timeout to Flow execution.

```typescript
const quickAPI = timeout(fetchFromAPI, 5000);
// Throws error if takes longer than 5 seconds
```

### Control Flow

#### `when(predicate, ifTrue, ifFalse)`

Conditional Flow execution.

```typescript
const processUser = when(
  flow((user: User) => user.isAdmin),
  adminFlow,
  userFlow
);
```

#### `repeat(flow, times)`

Repeats a Flow n times, piping output back as input.

```typescript
const repeatThrice = repeat(
  flow((x: number) => x + 1),
  3
);
console.log(await repeatThrice(0)); // 3
```

#### `validate(predicate, errorMessage)`

Validates input with predicate, throws on failure.

```typescript
const validatePositive = validate(
  (x: number) => x > 0,
  'Must be positive'
);
validatePositive.pipe(expensiveOperation); // Only runs if valid
```

### Data Transformation

#### `split(splitter, flows)`

Splits input and processes parts separately.

```typescript
const splitProcess = split(
  flow((data: string) => data.split(',')),
  [processHeader, processBody, processFooter]
);
```

#### `merge(merger)`

Merges multiple inputs into one.

```typescript
const combineResults = merge(
  flow(([a, b, c]) => ({ a, b, c }))
);
```

#### `tap(sideEffect)`

Performs side effect without modifying value (pass-through).

```typescript
const withLogging = flow((x: number) => x * 2)
  .pipe(tap(x => console.log('Result:', x)))
  .pipe(flow(x => x + 1));
```

## Type System

### Flow Type Utilities

```typescript
import type {
  FlowInput,
  FlowOutput,
  FlowChain
} from '@holon/flow';

// Extract input type
type In = FlowInput<typeof myFlow>; // number

// Extract output type
type Out = FlowOutput<typeof myFlow>; // string

// Infer chain result type
type ChainResult = FlowChain<[
  Flow<number, string>,
  Flow<string, boolean>,
  Flow<boolean, number>
]>; // Flow<number, number>
```

### Result Type

```typescript
import type { Result } from '@holon/flow';

type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

// Usage
const outcome: Result<User, ValidationError> = await validateUser(data);
```

### Maybe Type

```typescript
import type { Maybe } from '@holon/flow';

type Maybe<T> = T | null | undefined;

// Usage
const user: Maybe<User> = await findUser(id);
```

### FlowMeta Interface

```typescript
interface FlowMeta {
  name?: string;
  description?: string;
  performance?: {
    pure?: boolean;           // No side effects
    memoizable?: boolean;     // Results can be cached
    expectedDuration?: number; // Estimated execution time (ms)
  };
  types?: {
    input?: TypeValidator<any>;
    output?: TypeValidator<any>;
  };
  tags?: string[];
  version?: string;
  [key: string]: any; // Custom metadata
}
```

## Context System

Immutable, composable context for managing state and dependencies across Flow execution chains.

### Creating Contexts

```typescript
import { context } from '@holon/flow/context';

// Empty context
const ctx = context();

// With initial values
const ctx = context({
  userId: '123',
  locale: 'en-US',
  requestId: generateId()
});

// With symbols (type-safe keys)
import { ContextKeys } from '@holon/flow/context';

const ctx = context({
  [ContextKeys.USER_ID]: '123',
  [ContextKeys.LOCALE]: 'en-US'
});
```

### Context Operations

#### `get(key)` - Retrieve values

```typescript
const userId = ctx.get<string>('userId');
const locale = ctx.get<string>(ContextKeys.LOCALE);
```

#### `with(values)` - Extend context (immutable)

```typescript
const ctx1 = context({ a: 1 });
const ctx2 = ctx1.with({ b: 2 }); // New context

console.log(ctx1.get('b')); // undefined
console.log(ctx2.get('b')); // 2
```

#### `fork()` - Create child context

```typescript
const parent = context({ shared: 'value' });
const child = parent.fork();

// Child can access parent values
console.log(child.get('shared')); // 'value'

// Child modifications don't affect parent
const modified = child.with({ own: 'data' });
console.log(parent.get('own')); // undefined
```

#### `merge(...contexts)` - Combine contexts

```typescript
const ctx1 = context({ a: 1, b: 2 });
const ctx2 = context({ b: 3, c: 4 });

const merged = ctx1.merge(ctx2);
// Later contexts override earlier ones
console.log(merged.get('b')); // 3
```

#### `clone()` - Copy without parent relationship

```typescript
const original = context({ data: 'value' }).fork();
const clone = original.clone(); // Breaks parent chain
```

#### Other Operations

```typescript
ctx.has('key'); // Check existence
ctx.keys(); // Get all keys
ctx.entries(); // Get [key, value] pairs
ctx.values(); // Get all values
ctx.delete('key'); // Remove key (returns new context)
ctx.clear(); // Empty context
ctx.toObject(); // Convert to plain object
ctx.freeze(); // Prevent modifications
```

### Running Flows with Context

```typescript
const fetchUser = flow(async (id: string) => {
  const response = await fetch(`/users/${id}`);
  return response.json();
});

const ctx = context({ apiKey: 'secret' });
const user = await ctx.run(fetchUser, '123');
```

### Context-Aware Flows

Create Flows that automatically receive current context:

```typescript
import { contextual, getCurrentContext } from '@holon/flow/context';

const authFlow = contextual((userId: string, ctx) => {
  const apiKey = ctx.get<string>('apiKey');
  return fetch(`/auth/${userId}`, {
    headers: { 'X-API-Key': apiKey }
  });
});

// Context is injected automatically
const ctx = context({ apiKey: 'secret' });
await ctx.run(authFlow, 'user123');
```

### Scoped Execution

Run code within a specific context (uses AsyncLocalStorage):

```typescript
import { withContext } from '@holon/flow/context';

const ctx = context({ requestId: '123' });

await withContext(ctx, async () => {
  // All code here can access the context
  const current = await getCurrentContext();
  console.log(current?.get('requestId')); // '123'

  await someAsyncOperation();
  // Context propagates through async calls
});
```

### Built-in Context Keys

```typescript
import { ContextKeys } from '@holon/flow/context';

const ctx = context({
  [ContextKeys.REQUEST_ID]: generateId(),
  [ContextKeys.USER_ID]: session.userId,
  [ContextKeys.TRACE_ID]: trace.id,
  [ContextKeys.SPAN_ID]: span.id,
  [ContextKeys.LOCALE]: 'en-US',
  [ContextKeys.TIMEZONE]: 'UTC',
  [ContextKeys.ABORT_SIGNAL]: abortController.signal,
  [ContextKeys.LOGGER]: logger,
  [ContextKeys.METRICS]: metrics,
  [ContextKeys.CONFIG]: config
});
```

### Custom Context Keys

```typescript
import { createContextKey } from '@holon/flow/context';

// Type-safe custom keys
const SESSION_KEY = createContextKey('session');
const DB_KEY = createContextKey('database');

const ctx = context({
  [SESSION_KEY]: sessionData,
  [DB_KEY]: dbConnection
});
```

### Context with Modules

Combine Context with the module system:

```typescript
import { context } from '@holon/flow/context';
import { withModules, contextModule } from '@holon/flow/module';

const ctx = withModules(context({ base: 'value' }))
  .use(contextModule);

await new Promise(resolve => setTimeout(resolve, 10));

const mod = ctx.getModule(Symbol.for('holon:context'));

// Scoped contexts
const scoped = mod.context.scope('request', {
  id: '123',
  timestamp: Date.now()
});

// Fork
const forked = mod.context.fork();

// Merge
const merged = mod.context.merge(ctx1, ctx2);

// Isolate specific keys
const isolated = await mod.context.isolate(['userId', 'requestId']);
```

## Advanced Patterns

### HTTP API Pipeline

```typescript
import { compose, retry, timeout, validate } from '@holon/flow';

const apiPipeline = compose(
  validate((req) => req.url !== '', 'URL required'),
  timeout(
    retry(
      flow(async (req) => {
        const response = await fetch(req.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      }),
      3,
      1000
    ),
    5000
  ),
  flow((data) => transformResponse(data))
);
```

### Recursive Tree Traversal

```typescript
interface TreeNode {
  value: number;
  children?: TreeNode[];
}

const sumTree: Flow<TreeNode, number> = flow(async (node) => {
  if (!node.children?.length) return node.value;

  const sums = await Promise.all(
    node.children.map(child => sumTree(child))
  );
  return sums.reduce((acc, sum) => acc + sum, node.value);
});
```

### State Machine

```typescript
type State = 'idle' | 'loading' | 'success' | 'error';
type Event = { type: 'FETCH' } | { type: 'SUCCESS', data: any } | { type: 'ERROR', error: Error };

const stateMachine = flow((state: State, event: Event): State => {
  switch (state) {
    case 'idle':
      return event.type === 'FETCH' ? 'loading' : state;
    case 'loading':
      return event.type === 'SUCCESS' ? 'success' :
             event.type === 'ERROR' ? 'error' : state;
    default:
      return state;
  }
});
```

### Caching Strategy

```typescript
const cachedFetch = compose(
  // Try cache first
  fallback(
    flow(async (url: string) => {
      const cached = await cache.get(url);
      if (!cached) throw new Error('Cache miss');
      return cached;
    }),
    // Fallback to network
    compose(
      timeout(
        flow(async (url: string) => {
          const response = await fetch(url);
          return response.json();
        }),
        5000
      ),
      // Cache the result
      tap(async (data) => await cache.set(url, data))
    )
  )
);
```

### Parallel Data Processing

```typescript
const processDataset = compose(
  // Split into batches
  flow((data: Item[]) => {
    const batches: Item[][] = [];
    for (let i = 0; i < data.length; i += 100) {
      batches.push(data.slice(i, i + 100));
    }
    return batches;
  }),

  // Process batches in parallel
  map(
    compose(
      // Transform each batch
      map(transformItem),
      // Validate results
      filter(validateItem)
    )
  ),

  // Flatten results
  flow((batches: Item[][]) => batches.flat())
);
```

## Module System

The module system allows organizing and composing Flow utilities.

### Core Module

```typescript
import { coreModule } from '@holon/flow/core';

// Core module provides all Flow utilities
const instance = coreModule.factory(context);
const { flow, compose, map, filter } = instance.core;
```

### Creating Custom Modules

```typescript
import { createFlowModule } from '@holon/flow/core';

const httpModule = createFlowModule(
  'http',
  (ctx, core) => ({
    http: {
      get: core.flow(async (url: string) => {
        const response = await fetch(url);
        return response.json();
      }),
      post: core.flow(async ([url, body]: [string, any]) => {
        const response = await fetch(url, {
          method: 'POST',
          body: JSON.stringify(body)
        });
        return response.json();
      })
    }
  }),
  { version: '1.0.0', description: 'HTTP utilities' }
);
```

## Performance

### Zero-Cost Abstractions

Flow composition is optimized at runtime. Metadata hints enable:

- **Pure functions**: Automatic memoization eligibility
- **Parallelization**: Independent operations execute concurrently
- **Lazy evaluation**: Deferred computation when possible

### Metadata-Driven Optimization

```typescript
const optimizableFlow = flow(
  (x: number) => x * 2,
  {
    performance: {
      pure: true,        // No side effects
      memoizable: true,  // Cache results
      expectedDuration: 5 // 5ms expected
    }
  }
);

// Runtime can use metadata for optimization decisions
```

## TypeScript Support

Full type inference across composition chains:

```typescript
const pipeline = flow((x: number) => x * 2)
  .pipe(flow(x => x.toString()))
  .pipe(flow(x => x.length));

// Fully inferred: Flow<number, number>
const result: number = pipeline(42); // ✓ Type-safe
```

Type-safe branching:

```typescript
const conditional = when(
  flow((x: number) => x > 0),
  flow((x: number) => x * 2),    // Both branches must return
  flow((x: number) => x * -1)    // the same type
);
```

## Philosophy

**Adaptive Complexity**: Start with minimal API, grow as needed. Flow doesn't dictate architecture—it adapts.

**Holonic Principle**: Every Flow is simultaneously a complete system and a part of a larger system. Composition is uniform across all abstraction levels.

**Simplicity at Core**: One interface (`Flow`), one composition operator (`.pipe()`), infinite possibilities.

## License

MIT © Holon Framework

---

**Documentation Status**: This README describes the implemented functionality in `@holon/flow` v0.2.1. The [full specification](./specs/01-holon-flow.md) contains the complete vision including advanced features planned for future releases (Context, Effects, Objectives, Semantics, Bounded Contexts).
