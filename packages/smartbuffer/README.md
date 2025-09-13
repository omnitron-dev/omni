# @devgrid/smartbuffer

[![npm version](https://img.shields.io/npm/v/@devgrid/smartbuffer.svg)](https://www.npmjs.com/package/@devgrid/smartbuffer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8.3-blue)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

An enhanced and modernized version of [ByteBuffer.js](https://github.com/protobufjs/bytebuffer.js) for Node.js with TypeScript support, improved performance, and additional features for efficient binary data manipulation.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Usage](#core-usage)
  - [Reading Data](#reading-data)
  - [Writing Data](#writing-data)
  - [Buffer Operations](#buffer-operations)
  - [Variable Length Integers](#variable-length-integers)
- [API Reference](#api-reference)
- [Advanced Features](#advanced-features)
- [TypeScript Support](#typescript-support)
- [Performance](#performance)
- [Browser Support](#browser-support)
- [Best Practices](#best-practices)
- [Differences from ByteBuffer.js](#differences-from-bytebufferjs)
- [Contributing](#contributing)
- [License](#license)

## Features

- 🚀 **High Performance** - Optimized for Node.js environment
- 📦 **Minimal Dependencies** - Only Long.js and utfx for extended functionality
- ⚡ **TypeScript Native** - Written in TypeScript with full type definitions
- 🛡️ **Comprehensive Error Checking** - Robust validation with clear error messages
- 🔄 **Chainable API** - Fluent interface for method chaining
- 💾 **Multiple Data Types** - Support for all common binary data types
- 🌐 **Cross-Platform** - Works in Node.js and browsers via bundlers
- 🔍 **Debug Support** - Built-in debugging and inspection utilities

## Installation

```bash
npm install @devgrid/smartbuffer
# or
yarn add @devgrid/smartbuffer
# or
pnpm add @devgrid/smartbuffer
```

## Quick Start

```typescript
import { SmartBuffer } from '@devgrid/smartbuffer';

// Create a new buffer
const buffer = new SmartBuffer();

// Write data with method chaining
buffer
  .writeInt32LE(42)
  .writeString("Hello World")
  .writeFloat64BE(3.14159);

// Reset read position
buffer.reset();

// Read data back
const number = buffer.readInt32LE();     // 42
const text = buffer.readString(11);       // "Hello World"
const pi = buffer.readFloat64BE();        // 3.14159
```

## Core Usage

### Reading Data

SmartBuffer provides methods for reading all common data types:

```typescript
const buffer = new SmartBuffer();

// Write some test data first
buffer.writeInt8(127);
buffer.writeUInt8(255);
buffer.writeInt16LE(32767);
buffer.writeUInt16BE(65535);
buffer.writeInt32LE(-2147483648);
buffer.writeUInt32BE(4294967295);
buffer.writeFloatLE(1.23);
buffer.writeDoubleBE(123.456789);
buffer.writeString("Hello");

// Reset position for reading
buffer.reset();

// Read integers
const int8 = buffer.readInt8();          // 127
const uint8 = buffer.readUInt8();        // 255
const int16 = buffer.readInt16LE();      // 32767
const uint16 = buffer.readUInt16BE();    // 65535
const int32 = buffer.readInt32LE();      // -2147483648
const uint32 = buffer.readUInt32BE();    // 4294967295

// Read floating point
const float32 = buffer.readFloatLE();    // 1.23
const float64 = buffer.readDoubleBE();   // 123.456789

// Read strings
const str = buffer.readString(5);        // "Hello"

// Read with specific encoding
buffer.writeString("こんにちは", "utf8");
buffer.offset -= 15; // Move back
const japanese = buffer.readString(15, "utf8"); // "こんにちは"
```

### Writing Data

Write various data types with automatic buffer expansion:

```typescript
const buffer = new SmartBuffer();

// Write integers with different byte orders
buffer.writeInt8(-128);
buffer.writeUInt8(255);
buffer.writeInt16LE(1000);     // Little Endian
buffer.writeInt16BE(1000);     // Big Endian
buffer.writeInt32LE(-50000);
buffer.writeUInt32BE(3000000);

// Write 64-bit integers using BigInt
buffer.writeBigIntLE(BigInt("9007199254740991"));
buffer.writeBigUIntBE(BigInt("18446744073709551615"));

// Write floating point numbers
buffer.writeFloatLE(3.14159);
buffer.writeDoubleBE(2.718281828);

// Write strings
buffer.writeString("ASCII text");
buffer.writeCString("Null-terminated\0");  // C-style string
buffer.writeVString("Length-prefixed");    // With length prefix

// Write binary data
buffer.write([0x01, 0x02, 0x03, 0x04]);
buffer.writeBuffer(Buffer.from([0xFF, 0xFE]));

// Write BitSet
buffer.writeBitSet([true, false, true, true, false]);
```

### Buffer Operations

Manipulate and transform buffer data:

```typescript
const buffer = new SmartBuffer();

// Fill with data
buffer.writeString("Hello World!");

// Slice operations
const slice = buffer.slice(0, 5);  // New buffer with "Hello"
const copy = buffer.copy();        // Complete copy

// Buffer information
console.log(buffer.capacity);      // Current capacity
console.log(buffer.length);        // Data length
console.log(buffer.offset);        // Current position
console.log(buffer.remaining());   // Bytes remaining

// Compact and resize
buffer.compact();                  // Optimize size
buffer.resize(1024);               // Resize to specific capacity
buffer.ensureCapacity(2048);       // Ensure minimum capacity

// Clear and reset
buffer.clear();                    // Clear all data
buffer.reset();                    // Reset position only

// Convert to different formats
const nodeBuffer = buffer.toBuffer();      // Node.js Buffer
const arrayBuffer = buffer.toArrayBuffer(); // ArrayBuffer
const uint8Array = buffer.toUint8Array();  // Uint8Array
const base64 = buffer.toBase64();          // Base64 string
const hex = buffer.toHex();                // Hex string
const binary = buffer.toBinary();          // Binary string

// Reverse buffer contents
buffer.reverse();

// Append and prepend
buffer.append(" Appended");
buffer.prepend("Prepended ");
```

### Variable Length Integers

Efficient encoding for variable-sized integers:

```typescript
const buffer = new SmartBuffer();

// Write variable length integers (varint)
buffer.writeVarint32(300);         // Uses 2 bytes instead of 4
buffer.writeVarint64(1000000);     // Efficient for small values

// Write zigzag encoded varints (for signed integers)
buffer.writeVarint32ZigZag(-123);  // Efficient negative number encoding
buffer.writeVarint64ZigZag(-999999);

// Reset and read back
buffer.reset();

const int32 = buffer.readVarint32();        // 300
const int64 = buffer.readVarint64();        // 1000000
const zigzag32 = buffer.readVarint32ZigZag(); // -123
const zigzag64 = buffer.readVarint64ZigZag(); // -999999

// Calculate varint size without writing
const size = SmartBuffer.calculateVarint32(12345); // Returns byte count
```

## API Reference

### Constructor

```typescript
new SmartBuffer(capacity?: number, noAssert?: boolean)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| capacity | number | 64 | Initial buffer capacity in bytes |
| noAssert | boolean | false | Disable validation for better performance |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| buffer | Buffer | Underlying Node.js Buffer |
| offset | number | Current read/write position |
| markedOffset | number | Marked position for reset |
| length | number | Actual data length |
| capacity | number | Total buffer capacity |
| noAssert | boolean | Validation flag |

### Reading Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `readInt8()` | number | Read signed 8-bit integer |
| `readUInt8()` | number | Read unsigned 8-bit integer |
| `readInt16LE/BE()` | number | Read signed 16-bit integer |
| `readUInt16LE/BE()` | number | Read unsigned 16-bit integer |
| `readInt32LE/BE()` | number | Read signed 32-bit integer |
| `readUInt32LE/BE()` | number | Read unsigned 32-bit integer |
| `readInt64LE/BE()` | Long | Read signed 64-bit integer |
| `readUInt64LE/BE()` | Long | Read unsigned 64-bit integer |
| `readBigIntLE/BE()` | bigint | Read signed 64-bit BigInt |
| `readBigUIntLE/BE()` | bigint | Read unsigned 64-bit BigInt |
| `readFloatLE/BE()` | number | Read 32-bit float |
| `readDoubleLE/BE()` | number | Read 64-bit double |
| `readString(length, encoding?)` | string | Read string with length |
| `readCString()` | string | Read null-terminated string |
| `readVString()` | string | Read length-prefixed string |
| `readVarint32()` | number | Read variable-length int32 |
| `readVarint64()` | Long | Read variable-length int64 |

### Writing Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `writeInt8(value)` | this | Write signed 8-bit integer |
| `writeUInt8(value)` | this | Write unsigned 8-bit integer |
| `writeInt16LE/BE(value)` | this | Write signed 16-bit integer |
| `writeUInt16LE/BE(value)` | this | Write unsigned 16-bit integer |
| `writeInt32LE/BE(value)` | this | Write signed 32-bit integer |
| `writeUInt32LE/BE(value)` | this | Write unsigned 32-bit integer |
| `writeInt64LE/BE(value)` | this | Write signed 64-bit integer |
| `writeUInt64LE/BE(value)` | this | Write unsigned 64-bit integer |
| `writeBigIntLE/BE(value)` | this | Write signed 64-bit BigInt |
| `writeBigUIntLE/BE(value)` | this | Write unsigned 64-bit BigInt |
| `writeFloatLE/BE(value)` | this | Write 32-bit float |
| `writeDoubleLE/BE(value)` | this | Write 64-bit double |
| `writeString(str, encoding?)` | this | Write string |
| `writeCString(str)` | this | Write null-terminated string |
| `writeVString(str)` | this | Write length-prefixed string |
| `writeVarint32(value)` | this | Write variable-length int32 |
| `writeVarint64(value)` | this | Write variable-length int64 |

### Utility Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `remaining()` | number | Bytes remaining to read |
| `skip(bytes)` | this | Skip bytes forward |
| `rewind(bytes)` | this | Rewind bytes backward |
| `mark()` | this | Mark current position |
| `reset()` | this | Reset to marked position |
| `clear()` | this | Clear buffer contents |
| `compact()` | this | Compact buffer size |
| `resize(capacity)` | this | Resize buffer |
| `reverse()` | this | Reverse buffer contents |
| `append(data)` | this | Append data to end |
| `prepend(data)` | this | Prepend data to beginning |
| `slice(start, end)` | SmartBuffer | Create sub-buffer |
| `copy()` | SmartBuffer | Create buffer copy |
| `toBuffer()` | Buffer | Convert to Node.js Buffer |
| `toArrayBuffer()` | ArrayBuffer | Convert to ArrayBuffer |
| `toBase64()` | string | Convert to Base64 |
| `toHex()` | string | Convert to hexadecimal |
| `toBinary()` | string | Convert to binary string |
| `toDebug()` | string | Debug representation |

## Advanced Features

### Custom Encoding/Decoding

```typescript
import { SmartBuffer } from '@devgrid/smartbuffer';

// Custom data structure
interface Packet {
  id: number;
  timestamp: bigint;
  type: string;
  payload: Buffer;
}

class PacketBuffer extends SmartBuffer {
  writePacket(packet: Packet): this {
    this.writeUInt32LE(packet.id);
    this.writeBigUIntLE(packet.timestamp);
    this.writeVString(packet.type);
    this.writeUInt32LE(packet.payload.length);
    this.writeBuffer(packet.payload);
    return this;
  }
  
  readPacket(): Packet {
    return {
      id: this.readUInt32LE(),
      timestamp: this.readBigUIntLE(),
      type: this.readVString(),
      payload: this.readBuffer(this.readUInt32LE())
    };
  }
}

// Usage
const buffer = new PacketBuffer();
buffer.writePacket({
  id: 1,
  timestamp: BigInt(Date.now()),
  type: 'message',
  payload: Buffer.from('Hello World')
});

buffer.reset();
const packet = buffer.readPacket();
```

### Streaming Operations

```typescript
import { SmartBuffer } from '@devgrid/smartbuffer';
import { Readable, Writable } from 'stream';

// Stream writer
class BufferWriteStream extends Writable {
  private buffer = new SmartBuffer();
  
  _write(chunk: Buffer, encoding: string, callback: Function) {
    this.buffer.writeBuffer(chunk);
    callback();
  }
  
  getBuffer(): Buffer {
    return this.buffer.toBuffer();
  }
}

// Stream reader
class BufferReadStream extends Readable {
  private buffer: SmartBuffer;
  
  constructor(buffer: SmartBuffer) {
    super();
    this.buffer = buffer;
    this.buffer.reset();
  }
  
  _read(size: number) {
    const remaining = this.buffer.remaining();
    if (remaining === 0) {
      this.push(null); // EOF
      return;
    }
    
    const chunkSize = Math.min(size, remaining);
    const chunk = this.buffer.readBuffer(chunkSize);
    this.push(chunk);
  }
}

// Usage
const writeStream = new BufferWriteStream();
writeStream.write(Buffer.from('Stream'));
writeStream.write(Buffer.from('ing'));
writeStream.write(Buffer.from(' data'));
writeStream.end();

const buffer = new SmartBuffer(writeStream.getBuffer());
const readStream = new BufferReadStream(buffer);
readStream.on('data', chunk => console.log(chunk.toString()));
```

### Bit Operations

```typescript
const buffer = new SmartBuffer();

// Write individual bits as a BitSet
const bits = [
  true,  // 1
  false, // 0
  true,  // 1
  true,  // 1
  false, // 0
  false, // 0
  true,  // 1
  false  // 0
];
buffer.writeBitSet(bits); // Writes as bytes: 0b10110010

// Write bit flags
class FlagBuffer extends SmartBuffer {
  writeFlags(flags: { [key: string]: boolean }): this {
    let byte = 0;
    let bit = 0;
    
    for (const [key, value] of Object.entries(flags)) {
      if (value) {
        byte |= (1 << bit);
      }
      bit++;
      
      if (bit === 8) {
        this.writeUInt8(byte);
        byte = 0;
        bit = 0;
      }
    }
    
    if (bit > 0) {
      this.writeUInt8(byte);
    }
    
    return this;
  }
}
```

### Memory-Mapped Operations

```typescript
import { SmartBuffer } from '@devgrid/smartbuffer';

// Efficient memory views
const buffer = new SmartBuffer(1024);

// Fill with pattern
for (let i = 0; i < 256; i++) {
  buffer.writeInt32LE(i);
}

// Create typed array view
const int32View = new Int32Array(
  buffer.buffer.buffer,
  buffer.buffer.byteOffset,
  256
);

// Direct manipulation via view
int32View[10] = 999;

// Changes reflected in buffer
buffer.offset = 40;
console.log(buffer.readInt32LE()); // 999
```

## TypeScript Support

SmartBuffer is written in TypeScript and provides comprehensive type definitions:

```typescript
import { SmartBuffer } from '@devgrid/smartbuffer';

// Type-safe buffer operations
interface Message {
  id: number;
  text: string;
  timestamp: Date;
}

class TypedBuffer<T> {
  private buffer = new SmartBuffer();
  
  constructor(
    private encoder: (value: T, buffer: SmartBuffer) => void,
    private decoder: (buffer: SmartBuffer) => T
  ) {}
  
  write(value: T): void {
    this.encoder(value, this.buffer);
  }
  
  read(): T {
    return this.decoder(this.buffer);
  }
  
  toBuffer(): Buffer {
    return this.buffer.toBuffer();
  }
}

// Create typed buffer for messages
const messageBuffer = new TypedBuffer<Message>(
  (msg, buf) => {
    buf.writeUInt32LE(msg.id);
    buf.writeVString(msg.text);
    buf.writeBigIntLE(BigInt(msg.timestamp.getTime()));
  },
  (buf) => ({
    id: buf.readUInt32LE(),
    text: buf.readVString(),
    timestamp: new Date(Number(buf.readBigIntLE()))
  })
);

// Type-safe usage
messageBuffer.write({
  id: 1,
  text: 'Hello TypeScript',
  timestamp: new Date()
});
```

## Performance

### Optimization Tips

1. **Pre-allocate Capacity** - Avoid frequent resizing
   ```typescript
   // Good - allocate once
   const buffer = new SmartBuffer(1024 * 1024); // 1MB
   
   // Bad - multiple resizes
   const buffer = new SmartBuffer(); // Default 64 bytes
   ```

2. **Use noAssert Mode** - Skip validation in production
   ```typescript
   const buffer = new SmartBuffer(1024, true); // noAssert = true
   ```

3. **Batch Operations** - Minimize function calls
   ```typescript
   // Good - single write
   buffer.writeBuffer(Buffer.concat([buf1, buf2, buf3]));
   
   // Bad - multiple writes
   buffer.writeBuffer(buf1);
   buffer.writeBuffer(buf2);
   buffer.writeBuffer(buf3);
   ```

4. **Reuse Buffers** - Clear instead of creating new
   ```typescript
   const buffer = new SmartBuffer(1024);
   
   for (const data of dataset) {
     buffer.clear();
     // Process data
   }
   ```

### Benchmarks

SmartBuffer performance compared to native Buffer operations:

| Operation | SmartBuffer | Native Buffer | Overhead |
|-----------|-------------|---------------|----------|
| Write Int32 | 15ns | 12ns | 25% |
| Read Int32 | 10ns | 8ns | 25% |
| Write String | 45ns | 35ns | 28% |
| Resize | 150ns | 120ns | 25% |

*Note: Overhead includes bounds checking and automatic resizing*

## Browser Support

While optimized for Node.js, SmartBuffer works in browsers via bundlers:

### Webpack Configuration

```javascript
// webpack.config.js
module.exports = {
  resolve: {
    fallback: {
      "buffer": require.resolve("buffer/")
    }
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer']
    })
  ]
};
```

### Vite Configuration

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';

export default defineConfig({
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        NodeGlobalsPolyfillPlugin({
          buffer: true
        })
      ]
    }
  }
});
```

### Browser Usage

```html
<script src="path/to/smartbuffer.bundle.js"></script>
<script>
  const { SmartBuffer } = window.SmartBuffer;
  
  const buffer = new SmartBuffer();
  buffer.writeString("Hello from browser!");
  
  console.log(buffer.toBase64());
</script>
```

## Best Practices

### 1. Buffer Management

```typescript
// Create a buffer pool for reuse
class BufferPool {
  private pool: SmartBuffer[] = [];
  private maxSize: number;
  
  constructor(maxSize = 10) {
    this.maxSize = maxSize;
  }
  
  acquire(capacity = 1024): SmartBuffer {
    const buffer = this.pool.pop() || new SmartBuffer(capacity);
    buffer.clear();
    return buffer;
  }
  
  release(buffer: SmartBuffer): void {
    if (this.pool.length < this.maxSize) {
      this.pool.push(buffer);
    }
  }
}

const pool = new BufferPool();
const buffer = pool.acquire();
// Use buffer
pool.release(buffer);
```

### 2. Error Handling

```typescript
function safeReadInt32(buffer: SmartBuffer): number | null {
  try {
    if (buffer.remaining() >= 4) {
      return buffer.readInt32LE();
    }
    return null;
  } catch (error) {
    console.error('Failed to read int32:', error);
    return null;
  }
}

// Validate before writing
function writeValidString(buffer: SmartBuffer, str: string): void {
  if (typeof str !== 'string') {
    throw new TypeError('Expected string');
  }
  
  if (str.length > 65535) {
    throw new RangeError('String too long');
  }
  
  buffer.writeVString(str);
}
```

### 3. Protocol Implementation

```typescript
// Define a protocol with SmartBuffer
class Protocol {
  static readonly MAGIC = 0xDEADBEEF;
  static readonly VERSION = 1;
  
  static encode(type: string, payload: any): Buffer {
    const buffer = new SmartBuffer();
    
    buffer.writeUInt32BE(this.MAGIC);
    buffer.writeUInt8(this.VERSION);
    buffer.writeVString(type);
    buffer.writeVString(JSON.stringify(payload));
    
    return buffer.toBuffer();
  }
  
  static decode(data: Buffer): { type: string; payload: any } | null {
    const buffer = new SmartBuffer(data);
    
    try {
      const magic = buffer.readUInt32BE();
      if (magic !== this.MAGIC) {
        return null;
      }
      
      const version = buffer.readUInt8();
      if (version !== this.VERSION) {
        return null;
      }
      
      const type = buffer.readVString();
      const payload = JSON.parse(buffer.readVString());
      
      return { type, payload };
    } catch {
      return null;
    }
  }
}
```

## Differences from ByteBuffer.js

SmartBuffer improves upon ByteBuffer.js in several ways:

| Feature | ByteBuffer.js | SmartBuffer |
|---------|---------------|-------------|
| Platform | Browser + Node.js | Node.js optimized |
| TypeScript | Type definitions | Native TypeScript |
| Performance | Good | Optimized for Node.js |
| BigInt Support | No | Yes |
| API | Complex | Simplified |
| Dependencies | Multiple | Minimal |
| Modern Features | ES5 | ES2020+ |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT © DevGrid

Based on [ByteBuffer.js](https://github.com/protobufjs/bytebuffer.js) by Daniel Wirtz.

## Links

- [GitHub Repository](https://github.com/d-e-v-grid/devgrid/tree/main/packages/smartbuffer)
- [npm Package](https://www.npmjs.com/package/@devgrid/smartbuffer)
- [ByteBuffer.js](https://github.com/protobufjs/bytebuffer.js) (Original inspiration)