# @devgrid/common

[![npm version](https://img.shields.io/npm/v/@devgrid/common.svg)](https://www.npmjs.com/package/@devgrid/common)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9.2-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![Bun](https://img.shields.io/badge/bun-compatible-f472b6)](https://bun.sh)

A comprehensive utility library providing essential JavaScript/TypeScript functions for everyday development tasks. This package contains type-safe implementations of common utilities with minimal external dependencies.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Runtime Compatibility](#runtime-compatibility)
- [Quick Start](#quick-start)
- [Core Usage](#core-usage)
  - [Primitives](#primitives)
  - [Type Predicates](#type-predicates)
  - [Promise Utilities](#promise-utilities)
  - [Object Utilities](#object-utilities)
  - [Data Structures](#data-structures)
- [API Reference](#api-reference)
- [Advanced Features](#advanced-features)
- [TypeScript Support](#typescript-support)
- [Performance](#performance)
- [Best Practices](#best-practices)
- [Contributing](#contributing)
- [License](#license)

## Features

- 🎯 **Type-Safe** - Full TypeScript support with proper type inference
- 📦 **Minimal Dependencies** - Only `@noble/hashes` for cryptographic operations
- 🌳 **Tree-Shakeable** - Import only what you need
- ✅ **Comprehensive** - Wide range of utility functions
- 🚀 **Optimized** - Performance-focused implementations
- 🌐 **Cross-Runtime** - Works in Node.js and Bun
- 🔍 **Well-Tested** - Extensive test coverage
- 📚 **Well-Documented** - Clear examples and API documentation

## Installation

```bash
npm install @devgrid/common
# or
yarn add @devgrid/common
# or
pnpm add @devgrid/common
# or (for Bun)
bun add @devgrid/common
```

## Runtime Compatibility

This package is fully compatible with both **Node.js** and **Bun** runtimes.

### Running Tests

```bash
# Node.js
yarn test:node

# Bun
yarn test:bun

# Both runtimes
yarn test:all
```

### Compatibility Notes

- **Timer-based functionality**: Bun doesn't support Jest's fake timers. For timer-dependent features like `TimedMap`, we provide separate test suites for each runtime.
- **Promise tests**: Bun handles promise rejections slightly differently than Jest, but all functionality works identically.
- **No runtime-specific APIs**: The package doesn't use any Node.js or Bun-specific APIs, ensuring complete compatibility.

### Build Output

The package provides both CommonJS and ESM builds:
- CommonJS: `dist/index.js`
- ESM: `dist/esm/index.js`
- TypeScript definitions included

## Quick Start

```typescript
import { delay, isString, omit, retry } from '@devgrid/common';

// Use type predicates
if (isString(value)) {
  console.log(value.toUpperCase());
}

// Use promise utilities
await delay(1000); // Wait 1 second

// Use object utilities
const user = { id: 1, name: 'John', password: 'secret' };
const publicUser = omit(user, 'password'); // { id: 1, name: 'John' }

// Retry failed operations
const data = await retry(
  async () => fetch('/api/data'),
  { max: 3, backoffBase: 1000 }
);
```

## Core Usage

### Primitives

Basic utility functions for common operations.

```typescript
import { noop, identity, truly, falsely, arrify } from '@devgrid/common';

// noop - A function that does nothing (useful for default callbacks)
button.onClick = noop;
setInterval(noop, 1000); // Placeholder timer

// identity - Returns the input value unchanged
const result = [1, null, 2, undefined, 3].map(identity).filter(Boolean);
// [1, 2, 3]

// truly - Always returns true (useful for filters and tests)
const activeItems = items.filter(process.env.SKIP_FILTER ? truly : isActive);

// falsely - Always returns false
const disabled = permissions.checkAccess || falsely;

// arrify - Converts any value to an array
arrify(null);        // => []
arrify(undefined);   // => []
arrify(1);           // => [1]
arrify([1, 2, 3]);   // => [1, 2, 3] (returns same array)
arrify('hello');     // => ['hello']
```

### Type Predicates

Comprehensive type checking and validation functions.

```typescript
import { 
  isString, isNumber, isBoolean, isSymbol, isBigInt,
  isArray, isObject, isFunction, isPromise, isAsyncFunction,
  isNull, isUndefined, isNil, isExist,
  isDate, isRegexp, isError, isMap, isSet,
  isPlainObject, isPrimitive, isBuffer,
  isEmptyString, isEmptyObject,
  isNumeral, isNumeralInteger, isNumeralBigInt,
  isFinite, isInfinite, isInteger, isSafeInteger,
  isFloat, isOdd, isEven, isNegativeZero,
  isSubstring, isPrefix, isSuffix,
  isAsyncGenerator, isClass, isNan,
  isPropertyOwned, isPropertyDefined,
  getTag, getTagSimple
} from '@devgrid/common';

// Basic type checks with type narrowing
function processValue(value: unknown) {
  if (isString(value)) {
    // TypeScript knows value is string here
    return value.toLowerCase();
  }
  
  if (isNumber(value)) {
    // TypeScript knows value is number here
    return value.toFixed(2);
  }
  
  if (isArray(value)) {
    // TypeScript knows value is array here
    return value.length;
  }
}

// Advanced type checks
const data = { name: 'John', age: 30 };
isPlainObject(data);     // true (plain object)
isPlainObject(new Date()); // false (class instance)

isPrimitive(42);         // true
isPrimitive('hello');    // true
isPrimitive({});         // false

// Nil checks
isNil(null);             // true
isNil(undefined);        // true
isNil('');               // false
isExist('');             // true (not null/undefined)

// Empty checks
isEmptyString('   ');    // true (whitespace only)
isEmptyObject({});       // true
isEmptyObject({ a: 1 }); // false

// Numeric checks
isNumeral('42');         // true
isNumeral('42.5');       // true
isNumeral('abc');        // false
isNumeralInteger('42');  // true
isNumeralInteger('42.5'); // false
isNumeralBigInt('123n'); // true

// Number properties
isOdd(3);                // true
isEven(4);               // true
isFloat(3.14);           // true
isNegativeZero(-0);      // true

// String utilities
isSubstring('world', 'hello world');  // true
isPrefix('hello', 'hello world');     // true
isSuffix('world', 'hello world');     // true
isSubstring('foo', 'hello world');    // false

// Advanced checks
isAsyncFunction(async () => {});      // true
isAsyncGenerator(async function* () {}()); // true
isClass(class MyClass {});            // true

// Property checks
const obj = { a: 1 };
isPropertyOwned(obj, 'a');            // true
isPropertyOwned(obj, 'toString');     // false (inherited)
isPropertyDefined(obj, 'a');          // true
isPropertyDefined(obj, 'toString');   // true (includes inherited)

// Platform checks
import { isWindows, linux, darwin, freebsd, openbsd, sunos, aix, isNodejs } from '@devgrid/common';

if (isWindows) {
  // Windows-specific code
}
if (darwin) {
  // macOS-specific code
}
```

### Promise Utilities

Advanced promise handling and control flow utilities.

```typescript
import { 
  defer, delay, timeout, retry, props,
  promisify, promisifyAll, callbackify, nodeify,
  universalify, universalifyFromPromise,
  finally as finallyUtil, try as tryUtil
} from '@devgrid/common';

// defer - Create a deferred promise
const deferred = defer<string>();

// Some async operation
setTimeout(() => {
  deferred.resolve('Success!');
}, 1000);

const result = await deferred.promise; // 'Success!'

// delay - Promise-based setTimeout
console.log('Starting...');
await delay(2000);
console.log('2 seconds later');

// With value and unref option
const delayedValue = await delay(1000, 'Hello', { unref: true });
console.log(delayedValue); // 'Hello' (after 1 second)

// timeout - Add timeout to any promise
try {
  const response = await timeout(
    fetch('https://slow-api.example.com/data'),
    5000, // 5 second timeout
    { 
      unref: true,  // Allow process to exit
      signal: abortController.signal  // AbortSignal support
    }
  );
} catch (error) {
  if (error.message.includes('exceeded')) {
    console.log('Request was too slow');
  }
}

// retry - Retry failed operations with exponential backoff
const fetchWithRetry = await retry(
  async ({ current }) => {
    console.log(`Attempt ${current}`);
    
    const response = await fetch('/api/data');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return response.json();
  },
  {
    max: 3,                    // Maximum 3 attempts
    timeout: 5000,             // Timeout per attempt
    backoffBase: 1000,         // Start with 1s delay
    backoffExponent: 1.1,      // Multiply delay by 1.1 each time
    match: [/HTTP 5\d\d/],     // Only retry on 5xx errors
    report: (message, options, error) => {
      console.log(`${message}: ${error?.message}`);
    },
    name: 'fetchData'          // Name for logging
  }
);

// props - Resolve an object of promises
const userData = await props({
  profile: fetchUserProfile(),
  posts: fetchUserPosts(),
  followers: fetchFollowers(),
  settings: fetchUserSettings()
});
// userData = {
//   profile: {...},
//   posts: [...],
//   followers: [...],
//   settings: {...}
// }

// promisify - Convert callback-based functions
import { readFile } from 'fs';

const readFileAsync = promisify(readFile);
const content = await readFileAsync('config.json', 'utf8');

// With context
const boundPromisify = promisify(obj.method, { context: obj });

// promisifyAll - Promisify entire object
const fs = require('fs');
const fsAsync = promisifyAll(fs, { 
  suffix: 'Async',
  filter: (key) => !key.startsWith('_')
});
await fsAsync.readFileAsync('file.txt', 'utf8');

// callbackify - Convert promise-based to callback-based
const fetchCallback = callbackify(fetch);

fetchCallback('https://api.example.com', (err, response) => {
  if (err) {
    console.error('Request failed:', err);
  } else {
    console.log('Response:', response);
  }
});

// nodeify - Add callback support to promise
const promise = fetch('/api/data');
nodeify(promise, (err, result) => {
  if (err) console.error(err);
  else console.log(result);
});

// universalify - Support both callback and promise styles
const readFileUniversal = universalify(readFile);

// Use as promise
const data = await readFileUniversal('file.txt');

// Use with callback
readFileUniversal('file.txt', (err, data) => {
  // ...
});

// finally - Execute cleanup regardless of outcome
const connection = await openConnection();
await finallyUtil(
  performOperation(connection),
  () => connection.close()
);

// try - Wrap sync function in promise
const result = await tryUtil(() => JSON.parse(jsonString));
```

### Object Utilities

Functions for working with objects and their properties.

```typescript
import { omit, entries, keys, values } from '@devgrid/common';

// omit - Create object copy without specified keys
const user = {
  id: 1,
  name: 'John Doe',
  email: 'john@example.com',
  password: 'secret123',
  ssn: '123-45-6789'
};

// Single key
const publicUser = omit(user, 'password');
// { id: 1, name: 'John Doe', email: 'john@example.com', ssn: '123-45-6789' }

// Multiple keys
const safeUser = omit(user, ['password', 'ssn']);
// { id: 1, name: 'John Doe', email: 'john@example.com' }

// Using predicate function
const filtered = omit(user, (key, value) => {
  return key.startsWith('_') || value === null;
});

// Using regex pattern
const withoutPrivate = omit(user, /^_/);

// Deep omit
const nested = {
  user: {
    id: 1,
    profile: {
      name: 'John',
      password: 'secret',
      settings: {
        theme: 'dark',
        apiKey: 'xyz123'
      }
    }
  }
};

const cleaned = omit(nested, ['password', 'apiKey'], { deep: true });
// Removes password and apiKey at any depth

// Path-based omit
const config = {
  app: {
    name: 'MyApp',
    secret: {
      key: 'secret123',
      token: 'abc'
    }
  }
};

const publicConfig = omit(config, 'app.secret.key', { path: true });
// Removes only the specific nested key

// entries/keys/values with advanced options
const obj = { a: 1, b: 2 };
Object.defineProperty(obj, 'hidden', { 
  value: 3, 
  enumerable: false 
});

entries(obj);                           // [['a', 1], ['b', 2]]
entries(obj, { enumOnly: false });      // [['a', 1], ['b', 2], ['hidden', 3]]

// Work with prototype chain
class Parent {
  inherited = 'from parent';
}

class Child extends Parent {
  own = 'child property';
}

const instance = new Child();

keys(instance);                         // ['own', 'inherited']
keys(instance, { followProto: false }); // ['own', 'inherited']
keys(instance, { followProto: true });  // Includes prototype chain
keys(instance, { all: true });          // All properties including non-enumerable

values(instance);                       // ['child property', 'from parent']
values(instance, { enumOnly: false });  // Includes non-enumerable values
```

### Data Structures

Specialized data structures for common use cases.

```typescript
import { ListBuffer, TimedMap } from '@devgrid/common';

// ListBuffer - Efficient linked list implementation
const buffer = new ListBuffer<string>();

// Add items to the end
buffer.push('first');
buffer.push('second');
buffer.push('third');

// Remove items from the beginning
const first = buffer.shift();  // 'first'
const second = buffer.shift(); // 'second'

// Check size
console.log(buffer.length);    // 1

// Clear all items
buffer.clear();
console.log(buffer.length);    // 0

// Use for queue-like operations
class MessageQueue {
  private queue = new ListBuffer<Message>();
  
  enqueue(message: Message) {
    this.queue.push(message);
  }
  
  dequeue(): Message | undefined {
    return this.queue.shift();
  }
  
  get pending(): number {
    return this.queue.length;
  }
}

// TimedMap - Map with automatic expiration
const cache = new TimedMap<string, any>(60000); // 60 second default TTL

// Store data with default timeout
cache.set('user:123', { name: 'John', role: 'admin' });

// Store with custom timeout
cache.set('session:abc', { token: 'xyz' }, undefined, 30000); // 30s TTL

// Store with custom callback on expiration
cache.set('temp:data', data, (key) => {
  console.log(`Key ${key} expired`);
}, 5000);

// Retrieve data
const user = cache.get('user:123'); // { name: 'John', role: 'admin' }

// Iterate over entries
for (const [key, value] of cache.entries()) {
  console.log(key, value);
}

// Iterate over values
for (const value of cache.values()) {
  console.log(value);
}

// Manual cleanup
cache.delete('session:abc');
cache.clear(); // Remove all entries

// Use forEach
cache.forEach((value, key, map) => {
  console.log(`${key}: ${JSON.stringify(value)}`);
}, thisArg);
```

## API Reference

### Primitives

| Function | Description | Example |
|----------|-------------|---------|
| `noop()` | No operation function | `setTimeout(noop, 1000)` |
| `identity(value)` | Returns input unchanged | `[1, 2, 3].map(identity)` |
| `truly()` | Always returns true | `items.filter(truly)` |
| `falsely()` | Always returns false | `if (falsely()) { }` |
| `arrify(value)` | Converts value to array | `arrify(null) // []` |

### Type Predicates

| Function | Description | Returns |
|----------|-------------|---------|
| `isString(value)` | Checks if value is string | `value is string` |
| `isNumber(value)` | Checks if value is number | `value is number` |
| `isBoolean(value)` | Checks if value is boolean | `value is boolean` |
| `isBigInt(value)` | Checks if value is BigInt | `value is bigint` |
| `isSymbol(value)` | Checks if value is Symbol | `boolean` |
| `isArray(value)` | Checks if value is array | `value is any[]` |
| `isObject(value)` | Checks if value is object | `boolean` |
| `isFunction(value)` | Checks if value is function | `boolean` |
| `isAsyncFunction(value)` | Checks if value is async function | `boolean` |
| `isAsyncGenerator(value)` | Checks if value is async generator | `value is AsyncGenerator` |
| `isPromise(value)` | Checks if value is Promise | `boolean` |
| `isClass(value)` | Checks if value is class | `boolean` |
| `isNull(value)` | Checks if value is null | `boolean` |
| `isUndefined(value)` | Checks if value is undefined | `boolean` |
| `isNil(value)` | Checks if value is null or undefined | `boolean` |
| `isExist(value)` | Checks if value exists (not null/undefined) | `boolean` |
| `isPlainObject(value)` | Checks if value is plain object | `boolean` |
| `isPrimitive(value)` | Checks if value is primitive | `boolean` |
| `isEmptyString(value)` | Checks if string is empty or whitespace | `boolean` |
| `isEmptyObject(value)` | Checks if object has no own properties | `boolean` |
| `isBuffer(value)` | Checks if value is Buffer | `boolean` |
| `isDate(value)` | Checks if value is Date | `boolean` |
| `isRegexp(value)` | Checks if value is RegExp | `boolean` |
| `isError(value)` | Checks if value is Error | `boolean` |
| `isMap(value)` | Checks if value is Map | `boolean` |
| `isSet(value)` | Checks if value is Set | `boolean` |
| `isArrayBuffer(value)` | Checks if value is ArrayBuffer | `boolean` |
| `isArrayBufferView(value)` | Checks if value is ArrayBufferView | `boolean` |
| `isNumeral(value)` | Checks if value represents a finite number | `boolean` |
| `isNumeralInteger(value)` | Checks if value represents an integer | `boolean` |
| `isNumeralBigInt(value)` | Checks if string represents BigInt | `boolean` |
| `isFinite(value)` | Checks if number is finite | `boolean` |
| `isInfinite(value)` | Checks if number is infinite | `boolean` |
| `isInteger(value)` | Checks if number is integer | `boolean` |
| `isSafeInteger(value)` | Checks if number is safe integer | `boolean` |
| `isFloat(value)` | Checks if number is float | `boolean` |
| `isOdd(value)` | Checks if number is odd | `boolean` |
| `isEven(value)` | Checks if number is even | `boolean` |
| `isNan(value)` | Checks if value is NaN | `boolean` |
| `isNegativeZero(value)` | Checks if value is negative zero | `boolean` |
| `isSubstring(substr, str, offset?)` | Checks if substr exists in str | `boolean` |
| `isPrefix(prefix, str)` | Checks if str starts with prefix | `boolean` |
| `isSuffix(suffix, str)` | Checks if str ends with suffix | `boolean` |
| `isPropertyOwned(obj, key)` | Checks if property is own (not inherited) | `boolean` |
| `isPropertyDefined(obj, path)` | Checks if property path exists | `boolean` |
| `getTag(value)` | Gets detailed type tag | `string` |
| `getTagSimple(value)` | Gets simple type tag | `string` |

### Platform Predicates

| Constant | Description | Type |
|----------|-------------|------|
| `isWindows` | Running on Windows | `boolean` |
| `linux` | Running on Linux | `boolean` |
| `darwin` | Running on macOS | `boolean` |
| `freebsd` | Running on FreeBSD | `boolean` |
| `openbsd` | Running on OpenBSD | `boolean` |
| `sunos` | Running on SunOS | `boolean` |
| `aix` | Running on AIX | `boolean` |
| `isNodejs` | Running in Node.js | `boolean` |

### Promise Utilities

| Function | Description |
|----------|-------------|
| `defer<T>()` | Creates a deferred promise with resolve/reject methods |
| `delay(ms, value?, options?)` | Delays execution with optional value |
| `timeout(promise, ms, options?)` | Adds timeout to promise |
| `retry(fn, options)` | Retries function with backoff |
| `props(object)` | Resolves object of promises |
| `promisify(fn, options?)` | Converts callback to promise |
| `promisifyAll(obj, options?)` | Promisifies all methods in object |
| `callbackify(fn)` | Converts promise to callback |
| `nodeify(promise, callback)` | Adds callback support to promise |
| `universalify(fn)` | Supports both callback and promise |
| `universalifyFromPromise(fn)` | Universal wrapper for promise function |
| `finally(promise, onFinally)` | Execute cleanup regardless of outcome |
| `try(fn, ...args)` | Wrap sync function in promise |

### Object Utilities

| Function | Description |
|----------|-------------|
| `omit(obj, keys, options?)` | Creates object without specified keys |
| `entries(obj, options?)` | Gets object entries with options |
| `keys(obj, options?)` | Gets object keys with options |
| `values(obj, options?)` | Gets object values with options |

### Data Structures

| Class | Description |
|-------|-------------|
| `ListBuffer<T>` | Efficient linked list for queue operations |
| `TimedMap<K, V>` | Map with automatic key expiration |

## Advanced Features

### Custom Retry Strategies

```typescript
import { retry, delay } from '@devgrid/common';

// Custom retry with jitter
const fetchWithJitter = async (url: string) => {
  return retry(
    async ({ current }) => {
      // Add random jitter to prevent thundering herd
      const jitter = Math.random() * 1000;
      await delay(jitter);
      
      return fetch(url);
    },
    {
      max: 5,
      backoffBase: 1000,
      backoffExponent: 2,
      report: (msg, options) => {
        console.log(`Retry ${options.$current}/${options.max}`);
      }
    }
  );
};

// Conditional retry based on error type
const resilientFetch = async (url: string) => {
  return retry(
    async () => {
      const response = await fetch(url);
      
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        (error as any).status = response.status;
        throw error;
      }
      
      return response.json();
    },
    {
      max: 3,
      match: [
        // Only retry on network errors or 5xx
        /NetworkError/,
        /HTTP 5\d\d/
      ]
    }
  );
};
```

### Type-Safe Object Filtering

```typescript
import { omit, entries, isString, isNumber } from '@devgrid/common';

// Type-safe configuration filtering
interface Config {
  apiUrl: string;
  apiKey: string;
  timeout: number;
  debug: boolean;
  secretToken: string;
}

function getPublicConfig(config: Config) {
  // Remove sensitive fields
  return omit(config, ['apiKey', 'secretToken']);
}

// Filter object by value types
function extractStrings<T extends object>(obj: T): Partial<T> {
  const stringEntries = entries(obj)
    .filter(([_, value]) => isString(value));
  
  return Object.fromEntries(stringEntries) as Partial<T>;
}

// Deep filtering with predicate
function removeNullish<T extends object>(obj: T): T {
  return omit(obj, (key, value) => isNil(value), { deep: true });
}
```

### Advanced Timing Patterns

```typescript
import { delay, timeout, defer, TimedMap } from '@devgrid/common';

// Polling with timeout
async function pollEndpoint(url: string, interval = 1000, maxTime = 30000) {
  const start = Date.now();
  
  while (Date.now() - start < maxTime) {
    try {
      const response = await timeout(fetch(url), 5000);
      
      if (response.ok) {
        return response.json();
      }
    } catch (error) {
      // Continue polling
    }
    
    await delay(interval);
  }
  
  throw new Error('Polling timeout exceeded');
}

// Rate limiting with TimedMap
class RateLimiter {
  private attempts = new TimedMap<string, number>(60000); // 1 minute window
  private maxAttempts = 10;
  
  async checkLimit(key: string): Promise<boolean> {
    const current = this.attempts.get(key) || 0;
    
    if (current >= this.maxAttempts) {
      return false;
    }
    
    this.attempts.set(key, current + 1);
    return true;
  }
}

// Debounced async operations
function createAsyncDebounce<T>(fn: () => Promise<T>, wait: number) {
  let pending: Promise<T> | null = null;
  let timer: NodeJS.Timeout | null = null;
  const deferred = defer<T>();
  
  return async (): Promise<T> => {
    if (timer) clearTimeout(timer);
    
    if (!pending) {
      pending = deferred.promise;
      
      timer = setTimeout(async () => {
        try {
          const result = await fn();
          deferred.resolve(result);
        } catch (error) {
          deferred.reject(error);
        } finally {
          pending = null;
          timer = null;
        }
      }, wait);
    }
    
    return pending;
  };
}
```

## TypeScript Support

This library is written in TypeScript and provides comprehensive type definitions.

```typescript
// Type inference works automatically
const numbers = arrify(42);              // number[]
const mixed = arrify<string | number>('hello'); // (string | number)[]

// Type predicates provide type narrowing
function processUnknown(value: unknown) {
  if (isString(value)) {
    // TypeScript knows value is string
    return value.toUpperCase();
  }
  
  if (isArray(value)) {
    // TypeScript knows value is array
    return value.map(x => x);
  }
  
  if (isPromise(value)) {
    // TypeScript knows value is Promise
    return value.then(x => x);
  }
}

// Generic types are preserved
const config = {
  name: 'app',
  version: '1.0',
  debug: true,
  secret: 'xyz'
};

const publicConfig = omit(config, ['secret']);
// Type is inferred correctly

// Async utilities maintain types
const data = await retry(
  async () => ({ id: 1, name: 'John' }),
  { max: 3 }
);
// Type: { id: number, name: string }
```

## Performance

### Optimization Strategies

1. **Tree Shaking** - Import only what you need
   ```typescript
   // Good - only imports what's needed
   import { delay, retry } from '@devgrid/common';
   
   // Avoid - imports entire library
   import * as common from '@devgrid/common';
   ```

2. **Efficient Type Checking** - Predicates use optimal checks
   - Direct `typeof` checks where possible
   - Prototype chain checks minimized
   - Early returns for performance

3. **Memory Management**
   - `TimedMap` automatically cleans expired entries
   - `ListBuffer` provides O(1) push/shift operations
   - No memory leaks in async utilities

### Benchmarks

Performance characteristics:

- Type predicates: ~2-5ns per check
- Object utilities: O(n) where n is number of keys
- Promise utilities: Minimal overhead over native promises
- ListBuffer: O(1) push/shift operations
- TimedMap: O(1) get/set with automatic cleanup

## Best Practices

### Error Handling

```typescript
import { retry, isError, timeout } from '@devgrid/common';

// Always handle errors in retry operations
const safeRetry = async <T>(operation: () => Promise<T>) => {
  try {
    return await retry(operation, {
      max: 3,
      report: (msg, options, error) => {
        logger.warn(`Retry ${options.$current}: ${error?.message}`);
      }
    });
  } catch (finalError) {
    logger.error('All retries failed:', finalError);
    throw finalError;
  }
};

// Combine timeout with retry for robustness
const fetchWithTimeoutAndRetry = async (url: string) => {
  return retry(
    async () => {
      return timeout(fetch(url), 5000);
    },
    { max: 3, backoffBase: 1000 }
  );
};
```

### Type Safety

```typescript
// Use type predicates for unknown values
function handleApiResponse(response: unknown) {
  if (!isObject(response)) {
    throw new Error('Invalid response format');
  }
  
  if (!isPropertyDefined(response, 'status')) {
    throw new Error('Missing status field');
  }
  
  if (isPropertyDefined(response, 'data') && !isArray(response.data)) {
    throw new Error('Data must be an array');
  }
  
  // Now safely typed
  return {
    status: response.status,
    data: response.data || []
  };
}
```

### Memory Efficiency

```typescript
// Use TimedMap for automatic cache expiration
const cache = new TimedMap<string, any>(300000); // 5 minutes

// Use ListBuffer for queue operations
const eventQueue = new ListBuffer<Event>();
eventQueue.push(event);
const next = eventQueue.shift();

// Clean up when done
cache.clear();
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

- [GitHub Repository](https://github.com/d-e-v-grid/devgrid/tree/main/packages/common)
- [npm Package](https://www.npmjs.com/package/@devgrid/common)
- [Issue Tracker](https://github.com/d-e-v-grid/devgrid/issues)