# @devgrid/messagepack

A high-performance MessagePack implementation for Node.js with TypeScript support, custom type extensions, and streaming capabilities.

## Features

- 🚀 Full TypeScript support
- 📦 Minimal dependencies
- ⚡ High performance serialization/deserialization
- 🔄 Custom type extensions
- 💾 Built-in support for JavaScript native types
- 🛡️ Comprehensive error handling
- 🔍 Streaming support via SmartBuffer

## Installation

```bash
npm install @devgrid/messagepack
# or
yarn add @devgrid/messagepack
```

## Basic Usage

```typescript
import { encode, decode } from '@devgrid/messagepack';

// Encoding
const data = {
  name: "John",
  age: 30,
  hobbies: ["reading", "gaming"]
};
const encoded = encode(data);

// Decoding
const decoded = decode(encoded);
```

## Supported Types

### Built-in Types

```typescript
// Numbers (integers and floats)
encode(42);
encode(3.14);

// Strings
encode("Hello World");

// Booleans
encode(true);
encode(false);

// null
encode(null);

// Arrays
encode([1, 2, 3]);

// Objects
encode({ foo: "bar" });

// Buffer
encode(Buffer.from([1, 2, 3]));
```

### Native JavaScript Types

```typescript
import { serializer } from '@devgrid/messagepack';

// Date
const date = new Date();
const encodedDate = encode(date);

// Map
const map = new Map([["key", "value"]]);
const encodedMap = encode(map);

// Set
const set = new Set([1, 2, 3]);
const encodedSet = encode(set);

// RegExp
const regex = /pattern/g;
const encodedRegex = encode(regex);

// BigInt
const bigint = BigInt("9007199254740991");
const encodedBigInt = encode(bigint);

// Error objects
const error = new Error("Something went wrong");
const encodedError = encode(error);
```

## Custom Type Extensions

You can register your own types for serialization:

```typescript
import { Serializer } from '@devgrid/messagepack';

class User {
  constructor(public name: string, public age: number) {}
}

const customSerializer = new Serializer();

// Register custom type (use numbers 1-99 for user-defined types)
customSerializer.register(
  1, // type ID
  User, // constructor
  // Encoder
  (obj: User, buf: SmartBuffer) => {
    customSerializer.encode(obj.name, buf);
    customSerializer.encode(obj.age, buf);
  },
  // Decoder
  (buf: SmartBuffer) => {
    const name = customSerializer.decode(buf);
    const age = customSerializer.decode(buf);
    return new User(name, age);
  }
);

// Use custom serializer
const user = new User("John", 30);
const encoded = customSerializer.encode(user);
const decoded = customSerializer.decode(encoded);
```

## Error Handling

The library includes built-in support for serializing standard JavaScript errors:

```typescript
try {
  throw new TypeError("Invalid type");
} catch (error) {
  const encoded = encode(error);
  const decoded = decode(encoded);
  
  console.log(decoded instanceof TypeError); // true
  console.log(decoded.message); // "Invalid type"
  console.log(decoded.stack); // Preserved stack trace
}
```

## Streaming Support

The library supports streaming via SmartBuffer:

```typescript
import { SmartBuffer } from '@devgrid/smartbuffer';
import { serializer } from '@devgrid/messagepack';

// Create a buffer
const buf = new SmartBuffer();

// Encode multiple objects
serializer.encode({ type: "header" }, buf);
serializer.encode({ type: "data", content: "..." }, buf);
serializer.encode({ type: "footer" }, buf);

// Decode stream
while (buf.length > 0) {
  const result = serializer.decoder.tryDecode(buf);
  if (result) {
    console.log(result.value);
  } else {
    break; // Incomplete data
  }
}
```

## Type Extension IDs

The library reserves specific type IDs for different purposes:

- 126: Standard Errors
- 125: Date
- 124: Map
- 123: Set
- 121: RegExp
- 120: BigInt
- 119: Long
- 110-118: Reserved for other system types
- 100-109: Reserved for network types
- 1-99: Available for user-defined types

## Performance Considerations

- Uses SmartBuffer for efficient buffer operations
- Optimized encoding/decoding paths for common types
- Minimal allocations during serialization
- Efficient handling of binary data

## API Reference

### Main Functions

```typescript
encode(value: any): Buffer
decode(buffer: Buffer | SmartBuffer): any
tryDecode(buffer: SmartBuffer): { value: any, bytesConsumed: number } | null
```

### Serializer Class

```typescript
class Serializer {
  constructor(initialCapacity?: number);
  
  register(type: number, constructor: any, encode: EncodeFunction, decode: DecodeFunction): this;
  registerEncoder(type: number, check: CheckFunction, encode: EncodeFunction): this;
  registerDecoder(type: number, decode: DecodeFunction): this;
  
  encode(value: any, buffer?: SmartBuffer): SmartBuffer;
  decode(buffer: Buffer | SmartBuffer): any;
}
```

## License

MIT

## Credits

Built with [SmartBuffer](https://github.com/devgrid/smartbuffer) for efficient buffer operations.

## Browser Support

While this library is primarily designed for Node.js, it can be used in browser environments with proper bundling setup.

### Using with Bundlers

```typescript
// webpack/rollup/esbuild will handle the Buffer polyfill
import { encode, decode } from '@devgrid/messagepack';
```

### Bundler Configuration

#### Webpack

```javascript
// webpack.config.js
module.exports = {
  resolve: {
    fallback: {
      "buffer": require.resolve("buffer/"),
      "long": require.resolve("long")
    }
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer']
    })
  ]
};
```

#### Rollup

```javascript
// rollup.config.js
import nodePolyfills from 'rollup-plugin-node-polyfills';

export default {
  plugins: [
    nodePolyfills()
  ]
};
```

### Browser-Specific Considerations

- Requires Buffer polyfill (automatically handled by most bundlers)
- Long.js is required for 64-bit integer support
- Performance may vary compared to Node.js environment
- Streaming capabilities might be limited in browser context
- Consider using smaller alternatives for browser-only projects

### Browser Usage Example

```html
<!-- Include required polyfills -->
<script src="https://cdn.jsdelivr.net/npm/long/dist/long.js"></script>
<script src="https://cdn.jsdelivr.net/npm/buffer@6.0.3/index.min.js"></script>

<!-- Include bundled messagepack -->
<script src="path/to/bundled/messagepack.js"></script>

<script>
  const data = {
    name: "John",
    numbers: [1, 2, 3],
    timestamp: new Date()
  };

  // Encode data
  const encoded = messagepack.encode(data);

  // Decode data
  const decoded = messagepack.decode(encoded);
</script>
```

### Browser Bundle Size Optimization

To minimize bundle size when using in browsers:

1. Use tree-shaking capable bundler
2. Import only required functionality:
```typescript
import { encode, decode } from '@devgrid/messagepack';
// Instead of
import * as messagepack from '@devgrid/messagepack';
```
3. Consider using separate bundles for modern and legacy browsers
4. Implement custom serializers only for types you need
