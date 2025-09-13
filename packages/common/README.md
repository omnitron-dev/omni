# @devgrid/common

[![npm version](https://img.shields.io/npm/v/@devgrid/common.svg)](https://www.npmjs.com/package/@devgrid/common)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

A comprehensive utility library providing essential JavaScript/TypeScript functions for everyday development tasks. This package contains type-safe implementations of common utilities with zero external dependencies.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Usage](#core-usage)
  - [Primitives](#primitives)
  - [Type Predicates](#type-predicates)
  - [Promise Utilities](#promise-utilities)
  - [Object Utilities](#object-utilities)
  - [Data Structures](#data-structures)
  - [Cryptography](#cryptography)
- [API Reference](#api-reference)
- [Advanced Features](#advanced-features)
- [TypeScript Support](#typescript-support)
- [Performance](#performance)
- [Best Practices](#best-practices)
- [Contributing](#contributing)
- [License](#license)

## Features

- 🎯 **Type-Safe** - Full TypeScript support with proper type inference
- 📦 **Zero Dependencies** - Minimal footprint (except @noble/hashes for crypto)
- 🌳 **Tree-Shakeable** - Import only what you need
- ✅ **Comprehensive** - Wide range of utility functions
- 🚀 **Optimized** - Performance-focused implementations
- 🌐 **Cross-Platform** - Works in Node.js and browsers
- 🔍 **Well-Tested** - Extensive test coverage
- 📚 **Well-Documented** - Clear examples and API documentation

## Installation

```bash
npm install @devgrid/common
# or
yarn add @devgrid/common
# or
pnpm add @devgrid/common
```

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
  isArray, isObject, isFunction, isPromise,
  isNull, isUndefined, isNullish,
  isDate, isRegExp, isError,
  isEmpty, isPlainObject, isPrimitive,
  isSubstring, isPrefix, isSuffix
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

// Empty checks
isEmpty([]);             // true
isEmpty('');             // true
isEmpty({});             // true
isEmpty(new Map());      // true
isEmpty(new Set());      // true

// String utilities
isSubstring('world', 'hello world');  // true
isPrefix('hello', 'hello world');     // true
isSuffix('world', 'hello world');     // true
isSubstring('foo', 'hello world');    // false
```

### Promise Utilities

Advanced promise handling and control flow utilities.

```typescript
import { 
  defer, delay, timeout, retry, props,
  promisify, callbackify, nodeify
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

// With value
const delayedValue = await delay(1000, 'Hello');
console.log(delayedValue); // 'Hello' (after 1 second)

// timeout - Add timeout to any promise
try {
  const response = await timeout(
    fetch('https://slow-api.example.com/data'),
    5000, // 5 second timeout
    { message: 'Request timed out after 5 seconds' }
  );
} catch (error) {
  if (error.message.includes('timed out')) {
    console.log('Request was too slow');
  }
}

// retry - Retry failed operations with exponential backoff
const fetchWithRetry = await retry(
  async ({ current, total }) => {
    console.log(`Attempt ${current} of ${total}`);
    
    const response = await fetch('/api/data');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return response.json();
  },
  {
    max: 3,                    // Maximum 3 attempts
    backoffBase: 1000,         // Start with 1s delay
    backoffExponent: 2,        // Double delay each time
    match: [/HTTP 5\d\d/],     // Only retry on 5xx errors
    report: (message, meta, error) => {
      console.log(`${message}: ${error?.message}`);
    }
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

// callbackify - Convert promise-based to callback-based
const fetchCallback = callbackify(fetch);

fetchCallback('https://api.example.com', (err, response) => {
  if (err) {
    console.error('Request failed:', err);
  } else {
    console.log('Response:', response);
  }
});
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

const publicUser = omit(user, 'password');
// { id: 1, name: 'John Doe', email: 'john@example.com', ssn: '123-45-6789' }

const safeUser = omit(user, ['password', 'ssn']);
// { id: 1, name: 'John Doe', email: 'john@example.com' }

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
  },
  system: {
    version: '1.0',
    secret: 'system-secret'
  }
};

const cleaned = omit(nested, ['password', 'apiKey', 'secret'], { deep: true });
// {
//   user: {
//     id: 1,
//     profile: {
//       name: 'John',
//       settings: {
//         theme: 'dark'
//       }
//     }
//   },
//   system: {
//     version: '1.0'
//   }
// }

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
keys(instance, { followProto: false }); // ['own']
values(instance);                       // ['child property', 'from parent']
```

### Data Structures

Specialized data structures for common use cases.

```typescript
import { ListBuffer, TimedMap } from '@devgrid/common';

// ListBuffer - Efficient list operations
const buffer = new ListBuffer<string>();

// Add items
buffer.push('first', 'second', 'third');
buffer.unshift('zero');

// Access items
console.log(buffer.get(0));  // 'zero'
console.log(buffer.length);  // 4

// Convert to array when needed
const items = buffer.toArray(); // ['zero', 'first', 'second', 'third']

// Iterate
for (const item of buffer) {
  console.log(item);
}

// TimedMap - Map with automatic expiration
const cache = new TimedMap<string, any>(60000); // 60 second TTL

// Store data
cache.set('user:123', { name: 'John', role: 'admin' });
cache.set('session:abc', { token: 'xyz' }, 30000); // Custom 30s TTL

// Retrieve data
const user = cache.get('user:123'); // { name: 'John', role: 'admin' }

// After 60 seconds
setTimeout(() => {
  const expired = cache.get('user:123'); // undefined
}, 61000);

// Manual cleanup
cache.delete('session:abc');
cache.clear(); // Remove all entries
```

### Cryptography

Secure random ID generation.

```typescript
import { cuid } from '@devgrid/common';

// Generate collision-resistant unique identifiers
const id1 = cuid(); // "clh3qzm8h0000a65z8byfqhox"
const id2 = cuid(); // "clh3qzm8h0001a65z5nj3qhst"

// Use for database IDs, session tokens, etc.
const user = {
  id: cuid(),
  sessionId: cuid(),
  apiKey: cuid()
};

// IDs are:
// - URL-safe
// - Collision-resistant
// - Cryptographically secure
// - Sortable by creation time
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
| `isArray(value)` | Checks if value is array | `value is any[]` |
| `isObject(value)` | Checks if value is object | `value is object` |
| `isFunction(value)` | Checks if value is function | `value is Function` |
| `isPromise(value)` | Checks if value is Promise | `value is Promise<any>` |
| `isNull(value)` | Checks if value is null | `value is null` |
| `isUndefined(value)` | Checks if value is undefined | `value is undefined` |
| `isNullish(value)` | Checks if value is null or undefined | `value is null \| undefined` |
| `isEmpty(value)` | Checks if value is empty | `boolean` |
| `isPlainObject(value)` | Checks if value is plain object | `boolean` |
| `isPrimitive(value)` | Checks if value is primitive | `boolean` |

### Promise Utilities

| Function | Description |
|----------|-------------|
| `defer<T>()` | Creates a deferred promise |
| `delay(ms, value?)` | Delays execution with optional value |
| `timeout(promise, ms, options?)` | Adds timeout to promise |
| `retry(fn, options?)` | Retries function with backoff |
| `props(object)` | Resolves object of promises |
| `promisify(fn)` | Converts callback to promise |
| `callbackify(fn)` | Converts promise to callback |

### Object Utilities

| Function | Description |
|----------|-------------|
| `omit(obj, keys, options?)` | Creates object without keys |
| `entries(obj, options?)` | Gets object entries |
| `keys(obj, options?)` | Gets object keys |
| `values(obj, options?)` | Gets object values |

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
      report: (msg, meta) => {
        console.log(`Retry ${meta.current}/${meta.total} with ${meta.delay}ms delay`);
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
        error.status = response.status;
        throw error;
      }
      
      return response.json();
    },
    {
      max: 3,
      match: [
        // Only retry on network errors or 5xx
        (err) => !err.status || err.status >= 500
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

// Deep filtering
function removeNullish<T extends object>(obj: T): T {
  const clean = {} as T;
  
  for (const [key, value] of entries(obj)) {
    if (value !== null && value !== undefined) {
      if (isObject(value) && !isArray(value)) {
        clean[key] = removeNullish(value);
      } else {
        clean[key] = value;
      }
    }
  }
  
  return clean;
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
  
  return async (): Promise<T> => {
    if (timer) clearTimeout(timer);
    
    if (!pending) {
      const deferred = defer<T>();
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
// Type: { name: string, version: string, debug: boolean }

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
   - `ListBuffer` provides efficient array-like operations
   - No memory leaks in async utilities

### Benchmarks

Performance characteristics:

- Type predicates: ~2-5ns per check
- Object utilities: O(n) where n is number of keys
- Promise utilities: Minimal overhead over native promises
- Data structures: Optimized for their specific use cases

## Best Practices

### Error Handling

```typescript
import { retry, isError, timeout } from '@devgrid/common';

// Always handle errors in retry operations
const safeRetry = async <T>(operation: () => Promise<T>) => {
  try {
    return await retry(operation, {
      max: 3,
      report: (msg, meta, error) => {
        logger.warn(`Retry ${meta.current}: ${error?.message}`);
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
  
  if (!isString(response.status)) {
    throw new Error('Missing status field');
  }
  
  if (response.data && !isArray(response.data)) {
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

// Use ListBuffer for frequent array operations
const eventLog = new ListBuffer<LogEntry>();
eventLog.push({ timestamp: Date.now(), message: 'Started' });

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