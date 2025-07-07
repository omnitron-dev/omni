# @devgrid/common

A comprehensive utility library providing essential JavaScript/TypeScript functions for everyday development tasks. This package contains type-safe implementations of common utilities with zero external dependencies.

## Installation

```bash
npm install @devgrid/common
# or
yarn add @devgrid/common
# or
pnpm add @devgrid/common
```

## Features

- 🎯 Type-safe implementations with full TypeScript support
- 📦 Zero external dependencies
- 🌳 Tree-shakeable exports
- ✅ Comprehensive test coverage
- 🚀 Optimized for performance

## API Reference

### 🔧 Primitives

Basic utility functions for common operations.

```typescript
import { noop, identity, truly, falsely, arrify } from '@devgrid/common';

// noop - A function that does nothing (useful for default callbacks)
button.onClick = noop; // No operation

// identity - Returns the input value unchanged
identity(5); // => 5
identity({ foo: 'bar' }); // => { foo: 'bar' }

// truly - Always returns true (useful for filters)
[1, 2, 3].filter(truly); // => [1, 2, 3]

// falsely - Always returns false
if (falsely()) { /* never executes */ }

// arrify - Converts any value to an array
arrify(null); // => []
arrify(undefined); // => []
arrify(1); // => [1]
arrify([1, 2, 3]); // => [1, 2, 3] (returns same array)
```

### 🔍 Type Predicates

Comprehensive type checking and validation functions.

```typescript
import { 
  isString, isNumber, isBoolean, isSymbol, isBigInt,
  isArray, isObject, isFunction, isPromise,
  isNull, isUndefined, isNullish,
  isDate, isRegExp, isError,
  isEmpty, isPlainObject, isPrimitive,
  isSubstring, isPrefix, isSuffix
} from '@devgrid/common';

// Basic type checks
isString('hello'); // => true
isNumber(123); // => true
isArray([1, 2, 3]); // => true
isObject({}); // => true
isFunction(() => {}); // => true

// Null/undefined checks
isNull(null); // => true
isUndefined(undefined); // => true
isNullish(null || undefined); // => true

// Advanced checks
isPromise(Promise.resolve()); // => true
isPlainObject({ a: 1 }); // => true (not a class instance)
isPrimitive(42); // => true
isEmpty([]); // => true
isEmpty(''); // => true
isEmpty({}); // => true

// String utilities
isSubstring('world', 'hello world'); // => true
isPrefix('hello', 'hello world'); // => true
isSuffix('world', 'hello world'); // => true
```

### ⏱️ Promise Utilities

Advanced promise handling and control flow utilities.

```typescript
import { 
  defer, delay, timeout, retry, props,
  promisify, callbackify, nodeify
} from '@devgrid/common';

// defer - Create a deferred promise
const deferred = defer<string>();
deferred.promise.then(value => console.log(value));
deferred.resolve('Success!');

// delay - Promise-based setTimeout
await delay(1000); // Wait 1 second
const result = await delay(1000, 'done'); // Wait and return value

// timeout - Add timeout to any promise
try {
  const data = await timeout(
    fetch('https://api.example.com/data'),
    5000 // 5 second timeout
  );
} catch (error) {
  console.log('Request timed out');
}

// retry - Retry failed operations with exponential backoff
const data = await retry(
  async ({ current }) => {
    console.log(`Attempt ${current}`);
    return await fetch('/api/data');
  },
  {
    max: 3, // Maximum 3 attempts
    backoffBase: 1000, // Start with 1s delay
    backoffExponent: 2, // Double delay each time
    match: [NetworkError], // Only retry on specific errors
  }
);

// props - Resolve an object of promises
const results = await props({
  users: fetchUsers(),
  posts: fetchPosts(),
  comments: fetchComments()
});
// results = { users: [...], posts: [...], comments: [...] }

// promisify - Convert callback-based functions to promises
const readFile = promisify(fs.readFile);
const content = await readFile('file.txt', 'utf8');

// callbackify - Convert promise-based functions to callbacks
const fetchCallback = callbackify(fetch);
fetchCallback('url', (err, result) => {
  if (err) console.error(err);
  else console.log(result);
});
```

### 🗂️ Object Utilities

Functions for working with objects and their properties.

```typescript
import { omit, entries, keys, values } from '@devgrid/common';

// omit - Create object copy without specified keys
const user = { id: 1, name: 'John', password: 'secret' };
const publicUser = omit(user, 'password'); 
// => { id: 1, name: 'John' }

// Deep omit
const nested = { a: { b: { c: 1, d: 2 }, e: 3 }, f: 4 };
const result = omit(nested, ['c', 'f'], { deep: true });
// => { a: { b: { d: 2 }, e: 3 } }

// entries/keys/values with advanced options
const obj = { a: 1, b: 2 };
Object.defineProperty(obj, 'hidden', { 
  value: 3, 
  enumerable: false 
});

entries(obj); // => [['a', 1], ['b', 2]]
entries(obj, { enumOnly: false }); // => [['a', 1], ['b', 2], ['hidden', 3]]

// Work with prototype chain
class Parent {
  inherited = 'parent';
}
class Child extends Parent {
  own = 'child';
}
const instance = new Child();

keys(instance); // => ['own', 'inherited']
keys(instance, { followProto: false }); // => ['own']
```

### 📊 Data Structures

Specialized data structures for common use cases.

```typescript
import { ListBuffer, TimedMap } from '@devgrid/common';

// ListBuffer - Efficient list operations
const buffer = new ListBuffer<number>();
buffer.push(1, 2, 3);
buffer.unshift(0);
buffer.toArray(); // => [0, 1, 2, 3]

// TimedMap - Map with automatic expiration
const cache = new TimedMap<string, any>(60000); // 60 second TTL
cache.set('key', 'value');
cache.get('key'); // => 'value'
// After 60 seconds:
cache.get('key'); // => undefined
```

### 🔐 Cryptography Utilities

```typescript
import { cuid } from '@devgrid/common';

// Generate collision-resistant unique identifiers
const id = cuid(); // => "ck2qzqgwf0000a65z5rvfbhx5"
```

## Advanced Examples

### Building a Retry System

```typescript
import { retry, delay, isError } from '@devgrid/common';

async function resilientFetch(url: string) {
  return retry(
    async ({ current, total }) => {
      console.log(`Attempt ${current}/${total}`);
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return response.json();
    },
    {
      max: 5,
      backoffBase: 1000,
      backoffExponent: 2,
      match: [Error],
      report: (message, { current }, error) => {
        console.warn(`Retry ${current}: ${error?.message}`);
      }
    }
  );
}
```

### Type-Safe Object Filtering

```typescript
import { omit, isString, entries } from '@devgrid/common';

function sanitizeUserInput<T extends object>(input: T): Partial<T> {
  // Remove all non-string values
  const stringEntries = entries(input)
    .filter(([_, value]) => isString(value));
  
  // Reconstruct object with only string values
  return Object.fromEntries(stringEntries);
}

// Remove sensitive fields
function sanitizeUser(user: User) {
  return omit(user, ['password', 'ssn', 'creditCard']);
}
```

### Promise Timeout with Cleanup

```typescript
import { timeout, defer } from '@devgrid/common';

async function fetchWithTimeout(url: string, ms: number) {
  const controller = new AbortController();
  
  try {
    const response = await timeout(
      fetch(url, { signal: controller.signal }),
      ms,
      { 
        message: `Request timeout after ${ms}ms`,
        unref: true 
      }
    );
    return response;
  } catch (error) {
    controller.abort();
    throw error;
  }
}
```

## TypeScript Support

This library is written in TypeScript and provides comprehensive type definitions. All functions are fully typed with generics where appropriate.

```typescript
// Type inference works automatically
const numbers = arrify(42); // number[]
const mixed = arrify<string | number>('hello'); // (string | number)[]

// Type predicates provide type narrowing
const value: unknown = 'hello';
if (isString(value)) {
  // TypeScript knows value is string here
  console.log(value.toUpperCase());
}

// Generics preserve types
const obj = { a: 1, b: 'two', c: true };
const filtered = omit(obj, ['c']); // { a: number, b: string }
```

## Performance Considerations

- All predicates are optimized for performance with early returns
- Object utilities use efficient algorithms for deep operations
- Promise utilities properly handle cleanup and cancellation
- Data structures are designed for specific use cases with optimal performance

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## License

MIT © DevGrid