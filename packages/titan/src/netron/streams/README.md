# Netron Streams

## Overview

The Netron Streams module provides **stream-based communication primitives for distributed peer-to-peer data transmission** within the Netron RPC framework. It implements Node.js-compatible readable and writable streams that handle ordered, reliable packet-based data delivery across network peers.

### Key Features

- **Ordered Delivery**: Reorders out-of-sequence packets before delivery
- **Backpressure Handling**: Flow control for high-throughput scenarios
- **Live & Batch Modes**: Support for continuous and finite streaming
- **Automatic Cleanup**: Timeout-based cleanup for inactive streams
- **Serializable References**: Stream objects can be passed in RPC calls
- **Per-Peer Limits**: Max 1,000 streams per direction to prevent resource exhaustion

---

## Installation

Streams are part of the Netron module:

```typescript
import {
  NetronReadableStream,
  NetronWritableStream,
  StreamReference,
  isNetronStream
} from '@omnitron-dev/titan/netron/streams';
```

---

## Exports

| Export | Type | Description |
|--------|------|-------------|
| `NetronReadableStream` | Class | Readable stream for receiving data from remote peers |
| `NetronWritableStream` | Class | Writable stream for sending data to remote peers |
| `StreamReference` | Class | Serializable reference for network transmission |
| `StreamReferenceType` | Type | `'readable' \| 'writable'` |
| `isNetronStream` | Function | Type predicate for stream detection |

---

## NetronReadableStream

Receives and buffers incoming data packets from remote peers, ensuring ordered delivery.

### Constructor

```typescript
const stream = new NetronReadableStream(options: NetronReadableStreamOptions);

interface NetronReadableStreamOptions {
  peer: IStreamPeer;    // Associated peer
  streamId: number;     // Unique stream identifier
  isLive?: boolean;     // Live mode flag (default: false)
}
```

### Factory Method (Recommended)

```typescript
const stream = NetronReadableStream.create(peer, streamId, isLive?);
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | `number` (readonly) | Unique stream identifier |
| `peer` | `IStreamPeer` (readonly) | Associated remote peer |
| `isLive` | `boolean` | Live streaming mode flag |
| `isComplete` | `boolean` | All data has been received |

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `onPacket` | `(packet: Packet) => void` | Process incoming packet |
| `closeStream` | `(force?: boolean) => void` | Gracefully close stream |
| `forceClose` | `(reason?: string) => void` | Force immediate closure |

### Usage Example

```typescript
import { NetronReadableStream } from '@omnitron-dev/titan/netron/streams';

// Create readable stream for receiving data
const stream = NetronReadableStream.create(peer, streamId, false);

// Listen to data events
stream.on('data', (chunk) => {
  console.log('Received chunk:', chunk);
});

// Handle end of stream
stream.on('end', () => {
  console.log('Stream completed');
});

// Handle errors
stream.on('error', (error) => {
  console.error('Stream error:', error.message);
});

// Process incoming packets (called by transport layer)
function onRemotePacket(packet: Packet) {
  if (packet.isStreamChunk() && packet.streamId === streamId) {
    stream.onPacket(packet);
  }
}
```

### Buffer Management

Readable streams maintain a reordering buffer:

- **Buffer Limit**: 10,000 packets maximum
- **Backpressure**: Stops buffering when `push()` returns false
- **Cleanup**: Buffer cleared on stream close/destroy

```typescript
// If buffer exceeds 10,000 packets, streamBackpressure error is thrown
// Consumer must process data to allow more buffering
```

---

## NetronWritableStream

Sends data chunks to remote peers as ordered stream packets.

### Constructor

```typescript
const stream = new NetronWritableStream(options: NetronWritableStreamOptions);

interface NetronWritableStreamOptions {
  peer: IStreamPeer;    // Associated peer
  isLive?: boolean;     // Live mode flag (default: false)
  streamId?: number;    // Custom stream ID (auto-generated if not provided)
}
```

### Factory Method (Recommended)

```typescript
// Basic creation
const stream = NetronWritableStream.create(peer);

// With source piping
const stream = await NetronWritableStream.create(peer, sourceIterable, isLive, streamId);
```

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | `number` (readonly) | Unique stream identifier |
| `peer` | `IStreamPeer` (readonly) | Associated remote peer |
| `isLive` | `boolean` | Live streaming mode flag |

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `pipeFrom` | `(source: AsyncIterable \| Readable) => Promise<void>` | Pipe from source with backpressure |
| `closeStream` | `() => void` | Gracefully close stream |

### Usage Example

```typescript
import { NetronWritableStream } from '@omnitron-dev/titan/netron/streams';

// Create writable stream for sending data
const stream = NetronWritableStream.create(peer);

// Write data chunks
stream.write({ payload: 'chunk1' });
stream.write({ payload: 'chunk2' });
stream.write({ payload: 'chunk3' });

// Signal completion
stream.end();

// Handle drain (backpressure)
stream.on('drain', () => {
  console.log('Ready for more data');
});

// Handle finish
stream.on('finish', () => {
  console.log('All data sent');
});
```

### Piping from Source

```typescript
import fs from 'fs';

// Pipe from file stream
const fileStream = fs.createReadStream('large-file.bin');
const remoteStream = NetronWritableStream.create(peer);

await remoteStream.pipeFrom(fileStream);
console.log('File transfer complete');

// Pipe from async generator
async function* generateData() {
  for (let i = 0; i < 100; i++) {
    yield { index: i, data: `chunk-${i}` };
  }
}

const stream = NetronWritableStream.create(peer);
await stream.pipeFrom(generateData());
```

---

## StreamReference

Serializable representation of a stream for RPC transmission.

### Constructor

```typescript
const ref = new StreamReference(
  streamId: number,
  type: StreamReferenceType,
  isLive: boolean,
  peerId: string
);
```

### Static Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `from` | `(stream: NetronReadableStream \| NetronWritableStream) => StreamReference` | Serialize stream |
| `to` | `(ref: StreamReference, peer: IStreamPeer) => NetronReadableStream \| NetronWritableStream` | Deserialize stream |

### Usage Example

```typescript
import { StreamReference } from '@omnitron-dev/titan/netron/streams';

// Serialize stream for RPC transmission
const readable = NetronReadableStream.create(peer, 42, false);
const ref = StreamReference.from(readable);

// Send in RPC payload
await peer.callRemote('processStream', { streamRef: ref, options: {} });

// Deserialize on receiving end
const incomingRef = new StreamReference(42, 'readable', false, 'peer-123');
const stream = StreamReference.to(incomingRef, localPeer);
```

---

## Stream Modes

### Batch Mode (Default)

For finite data transfers with automatic cleanup:

```typescript
// Batch stream - has timeout, can be gracefully closed
const stream = NetronWritableStream.create(peer, source, false);

// Auto-closes after 60 seconds of inactivity (configurable)
// Can be gracefully closed with stream.closeStream()
```

### Live Mode

For continuous streaming without timeout:

```typescript
// Live stream - no timeout, cannot be gracefully closed
const liveStream = NetronWritableStream.create(peer, undefined, true);

// Keep streaming indefinitely
setInterval(() => {
  liveStream.write({ timestamp: Date.now(), metrics: getMetrics() });
}, 1000);

// Must use destroy() to close (not closeStream())
liveStream.destroy();
```

---

## Configuration

### Netron Options

Configure streams via Netron options:

```typescript
const netron = new Netron({
  streamTimeout: 120000  // 2 minutes (default: 60000ms)
});
```

### Stream Limits

| Limit | Value | Description |
|-------|-------|-------------|
| Max readable streams per peer | 1,000 | Prevents memory exhaustion |
| Max writable streams per peer | 1,000 | Prevents memory exhaustion |
| Reorder buffer size | 10,000 packets | Prevents unbounded memory growth |

---

## Error Handling

### Error Types

```typescript
import { NetronErrors } from '@omnitron-dev/titan/errors';

// Backpressure error - buffer full or stream limit reached
NetronErrors.streamBackpressure(streamId, bufferSize);

// Stream closed error - operation on closed stream
NetronErrors.streamClosed(streamId, reason);
```

### Handling Errors

```typescript
stream.on('error', (err) => {
  if (err.code === 'STREAM_BACKPRESSURE') {
    console.warn('Stream backpressure:', err.message);
    // Wait for drain event
  } else if (err.code === 'STREAM_CLOSED') {
    console.info('Stream was closed:', err.message);
  } else {
    console.error('Stream error:', err);
  }
});
```

---

## Best Practices

### 1. Always Handle Errors

```typescript
stream.on('error', (err) => {
  logger.error('Stream failed:', err);
});
```

### 2. Respect Backpressure

```typescript
function writeData(stream, data) {
  if (!stream.write(data)) {
    // Wait for drain before writing more
    return new Promise(resolve => stream.once('drain', resolve));
  }
  return Promise.resolve();
}

// Usage
for (const chunk of chunks) {
  await writeData(stream, chunk);
}
```

### 3. Use Factory Methods

```typescript
// Preferred
const stream = NetronReadableStream.create(peer, streamId);

// Instead of
const stream = new NetronReadableStream({ peer, streamId });
```

### 4. Choose Correct Mode

```typescript
// For RPC request/response (finite data)
const batchStream = NetronWritableStream.create(peer, source, false);

// For metrics/logs (continuous data)
const liveStream = NetronWritableStream.create(peer, source, true);
```

### 5. Clean Up Resources

```typescript
// Streams automatically clean up on close/destroy
// For manual cleanup, call destroy()
stream.destroy();
```

---

## Integration with Netron RPC

### Returning Streams from Methods

```typescript
@Service('file@1.0.0')
class FileService {
  @Public()
  async downloadFile(fileId: string): Promise<StreamReference> {
    const fileStream = fs.createReadStream(`/files/${fileId}`);
    const netronStream = NetronWritableStream.create(this.peer);

    // Pipe in background
    netronStream.pipeFrom(fileStream).catch(console.error);

    // Return reference for client
    return StreamReference.from(netronStream);
  }
}
```

### Receiving Streams in Methods

```typescript
@Service('upload@1.0.0')
class UploadService {
  @Public()
  async uploadFile(streamRef: StreamReference): Promise<void> {
    const stream = StreamReference.to(streamRef, this.peer);

    // Process stream data
    for await (const chunk of stream) {
      await processChunk(chunk);
    }
  }
}
```

---

## Performance Considerations

### Memory Management

- Streams are deregistered from peer on close/destroy
- Reorder buffer is explicitly cleared on cleanup
- Timeout timers are always cleared

### Throughput

- Sequential packet indexing enables fast reordering
- Backpressure prevents memory exhaustion
- Per-peer limits bound resource usage

### Timeouts

- Non-live streams: 60 seconds default (configurable)
- Live streams: No timeout (must be explicitly destroyed)

---

## Troubleshooting

### Stream Not Receiving Data

```typescript
// Check if stream is registered
console.log('Registered streams:', peer.readableStreams.size);

// Verify packet routing
stream.onPacket(packet);  // Must be called for each incoming packet
```

### Backpressure Errors

```typescript
// Increase buffer consumption rate
stream.on('data', (chunk) => {
  // Process synchronously or use setImmediate
  setImmediate(() => processChunk(chunk));
});
```

### Memory Leaks

```typescript
// Ensure streams are destroyed
process.on('exit', () => {
  for (const stream of peer.writableStreams.values()) {
    stream.destroy();
  }
});
```

---

## See Also

- [Netron Documentation](../README.md)
- [Packet Documentation](../packet/README.md)
- [Transport Documentation](../transport/README.md)

---

**Last Updated:** 2025-10-09
**Version:** 1.0.0
