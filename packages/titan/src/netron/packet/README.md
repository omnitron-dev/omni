# Netron Packet Protocol

## Table of Contents

- [Overview](#overview)
- [Packet Structure](#packet-structure)
  - [Binary Format](#binary-format)
  - [Header Fields](#header-fields)
  - [Payload Format](#payload-format)
- [Packet Types](#packet-types)
- [Serialization](#serialization)
  - [Custom MessagePack Implementation](#custom-messagepack-implementation)
  - [Type Mapping](#type-mapping)
  - [Custom Types](#custom-types)
- [Streaming Protocol](#streaming-protocol)
- [API Reference](#api-reference)
- [Current Limitations](#current-limitations)
- [Implementation Files](#implementation-files)

## Overview

The Netron Packet Protocol is a binary protocol designed for efficient RPC communication over binary transports (WebSocket, TCP, Unix sockets). It uses a custom MessagePack implementation for serialization and implements a compact header structure for minimal overhead.

### Design Goals

- **Efficiency**: Minimal overhead with binary encoding
- **Type Safety**: Strong typing with serialization validation
- **Streaming Support**: Native support for async iterables
- **Transport Agnostic**: Works with WebSocket, TCP, and Unix sockets
- **Extensibility**: Support for custom types through MessagePack extensions

### Important Notes

⚠️ **HTTP Transport Exception**: The HTTP transport (`packages/titan/src/netron/transport/http`) uses native JSON/HTTP messages instead of binary packets for better REST compatibility and debugging. This packet protocol is **only used for binary transports**.

## Packet Structure

### Binary Format

Each packet consists of a compact header and serialized payload:

```
┌─────────────────────────────────────────┐
│              PACKET HEADER              │
├──────────────┬──────────────────────────┤
│      ID      │         FLAGS            │
│   (4 bytes)  │        (1 byte)          │
├──────────────┴──────────────────────────┤
│              SERIALIZED DATA            │
│            (Variable Length)            │
├─────────────────────────────────────────┤
│         STREAM METADATA (Optional)      │
│    Stream ID (4 bytes)                  │
│    Stream Index (4 bytes)               │
└─────────────────────────────────────────┘
```

**Actual Implementation** (`index.ts:80-98`):
```typescript
export const encodePacket = (packet: Packet) => {
  const buf = new SmartBuffer(128);

  buf.writeUInt32BE(packet.id);           // 4 bytes: Packet ID
  buf.writeUInt8(packet.flags);           // 1 byte: Control flags
  serializer.encode(packet.data, buf);    // Variable: Serialized payload

  if (packet.isStreamChunk()) {
    buf.writeUInt32BE(packet.streamId!);  // 4 bytes: Stream ID
    buf.writeUInt32BE(packet.streamIndex!); // 4 bytes: Stream index
  }

  return buf.toBuffer();
};
```

### Header Fields

#### ID (32 bits, big-endian)

Unique packet identifier for correlation:

- **Request packets**: Generate using `Packet.nextId()`
- **Response packets**: Echo request ID
- **Stream packets**: Share common packet ID within stream
- Range: 0 to 4,294,967,295

#### FLAGS (8 bits)

The flags byte contains control information:

```
Bit 7   6   5   4   3   2   1   0
┌───┬───┬───┬───┬───┬───┬───┬───┐
│ERR│IMP│LIV│EOS│ TYPE (4 bits) │
└───┴───┴───┴───┴───┴───┴───┴───┘
```

**Detailed Flag Descriptions** (`packet.ts:86-91`):

- **TYPE (bits 0-3)**: Packet type (0x00-0x0F)
- **EOS (bit 4)**: End of stream flag
- **LIV (bit 5)**: Live stream indicator
- **IMP (bit 6)**: Impulse (0=Response, 1=Request)
- **ERR (bit 7)**: Error flag

**Bit Manipulation** (`packet.ts:16-84`):
```typescript
const IMPULSE_OFFSET = 6;
const ERROR_OFFSET = 7;
const TYPE_OFFSET = 0;
const TYPE_SIZE = 4;
const EOS_OFFSET = 4;
const LIVE_OFFSET = 5;
```

### Payload Format

Payloads are MessagePack-encoded and can be of any type. The structure depends on the packet type and application logic. Common patterns:

```typescript
// RPC Call payload
['service@1.0.0', 'methodName', [arg1, arg2, ...]]

// Stream chunk payload
{ streamId: 123, data: ... }

// Error payload
{ code: 'ERROR_CODE', message: 'Error message', stack: '...' }
```

## Packet Types

### Core Types

**From `types.ts:39-46`:**

```typescript
export const TYPE_PING = 0x00;         // Health check (DEFINED BUT NOT USED)
export const TYPE_GET = 0x01;          // Property getter
export const TYPE_SET = 0x02;          // Property setter
export const TYPE_CALL = 0x03;         // Method invocation
export const TYPE_TASK = 0x04;         // Task execution
export const TYPE_STREAM = 0x05;       // Streaming data
export const TYPE_STREAM_ERROR = 0x06; // Stream error
export const TYPE_STREAM_CLOSE = 0x07; // Stream closure
```

### Type Details

#### TYPE_GET (0x01)

Property retrieval - currently defined but usage depends on RemotePeer implementation.

#### TYPE_SET (0x02)

Property modification - currently defined but usage depends on RemotePeer implementation.

#### TYPE_CALL (0x03)

Remote method invocation - primary packet type for RPC calls.

**Usage** (`remote-peer.ts:480`):
```typescript
const packet = createPacket(Packet.nextId(), 1, TYPE_CALL, data);
```

#### TYPE_TASK (0x04)

Task execution - for async task management.

#### TYPE_STREAM (0x05)

Streaming data chunk with sequence tracking.

**Usage** (`index.ts:47-61`):
```typescript
export const createStreamPacket = (
  id: number,
  streamId: number,
  streamIndex: number,
  isLast: boolean,
  isLive: boolean,
  data: any
) => {
  const packet = new Packet(id);
  packet.setImpulse(1);
  packet.setType(TYPE_STREAM);
  packet.setStreamInfo(streamId, streamIndex, isLast, isLive);
  packet.data = data;
  return packet;
};
```

#### TYPE_STREAM_ERROR (0x06)

Stream error notification - sent when stream encounters an error.

**Usage** (`writable-stream.ts:132`):
```typescript
createPacket(Packet.nextId(), 1, TYPE_STREAM_ERROR, {
  streamId: this.id,
  message: err.message,
  stack: err.stack
})
```

#### TYPE_STREAM_CLOSE (0x07)

Stream closure notification - explicit stream termination.

**Usage** (`writable-stream.ts:213`):
```typescript
createPacket(Packet.nextId(), 1, TYPE_STREAM_CLOSE, {
  streamId: this.id,
  reason: closeReason,
})
```

## Serialization

### Custom MessagePack Implementation

Netron uses a **custom MessagePack implementation** from `@omnitron-dev/msgpack`, not the standard `@msgpack/msgpack` library.

**From `serializer.ts:1-15`:**
```typescript
import { SmartBuffer } from '@omnitron-dev/msgpack/smart-buffer';
import { Serializer, registerCommonTypesFor } from '@omnitron-dev/msgpack';

export const serializer = new Serializer();
registerCommonTypesFor(serializer);
```

### Type Mapping

The custom serializer handles standard JavaScript types with MessagePack encoding:

| JavaScript Type | MessagePack Type | Notes |
|----------------|------------------|-------|
| null | nil | 1 byte |
| boolean | bool | 1 byte |
| number (int) | int8-64 | 1-9 bytes |
| number (float) | float64 | 9 bytes |
| string | str | 1-5 + length |
| Buffer | bin | 1-5 + length |
| Array | array | 1-5 + items |
| Object | map | 1-5 + pairs |

### Custom Types

#### Definition (Extension Type 109)

Service definition metadata.

**From `serializer.ts:40-74`:**
```typescript
serializer.register(
  109,
  Definition,
  (obj: Definition, buf: SmartBuffer) => {
    serializer.encode(obj.id, buf);
    serializer.encode(obj.parentId, buf);
    serializer.encode(obj.peerId, buf);
    serializer.encode(obj.meta, buf);
  },
  (buf: SmartBuffer) => {
    const id = serializer.decode(buf);
    const parentId = serializer.decode(buf);
    const peerId = serializer.decode(buf);
    const meta = serializer.decode(buf);
    const def = new Definition(id, peerId, meta);
    def.parentId = parentId;
    return def;
  }
);
```

#### Reference (Extension Type 108)

Service reference for remote service access.

**From `serializer.ts:85-107`:**
```typescript
serializer.register(
  108,
  Reference,
  (obj: any, buf: SmartBuffer) => {
    serializer.encode(obj.defId, buf);
  },
  (buf: SmartBuffer) => new Reference(serializer.decode(buf))
);
```

#### StreamReference (Extension Type 107)

Stream connection reference with lazy registration to avoid circular dependencies.

**From `serializer.ts:110-172`:**
```typescript
// Lazy registration via ensureStreamReferenceRegistered()
serializer.register(
  107,
  StreamReferenceClass,
  (obj: any, buf: SmartBuffer) => {
    serializer.encode(obj.streamId.toString(), buf);
    buf.writeUInt8(obj.type === 'writable' ? 1 : 0);
    buf.writeUInt8(obj.isLive ? 1 : 0);
    serializer.encode(obj.peerId, buf);
  },
  (buf: SmartBuffer) => {
    const streamId = Number(serializer.decode(buf));
    const streamType = buf.readUInt8() === 1 ? 'writable' : 'readable';
    const isLive = buf.readUInt8() === 1;
    const peerId = serializer.decode(buf);
    return new StreamReferenceClass(streamId, streamType, isLive, peerId);
  }
);
```

## Streaming Protocol

### Stream Management

Streams are managed through packet sequences with metadata:

**Stream Initialization** (`remote-peer.ts`):
1. Send TYPE_CALL packet with method invocation
2. Receive StreamReference in response
3. Start receiving TYPE_STREAM packets with same streamId

**Stream Data Flow**:
```typescript
// Each stream packet contains:
{
  id: packetId,           // Unique packet ID
  type: TYPE_STREAM,      // 0x05
  flags: {
    live: boolean,        // Bit 5
    eos: boolean          // Bit 4 (end of stream)
  },
  streamId: number,       // Unique stream identifier
  streamIndex: number,    // Sequential chunk number
  data: any              // Actual chunk data
}
```

**Stream Termination**:

Normal completion:
```typescript
createPacket(id, 1, TYPE_STREAM_CLOSE, {
  streamId,
  reason: 'completed'
})
```

Error termination:
```typescript
createPacket(id, 1, TYPE_STREAM_ERROR, {
  streamId,
  message: errorMessage,
  stack: errorStack
})
```

## API Reference

### Factory Functions

#### `createPacket(id, impulse, type, data)`

Creates a standard packet.

**Parameters**:
- `id: number` - Unique packet identifier
- `impulse: PacketImpulse` - 0 (response) or 1 (request)
- `type: PacketType` - Packet type constant
- `data: any` - Payload data

**Returns**: `Packet`

**Example**:
```typescript
const packet = createPacket(
  Packet.nextId(),
  1,
  TYPE_CALL,
  ['service@1.0.0', 'method', [arg1, arg2]]
);
```

#### `createStreamPacket(id, streamId, streamIndex, isLast, isLive, data)`

Creates a stream packet with metadata.

**Parameters**:
- `id: number` - Unique packet identifier
- `streamId: number` - Stream identifier
- `streamIndex: number` - Chunk sequence number
- `isLast: boolean` - Is this the last chunk
- `isLive: boolean` - Is this a live stream
- `data: any` - Chunk data

**Returns**: `Packet`

#### `encodePacket(packet)`

Encodes packet to binary buffer for transmission.

**Parameters**:
- `packet: Packet` - Packet to encode

**Returns**: `Buffer`

#### `decodePacket(buffer)`

Decodes binary buffer to packet.

**Parameters**:
- `buffer: Buffer | ArrayBuffer` - Binary data to decode

**Returns**: `Packet`

**Throws**: `Error` if buffer is incomplete or invalid

### Packet Class

#### Constructor

```typescript
constructor(id: number)
```

#### Properties

```typescript
public flags: number          // Control flags (uint8)
public data: any             // Payload data
public streamId?: number     // Stream ID (if stream packet)
public streamIndex?: number  // Stream chunk index (if stream packet)
public id: number            // Packet ID (readonly via constructor)
```

#### Methods

**Type Management**:
```typescript
setType(type: PacketType): void
getType(): PacketType
```

**Impulse Management**:
```typescript
setImpulse(val: PacketImpulse): void  // 0 or 1
getImpulse(): PacketImpulse
```

**Error Flag**:
```typescript
setError(val: 0 | 1): void
getError(): number
```

**Stream Information**:
```typescript
setStreamInfo(streamId: number, streamIndex: number, isLast: boolean, isLive: boolean): void
isStreamChunk(): boolean
isLastChunk(): boolean
isLive(): boolean
```

**Static Methods**:
```typescript
static nextId(): number  // Generate unique ID
static resetId(): void   // Reset ID generator (use with caution)
```

## Current Limitations

### ❌ Missing Features Described in Old Documentation

The following features are **documented but not implemented**:

1. **No LENGTH field** in packet header
2. **No CHECKSUM field** or validation
3. **No TYPE_PING usage** - defined but never used
4. **No StreamType enum usage** - defined but unused
5. **No packet pooling** (PacketPool)
6. **No buffer management** (BufferManager)
7. **No compression support** (CompressedPacket)
8. **No packet validation** (PacketValidator)
9. **No rate limiting** (PacketRateLimiter)
10. **No input sanitization** (PacketSanitizer)
11. **No protocol versioning** or handshake
12. **No backpressure handling** (StreamController)

### ⚠️ Known Issues

1. **HTTP Transport Incompatibility**: HTTP transport uses native JSON messages, not packets
2. **Binary Detection Heuristic**: `base-transport.ts:78-83` uses simple heuristics to detect text vs binary
3. **No Packet Size Limits**: Unlike documented, there's no MAX_PACKET_SIZE validation
4. **ID Collision Risk**: `Packet.resetId()` can cause ID collisions if packets are in flight
5. **StreamReference Circular Dependency**: Requires lazy registration to avoid import cycles

### ✅ Working Features

1. **Binary packet encoding/decoding**
2. **Stream support** with sequence tracking
3. **Custom type serialization** (Definition, Reference, StreamReference)
4. **Transport abstraction** (WebSocket, TCP, Unix sockets)
5. **Error propagation** via TYPE_STREAM_ERROR
6. **Graceful stream closure** via TYPE_STREAM_CLOSE

## Implementation Files

### Core Files

- **`packet.ts`** - Packet class with bit manipulation
- **`types.ts`** - Type definitions and constants
- **`serializer.ts`** - MessagePack serialization with custom types
- **`index.ts`** - Public API and encode/decode functions

### Usage Examples

**Binary Transport** (`base-transport.ts:62-66`):
```typescript
async sendPacket(packet: Packet): Promise<void> {
  const encoded = encodePacket(packet);
  await this.send(encoded);
  this.metrics.packetsSent++;
}
```

**Packet Decoding** (`base-transport.ts:89-93`):
```typescript
try {
  const packet = decodePacket(data);
  this.metrics.packetsReceived++;
  this.emit('packet', packet);
} catch (error) {
  this.emit('data', data); // Fallback for non-packet data
}
```

**Remote Procedure Call** (`remote-peer.ts:480`):
```typescript
const packet = createPacket(Packet.nextId(), 1, type, data);
this.responseHandlers.set(packet.id, {
  successHandler,
  errorHandler
});
await this.sendPacket(packet);
```

**Stream Error Handling** (`writable-stream.ts:132-135`):
```typescript
this.peer.sendPacket(
  createPacket(Packet.nextId(), 1, TYPE_STREAM_ERROR, {
    streamId: this.id,
    message: err.message,
    stack: err.stack
  })
);
```

## Migration Notes

### From Old Documentation

If you were relying on the old README documentation:

1. **Remove checksum verification** - not implemented
2. **Don't use LENGTH field** - doesn't exist
3. **Custom extension type IDs are different**:
   - Definition: 109 (not 3)
   - Reference: 108 (not 2)
   - StreamReference: 107 (not 4)
4. **No protocol versioning** - all peers must use same version
5. **Use @omnitron-dev/msgpack** not @msgpack/msgpack
6. **Payload structure is flexible** - not restricted to arrays

### Best Practices

1. **Always use factory functions**: `createPacket()` and `createStreamPacket()`
2. **Check packet type** before processing payload
3. **Handle decode errors**: `decodePacket()` throws on invalid data
4. **Use Packet.nextId()**: Don't manually generate IDs
5. **Clean up streams**: Always send TYPE_STREAM_CLOSE or TYPE_STREAM_ERROR

## See Also

- [Netron Main Documentation](../README.md)
- [Transport Layer](../transport/README.md)
- [Binary Transports](../transport/websocket-transport.ts)
- [HTTP Transport](../transport/http/) - Uses JSON, not packets!
- [MessagePack Implementation](../../../../msgpack/README.md)
