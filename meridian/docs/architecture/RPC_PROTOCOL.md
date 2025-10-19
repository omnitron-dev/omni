# Meridian RPC Protocol Specification

**Version**: 1.0
**Wire Format**: MessagePack
**Transport**: Unix Socket (primary), TCP (optional)

## Overview

The Meridian RPC protocol is a binary, bidirectional communication protocol between thin MCP clients and the global server daemon. It uses MessagePack for efficient serialization and supports streaming for large results.

## Design Goals

1. **Efficiency**: Binary format (MessagePack) vs JSON reduces size by ~40%
2. **Streaming**: Support large result sets without buffering entire response
3. **Multiplexing**: Multiple concurrent requests on single connection
4. **Backpressure**: Flow control for streaming responses
5. **Extensibility**: Protocol versioning for future enhancements

## Message Types

### Request Message

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcRequest {
    /// Protocol version (current: 1)
    pub version: u8,

    /// Unique request ID (for correlation)
    pub id: u64,

    /// Tool name (e.g., "code.search_symbols")
    pub tool: String,

    /// MessagePack-encoded parameters
    pub params: rmpv::Value,

    /// Enable streaming response?
    pub stream: bool,

    /// Maximum result size (bytes), None = unlimited
    pub max_size: Option<usize>,

    /// Request timeout (milliseconds), None = server default
    pub timeout_ms: Option<u64>,

    /// Optional authentication token
    pub auth: Option<String>,
}
```

**Wire format** (MessagePack map):
```
{
    0x00: version (uint8),
    0x01: id (uint64),
    0x02: tool (string),
    0x03: params (any),
    0x04: stream (bool),
    0x05: max_size (uint64 or null),
    0x06: timeout_ms (uint64 or null),
    0x07: auth (string or null)
}
```

### Response Message

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcResponse {
    /// Protocol version
    pub version: u8,

    /// Request ID (matches RpcRequest.id)
    pub id: u64,

    /// Result (if successful)
    pub result: Option<rmpv::Value>,

    /// Error (if failed)
    pub error: Option<RpcError>,

    /// Streaming chunk (if request.stream = true)
    pub chunk: Option<StreamChunk>,

    /// Server performance metrics
    pub metrics: Option<ResponseMetrics>,
}
```

**Wire format** (MessagePack map):
```
{
    0x00: version (uint8),
    0x01: id (uint64),
    0x02: result (any or null),
    0x03: error (map or null),
    0x04: chunk (map or null),
    0x05: metrics (map or null)
}
```

### Error Message

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    /// Error code
    pub code: ErrorCode,

    /// Human-readable message
    pub message: String,

    /// Additional error data
    pub data: Option<rmpv::Value>,

    /// Stack trace (debug builds only)
    pub trace: Option<Vec<String>>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[repr(u16)]
pub enum ErrorCode {
    // Protocol errors (1000-1999)
    InvalidRequest = 1000,
    UnsupportedVersion = 1001,
    MalformedParams = 1002,
    RequestTooLarge = 1003,

    // Server errors (2000-2999)
    InternalError = 2000,
    NotFound = 2001,
    Timeout = 2002,
    ResourceExhausted = 2003,
    ServiceUnavailable = 2004,

    // Business logic errors (3000-3999)
    SymbolNotFound = 3000,
    ProjectNotFound = 3001,
    InvalidQuery = 3002,
    PermissionDenied = 3003,

    // Client errors (4000-4999)
    Unauthorized = 4000,
    RateLimited = 4001,
}
```

### Stream Chunk

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChunk {
    /// Chunk sequence number (0-indexed)
    pub sequence: u64,

    /// Chunk data (partial result)
    pub data: Vec<u8>,

    /// Is this the final chunk?
    pub is_final: bool,

    /// Total chunks (if known)
    pub total_chunks: Option<u64>,

    /// Compression used (if any)
    pub compression: Option<CompressionType>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum CompressionType {
    None,
    Lz4,
    Zstd,
}
```

### Response Metrics

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseMetrics {
    /// Server processing time (microseconds)
    pub processing_time_us: u64,

    /// Database query time (microseconds)
    pub db_time_us: u64,

    /// Cache hit?
    pub cache_hit: bool,

    /// Number of results
    pub result_count: usize,

    /// Response size (bytes, uncompressed)
    pub response_size: usize,
}
```

## Wire Protocol

### Framing

Each message is prefixed with a 4-byte length header (little-endian):

```
┌────────────┬──────────────────────────────┐
│ Length (4B)│ MessagePack Payload (N bytes)│
└────────────┴──────────────────────────────┘
```

**Example**:
```
0x00 0x00 0x01 0x2A  [298 bytes of MessagePack data]
└─────────────────┘
        │
     length = 298
```

### Connection Handshake

1. **Client → Server**: Handshake request
```rust
{
    "type": "handshake",
    "client_version": "1.0.0",
    "protocol_version": 1,
    "capabilities": ["streaming", "compression"],
    "client_id": "claude-window-1234"
}
```

2. **Server → Client**: Handshake response
```rust
{
    "type": "handshake_ack",
    "server_version": "0.1.0",
    "protocol_version": 1,
    "capabilities": ["streaming", "compression", "hot_reload"],
    "session_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "max_request_size": 10485760,  // 10MB
    "max_response_size": 104857600 // 100MB
}
```

### Request-Response Flow

#### Simple Request

```
Client                           Server
  │                                 │
  │  RpcRequest (id=123)            │
  │ ───────────────────────────────>│
  │                                 │
  │                        [Process]│
  │                                 │
  │  RpcResponse (id=123, result)   │
  │ <───────────────────────────────│
  │                                 │
```

#### Streaming Request

```
Client                           Server
  │                                 │
  │  RpcRequest (id=456, stream=true)
  │ ───────────────────────────────>│
  │                                 │
  │                    [Start stream]│
  │                                 │
  │  RpcResponse (id=456, chunk 0)  │
  │ <───────────────────────────────│
  │                                 │
  │  RpcResponse (id=456, chunk 1)  │
  │ <───────────────────────────────│
  │                                 │
  │  RpcResponse (id=456, chunk 2)  │
  │ <───────────────────────────────│
  │                                 │
  │  ...                            │
  │                                 │
  │  RpcResponse (id=456, final)    │
  │ <───────────────────────────────│
  │                                 │
```

#### Error Response

```
Client                           Server
  │                                 │
  │  RpcRequest (id=789)            │
  │ ───────────────────────────────>│
  │                                 │
  │                         [Error!]│
  │                                 │
  │  RpcResponse (id=789, error)    │
  │ <───────────────────────────────│
  │                                 │
```

### Multiplexing

Multiple requests can be in-flight simultaneously:

```
Client                           Server
  │                                 │
  │  Request A (id=1)               │
  │ ───────────────────────────────>│
  │                                 │
  │  Request B (id=2)               │
  │ ───────────────────────────────>│
  │                                 │
  │  Request C (id=3)               │
  │ ───────────────────────────────>│
  │                                 │
  │  Response B (id=2) [Fast query] │
  │ <───────────────────────────────│
  │                                 │
  │  Response A (id=1)              │
  │ <───────────────────────────────│
  │                                 │
  │  Response C (id=3)              │
  │ <───────────────────────────────│
  │                                 │
```

## Transport Layers

### Unix Domain Socket (Primary)

**Path**: `/tmp/meridian-{user}.sock` or `$MERIDIAN_HOME/socket/meridian.sock`

**Advantages**:
- Lowest latency (~1-2ms overhead)
- No network stack
- Automatic cleanup on process exit
- Secure (filesystem permissions)

**Connection**:
```rust
use tokio::net::UnixStream;

let stream = UnixStream::connect("/tmp/meridian.sock").await?;
```

### TCP Socket (Optional)

**Port**: 7878 (configurable)

**Advantages**:
- Remote connections
- Load balancing
- Cross-machine communication

**Disadvantages**:
- Higher latency (~3-5ms overhead)
- Requires authentication
- Network firewall configuration

**Connection**:
```rust
use tokio::net::TcpStream;

let stream = TcpStream::connect("127.0.0.1:7878").await?;
```

## Compression

### When to Compress

- Responses > 1KB
- Client supports compression (in capabilities)
- Server configured with compression enabled

### Compression Algorithms

1. **LZ4** (default): Fast compression, ~50% size reduction
2. **Zstd**: Better compression, ~65% size reduction (slower)

### Compression Negotiation

```rust
// Client request
{
    "compression_preference": ["zstd", "lz4", "none"]
}

// Server response
{
    "compression_used": "lz4"
}
```

## Flow Control

### Backpressure Mechanism

For streaming responses, client can pause server with `PAUSE` message:

```rust
{
    "type": "flow_control",
    "request_id": 456,
    "action": "pause" | "resume" | "cancel"
}
```

Server honors pause/resume and stops sending chunks until resumed.

### Rate Limiting

Server may reject requests if client exceeds rate limit:

```rust
RpcError {
    code: ErrorCode::RateLimited,
    message: "Rate limit exceeded: 100 requests/second",
    data: {
        "limit": 100,
        "window": 1000,  // milliseconds
        "retry_after": 500  // milliseconds
    }
}
```

## Hot-Reload Protocol

### Server Reload Signal

When server is about to reload:

```rust
{
    "type": "server_reload",
    "reason": "hot_reload",
    "estimated_downtime_ms": 500,
    "reconnect_after_ms": 600
}
```

### Client Behavior

1. Receive reload signal
2. Stop sending new requests
3. Wait for in-flight requests to complete
4. Close connection gracefully
5. Wait `reconnect_after_ms`
6. Reconnect and resume

## Error Handling

### Retryable Errors

These errors can be retried automatically:
- `Timeout`
- `ResourceExhausted`
- `ServiceUnavailable`

**Retry strategy**: Exponential backoff with jitter
- Attempt 1: Wait 100ms
- Attempt 2: Wait 200ms + random(0-50ms)
- Attempt 3: Wait 400ms + random(0-100ms)
- Max attempts: 5

### Non-Retryable Errors

These errors should NOT be retried:
- `InvalidRequest`
- `MalformedParams`
- `PermissionDenied`
- `Unauthorized`

## Performance Characteristics

### Latency Breakdown

```
Total latency = Network + Serialization + Processing + Deserialization

Unix Socket:
  Network: 0.1ms
  Serialization (MessagePack): 0.3ms
  Processing: [varies by tool]
  Deserialization: 0.3ms
  Total overhead: ~0.7ms

TCP Localhost:
  Network: 1-2ms
  Serialization: 0.3ms
  Processing: [varies]
  Deserialization: 0.3ms
  Total overhead: ~2-3ms
```

### Throughput

- **Small requests** (<1KB): 10,000+ requests/sec
- **Medium requests** (1-10KB): 5,000+ requests/sec
- **Large requests** (>100KB): 500+ requests/sec
- **Streaming**: Sustains 100MB/sec

### Message Size Limits

- Max request size: 10MB (configurable)
- Max response size: 100MB (configurable)
- Max stream chunk: 1MB
- Max in-flight requests: 1000 per connection

## Security

### Authentication (Optional)

```rust
// Client sends HMAC-SHA256 token
RpcRequest {
    auth: Some(hmac_sha256(secret_key, payload))
}

// Server validates
if !validate_hmac(request.auth, secret_key, payload) {
    return RpcError::Unauthorized;
}
```

### Encryption (Optional)

For remote connections, use TLS:
```rust
use tokio_rustls::TlsStream;

let stream = TlsStream::connect(config, "meridian.example.com", tcp_stream).await?;
```

## Example Implementations

### Client-Side (Rust)

```rust
use meridian_rpc::{RpcClient, RpcRequest};
use serde_json::json;

#[tokio::main]
async fn main() -> Result<()> {
    // Connect to server
    let client = RpcClient::connect("unix:///tmp/meridian.sock").await?;

    // Simple request
    let response = client.call(RpcRequest {
        version: 1,
        id: 1,
        tool: "code.search_symbols".to_string(),
        params: rmpv::ext::to_value(&json!({
            "query": "async fn",
            "limit": 10
        }))?,
        stream: false,
        max_size: None,
        timeout_ms: Some(5000),
        auth: None,
    }).await?;

    println!("Result: {:?}", response.result);

    Ok(())
}
```

### Server-Side (Rust)

```rust
use meridian_rpc::{RpcServer, RpcRequest, RpcResponse};

#[tokio::main]
async fn main() -> Result<()> {
    // Create server
    let mut server = RpcServer::bind("unix:///tmp/meridian.sock").await?;

    // Handle requests
    server.on_request(|request: RpcRequest| async move {
        match request.tool.as_str() {
            "code.search_symbols" => {
                // Execute search
                let results = search_symbols(&request.params).await?;

                Ok(RpcResponse {
                    version: 1,
                    id: request.id,
                    result: Some(rmpv::ext::to_value(&results)?),
                    error: None,
                    chunk: None,
                    metrics: Some(ResponseMetrics { /* ... */ }),
                })
            }
            _ => {
                Ok(RpcResponse::error(
                    request.id,
                    RpcError::not_found("Unknown tool")
                ))
            }
        }
    });

    // Start server
    server.serve().await?;

    Ok(())
}
```

## Versioning

### Protocol Version

Current version: **1**

Version negotiation:
- Client requests version in handshake
- Server responds with supported version
- Use minimum of (client_version, server_version)

### Breaking Changes

New major version required for:
- Incompatible wire format changes
- Removal of message fields
- Change in error codes

### Non-Breaking Changes

Minor version bump for:
- New optional fields
- New error codes
- Performance improvements

## Monitoring

### Metrics to Track

**Client-side**:
- Request latency (p50, p95, p99)
- Error rate by error code
- Retry attempts
- Connection failures

**Server-side**:
- Request throughput (requests/sec)
- Processing time by tool
- Queue depth
- Memory usage
- Active connections

### Health Check

Client can send ping request:

```rust
RpcRequest {
    tool: "ping",
    params: {},
    ...
}

RpcResponse {
    result: {
        "status": "ok",
        "uptime": 86400,
        "version": "0.1.0"
    }
}
```

## Appendix: MessagePack Encoding Examples

### Simple Request

JSON equivalent:
```json
{
    "version": 1,
    "id": 123,
    "tool": "ping",
    "params": {},
    "stream": false
}
```

MessagePack (hex):
```
85                    // Map with 5 elements
  00                  // Key: 0 (version)
  01                  // Value: 1
  01                  // Key: 1 (id)
  7B                  // Value: 123
  02                  // Key: 2 (tool)
  A4 70 69 6E 67      // Value: "ping"
  03                  // Key: 3 (params)
  80                  // Value: {}
  04                  // Key: 4 (stream)
  C2                  // Value: false
```

Total size: 18 bytes (vs 98 bytes JSON) = 82% reduction

### Complex Response

JSON equivalent:
```json
{
    "version": 1,
    "id": 456,
    "result": [
        {"name": "foo", "score": 0.95},
        {"name": "bar", "score": 0.85}
    ]
}
```

MessagePack size: ~65 bytes (vs ~120 bytes JSON) = 46% reduction

## References

- MessagePack specification: https://msgpack.org
- JSON-RPC 2.0: https://www.jsonrpc.org/specification
- Unix domain sockets: https://man7.org/linux/man-pages/man7/unix.7.html
