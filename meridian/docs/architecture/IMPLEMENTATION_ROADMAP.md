# Implementation Roadmap: Client-Server Architecture

**Duration**: 6 weeks
**Effort**: ~160 hours (40 hours estimate × 4 sprints)

## Sprint 1: Foundation (Week 1-2)

### Goals
- Implement RPC protocol layer
- Create basic client/server infrastructure
- Unit tests for protocol encoding/decoding

### Tasks

#### Task 1.1: RPC Protocol Implementation (8 hours)
**Files**: `src/rpc/protocol.rs`, `src/rpc/codec.rs`

- [ ] Define RpcRequest/RpcResponse structs
- [ ] Implement MessagePack encoding/decoding
- [ ] Add compression support (LZ4)
- [ ] Error types and handling
- [ ] Unit tests (>90% coverage)

**Deliverable**: Protocol crate builds, all tests pass

#### Task 1.2: RPC Client Implementation (8 hours)
**Files**: `src/rpc/client.rs`, `src/rpc/connection.rs`

- [ ] Unix socket connection management
- [ ] Request/response correlation (ID tracking)
- [ ] Automatic reconnection logic
- [ ] Connection pooling (client-side)
- [ ] Integration tests with mock server

**Deliverable**: Client can send/receive messages

#### Task 1.3: RPC Server Implementation (12 hours)
**Files**: `src/rpc/server.rs`, `src/rpc/handler.rs`

- [ ] Unix socket listener
- [ ] Accept incoming connections
- [ ] Spawn handler per connection
- [ ] Route requests to handlers
- [ ] Send responses
- [ ] Graceful shutdown

**Deliverable**: Server accepts connections and echoes requests

#### Task 1.4: Streaming Support (8 hours)
**Files**: `src/rpc/streaming.rs`

- [ ] StreamChunk implementation
- [ ] Server-side streaming (send chunks)
- [ ] Client-side reassembly
- [ ] Backpressure mechanism
- [ ] Streaming tests (large datasets)

**Deliverable**: Can stream 10,000+ results efficiently

#### Task 1.5: Integration Testing (4 hours)
**Files**: `tests/rpc_integration.rs`

- [ ] Client-server roundtrip tests
- [ ] Concurrent requests test
- [ ] Streaming test
- [ ] Error propagation test
- [ ] Performance benchmarks

**Deliverable**: All integration tests pass, latency <2ms

## Sprint 2: Server Daemon (Week 3-4)

### Goals
- Migrate tool handlers to server
- Implement thread pool
- Add connection management

### Tasks

#### Task 2.1: Server Daemon Structure (8 hours)
**Files**: `src/server/daemon.rs`, `src/server/mod.rs`

- [ ] Main daemon loop
- [ ] Initialize all subsystems (once!)
- [ ] RocksDB connection pool
- [ ] HNSW index loading
- [ ] Start RPC server
- [ ] Health monitoring

**Deliverable**: Server starts and accepts connections

#### Task 2.2: Move Tool Handlers (12 hours)
**Files**: `src/server/handlers.rs` (moved from `src/mcp/handlers.rs`)

- [ ] Copy all 91+ tool implementations
- [ ] Update imports (use shared resources)
- [ ] Remove Arc<RwLock<>> wrappers (use pool)
- [ ] Add RPC request/response translation
- [ ] Test each tool via RPC

**Deliverable**: All tools work via RPC protocol

#### Task 2.3: Thread Pool Implementation (8 hours)
**Files**: `src/server/thread_pool.rs`

- [ ] Fixed-size thread pool (16 threads)
- [ ] Bounded work queue (1000 requests)
- [ ] Request distribution (round-robin)
- [ ] Thread affinity (for cache locality)
- [ ] Pool statistics (queue depth, utilization)

**Deliverable**: Concurrent requests handled efficiently

#### Task 2.4: Connection Management (6 hours)
**Files**: `src/server/connection_mgr.rs`

- [ ] Track active connections
- [ ] Per-connection state (session ID)
- [ ] Connection limits (max 100)
- [ ] Idle connection timeout (5 min)
- [ ] Connection metrics

**Deliverable**: Server manages 100+ connections

#### Task 2.5: Resource Pooling (6 hours)
**Files**: `src/server/resource_pool.rs`

- [ ] RocksDB connection pool (20 connections)
- [ ] HNSW index pool (shared, mmap)
- [ ] Embedding model pool (1 instance, mutex)
- [ ] Cache pool (LRU, 1GB)

**Deliverable**: Resources efficiently shared

## Sprint 3: Thin Client (Week 5-6)

### Goals
- Implement thin MCP client
- Protocol translation (JSON-RPC ↔ RPC)
- Integration with existing MCP tooling

### Tasks

#### Task 3.1: Thin Client Structure (6 hours)
**Files**: `src/mcp/thin_client.rs`

- [ ] Main entry point (replaces server)
- [ ] Initialize RPC client
- [ ] JSON-RPC stdio handling (reuse transport.rs)
- [ ] Graceful shutdown

**Deliverable**: Basic thin client runs

#### Task 3.2: Protocol Translation (8 hours)
**Files**: `src/mcp/translation.rs`

- [ ] JSON-RPC → RpcRequest conversion
- [ ] RpcResponse → JSON-RPC conversion
- [ ] Error mapping
- [ ] Streaming support (chunk reassembly)
- [ ] Handle all 91+ tool name variants

**Deliverable**: All MCP tools work through thin client

#### Task 3.3: Connection Management (6 hours)
**Files**: `src/mcp/connection.rs`

- [ ] Connect to server on startup
- [ ] Automatic reconnection (with backoff)
- [ ] Handle server reload gracefully
- [ ] Connection health checks (ping)

**Deliverable**: Robust connection handling

#### Task 3.4: CLI Integration (4 hours)
**Files**: `src/main.rs` (update)

- [ ] Add `--thin-client` flag
- [ ] Add `--legacy-mode` flag (default for now)
- [ ] Auto-detect global server
- [ ] Fallback to legacy if server unavailable

**Deliverable**: CLI supports both modes

#### Task 3.5: End-to-End Testing (8 hours)
**Files**: `tests/e2e_thin_client.rs`

- [ ] Start server daemon
- [ ] Start thin client
- [ ] Send JSON-RPC requests
- [ ] Verify responses
- [ ] Test all 91+ tools
- [ ] Test streaming
- [ ] Test error handling

**Deliverable**: All E2E tests pass

## Sprint 4: Hot-Reload & Polish (Week 7-8)

### Goals
- Implement hot-reload mechanism
- Performance optimization
- Documentation and examples

### Tasks

#### Task 4.1: Hot-Reload Implementation (10 hours)
**Files**: `src/server/hot_reload.rs`

- [ ] Signal handler (SIGUSR1)
- [ ] State preservation
- [ ] Graceful process swap
- [ ] Client notification
- [ ] Test hot-reload cycle

**Deliverable**: Can reload server in <500ms

#### Task 4.2: Performance Optimization (8 hours)

- [ ] Profile server with `perf`
- [ ] Optimize hot paths (encoding/decoding)
- [ ] Add caching layers
- [ ] Tune thread pool size
- [ ] Optimize database queries

**Deliverable**: Latency overhead <2ms

#### Task 4.3: Monitoring & Metrics (6 hours)
**Files**: `src/server/monitoring.rs`

- [ ] Request metrics (latency, throughput)
- [ ] Resource metrics (CPU, memory, connections)
- [ ] Tool-specific metrics
- [ ] Metrics export (Prometheus format)
- [ ] Admin dashboard (simple HTML)

**Deliverable**: Comprehensive metrics available

#### Task 4.4: Documentation (8 hours)
**Files**: Various `*.md` files

- [ ] Update README with new architecture
- [ ] Write migration guide
- [ ] Write troubleshooting guide
- [ ] API reference documentation
- [ ] Performance tuning guide

**Deliverable**: Complete documentation

#### Task 4.5: Examples & Tutorials (4 hours)
**Files**: `examples/`

- [ ] Example: Simple RPC client
- [ ] Example: Custom tool via RPC
- [ ] Example: Load testing
- [ ] Tutorial: Migrating from legacy mode

**Deliverable**: Working examples

#### Task 4.6: Production Readiness (4 hours)

- [ ] Systemd service file
- [ ] Log rotation configuration
- [ ] Error recovery mechanisms
- [ ] Graceful degradation (server down)
- [ ] Security hardening checklist

**Deliverable**: Production-ready deployment

## Post-Launch: Advanced Features

### Phase 5: Advanced Features (Week 9+)

- [ ] TCP transport (remote connections)
- [ ] TLS encryption
- [ ] Authentication/authorization
- [ ] Load balancing (multiple servers)
- [ ] Read replicas (horizontal scaling)
- [ ] Distributed caching (Redis)
- [ ] Request tracing (OpenTelemetry)
- [ ] gRPC transport (language-agnostic)

## Risk Mitigation

### Risk 1: Protocol Incompatibility
**Mitigation**: Extensive integration testing, protocol versioning

### Risk 2: Performance Regression
**Mitigation**: Benchmark every commit, performance budget (<2ms overhead)

### Risk 3: Data Loss on Reload
**Mitigation**: State preservation tests, write-ahead logging

### Risk 4: Client Disconnection
**Mitigation**: Automatic reconnection, request replay

### Risk 5: Memory Leaks
**Mitigation**: Memory profiling, leak tests with valgrind

## Success Criteria

### Must Have (Sprint 1-4)
- [ ] All 91+ tools work via RPC
- [ ] Latency overhead <2ms (Unix socket)
- [ ] Memory per thin client <30MB
- [ ] Server memory <1GB (50 clients)
- [ ] Hot-reload downtime <500ms
- [ ] Zero data loss on reload
- [ ] 100% backward compatibility

### Should Have (Post-Launch)
- [ ] Cache hit rate >80%
- [ ] Support 100+ concurrent clients
- [ ] Graceful degradation (fallback to legacy)
- [ ] Performance dashboard
- [ ] Admin UI for server status

### Nice to Have (Future)
- [ ] Remote server support (TCP)
- [ ] Load balancing
- [ ] Distributed tracing
- [ ] Multi-language clients (Python, TypeScript)

## Testing Strategy

### Unit Tests
- Every module has >90% code coverage
- Test error conditions
- Test edge cases

### Integration Tests
- Client-server communication
- Concurrent requests
- Streaming large results
- Error propagation
- Reconnection logic

### End-to-End Tests
- Full MCP protocol flow
- All 91+ tools
- Multiple clients
- Hot-reload cycle

### Performance Tests
- Latency benchmarks (p50, p95, p99)
- Throughput tests (requests/sec)
- Memory usage (client + server)
- Load tests (1000+ concurrent clients)

### Stress Tests
- Extended runtime (24+ hours)
- Memory leak detection
- Resource exhaustion
- Failure injection

## Rollout Plan

### Week 9: Internal Testing
- Team uses thin client mode
- Fix bugs reported
- Performance tuning

### Week 10: Beta Release
- Release to select users
- Gather feedback
- Monitor metrics

### Week 11-12: Production
- Make thin client default
- Update documentation
- Announce on Discord/Twitter

### Week 13+: Deprecation
- Mark legacy mode deprecated
- Remove in 3 months
- Clean up code

## Metrics to Track

### Development Metrics
- Code coverage (>90%)
- Build time (<5 min)
- Test pass rate (100%)
- Bug count (decreasing trend)

### Performance Metrics
- Request latency (p50, p95, p99)
- Throughput (requests/sec)
- Memory usage (client + server)
- Cache hit rate

### Reliability Metrics
- Uptime (>99.9%)
- Error rate (<0.1%)
- Recovery time (<1s)
- Data loss (0)

## Dependencies

### Existing Crates
- `tokio` - Async runtime
- `serde` - Serialization
- `rmp-serde` - MessagePack
- `lz4` - Compression
- `anyhow` - Error handling

### New Crates
- `rmpv` - MessagePack value types
- `dashmap` - Concurrent hashmap (connection tracking)
- `parking_lot` - Fast mutexes (resource pool)

## File Structure (Final State)

```
meridian/src/
├── rpc/
│   ├── mod.rs                 # Public API
│   ├── protocol.rs            # Message types
│   ├── codec.rs               # Encoding/decoding
│   ├── client.rs              # RPC client
│   ├── server.rs              # RPC server
│   ├── streaming.rs           # Streaming support
│   ├── connection.rs          # Connection management
│   └── tests.rs               # RPC tests
│
├── server/
│   ├── mod.rs                 # Server module
│   ├── daemon.rs              # Main daemon loop
│   ├── handlers.rs            # Tool handlers (91+)
│   ├── thread_pool.rs         # Thread pool
│   ├── connection_mgr.rs      # Connection tracking
│   ├── resource_pool.rs       # Resource pooling
│   ├── hot_reload.rs          # Hot-reload support
│   ├── monitoring.rs          # Metrics & monitoring
│   └── tests.rs               # Server tests
│
├── mcp/
│   ├── mod.rs                 # MCP module
│   ├── thin_client.rs         # NEW: Thin MCP client
│   ├── translation.rs         # JSON-RPC ↔ RPC
│   ├── server.rs              # Legacy server (deprecated)
│   ├── handlers.rs            # REMOVED (moved to server/)
│   ├── transport.rs           # stdio/JSON-RPC handling
│   └── tools.rs               # Tool definitions
│
└── global/
    ├── ipc.rs                 # DEPRECATED
    ├── server.rs              # MODIFIED: Use RPC server
    └── ...
```

## Estimated Timeline

| Sprint | Duration | Deliverable |
|--------|----------|-------------|
| Sprint 1 | 2 weeks | RPC protocol working |
| Sprint 2 | 2 weeks | Server daemon with all tools |
| Sprint 3 | 2 weeks | Thin client functional |
| Sprint 4 | 2 weeks | Hot-reload + polish |
| **Total** | **8 weeks** | **Production-ready** |

## Approval Checklist

Before merging to main:

- [ ] All tests pass (unit, integration, E2E)
- [ ] Code coverage >90%
- [ ] Performance benchmarks meet targets
- [ ] Documentation complete
- [ ] Security review passed
- [ ] Backward compatibility verified
- [ ] Beta testing complete (1 week minimum)
- [ ] Migration guide tested by external users

## Next Steps

1. Review and approve this roadmap
2. Create GitHub issues for each task
3. Assign sprints to developers
4. Set up CI/CD for automated testing
5. Begin Sprint 1 implementation
