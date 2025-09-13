# @devgrid/async-emitter

[![npm version](https://img.shields.io/npm/v/@devgrid/async-emitter.svg)](https://www.npmjs.com/package/@devgrid/async-emitter)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

A powerful asynchronous event emitter built on top of [eventemitter3](https://github.com/primus/eventemitter3), providing parallel, serial, and reduce event emission patterns with concurrency control.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Usage](#core-usage)
  - [Emission Patterns](#emission-patterns)
  - [Concurrency Control](#concurrency-control)
  - [Subscription Management](#subscription-management)
- [API Reference](#api-reference)
- [Advanced Features](#advanced-features)
- [TypeScript Support](#typescript-support)
- [Performance](#performance)
- [Browser Support](#browser-support)
- [Contributing](#contributing)
- [License](#license)

## Features

- 🚀 **High Performance** - Built on the fast and lightweight eventemitter3
- 🔄 **Multiple Emission Patterns** - Parallel, serial, reduce, and reduceRight patterns
- ⚡ **Concurrency Control** - Limit concurrent listener executions with built-in optimized limiter
- 🎯 **Type Safety** - Full TypeScript support with proper type inference
- 🌐 **Cross-Platform** - Works in both Node.js and browsers
- 💪 **Promise-Based** - Async/await friendly API
- 🎈 **Lightweight** - Minimal dependencies
- 🔍 **Memory Efficient** - WeakMap-based cleanup for once listeners

## Installation

```bash
npm install @devgrid/async-emitter
# or
yarn add @devgrid/async-emitter
# or
pnpm add @devgrid/async-emitter
```

## Quick Start

```typescript
import { EventEmitter } from '@devgrid/async-emitter';

const emitter = new EventEmitter();

// Add async listener
emitter.on('event', async (data) => {
  await someAsyncOperation(data);
  console.log('Event processed:', data);
});

// Emit event and wait for all listeners
await emitter.emitParallel('event', { message: 'Hello World' });
```

## Core Usage

### Emission Patterns

#### Parallel Emission

Execute all listeners concurrently. Best for independent operations.

```typescript
const emitter = new EventEmitter();

emitter.on('user:login', async (user) => {
  await analytics.track('login', user);
});

emitter.on('user:login', async (user) => {
  await notifications.send('welcome', user);
});

emitter.on('user:login', async (user) => {
  await cache.store(user);
});

// All three operations run simultaneously
await emitter.emitParallel('user:login', { id: 123, name: 'John' });
```

#### Serial Emission

Execute listeners one after another. Useful when order matters.

```typescript
const emitter = new EventEmitter();

emitter.on('pipeline', async (data) => {
  console.log('Step 1: Validate');
  data.validated = true;
  return data;
});

emitter.on('pipeline', async (data) => {
  console.log('Step 2: Transform');
  data.transformed = true;
  return data;
});

emitter.on('pipeline', async (data) => {
  console.log('Step 3: Save');
  data.saved = true;
  return data;
});

// Executes in order, each receiving the previous result
const results = await emitter.emitSerial('pipeline', { value: 'test' });
// results = [
//   { value: 'test', validated: true },
//   { value: 'test', validated: true, transformed: true },
//   { value: 'test', validated: true, transformed: true, saved: true }
// ]
```

#### Reduce Pattern

Process events with accumulated results, left to right.

```typescript
const emitter = new EventEmitter();

emitter.on('calculate', async (accumulator, value) => {
  return accumulator + value;
});

emitter.on('calculate', async (accumulator, value) => {
  return accumulator * 2;
});

const result = await emitter.emitReduce('calculate', 5, 10);
// First listener: 5 + 10 = 15
// Second listener: 15 * 2 = 30
console.log(result); // 30
```

#### ReduceRight Pattern

Process events with accumulated results, right to left.

```typescript
const emitter = new EventEmitter();

emitter.on('compose', async (fn) => (x) => fn(x) + 1);
emitter.on('compose', async (fn) => (x) => fn(x) * 2);

const composedFn = await emitter.emitReduceRight('compose', (x) => x);
console.log(composedFn(5)); // ((5) * 2) + 1 = 11
```

### Concurrency Control

Limit the number of concurrent listener executions to prevent resource exhaustion.

```typescript
// Limit to 2 concurrent executions
const emitter = new EventEmitter(2);

// Add 10 listeners
for (let i = 0; i < 10; i++) {
  emitter.on('heavy-task', async () => {
    console.log(`Task ${i} started`);
    await heavyOperation();
    console.log(`Task ${i} completed`);
  });
}

// Only 2 will run at a time
await emitter.emitParallel('heavy-task');

// Change concurrency at runtime
emitter.setConcurrency(5);
```

### Subscription Management

#### One-time Listeners

```typescript
const emitter = new EventEmitter();

// Method 1: Using once
emitter.once('startup', async () => {
  console.log('Application started');
  await initializeApp();
});

// Method 2: Using subscribe with once option
const unsubscribe = emitter.subscribe('startup', async () => {
  console.log('Another startup handler');
}, true);

await emitter.emitParallel('startup');
// Both handlers execute only once
```

#### Dynamic Subscription

```typescript
const emitter = new EventEmitter();

// Subscribe and get unsubscribe function
const unsubscribe = emitter.subscribe('data', async (data) => {
  console.log('Received:', data);
  
  if (data.stop) {
    unsubscribe(); // Unsubscribe from within handler
  }
});

await emitter.emitParallel('data', { value: 1 });
await emitter.emitParallel('data', { value: 2, stop: true });
await emitter.emitParallel('data', { value: 3 }); // This won't be logged
```

## API Reference

### Constructor

```typescript
new EventEmitter(concurrency?: number)
```

- `concurrency` - Maximum number of concurrent listener executions (default: Infinity)

### Methods

#### Event Emission

| Method | Description | Returns |
|--------|-------------|---------|
| `emitParallel(event, ...args)` | Execute all listeners concurrently | `Promise<any[]>` |
| `emitSerial(event, ...args)` | Execute listeners sequentially | `Promise<any[]>` |
| `emitReduce(event, ...args)` | Reduce left-to-right with accumulator | `Promise<any>` |
| `emitReduceRight(event, ...args)` | Reduce right-to-left with accumulator | `Promise<any>` |

#### Listener Management

| Method | Description | Returns |
|--------|-------------|---------|
| `on(event, listener)` | Add a listener | `this` |
| `once(event, listener)` | Add a one-time listener | `this` |
| `removeListener(event, listener)` | Remove a specific listener | `this` |
| `removeAllListeners(event?)` | Remove all listeners | `this` |
| `subscribe(event, listener, once?)` | Subscribe with unsubscribe function | `() => void` |

#### Configuration

| Method | Description | Returns |
|--------|-------------|---------|
| `setConcurrency(limit)` | Set concurrency limit | `this` |

#### Utilities

| Method | Description | Returns |
|--------|-------------|---------|
| `listenerCount(event)` | Get listener count for event | `number` |
| `listeners(event)` | Get array of listeners | `Function[]` |
| `eventNames()` | Get array of event names | `Array<string\|symbol>` |

### Type Guards

```typescript
import { isEventEmitter } from '@devgrid/eventemitter';

if (isEventEmitter(obj)) {
  // obj is EventEmitter instance
  await obj.emitParallel('event');
}
```

## Advanced Features

### Error Handling

```typescript
const emitter = new EventEmitter();

emitter.on('task', async () => {
  throw new Error('Task failed');
});

emitter.on('task', async () => {
  return 'Success';
});

try {
  // In parallel mode, all listeners run regardless of errors
  const results = await emitter.emitParallel('task');
  // results = [Error, 'Success']
} catch (error) {
  // emitParallel doesn't throw, errors are in results
}

try {
  // In serial mode, execution stops on first error
  const results = await emitter.emitSerial('task');
} catch (error) {
  console.error('Serial execution failed:', error);
}
```

### Listener Context

```typescript
const emitter = new EventEmitter();

class Service {
  name = 'MyService';

  async handleEvent(data: any) {
    console.log(`${this.name} handling:`, data);
  }
}

const service = new Service();

// Bind context
emitter.on('event', service.handleEvent.bind(service));

// Or use arrow function
emitter.on('event', async (data) => service.handleEvent(data));
```

### Event Namespacing

```typescript
const emitter = new EventEmitter();

// Use namespaced events
emitter.on('user:created', async (user) => { /* ... */ });
emitter.on('user:updated', async (user) => { /* ... */ });
emitter.on('user:deleted', async (user) => { /* ... */ });

// Emit specific events
await emitter.emitParallel('user:created', newUser);
```

## TypeScript Support

Full TypeScript support with proper type inference:

```typescript
interface Events {
  'user:login': (user: { id: number; name: string }) => Promise<void>;
  'data:process': (data: Buffer) => Promise<Buffer>;
  'calculate': (a: number, b: number) => Promise<number>;
}

class TypedEmitter extends EventEmitter {
  on<K extends keyof Events>(event: K, listener: Events[K]): this {
    return super.on(event, listener);
  }

  async emitParallel<K extends keyof Events>(
    event: K,
    ...args: Parameters<Events[K]>
  ): Promise<Array<ReturnType<Events[K]>>> {
    return super.emitParallel(event, ...args);
  }
}

const emitter = new TypedEmitter();

// Type-safe event handling
emitter.on('user:login', async (user) => {
  // user is typed as { id: number; name: string }
  console.log(user.name);
});
```

## Performance

### Optimization Tips

1. **Use appropriate emission pattern**
   - Parallel for independent operations
   - Serial for dependent operations
   - Reduce for accumulation

2. **Set concurrency limits**
   - Prevent resource exhaustion
   - Balance between parallelism and resource usage

3. **Clean up listeners**
   - Remove unused listeners
   - Use `once` for one-time events

### Benchmarks

EventEmitter adds minimal overhead to eventemitter3:

- Event emission: ~5% overhead for async handling
- Memory usage: Minimal (WeakMap for once listeners)
- Concurrency control: ~10% overhead when limited

## Browser Support

Works in all modern browsers with ES2015+ support:

```html
<!-- Using a bundler (recommended) -->
<script src="dist/bundle.js"></script>

<!-- Using directly -->
<script src="https://unpkg.com/eventemitter3/umd/eventemitter3.min.js"></script>
<script src="path/to/async-emitter.js"></script>

<script>
  const emitter = new EventEmitter();
  
  emitter.on('click', async (event) => {
    const response = await fetch('/api/click');
    console.log('Click tracked');
  });

  document.getElementById('button').addEventListener('click', (e) => {
    emitter.emitParallel('click', e);
  });
</script>
```

### Bundler Configuration

With webpack/rollup/vite, no special configuration needed:

```javascript
import { EventEmitter } from '@devgrid/async-emitter';
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT © DevGrid

## Links

- [GitHub Repository](https://github.com/d-e-v-grid/devgrid/tree/main/packages/async-emitter)
- [npm Package](https://www.npmjs.com/package/@devgrid/async-emitter)
- [Issue Tracker](https://github.com/d-e-v-grid/devgrid/issues)