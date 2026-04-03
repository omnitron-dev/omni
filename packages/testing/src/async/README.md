# Async Testing Utilities

Comprehensive utilities for testing asynchronous code in JavaScript/TypeScript.

## Installation

```bash
pnpm add -D @omnitron-dev/testing
```

## Usage

Import from the main package or the async submodule:

```typescript
// Import from main package
import { defer, waitFor, retry } from '@omnitron-dev/testing';

// Or import from async submodule
import { defer, waitFor, retry } from '@omnitron-dev/testing/async';
```

## API Reference

### Deferred Promises

#### `DeferredPromise<T>`
Class for creating a promise with external control over resolution/rejection.

```typescript
const deferred = new DeferredPromise<string>();
setTimeout(() => deferred.resolve('done'), 1000);
await deferred.promise; // 'done'
console.log(deferred.isSettled); // true
```

#### `createDeferred<T>()`
Factory function for creating deferred promises.

```typescript
const deferred = createDeferred<number>();
deferred.resolve(42);
```

#### `defer<T>()`
Lightweight deferred promise (backward compatible).

```typescript
const deferred = defer<string>();
deferred.resolve('success');
await deferred.promise;
```

### Retry and Timeout

#### `retry<T>(fn, options?)`
Retry an async operation with exponential backoff.

```typescript
const result = await retry(
  async () => fetchData(),
  {
    retries: 5,
    delay: 100,
    backoff: 2,
    onRetry: (error, attempt) => console.log(`Retry ${attempt}`)
  }
);
```

**Options:**
- `retries`: Maximum retry attempts (default: 3)
- `delay`: Initial delay in ms (default: 100)
- `backoff`: Backoff multiplier (default: 2)
- `onRetry`: Callback on each retry

#### `withTimeout<T>(promise, timeout?, errorMessage?)`
Race a promise against a timeout.

```typescript
const result = await withTimeout(
  fetchData(),
  5000,
  'Data fetch timed out'
);
```

### Wait Utilities

#### `waitFor(condition, options?)`
Wait for a condition to become true.

```typescript
await waitFor(
  () => element.isVisible(),
  { timeout: 3000, interval: 100, message: 'Element not visible' }
);
```

#### `waitForCondition(condition, timeout?, interval?)`
Alternative API for waiting on conditions.

```typescript
await waitForCondition(
  () => counter > 10,
  5000,
  100
);
```

#### `delay(ms)`
Simple async sleep utility.

```typescript
await delay(1000); // Wait 1 second
```

#### `nextTick()`
Wait for the next event loop tick.

```typescript
emitter.emit('event');
await nextTick();
// Event handlers have now executed
```

#### `flushPromises()`
Flush all pending promises in the event loop.

```typescript
Promise.resolve().then(() => { executed = true });
await flushPromises();
expect(executed).toBe(true);
```

### Event Utilities

#### `EventListenerTracker`
Track event listeners for automatic cleanup.

```typescript
const tracker = new EventListenerTracker();
tracker.on(emitter, 'data', handler);
tracker.once(emitter, 'error', errorHandler);

// In cleanup
tracker.cleanup(); // Removes all tracked listeners
```

#### `EventCollector<T>`
Collect events for inspection and assertions.

```typescript
const collector = new EventCollector(emitter);
collector.collect('data');

// Trigger events...

const events = collector.getEvents('data');
expect(events).toHaveLength(3);

collector.assertEmitted('data', 3);
collector.clear();
collector.stop();
```

#### `waitForEvents(target, events, timeout?)`
Wait for multiple events to be emitted.

```typescript
const [userData, profileData] = await waitForEvents(
  emitter,
  ['user', 'profile'],
  3000
);
```

#### `collectEvents<T>(target, event, condition, timeout?)`
Collect events until a condition is met.

```typescript
const events = await collectEvents(
  emitter,
  'data',
  (events) => events.length >= 5,
  3000
);
```

#### `createEventSpy(target, event)`
Create a spy to record events.

```typescript
const spy = createEventSpy(emitter, 'data');
// Trigger events...
expect(spy.events).toHaveLength(3);
spy.clear();
```

### Mock Timers

#### `MockTimerController`
Manual control over timers for deterministic testing.

```typescript
const timer = new MockTimerController();
timer.install();

let executed = false;
setTimeout(() => { executed = true }, 1000);

timer.tick(500);  // executed is still false
timer.tick(500);  // executed is now true

timer.restore();
```

**Methods:**
- `install()`: Replace native timers
- `restore()`: Restore native timers
- `tick(ms)`: Advance time by ms
- `getCurrentTime()`: Get current mock time
- `getPendingCount()`: Get number of pending timers
- `clearAll()`: Clear all pending timers
- `reset()`: Reset to initial state

#### `createMockTimer()`
Factory function for creating mock timers.

```typescript
const timer = createMockTimer();
timer.install();
// ... test code ...
timer.restore();
```

## Error Handling

All async utilities use typed errors from `@omnitron-dev/testing/errors`:

- `TimeoutError`: Thrown when operations timeout
- `TestingError`: Base class for testing errors

```typescript
import { TimeoutError } from '@omnitron-dev/testing';

try {
  await waitFor(() => false, { timeout: 100 });
} catch (error) {
  if (error instanceof TimeoutError) {
    console.log('Operation timed out');
  }
}
```

## Examples

### Testing Event Sequences

```typescript
import { EventCollector, delay } from '@omnitron-dev/testing/async';

test('event sequence', async () => {
  const emitter = new EventEmitter();
  const collector = new EventCollector(emitter);
  
  collector.collect('start');
  collector.collect('data');
  collector.collect('end');
  
  // Trigger events
  await processData(emitter);
  
  collector.assertEmitted('start', 1);
  collector.assertEmitted('data', 5);
  collector.assertEmitted('end', 1);
  
  collector.stop();
});
```

### Retrying Flaky Operations

```typescript
import { retry } from '@omnitron-dev/testing/async';

test('retry flaky operation', async () => {
  const result = await retry(
    async () => {
      const response = await fetch('/api/data');
      if (!response.ok) throw new Error('Failed');
      return response.json();
    },
    {
      retries: 3,
      delay: 100,
      backoff: 2,
      onRetry: (error, attempt) => {
        console.log(`Retry ${attempt}: ${error.message}`);
      }
    }
  );
  
  expect(result).toBeDefined();
});
```

### Testing Time-Dependent Code

```typescript
import { MockTimerController } from '@omnitron-dev/testing/async';

test('debounce function', () => {
  const timer = new MockTimerController();
  timer.install();
  
  let count = 0;
  const debounced = debounce(() => { count++; }, 100);
  
  debounced();
  debounced();
  debounced();
  
  timer.tick(50);
  expect(count).toBe(0);
  
  timer.tick(50);
  expect(count).toBe(1);
  
  timer.restore();
});
```

## License

MIT
