# @devgrid/async-emitter

A powerful asynchronous event emitter built on top of [eventemitter3](https://github.com/primus/eventemitter3), providing parallel, serial, and reduce event emission patterns with concurrency control.

## Features

- 🚀 Built on fast and lightweight eventemitter3
- 🌐 Works in both Node.js and browsers
- ⚡ Support for parallel and serial event emission
- 🔄 Reduce pattern for event processing
- 🎯 Concurrency control
- 💪 TypeScript support
- 🔍 Memory leak prevention with WeakMap
- 🎈 Lightweight with minimal dependencies

## Installation

```bash
npm install @devgrid/async-emitter
# or
yarn add @devgrid/async-emitter
```

## Basic Usage

```typescript
import { AsyncEventEmitter } from '@devgrid/async-emitter';

const emitter = new AsyncEventEmitter();

// Add async listener
emitter.on('event', async (data) => {
  await someAsyncOperation(data);
});

// Emit event and wait for all listeners
await emitter.emitParallel('event', 'some data');
```

## Emission Patterns

### Parallel Emission

Execute all listeners concurrently:

```typescript
const emitter = new AsyncEventEmitter();

emitter.on('parallel', async () => {
  await delay(100);
  console.log('First listener');
});

emitter.on('parallel', async () => {
  await delay(50);
  console.log('Second listener');
});

// Both listeners execute simultaneously
await emitter.emitParallel('parallel');
```

### Serial Emission

Execute listeners one after another:

```typescript
const emitter = new AsyncEventEmitter();

emitter.on('serial', async (value) => {
  await delay(100);
  return value + 1;
});

emitter.on('serial', async (value) => {
  await delay(50);
  return value * 2;
});

// Listeners execute sequentially
const results = await emitter.emitSerial('serial', 1);
console.log(results); // [2, 2]
```

### Reduce Pattern

Process events with accumulated results:

```typescript
const emitter = new AsyncEventEmitter();

// Left to right reduction
emitter.on('reduce', async (value) => value + 1);
emitter.on('reduce', async (value) => value * 2);

const result = await emitter.emitReduce('reduce', 1);
console.log(result); // 4 ((1 + 1) * 2)

// Right to left reduction
const rightResult = await emitter.emitReduceRight('reduce', 1);
console.log(rightResult); // 3 (1 * 2 + 1)
```

## Concurrency Control

Limit the number of concurrent listener executions:

```typescript
const emitter = new AsyncEventEmitter(2); // Max 2 concurrent executions

// Or set concurrency later
emitter.setConcurrency(3);

emitter.on('concurrent', async () => {
  await heavyOperation();
});

// Only 2/3 listeners will execute simultaneously
await emitter.emitParallel('concurrent');
```

## Subscription Management

### One-time Listeners

```typescript
const emitter = new AsyncEventEmitter();

// Using once
emitter.once('single', async () => {
  console.log('Called only once');
});

// Using subscribe with once option
const unsubscribe = emitter.subscribe('single', async () => {
  console.log('Also called only once');
}, true);

// Manual unsubscribe if needed
unsubscribe();
```

### Subscription Cleanup

```typescript
const emitter = new AsyncEventEmitter();

const cleanup = emitter.subscribe('event', async () => {
  console.log('Event handled');
});

// Later, when you need to remove the listener
cleanup();
```

## Browser Support

Thanks to eventemitter3, this library works seamlessly in browsers:

```html
<!-- Using via CDN -->
<script src="https://unpkg.com/eventemitter3/umd/eventemitter3.min.js"></script>
<script src="path/to/async-emitter.js"></script>

<script>
  const emitter = new AsyncEventEmitter();
  
  emitter.on('click', async () => {
    await fetch('/api/endpoint');
  });

  document.getElementById('button').addEventListener('click', () => {
    emitter.emitParallel('click');
  });
</script>
```

Using with bundlers:

```typescript
// webpack/rollup/esbuild will handle it automatically
import { AsyncEventEmitter } from '@devgrid/async-emitter';
```

## API Reference

### Constructor

```typescript
new AsyncEventEmitter(concurrency?: number)
```

### Methods

```typescript
class AsyncEventEmitter {
  // Emission patterns
  emitParallel(event: string, ...args: any[]): Promise<any[]>
  emitSerial(event: string, ...args: any[]): Promise<any[]>
  emitReduce(event: string, ...args: any[]): Promise<any>
  emitReduceRight(event: string, ...args: any[]): Promise<any>

  // Listener management
  on(event: string, listener: Function): this
  once(event: string, listener: Function): this
  removeListener(event: string, listener: Function): this
  subscribe(event: string, listener: Function, once?: boolean): () => void

  // Configuration
  setConcurrency(concurrency: number): this
}
```

### Type Checking

```typescript
import { isAsyncEventEmitter } from '@devgrid/async-emitter';

if (isAsyncEventEmitter(obj)) {
  // obj is an AsyncEventEmitter instance
}
```

## Performance Considerations

- Uses WeakMap for memory-efficient once listener tracking
- Built on eventemitter3 for optimal performance
- Minimal overhead for async operations
- Efficient concurrency control with p-limit

## License

MIT

## Credits

Built with [eventemitter3](https://github.com/primus/eventemitter3) for cross-platform event emission.
