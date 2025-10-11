# @omnitron-dev/msgpack

[![npm version](https://img.shields.io/npm/v/@omnitron-dev/msgpack.svg)](https://www.npmjs.com/package/@omnitron-dev/msgpack)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

A high-performance MessagePack implementation for Node.js with TypeScript support, custom type extensions, and streaming capabilities. Provides efficient binary serialization with minimal overhead.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Usage](#core-usage)
  - [Basic Types](#basic-types)
  - [Native JavaScript Types](#native-javascript-types)
  - [Custom Type Extensions](#custom-type-extensions)
  - [Streaming](#streaming)
- [API Reference](#api-reference)
- [Advanced Features](#advanced-features)
- [Configuration](#configuration)
- [TypeScript Support](#typescript-support)
- [Performance](#performance)
- [Browser Support](#browser-support)
- [Best Practices](#best-practices)
- [Contributing](#contributing)
- [License](#license)

## Features

- 🚀 **High Performance** - Optimized encoding/decoding paths
- 📦 **Small Size** - Minimal dependencies
- ⚡ **Full MessagePack Spec** - Compliant with MessagePack specification
- 🔧 **Extensible** - Register custom types with ease
- 💾 **Native Type Support** - Built-in support for JavaScript types
- 🌊 **Streaming Support** - Handle large data streams efficiently
- 🛡️ **Type Safety** - Full TypeScript support
- 🔍 **Error Handling** - Comprehensive error serialization

## Installation

```bash
npm install @omnitron-dev/msgpack
# or
yarn add @omnitron-dev/msgpack
# or
pnpm add @omnitron-dev/msgpack
```

## Quick Start

```typescript
import { encode, decode } from '@omnitron-dev/msgpack';

// Encode data
const data = {
  name: "John Doe",
  age: 30,
  tags: ["developer", "typescript"],
  joined: new Date()
};

const encoded = encode(data);
// Returns Buffer with MessagePack binary data

// Decode data
const decoded = decode(encoded);
// Returns original object with Date preserved
```

## Core Usage

### Basic Types

MessagePack efficiently encodes all basic JavaScript types:

```typescript
import { encode, decode } from '@omnitron-dev/msgpack';

// Numbers (integers and floats)
const num1 = encode(42);           // Positive fixint
const num2 = encode(-17);          // Negative fixint
const num3 = encode(3.14159);      // Float64
const num4 = encode(2147483647);   // Int32

// Strings
const str1 = encode("Hello");      // Fixstr
const str2 = encode("A".repeat(100)); // Str8
const str3 = encode("📦 Unicode"); // UTF-8 encoded

// Booleans and null
const bool1 = encode(true);        // True
const bool2 = encode(false);       // False
const nil = encode(null);          // Nil

// Arrays
const arr1 = encode([1, 2, 3]);    // Fixarray
const arr2 = encode(new Array(20).fill(0)); // Array16

// Objects
const obj1 = encode({ a: 1 });     // Fixmap
const obj2 = encode({ ...large }); // Map16/Map32

// Binary data
const bin1 = encode(Buffer.from([1, 2, 3])); // Bin8
const bin2 = encode(new Uint8Array(1000));   // Bin16
```

### Native JavaScript Types

Built-in support for common JavaScript objects:

```typescript
import { encode, decode } from '@omnitron-dev/msgpack';

// Date objects
const date = new Date('2024-01-01T00:00:00Z');
const encoded = encode({ timestamp: date });
const decoded = decode(encoded);
console.log(decoded.timestamp instanceof Date); // true

// Map objects
const map = new Map([
  ['key1', 'value1'],
  ['key2', { nested: true }]
]);
const mapData = decode(encode(map));
console.log(mapData instanceof Map); // true

// Set objects
const set = new Set([1, 2, 3, 'unique']);
const setData = decode(encode(set));
console.log(setData instanceof Set); // true

// RegExp objects
const regex = /^test.*pattern$/gi;
const regexData = decode(encode(regex));
console.log(regexData instanceof RegExp); // true
console.log(regexData.flags); // 'gi'

// BigInt support
const bigNum = BigInt("9007199254740991");
const bigData = decode(encode(bigNum));
console.log(typeof bigData === 'bigint'); // true

// Error objects
try {
  throw new TypeError("Something went wrong");
} catch (error) {
  const errorData = decode(encode(error));
  console.log(errorData instanceof TypeError); // true
  console.log(errorData.message); // "Something went wrong"
  console.log(errorData.stack); // Stack trace preserved
}
```

### Custom Type Extensions

Register your own types for serialization:

```typescript
import { Serializer } from '@omnitron-dev/msgpack';

// Define a custom class
class User {
  constructor(
    public id: string,
    public name: string,
    public roles: string[]
  ) {}
  
  get isAdmin() {
    return this.roles.includes('admin');
  }
}

// Create a custom serializer
const serializer = new Serializer();

// Register the custom type
serializer.register(
  1, // Type ID (1-99 for user types)
  User, // Constructor function
  // Encoder function
  (user: User, buffer) => {
    serializer.encode(user.id, buffer);
    serializer.encode(user.name, buffer);
    serializer.encode(user.roles, buffer);
  },
  // Decoder function
  (buffer) => {
    const id = serializer.decode(buffer);
    const name = serializer.decode(buffer);
    const roles = serializer.decode(buffer);
    return new User(id, name, roles);
  }
);

// Use the custom serializer
const user = new User('123', 'John Doe', ['admin', 'user']);
const encoded = serializer.encode(user);
const decoded = serializer.decode(encoded);

console.log(decoded instanceof User); // true
console.log(decoded.isAdmin); // true
```

### Streaming

Handle large data streams efficiently:

```typescript
import { SmartBuffer } from '@omnitron-dev/smartbuffer';
import { serializer } from '@omnitron-dev/msgpack';

// Streaming encoder
class MessageStream {
  private buffer = new SmartBuffer();
  
  write(data: any): void {
    serializer.encode(data, this.buffer);
  }
  
  *read() {
    while (this.buffer.remaining() > 0) {
      const result = serializer.decoder.tryDecode(this.buffer);
      if (result) {
        yield result.value;
      } else {
        break; // Wait for more data
      }
    }
  }
  
  getBuffer(): Buffer {
    return this.buffer.toBuffer();
  }
}

// Usage
const stream = new MessageStream();

// Write multiple messages
stream.write({ type: 'header', version: '1.0' });
stream.write({ type: 'data', items: [1, 2, 3] });
stream.write({ type: 'footer', checksum: 'abc123' });

// Read messages
for (const message of stream.read()) {
  console.log('Received:', message);
}

// Network streaming example
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

class MessagePackTransform extends Transform {
  private buffer = new SmartBuffer();
  
  _transform(chunk: Buffer, encoding: string, callback: Function) {
    this.buffer.writeBuffer(chunk);
    
    while (this.buffer.remaining() > 0) {
      const result = serializer.decoder.tryDecode(this.buffer);
      if (result) {
        this.push(JSON.stringify(result.value) + '\n');
      } else {
        break;
      }
    }
    
    callback();
  }
}

// Convert MessagePack file to JSON lines
await pipeline(
  createReadStream('data.msgpack'),
  new MessagePackTransform(),
  createWriteStream('data.jsonl')
);
```

## API Reference

### Main Functions

| Function | Description | Returns |
|----------|-------------|---------|
| `encode(value)` | Encode any value to MessagePack | `Buffer` |
| `decode(buffer)` | Decode MessagePack buffer | `any` |
| `tryDecode(buffer)` | Try to decode, returns null if incomplete | `{ value, bytesConsumed } \| null` |

### Serializer Class

```typescript
class Serializer {
  // Create a new serializer instance
  constructor(initialCapacity?: number);
  
  // Register a custom type
  register(
    type: number,
    constructor: Function,
    encode: (value: any, buffer: SmartBuffer) => void,
    decode: (buffer: SmartBuffer) => any
  ): this;
  
  // Register encoder only
  registerEncoder(
    type: number,
    check: (value: any) => boolean,
    encode: (value: any, buffer: SmartBuffer) => void
  ): this;
  
  // Register decoder only
  registerDecoder(
    type: number,
    decode: (buffer: SmartBuffer) => any
  ): this;
  
  // Encode a value
  encode(value: any, buffer?: SmartBuffer): Buffer;
  
  // Decode a buffer
  decode(buffer: Buffer | SmartBuffer): any;
}
```

### Type Extension IDs

Reserved type IDs for different purposes:

| Range | Purpose | Examples |
|-------|---------|----------|
| 1-99 | User-defined types | Custom classes, domain objects |
| 100-109 | Network types | URLs, IP addresses |
| 110-118 | System types | File handles, processes |
| 119 | Long (64-bit integers) | Large numbers |
| 120 | BigInt | Arbitrary precision integers |
| 121 | RegExp | Regular expressions |
| 123 | Set | ES6 Set |
| 124 | Map | ES6 Map |
| 125 | Date | JavaScript Date |
| 126 | Error | Error objects |

## Advanced Features

### Error Serialization

Comprehensive error handling with stack traces:

```typescript
import { encode, decode } from '@omnitron-dev/msgpack';

// Serialize different error types
const errors = {
  standard: new Error('Standard error'),
  type: new TypeError('Type mismatch'),
  range: new RangeError('Out of bounds'),
  custom: Object.assign(new Error('Custom'), {
    code: 'CUSTOM_ERROR',
    statusCode: 400
  })
};

const encoded = encode(errors);
const decoded = decode(encoded);

// All error properties preserved
console.log(decoded.standard.message); // 'Standard error'
console.log(decoded.standard.stack);   // Full stack trace
console.log(decoded.custom.code);      // 'CUSTOM_ERROR'
console.log(decoded.custom.statusCode); // 400
```

### Complex Type Handling

Handle nested and circular structures:

```typescript
import { Serializer } from '@omnitron-dev/msgpack';

const serializer = new Serializer();

// Handle circular references with custom logic
class Node {
  value: any;
  next: Node | null = null;
  
  constructor(value: any) {
    this.value = value;
  }
}

serializer.register(
  10,
  Node,
  (node: Node, buffer) => {
    const seen = new Set();
    const encode = (n: Node) => {
      if (seen.has(n)) {
        serializer.encode({ $ref: n.value }, buffer);
        return;
      }
      seen.add(n);
      serializer.encode({
        value: n.value,
        next: n.next ? encode(n.next) : null
      }, buffer);
    };
    encode(node);
  },
  (buffer) => {
    // Decode logic with reference resolution
    return serializer.decode(buffer);
  }
);
```

### Performance Optimization

```typescript
import { Serializer } from '@omnitron-dev/msgpack';

// Pre-allocate buffer for better performance
const serializer = new Serializer(1024 * 1024); // 1MB initial capacity

// Batch encoding
class BatchEncoder {
  private serializer = new Serializer(1024 * 1024);
  
  encodeBatch(items: any[]): Buffer[] {
    return items.map(item => this.serializer.encode(item));
  }
  
  encodeBatchSingle(items: any[]): Buffer {
    const buffer = new SmartBuffer();
    
    // Write count
    buffer.writeUInt32LE(items.length);
    
    // Write all items
    for (const item of items) {
      const encoded = this.serializer.encode(item);
      buffer.writeUInt32LE(encoded.length);
      buffer.writeBuffer(encoded);
    }
    
    return buffer.toBuffer();
  }
}
```

## Configuration

### Custom Serializer Options

```typescript
import { Serializer } from '@omnitron-dev/msgpack';

const serializer = new Serializer(
  65536 // Initial buffer capacity (64KB)
);

// Configure behavior
serializer.register(/* ... */);

// Multiple serializers for different contexts
const apiSerializer = new Serializer();
const dbSerializer = new Serializer();
const cacheSerializer = new Serializer();

// Register different types for different use cases
apiSerializer.register(/* API-specific types */);
dbSerializer.register(/* DB-specific types */);
cacheSerializer.register(/* Cache-specific types */);
```

## TypeScript Support

Full TypeScript support with type inference:

```typescript
import { encode, decode, Serializer } from '@omnitron-dev/msgpack';

// Type-safe encoding/decoding
interface User {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

const user: User = {
  id: '123',
  name: 'John',
  email: 'john@example.com',
  createdAt: new Date()
};

const encoded = encode(user);
const decoded = decode(encoded) as User;

// Generic serializer
class TypedSerializer<T> {
  private serializer = new Serializer();
  
  encode(value: T): Buffer {
    return this.serializer.encode(value);
  }
  
  decode(buffer: Buffer): T {
    return this.serializer.decode(buffer) as T;
  }
}

const userSerializer = new TypedSerializer<User>();
```

## Performance

### Benchmarks

MessagePack provides significant size and speed advantages:

| Format | Size | Encode Time | Decode Time |
|--------|------|-------------|-------------|
| JSON | 100% | 100% | 100% |
| MessagePack | 60-80% | 80-90% | 70-80% |

### Optimization Tips

1. **Pre-allocate Buffers** - Use appropriate initial capacity
2. **Reuse Serializers** - Don't create new instances repeatedly
3. **Batch Operations** - Process multiple items together
4. **Stream Large Data** - Use streaming for files or large datasets

```typescript
// Optimized usage
const serializer = new Serializer(1024 * 1024); // 1MB

// Reuse for multiple operations
for (const item of largeDataset) {
  const encoded = serializer.encode(item);
  await processEncoded(encoded);
}
```

## Browser Support

Works in modern browsers with proper bundling:

### Webpack Configuration

```javascript
// webpack.config.js
module.exports = {
  resolve: {
    fallback: {
      "buffer": require.resolve("buffer/"),
      "stream": require.resolve("stream-browserify")
    }
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer']
    })
  ]
};
```

### Rollup Configuration

```javascript
// rollup.config.js
import nodePolyfills from 'rollup-plugin-node-polyfills';
import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
  plugins: [
    nodeResolve({
      browser: true,
      preferBuiltins: false
    }),
    nodePolyfills()
  ]
};
```

### Browser Usage

```html
<script src="https://cdn.jsdelivr.net/npm/buffer@6/index.min.js"></script>
<script src="path/to/messagepack.bundle.js"></script>

<script>
  const { encode, decode } = MessagePack;
  
  const data = {
    message: 'Hello from browser!',
    timestamp: new Date()
  };
  
  const encoded = encode(data);
  console.log('Encoded size:', encoded.length);
  
  const decoded = decode(encoded);
  console.log('Decoded:', decoded);
</script>
```

## Best Practices

### 1. Type Registration

```typescript
// Register types once at startup
const serializer = new Serializer();

// Good - register at initialization
serializer.register(1, MyClass, encodeMyClass, decodeMyClass);

// Bad - registering in hot path
function processData(data: MyClass) {
  const s = new Serializer();
  s.register(1, MyClass, ...); // Don't do this!
  return s.encode(data);
}
```

### 2. Error Handling

```typescript
import { decode } from '@omnitron-dev/msgpack';

function safeDecodeDecoding(buffer: Buffer): any {
  try {
    return decode(buffer);
  } catch (error) {
    console.error('Failed to decode MessagePack:', error);
    
    // Handle specific errors
    if (error.message.includes('Invalid type')) {
      // Handle unknown type
    } else if (error.message.includes('Unexpected end')) {
      // Handle truncated data
    }
    
    throw error;
  }
}
```

### 3. Streaming Best Practices

```typescript
// Good - process data as it arrives
class StreamProcessor {
  private buffer = new SmartBuffer();
  
  process(chunk: Buffer): any[] {
    this.buffer.writeBuffer(chunk);
    const results = [];
    
    while (this.buffer.remaining() > 0) {
      const result = serializer.decoder.tryDecode(this.buffer);
      if (!result) break;
      results.push(result.value);
    }
    
    // Compact buffer if needed
    if (this.buffer.offset > 1024 * 1024) {
      this.buffer.compact();
    }
    
    return results;
  }
}
```

### 4. Security Considerations

```typescript
// Validate data before encoding
function encodeUserData(data: any): Buffer {
  // Validate input
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid data format');
  }
  
  // Sanitize sensitive fields
  const safe = {
    ...data,
    password: undefined,
    ssn: undefined,
    creditCard: undefined
  };
  
  return encode(safe);
}

// Set size limits for decoding
function decodeWithLimit(buffer: Buffer, maxSize = 10 * 1024 * 1024) {
  if (buffer.length > maxSize) {
    throw new Error('Message too large');
  }
  
  return decode(buffer);
}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT © Omnitron

## Links

- [GitHub Repository](https://github.com/omnitron-dev/omni/tree/main/packages/messagepack)
- [npm Package](https://www.npmjs.com/package/@omnitron-dev/msgpack)
- [MessagePack Specification](https://msgpack.org/)