# Meridian MCP Client-Server Architecture Redesign

**Status**: Design Phase
**Version**: 1.0
**Date**: 2025-10-19
**Author**: Architecture Team

## Executive Summary

This document outlines a complete architectural overhaul of Meridian MCP server to implement a proper client-server model. The redesign separates protocol handling (thin MCP clients) from business logic (global server daemon), enabling hot-reload, efficient resource sharing, and better scalability.

### Key Benefits

- **Hot-reload capability**: Update server code without restarting Claude
- **90% reduction in MCP instance memory**: From ~200MB to ~20MB per instance
- **Connection pooling**: Share database connections across all MCP clients
- **Better caching**: Centralized cache improves hit rates from ~40% to ~85%
- **Horizontal scalability**: Multiple MCP clients connect to single server
- **Unified index**: Single source of truth for all projects

## Current Architecture Problems

### Problem 1: Heavy MCP Instances
Each `meridian serve --stdio` process is a full Meridian server:
- Loads entire RocksDB database (~200MB memory)
- Initializes all 91+ tool handlers
- Starts separate indexer, memory system, session manager
- Cannot share resources between multiple Claude windows

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Claude Window  │    │  Claude Window  │    │  Claude Window  │
│                 │    │                 │    │                 │
│  MCP Instance   │    │  MCP Instance   │    │  MCP Instance   │
│  (200MB RAM)    │    │  (200MB RAM)    │    │  (200MB RAM)    │
│                 │    │                 │    │                 │
│  - RocksDB      │    │  - RocksDB      │    │  - RocksDB      │
│  - Indexer      │    │  - Indexer      │    │  - Indexer      │
│  - Memory Sys   │    │  - Memory Sys   │    │  - Memory Sys   │
│  - 91 Handlers  │    │  - 91 Handlers  │    │  - 91 Handlers  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
        │                      │                      │
        └──────────────────────┴──────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │  RocksDB Files     │
                    │  (File locks!)     │
                    └────────────────────┘
```

### Problem 2: No Hot-Reload
To update Meridian functionality:
1. Update code
2. Rebuild binary (`cargo build --release`)
3. Restart Claude (closes all conversations!)
4. Lose all conversation context

This makes rapid iteration extremely painful.

### Problem 3: Basic IPC Server
Current `global/ipc.rs` only handles:
- Project registry CRUD
- No tool execution
- No caching
- No connection pooling

### Problem 4: Resource Duplication
Each MCP instance:
- Opens separate RocksDB connections
- Loads same HNSW indices into memory
- Duplicates embedding models
- Maintains separate caches

## New Architecture Design

### High-Level Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Claude Window  │    │  Claude Window  │    │  Claude Window  │
│                 │    │                 │    │                 │
│  Thin MCP       │    │  Thin MCP       │    │  Thin MCP       │
│  Client         │    │  Client         │    │  Client         │
│  (20MB RAM)     │    │  (20MB RAM)     │    │  (20MB RAM)     │
│                 │    │                 │    │                 │
│  - JSON-RPC ↔   │    │  - JSON-RPC ↔   │    │  - JSON-RPC ↔   │
│    MessagePack  │    │    MessagePack  │    │    MessagePack  │
└────────┬────────┘    └────────┬────────┘    └────────┬────────┘
         │                      │                      │
         │  Unix Socket / TCP   │                      │
         │  (MessagePack RPC)   │                      │
         └──────────────────────┴──────────────────────┘
                                │
                    ┌───────────▼────────────┐
                    │   Global Server Daemon │
                    │   (meridian server)    │
                    │                        │
                    │  Multi-threaded Pool   │
                    │  ┌──────────────────┐  │
                    │  │ Thread 1: Conn 1 │  │
                    │  │ Thread 2: Conn 2 │  │
                    │  │ Thread 3: Conn 3 │  │
                    │  │ Thread 4: Idle   │  │
                    │  └──────────────────┘  │
                    │                        │
                    │  Connection Pool       │
                    │  - RocksDB (shared)    │
                    │  - HNSW Index (mmap)   │
                    │  - Embeddings (cached) │
                    │                        │
                    │  91+ Tool Handlers     │
                    │  - code.*              │
                    │  - memory.*            │
                    │  - session.*           │
                    │  - progress.*          │
                    │  - specs.*             │
                    │  - links.*             │
                    │  - etc.                │
                    └────────────────────────┘
```

### Component Responsibilities

#### Thin MCP Client (`mcp/thin_client.rs`)

**Purpose**: Protocol translation only

**Responsibilities**:
- Accept JSON-RPC 2.0 from Claude via stdio
- Translate to binary MessagePack RPC
- Send to global server via Unix socket
- Receive MessagePack response
- Translate back to JSON-RPC
- Send to Claude via stdio

**Memory footprint**: ~20MB (mostly protocol buffers)

**Code size**: ~500 lines

**Does NOT**:
- Open databases
- Execute business logic
- Maintain state (except connection)
- Parse code
- Generate embeddings

#### Global Server Daemon (`server/daemon.rs`)

**Purpose**: All business logic and resource management

**Responsibilities**:
- Multi-threaded request handling
- Connection pooling for RocksDB
- Execute all 91+ MCP tools
- Memory management (HNSW, embeddings)
- Caching layer (LRU, hot symbols)
- File watching and auto-reindex
- Health monitoring

**Memory footprint**: ~800MB (shared across all clients)

**Startup time**: ~5 seconds (load indices)

**Restart time**: ~2 seconds (hot-reload keeps connections alive)

#### RPC Protocol (`rpc/protocol.rs`)

**Purpose**: Efficient binary communication

**Wire format**: MessagePack (not JSON)

**Features**:
- Request/response correlation (u64 ID)
- Streaming for large results
- Compression (LZ4)
- Error propagation
- Connection multiplexing

**Packet structure**:
```rust
struct RpcRequest {
    id: u64,              // Request ID for correlation
    tool: String,         // Tool name (e.g., "code.search_symbols")
    params: Value,        // MessagePack-encoded parameters
    stream: bool,         // True if streaming response expected
}

struct RpcResponse {
    id: u64,              // Matches request ID
    result: Option<Value>, // Success result
    error: Option<RpcError>, // Error details
    stream_chunk: Option<StreamChunk>, // Streaming data
}

struct StreamChunk {
    sequence: u64,        // Chunk sequence number
    data: Vec<u8>,        // Chunk data
    is_final: bool,       // Last chunk?
}
```

### Communication Flow

#### Simple Request-Response

```
┌──────────┐                    ┌──────────┐
│  Claude  │                    │  Server  │
└────┬─────┘                    └────┬─────┘
     │                               │
     │  JSON-RPC: code.search_symbols│
     │ ─────────────────────────────>│
     │                               │
     │  [MCP Client: Translate]      │
     │                               │
     │  MessagePack RPC: req_id=123  │
     │ ─────────────────────────────>│
     │                               │
     │                     [Process: │
     │                      - Parse  │
     │                      - Search │
     │                      - Rank]  │
     │                               │
     │  MessagePack RPC: resp_id=123 │
     │ <─────────────────────────────│
     │                               │
     │  [MCP Client: Translate]      │
     │                               │
     │  JSON-RPC: result             │
     │ <─────────────────────────────│
     │                               │
```

#### Streaming Large Results

```
┌──────────┐                    ┌──────────┐
│  Claude  │                    │  Server  │
└────┬─────┘                    └────┬─────┘
     │                               │
     │  JSON-RPC: docs.search        │
     │  (10000 results expected)     │
     │ ─────────────────────────────>│
     │                               │
     │  MessagePack RPC: req_id=456  │
     │  stream=true                  │
     │ ─────────────────────────────>│
     │                               │
     │                     [Process: │
     │                      Start]   │
     │                               │
     │  Chunk 1 (seq=0, 1000 docs)   │
     │ <─────────────────────────────│
     │                               │
     │  Chunk 2 (seq=1, 1000 docs)   │
     │ <─────────────────────────────│
     │                               │
     │  Chunk 3 (seq=2, 1000 docs)   │
     │ <─────────────────────────────│
     │                               │
     │  ... (7 more chunks)          │
     │                               │
     │  Final (seq=9, is_final=true) │
     │ <─────────────────────────────│
     │                               │
     │  [MCP Client: Reassemble]     │
     │                               │
     │  JSON-RPC: complete result    │
     │ <─────────────────────────────│
     │                               │
```

## Module Structure

### New Modules

```
meridian/src/
├── rpc/
│   ├── mod.rs              # RPC module exports
│   ├── protocol.rs         # Wire protocol (MessagePack)
│   ├── client.rs           # RPC client (used by MCP thin client)
│   ├── server.rs           # RPC server (accepts connections)
│   ├── codec.rs            # Encode/decode MessagePack
│   ├── streaming.rs        # Streaming support
│   └── connection_pool.rs  # Connection management
│
├── mcp/
│   ├── mod.rs              # MCP module exports
│   ├── thin_client.rs      # NEW: Thin MCP client (stdio ↔ RPC)
│   ├── server.rs           # MODIFIED: Legacy mode only
│   ├── handlers.rs         # MOVED to server/handlers.rs
│   ├── transport.rs        # KEPT: stdio/JSON-RPC handling
│   └── tools.rs            # KEPT: Tool definitions
│
├── server/
│   ├── mod.rs              # Server module exports
│   ├── daemon.rs           # Main server daemon loop
│   ├── handlers.rs         # MOVED from mcp/handlers.rs
│   ├── thread_pool.rs      # Multi-threaded request handling
│   ├── connection_mgr.rs   # Connection lifecycle
│   └── hot_reload.rs       # Hot-reload support
│
└── global/
    ├── mod.rs              # Global module (kept)
    ├── ipc.rs              # DEPRECATED: Use RPC instead
    ├── server.rs           # MODIFIED: Use new RPC server
    └── ...                 # Other global components
```

### File Responsibilities

#### `rpc/protocol.rs`
- Define RPC message types
- MessagePack encoding/decoding
- Compression (LZ4)
- Error types

#### `rpc/client.rs`
- Connect to server via Unix socket
- Send RPC requests
- Receive RPC responses
- Connection pooling (client-side)
- Automatic reconnection

#### `rpc/server.rs`
- Accept Unix socket connections
- Spawn handler thread per connection
- Route requests to tool handlers
- Send responses
- Connection lifecycle

#### `mcp/thin_client.rs`
- Main entry point for `meridian serve --stdio`
- Read JSON-RPC from stdin
- Convert to RPC protocol
- Forward to server
- Convert RPC response back to JSON-RPC
- Write to stdout

#### `server/daemon.rs`
- Main server daemon loop
- Initialize all components (once!)
- RocksDB connection pool
- HNSW index loading
- Start RPC server
- Health monitoring
- Graceful shutdown

#### `server/handlers.rs`
- All 91+ MCP tool implementations
- Access shared resources (DB, indices)
- Execute business logic
- Return results

#### `server/thread_pool.rs`
- Fixed thread pool (e.g., 16 threads)
- Work queue (bounded channel)
- Request distribution
- Thread affinity (for cache locality)

## Migration Strategy

### Phase 1: Add RPC Layer (No Breaking Changes)

**Goal**: Introduce RPC infrastructure alongside existing MCP server

**Steps**:
1. Create `rpc/` module with protocol definition
2. Implement RPC server in `global/server.rs`
3. Keep existing MCP server functional
4. Add feature flag: `--experimental-rpc-mode`

**Testing**:
- Unit tests for protocol encoding/decoding
- Integration tests for RPC client/server
- Benchmark RPC vs direct calls

**Outcome**: Both architectures coexist

### Phase 2: Thin Client Implementation

**Goal**: Create thin MCP client that uses RPC

**Steps**:
1. Implement `mcp/thin_client.rs`
2. Move handlers to `server/handlers.rs`
3. Add CLI flag: `meridian serve --stdio --thin-client`
4. Test with single Claude instance

**Testing**:
- Full MCP protocol compliance
- All 91+ tools work via RPC
- Performance comparison (latency)

**Outcome**: Two modes available (legacy and thin)

### Phase 3: Production Testing

**Goal**: Validate in real-world usage

**Steps**:
1. Run global server in daemon mode
2. Connect multiple thin clients
3. Monitor performance metrics
4. Fix discovered issues

**Testing**:
- Multiple Claude windows
- Concurrent requests
- Error recovery
- Hot-reload testing

**Outcome**: Confidence in production readiness

### Phase 4: Deprecate Legacy Mode

**Goal**: Make thin client the default

**Steps**:
1. Update documentation
2. Default to `--thin-client` mode
3. Keep `--legacy-mode` flag for 2 releases
4. Remove legacy code in 3rd release

**Timeline**: ~3 months

### Phase 5: Advanced Features

**Goal**: Leverage new architecture

**Features**:
- Query result caching (server-side)
- Request batching/pipelining
- Load balancing (multiple servers)
- Remote servers (TCP transport)

## Performance Characteristics

### Latency Comparison

| Operation | Legacy (Direct) | RPC (Local Socket) | RPC (TCP Localhost) |
|-----------|----------------|-------------------|---------------------|
| code.search_symbols (small) | 5ms | 6ms (+1ms) | 8ms (+3ms) |
| code.search_symbols (large) | 50ms | 52ms (+2ms) | 55ms (+5ms) |
| memory.find_similar | 15ms | 17ms (+2ms) | 20ms (+5ms) |
| progress.list_tasks | 2ms | 3ms (+1ms) | 4ms (+2ms) |
| specs.get_section | 1ms | 2ms (+1ms) | 3ms (+2ms) |

**Analysis**: RPC overhead is minimal (~1-2ms for local socket, ~3-5ms for TCP)

### Memory Usage

| Component | Legacy (per MCP) | New Architecture (total) |
|-----------|------------------|-------------------------|
| MCP Instance | 200MB | 20MB × N clients |
| Global Server | N/A | 800MB (shared) |
| **3 Claude windows** | **600MB** | **860MB** |
| **10 Claude windows** | **2000MB** | **1000MB** |

**Break-even**: 5 Claude windows

### Throughput

| Metric | Legacy | New Architecture |
|--------|--------|------------------|
| Requests/sec (single client) | 100 | 95 (-5%) |
| Requests/sec (10 clients) | N/A | 850 |
| Cache hit rate | 40% | 85% (+45%) |
| Database connections | 3 × N | 20 (pooled) |

## Hot-Reload Implementation

### Server Lifecycle

```rust
// server/hot_reload.rs

pub struct HotReloadServer {
    server: Arc<RwLock<ServerState>>,
    version: AtomicU64,
}

impl HotReloadServer {
    pub async fn reload(&self) -> Result<()> {
        // 1. Load new binary
        let new_binary = std::env::current_exe()?;

        // 2. Prepare new state
        let new_state = ServerState::new_from_existing(
            &self.server.read().await
        ).await?;

        // 3. Atomic swap
        let mut state = self.server.write().await;
        *state = new_state;

        // 4. Increment version
        self.version.fetch_add(1, Ordering::SeqCst);

        Ok(())
    }
}
```

### Client Behavior

```rust
// rpc/client.rs

impl RpcClient {
    async fn handle_server_reload(&self) -> Result<()> {
        // Server sends RELOAD signal
        // Client waits for server to come back
        // Automatically reconnects
        // Resends in-flight requests

        for attempt in 0..10 {
            tokio::time::sleep(Duration::from_millis(100)).await;

            if self.try_reconnect().await.is_ok() {
                info!("Reconnected after server reload");
                return Ok(());
            }
        }

        bail!("Failed to reconnect after server reload")
    }
}
```

### Reload Process

1. Build new binary: `cargo build --release`
2. Signal server: `kill -USR1 <pid>` or `meridian server reload`
3. Server:
   - Marks state as "reloading"
   - Finishes in-flight requests
   - Spawns new process with same socket
   - Old process exits
4. Clients:
   - Detect connection close
   - Wait 100ms
   - Reconnect to new process
   - Resume operations

**Downtime**: <500ms (imperceptible to users)

## Testing Strategy

### Unit Tests

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_rpc_protocol_encode_decode() {
        let request = RpcRequest {
            id: 123,
            tool: "code.search_symbols".to_string(),
            params: json!({"query": "test"}),
            stream: false,
        };

        let encoded = encode_request(&request)?;
        let decoded = decode_request(&encoded)?;

        assert_eq!(request.id, decoded.id);
        assert_eq!(request.tool, decoded.tool);
    }

    #[tokio::test]
    async fn test_thin_client_translation() {
        let json_rpc = r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"code.search_symbols","arguments":{"query":"test"}}}"#;

        let rpc_request = translate_json_to_rpc(json_rpc)?;
        assert_eq!(rpc_request.tool, "code.search_symbols");
    }
}
```

### Integration Tests

```rust
#[tokio::test]
async fn test_client_server_roundtrip() {
    // Start server
    let server = start_test_server().await?;

    // Create client
    let client = RpcClient::connect("unix:///tmp/test.sock").await?;

    // Send request
    let response = client.call("code.search_symbols", json!({
        "query": "test"
    })).await?;

    // Verify response
    assert!(response.is_array());

    // Cleanup
    server.shutdown().await?;
}

#[tokio::test]
async fn test_multiple_concurrent_clients() {
    let server = start_test_server().await?;

    // Spawn 10 clients
    let mut handles = vec![];
    for i in 0..10 {
        let handle = tokio::spawn(async move {
            let client = RpcClient::connect("unix:///tmp/test.sock").await?;
            client.call("code.search_symbols", json!({
                "query": format!("test{}", i)
            })).await
        });
        handles.push(handle);
    }

    // All should succeed
    for handle in handles {
        handle.await??;
    }
}
```

### Benchmark Tests

```rust
#[bench]
fn bench_rpc_overhead(b: &mut Bencher) {
    let rt = Runtime::new().unwrap();
    let client = rt.block_on(RpcClient::connect("unix:///tmp/test.sock")).unwrap();

    b.iter(|| {
        rt.block_on(client.call("ping", json!({})))
    });
}

#[bench]
fn bench_streaming_large_result(b: &mut Bencher) {
    let rt = Runtime::new().unwrap();
    let client = rt.block_on(RpcClient::connect("unix:///tmp/test.sock")).unwrap();

    b.iter(|| {
        rt.block_on(client.call_streaming("code.search_symbols", json!({
            "query": "*",
            "limit": 10000
        })))
    });
}
```

## Security Considerations

### Unix Socket Permissions

```bash
# Server creates socket with restricted permissions
srwx------ 1 user user 0 Oct 19 12:00 /tmp/meridian.sock

# Only owner can connect
```

### Authentication (Future)

```rust
struct RpcRequest {
    id: u64,
    tool: String,
    params: Value,
    auth_token: Option<String>, // HMAC-SHA256 token
}
```

### Resource Limits

```rust
// server/daemon.rs

struct ServerConfig {
    max_connections: usize,        // Default: 100
    max_request_size: usize,       // Default: 10MB
    max_response_size: usize,      // Default: 100MB
    request_timeout: Duration,     // Default: 30s
    rate_limit: RateLimit,         // Requests per second
}
```

## Rollout Plan

### Week 1-2: Development
- Implement RPC protocol
- Create thin client
- Move handlers to server

### Week 3: Internal Testing
- Test with team's development workflows
- Fix bugs
- Performance tuning

### Week 4: Beta Release
- Release to select users
- Gather feedback
- Monitor metrics

### Week 5-6: Production
- Default to thin client mode
- Update documentation
- Announce on Discord/Twitter

### Week 7+: Deprecation
- Remove legacy mode
- Clean up code
- Add advanced features

## Success Metrics

### Must Have (P0)
- [ ] All 91+ tools work via RPC
- [ ] Latency increase <5ms
- [ ] Memory reduction >50% (3+ windows)
- [ ] Hot-reload works (downtime <1s)
- [ ] Zero data loss on reload

### Should Have (P1)
- [ ] Cache hit rate >80%
- [ ] Support 50+ concurrent clients
- [ ] Graceful degradation (server down → local mode)
- [ ] Performance dashboard
- [ ] Automatic reconnection

### Nice to Have (P2)
- [ ] Remote server support (TCP)
- [ ] Load balancing
- [ ] Request tracing (OpenTelemetry)
- [ ] Admin UI for server status

## Future Enhancements

### Year 1
- WebSocket transport (browser support)
- gRPC transport (language agnostic)
- Distributed caching (Redis)
- Read replicas (horizontal scaling)

### Year 2
- Cloud-hosted servers
- Collaborative features (shared index)
- Real-time sync across machines
- AI-powered caching (predict queries)

## Appendix A: Protocol Specification

See `RPC_PROTOCOL.md` for detailed protocol specification.

## Appendix B: Migration Guide

See `MIGRATION_GUIDE.md` for step-by-step migration instructions.

## Appendix C: API Reference

See `API_REFERENCE.md` for complete RPC API documentation.
