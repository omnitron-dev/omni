# SmartBuffer

An enhanced and modernized version of [ByteBuffer.js](https://github.com/protobufjs/bytebuffer.js) for Node.js with TypeScript support, improved performance, and additional features.

## Features

- 🚀 Full TypeScript support
- 📦 Zero dependencies (except Long.js for 64-bit integers)
- ⚡ Optimized for Node.js
- 🛡️ Comprehensive error checking
- 🔄 Chainable API
- 💾 Support for various data types and encodings
- 🌐 Browser support via bundlers

## Browser Support

While SmartBuffer is primarily optimized for Node.js, it can be used in browsers through modern bundlers like webpack, Rollup, or esbuild. Here are a few things to keep in mind:

### Using with Bundlers

```typescript
// webpack/rollup will handle the Buffer polyfill automatically
import { SmartBuffer } from '@devgrid/smartbuffer';
```

### Browser-Specific Considerations

- Requires a Buffer polyfill (automatically handled by most bundlers)
- Some Node.js-specific optimizations may not be available
- Performance may vary compared to Node.js environment
- Recommended to use smaller specialized alternatives for browser-only projects

### Example with Browser Bundler

```javascript
// webpack.config.js
module.exports = {
  resolve: {
    fallback: {
      "buffer": require.resolve("buffer/")
    }
  }
};
```

```typescript
// Your application code
import { Buffer } from 'buffer';
import { SmartBuffer } from '@devgrid/smartbuffer';

// Now you can use SmartBuffer in the browser
const buffer = new SmartBuffer();
buffer.writeString("Hello Browser!");
```

## Installation

```bash
npm install @devgrid/smartbuffer
# or
yarn add @devgrid/smartbuffer
```

## Basic Usage

```typescript
import { SmartBuffer } from '@devgrid/smartbuffer';

// Create a new buffer
const buffer = new SmartBuffer();

// Write some data
buffer
  .writeInt32LE(12345)
  .writeString("Hello World")
  .writeFloat64BE(3.14);

// Reset read position
buffer.reset();

// Read data back
const number = buffer.readInt32LE();     // 12345
const string = buffer.readString(11);     // "Hello World"
const float = buffer.readFloat64BE();     // 3.14
```

## Key Features

### Multiple Data Types Support

```typescript
const buffer = new SmartBuffer();

// Integer types
buffer.writeInt8(1);
buffer.writeInt16LE(2);
buffer.writeInt32BE(3);
buffer.writeUInt64LE(4);

// Floating point
buffer.writeFloatLE(1.1);
buffer.writeDoubleBE(2.2);

// BigInt support
buffer.writeBigIntLE(BigInt("9007199254740991"));

// Strings with various encodings
buffer.writeString("Hello");        // UTF8
buffer.writeCString("World");       // Null-terminated
buffer.writeVString("!");           // Length-prefixed
```

### Variable Length Integers

```typescript
const buffer = new SmartBuffer();

// Write variable length integers
buffer.writeVarint32(1234);
buffer.writeVarint64(9007199254740991);

// Write zigzag encoded variants
buffer.writeVarint32ZigZag(-1234);
buffer.writeVarint64ZigZag(-9007199254740991);
```

### Buffer Operations

```typescript
const buffer = new SmartBuffer();

// Append data
buffer.write("Hello");
buffer.append(" World");

// Slice and copy
const slice = buffer.slice(0, 5);
const copy = buffer.copy();

// Compact and resize
buffer.compact();
buffer.resize(1024);

// Convert to different formats
const nodeBuffer = buffer.toBuffer();
const arrayBuffer = buffer.toArrayBuffer();
const base64 = buffer.toBase64();
const hex = buffer.toHex();
```

### Advanced Features

```typescript
const buffer = new SmartBuffer();

// BitSet operations
buffer.writeBitSet([true, false, true]);

// Debug output
console.log(buffer.toDebug());

// Concatenate multiple buffers
const combined = SmartBuffer.concat([buffer1, buffer2, buffer3]);

// Handle different endianness
buffer.writeInt32LE(12345);  // Little-endian
buffer.writeInt32BE(12345);  // Big-endian
```

## API Reference

### Constructor

```typescript
new SmartBuffer(capacity?: number, noAssert?: boolean)
```

- `capacity`: Initial buffer size (default: 64)
- `noAssert`: Skip argument validation for better performance (default: false)

### Reading Methods

| Method | Description |
|--------|-------------|
| `readInt8()` | Read 8-bit signed integer |
| `readUInt8()` | Read 8-bit unsigned integer |
| `readInt16LE/BE()` | Read 16-bit signed integer |
| `readUInt16LE/BE()` | Read 16-bit unsigned integer |
| `readInt32LE/BE()` | Read 32-bit signed integer |
| `readUInt32LE/BE()` | Read 32-bit unsigned integer |
| `readBigIntLE/BE()` | Read 64-bit signed BigInt |
| `readFloatLE/BE()` | Read 32-bit float |
| `readDoubleLE/BE()` | Read 64-bit float |
| `readString()` | Read UTF-8 string |
| `readCString()` | Read null-terminated string |
| `readVString()` | Read length-prefixed string |
| `readVarint32/64()` | Read variable-length integer |

### Writing Methods

| Method | Description |
|--------|-------------|
| `writeInt8()` | Write 8-bit signed integer |
| `writeUInt8()` | Write 8-bit unsigned integer |
| `writeInt16LE/BE()` | Write 16-bit signed integer |
| `writeUInt16LE/BE()` | Write 16-bit unsigned integer |
| `writeInt32LE/BE()` | Write 32-bit signed integer |
| `writeUInt32LE/BE()` | Write 32-bit unsigned integer |
| `writeBigIntLE/BE()` | Write 64-bit signed BigInt |
| `writeFloatLE/BE()` | Write 32-bit float |
| `writeDoubleLE/BE()` | Write 64-bit float |
| `writeString()` | Write UTF-8 string |
| `writeCString()` | Write null-terminated string |
| `writeVString()` | Write length-prefixed string |
| `writeVarint32/64()` | Write variable-length integer |

### Buffer Operations

| Method | Description |
|--------|-------------|
| `slice()` | Create a new buffer from a portion of this buffer |
| `copy()` | Create a copy of this buffer |
| `compact()` | Optimize buffer size to content |
| `reset()` | Reset read/write positions |
| `reverse()` | Reverse buffer contents |
| `append()` | Append data to buffer |
| `prepend()` | Prepend data to buffer |

## Differences from ByteBuffer.js

- Node.js only implementation
- Native TypeScript support
- Improved error handling
- Better performance for Node.js environment
- Additional utility methods
- Modern JavaScript features support
- BigInt support for 64-bit integers

## License

MIT License

## Credits

Based on [ByteBuffer.js](https://github.com/protobufjs/bytebuffer.js) by Daniel Wirtz.
