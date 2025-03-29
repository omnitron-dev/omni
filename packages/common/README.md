# @devgrid/common

A comprehensive utility library providing a collection of commonly used JavaScript/TypeScript functions for everyday development tasks.

## Installation

```bash
npm install @devgrid/common
# or
yarn add @devgrid/common
```

## Features

- Type-safe implementations
- Zero dependencies
- Comprehensive test coverage
- Tree-shakeable exports

## API Documentation

### Primitives

Basic utility functions for common operations.

```typescript
import { noop, identity, truly, falsely, arrify } from '@devgrid/common';

// noop - Does nothing
noop(); // => undefined

// identity - Returns the input value
identity(5); // => 5
identity({ foo: 'bar' }); // => { foo: 'bar' }

// truly - Always returns true
truly(); // => true

// falsely - Always returns false
falsely(); // => false

// arrify - Converts value to array
arrify(null); // => []
arrify(undefined); // => []
arrify(1); // => [1]
arrify([1, 2, 3]); // => [1, 2, 3]
```

### Type Predicates

Functions for type checking and validation.

```typescript
import { 
  isString, 
  isNumber, 
  isArray, 
  isObject,
  isPromise,
  // ... and many more
} from '@devgrid/common';

// Basic type checks
isString('hello'); // => true
isNumber(123); // => true
isArray([1, 2, 3]); // => true
isObject({}); // => true

// Advanced checks
isPromise(Promise.resolve()); // => true
isSubstring('hello', 'hello world'); // => true
isPrefix('hello', 'hello world'); // => true
```

### Promise Utilities

Advanced promise handling utilities.

```typescript
import { 
  timeout, 
  retry, 
  delay, 
  props 
} from '@devgrid/common';

// Add timeout to promises
await timeout(fetch('api.example.com'), 5000);

// Retry failed operations
await retry(async () => {
  // Your async operation here
}, {
  max: 3,
  backoffBase: 1000
});

// Delay execution
await delay(1000); // waits for 1 second

// Handle object of promises
await props({
  users: fetchUsers(),
  posts: fetchPosts()
});
```

### Object Utilities

Functions for handling objects and their properties.

```typescript
import { omit, entries } from '@devgrid/common';

// Omit properties from objects
const user = { name: 'John', age: 30, password: '123' };
omit(user, ['password']); // => { name: 'John', age: 30 }

// Get object entries with advanced options
entries(obj, { 
  enumOnly: true, 
  followProto: false 
});
```

## Advanced Usage

### Timeout with AbortController

```typescript
const controller = new AbortController();

timeout(longOperation(), 5000, { 
  signal: controller.signal,
  unref: true 
});

// Later, if needed:
controller.abort();
```

### Retry with Custom Configuration

```typescript
await retry(async ({ current }) => {
  console.log(`Attempt ${current}`);
  // Your operation here
}, {
  max: 5,
  backoffBase: 1000,
  backoffExponent: 2,
  match: [NetworkError, TimeoutError],
  report: (message, options, error) => {
    console.log(`${message}: ${error?.message}`);
  }
});
```

## TypeScript Support

This library is written in TypeScript and includes type definitions. All functions are fully typed and provide excellent IDE support.

```typescript
// Example of TypeScript inference
const result = identity<number>(5); // result is typed as number
const arr = arrify<string>('hello'); // arr is typed as string[]
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License