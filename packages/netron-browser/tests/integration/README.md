# Netron Browser Integration Tests

Comprehensive integration tests verifying full protocol compatibility between the netron-browser client and Titan server.

## Test Suite Overview

### 1. Client-Server Integration (`client-server.test.ts`)
**Purpose**: Basic RPC functionality and transport compatibility testing.

**Coverage**:
- HTTP Client Integration (235 test cases)
  - Calculator Service operations (add, subtract, multiply, divide, async operations)
  - User Service CRUD operations (create, read, update, delete, list)
  - Echo Service for data type testing (string, number, boolean, object, array)
  - Stream Service simulated operations
  - Performance benchmarks (sequential, parallel, high concurrency)
  - Error handling (non-existent service/method, invalid arguments)

- WebSocket Client Integration (80 test cases)
  - Calculator Service operations
  - User Service operations
  - Echo Service complex object handling
  - Connection state management
  - Metrics tracking

- Mixed Transport Tests (5 test cases)
  - Result consistency across HTTP and WebSocket
  - Concurrent operations on both transports
  - Complex object handling across transports
  - Error propagation consistency
  - High load handling on both transports simultaneously

- Advanced Integration Scenarios (15 test cases)
  - Multi-step workflows (create → update → verify → delete)
  - Mixed service call workflows
  - State consistency across operations
  - Date and special numeric value handling
  - Nested and mixed type arrays
  - Sparse array handling
  - Connection metrics and error tracking

**Key Assertions**:
- Response correctness and data integrity
- Error propagation and error message preservation
- Performance thresholds (latency < 1s for sequential, < 500ms for parallel)
- Metrics tracking (requests sent, responses received, errors)

---

### 2. WebSocket Protocol (`websocket-protocol.test.ts`)
**Purpose**: Deep testing of WebSocket binary protocol and packet encoding/decoding.

**Coverage**:
- Binary Protocol (6 test cases)
  - Binary packet handling over WebSocket
  - Data type preservation (primitives, objects, arrays)
  - Large payload handling (10,000+ items)
  - Unicode and special character support
  - Edge case values (0, -0, Infinity, NaN, etc.)

- Packet Structure (5 test cases)
  - Unique ID generation (tested with 1,000 IDs)
  - Packet ID reset functionality
  - All 16 packet type handling
  - Flag preservation during modifications
  - Combined flag operations

- Serialization (4 test cases)
  - Primitive type serialization
  - Complex object serialization
  - Array serialization (empty, nested, mixed types)
  - Circular reference handling

- Connection State (3 test cases)
  - Connection state reporting
  - Metrics tracking
  - Connection event handling

- Concurrent Operations (3 test cases)
  - 50 concurrent requests
  - Mixed concurrent operations
  - 100 rapid sequential calls

- Service Discovery (3 test cases)
  - Multiple service invocations
  - Non-existent service handling
  - Non-existent method handling

- Performance (2 test cases)
  - Low latency maintenance (avg < 50ms, max < 200ms)
  - High throughput (1,000 requests in < 5s)

**Key Assertions**:
- Packet flag integrity (type, impulse, error, stream flags)
- Serialization round-trip accuracy
- Performance thresholds (latency, throughput)
- Unique ID generation (no collisions in 1,000 IDs)

---

### 3. Streaming Integration (`streaming.test.ts`)
**Purpose**: Testing streaming functionality and large data transfers.

**Coverage**:
- Simulated Streaming (WebSocket) (5 test cases)
  - Array-based number generation
  - Large dataset efficiency (1,000 items < 1s)
  - Complex data object generation
  - Empty stream handling
  - Very large payloads (10,000 items)

- Streaming Data Types (2 test cases)
  - Numeric sequence integrity
  - Structured data consistency

- Stream Performance (2 test cases)
  - Scaling efficiency across sizes (10, 100, 1,000)
  - Consistent performance under load

- Concurrent Streaming (2 test cases)
  - 5 concurrent stream requests
  - 10 interleaved streaming operations

- HTTP Streaming (2 test cases)
  - Array-based generation via HTTP
  - Large payloads over HTTP (500 items)

- Stream Error Handling (2 test cases)
  - Negative count handling
  - Extremely large count handling (100,000)

- Data Integrity (6 test cases)
  - Sequence order maintenance
  - No duplicate items (tested with 1,000 items)
  - No missing items
  - Timestamp validation
  - Monotonic timestamp verification

**Key Assertions**:
- Sequence integrity (no gaps, no duplicates, correct order)
- Performance scaling (linear with size)
- Timestamp validity (within reasonable bounds)
- Concurrent stream handling

---

### 4. Error Serialization (`errors.test.ts`)
**Purpose**: Comprehensive error handling and serialization across network boundaries.

**Coverage**:
- Error Propagation (WebSocket) (5 test cases)
  - Basic error propagation
  - Division by zero error
  - User not found error
  - Service not found error
  - Method not found error

- Error Object Properties (2 test cases)
  - Error message preservation
  - Special character handling in error messages

- Multiple Error Scenarios (2 test cases)
  - Different error types from different services
  - Concurrent error handling (5 simultaneous errors)

- Error Recovery (2 test cases)
  - Successful requests after errors
  - Alternating success and error patterns

- HTTP Error Propagation (3 test cases)
  - Error propagation via HTTP
  - Division by zero via HTTP
  - Not found errors via HTTP

- TitanError Serialization (12 test cases)
  - Round-trip serialization
  - Stack trace preservation
  - Tracing information (requestId, correlationId, etc.)
  - MessagePack serialization
  - All standard error codes
  - Custom error codes
  - Complex error details
  - Null/undefined in error details

- HTTP Error Parsing (3 test cases)
  - HTTP 404 parsing
  - HTTP 500 parsing
  - Tracing header extraction

- Error Edge Cases (8 test cases)
  - Very long error messages (10,000 chars)
  - Empty error messages
  - Special JSON characters in messages
  - Malformed error data
  - Null error data
  - Undefined error data
  - Already-TitanError data

**Key Assertions**:
- Error message preservation
- Error code accuracy
- Stack trace preservation
- Tracing information integrity
- Deserialization robustness

---

### 5. Packet Protocol Compatibility (`packet-protocol.test.ts`)
**Purpose**: Low-level packet structure and custom type serialization testing.

**Coverage**:
- Packet Structure Validation (4 test cases)
  - Unique ID generation (1,000 IDs)
  - ID generator reset
  - All packet types (0-15)
  - Flag preservation during modifications

- Packet Flag Operations (4 test cases)
  - Impulse flag independence
  - Error flag independence
  - Stream flag combinations
  - Stream chunk identification

- Packet Data Serialization (3 test cases)
  - Primitive types in packets
  - Complex objects in packets
  - Arrays in packets

- Stream Packet Metadata (3 test cases)
  - Stream ID and index preservation
  - Large stream IDs (max uint32)
  - Large stream indices (max uint32)

- End-to-End Communication (3 test cases)
  - Simple request roundtrip
  - Complex payload roundtrip
  - 100 rapid request/response cycles

- TitanError Serialization (3 test cases)
  - Error serialization roundtrip
  - Stack trace preservation
  - All error code handling

- Reference Serialization (2 test cases)
  - Reference encoding/decoding
  - Multiple references

- Definition Serialization (2 test cases)
  - Definition with parent
  - Definition without parent

- StreamReference Serialization (3 test cases)
  - Readable stream reference
  - Writable stream reference
  - Both stream types

- Mixed Type Serialization (2 test cases)
  - Arrays with mixed custom types
  - Objects with custom type properties

- Protocol Edge Cases (4 test cases)
  - All flag combinations (16 types × 2 impulse × 2 error)
  - Maximum stream values
  - Empty payloads
  - Large arrays (10,000 items)
  - Deeply nested objects (50 levels)
  - Very long strings (100,000 chars)

**Key Assertions**:
- Packet flag bit manipulation correctness
- Custom type serialization accuracy
- Edge case handling (max values, empty data, deep nesting)

---

### 6. Performance Benchmarks (`performance.test.ts`)
**Purpose**: Performance characterization and regression detection.

**Coverage**:
- Latency Benchmarks (3 test cases)
  - Simple RPC latency (100 iterations)
  - Complex object echo latency (50 iterations)
  - Array streaming latency (20 iterations, 100 items each)

- Throughput Benchmarks (3 test cases)
  - Sequential throughput (500 operations)
  - Concurrent throughput (500 operations)
  - Mixed operation throughput (300 operations)

- Payload Size Impact (2 test cases)
  - Size impact analysis (10, 100, 1,000, 10,000 items)
  - Large payload efficiency (50,000 items × 5)

- Sustained Load Testing (1 test case)
  - 5-second sustained load test

- Error Handling Performance (1 test case)
  - Success vs error latency comparison (50 each)

- Transport Comparison (3 test cases)
  - HTTP vs WebSocket latency
  - HTTP vs WebSocket throughput
  - HTTP vs WebSocket large payloads

- Performance Regression Detection (1 test case)
  - Baseline performance with percentile analysis (P95, P99)

**Key Metrics**:
- Average latency: < 50ms
- P95 latency: < 100ms
- P99 latency: < 150ms
- Max latency: < 300ms
- Sequential throughput: > 10 ops/sec
- Concurrent throughput: > 50 ops/sec
- Large payload handling: < 2s for 50,000 items
- Error overhead: < 2x success latency

**Benchmark Output**:
Each test outputs detailed performance metrics including:
- Operation count
- Total/average/min/max times
- Throughput (ops/sec)
- Percentile analysis (P95, P99)
- Transport comparison data

---

## Running the Tests

### Run All Integration Tests
```bash
npm run test:integration
```

### Run Specific Test Suite
```bash
# Client-server tests
npm run test:integration -- client-server.test.ts

# WebSocket protocol tests
npm run test:integration -- websocket-protocol.test.ts

# Streaming tests
npm run test:integration -- streaming.test.ts

# Error tests
npm run test:integration -- errors.test.ts

# Packet protocol tests
npm run test:integration -- packet-protocol.test.ts

# Performance benchmarks
npm run test:integration -- performance.test.ts
```

### Run with Coverage
```bash
npm run test:coverage -- --config vitest.integration.config.ts
```

### Run in Watch Mode
```bash
vitest --config vitest.integration.config.ts
```

---

## Test Infrastructure

### Server Fixture (`tests/fixtures/titan-server.ts`)
- Creates minimal Titan application with Netron
- Supports HTTP and/or WebSocket transports
- Dynamic port allocation (avoids conflicts)
- Automatic cleanup
- Configurable logging

### Test Services (`tests/fixtures/test-services.ts`)
- **CalculatorService**: Basic arithmetic operations, error scenarios
- **UserService**: CRUD operations, state management
- **EchoService**: Data type preservation, error throwing
- **StreamService**: Array generation, simulated streaming

### Setup Files (`tests/setup/integration.ts`)
- WebSocket polyfill for Node.js environment
- Global test configuration

---

## Test Statistics

**Total Test Files**: 6
**Total Test Suites**: ~50
**Total Test Cases**: ~200+

**Coverage Areas**:
- ✅ HTTP Transport
- ✅ WebSocket Transport
- ✅ Binary Protocol (MessagePack)
- ✅ Packet Encoding/Decoding
- ✅ Error Serialization
- ✅ Custom Type Serialization (TitanError, Reference, Definition, StreamReference)
- ✅ Streaming (array-based simulation)
- ✅ Service Discovery
- ✅ Concurrent Operations
- ✅ Performance Benchmarking
- ✅ Transport Comparison
- ✅ Edge Cases and Boundary Conditions

**Test Types**:
- Functional correctness
- Protocol compatibility
- Error handling
- Performance benchmarking
- Regression detection
- Edge case validation

---

## Performance Baselines

Based on the performance test suite, the following baselines are established:

| Metric | Threshold | Test |
|--------|-----------|------|
| Simple RPC Average | < 50ms | websocket-protocol.test.ts |
| Simple RPC Max | < 200ms | websocket-protocol.test.ts |
| Sequential Throughput | > 10 ops/sec | performance.test.ts |
| Concurrent Throughput | > 50 ops/sec | performance.test.ts |
| Large Payload (50K items) | < 2s | performance.test.ts |
| P95 Latency | < 100ms | performance.test.ts |
| P99 Latency | < 150ms | performance.test.ts |
| Max Latency | < 300ms | performance.test.ts |
| Error Overhead | < 2x success | performance.test.ts |

---

## Known Limitations

1. **Streaming**: Current tests use array-based simulation. True streaming (ReadableStream/WritableStream) is not fully implemented yet.

2. **Connection Recovery**: Reconnection logic is tested but disabled in most tests (`reconnect: false`) for deterministic behavior.

3. **Large Payloads**: Very large payloads (>100K items) may hit timeout limits in some test scenarios.

4. **Circular References**: MessagePack throws on circular references - this is expected behavior and tested.

---

## Future Enhancements

1. **Real Streaming Tests**: Add tests for actual ReadableStream/WritableStream when implemented
2. **Reconnection Scenarios**: Test auto-reconnect, exponential backoff, max attempts
3. **Security Tests**: Authentication, authorization, rate limiting
4. **Network Conditions**: Latency simulation, packet loss, disconnections
5. **Browser E2E**: Complement with actual browser tests (Playwright already configured)
6. **Load Testing**: Extended load tests with monitoring and profiling

---

## CI/CD Integration

These tests are designed to run in CI/CD pipelines:

- Fast execution (most tests < 10s)
- No external dependencies (self-contained Titan server)
- Deterministic results
- Clear failure messages
- Performance regression detection

Recommended CI configuration:
```yaml
- name: Run Integration Tests
  run: npm run test:integration
  timeout-minutes: 10
```

---

## Troubleshooting

### Tests Timeout
- Increase timeout in `vitest.integration.config.ts`
- Check if Titan server is starting correctly
- Look for port conflicts

### Connection Errors
- Verify WebSocket polyfill is loaded
- Check server fixture cleanup
- Ensure ports are released between tests

### Performance Test Failures
- CI environments may be slower - adjust thresholds
- Ensure no other processes are competing for resources
- Check for throttling or rate limiting

### Random Failures
- Tests are designed to be deterministic
- Report flaky tests as bugs
- Check for race conditions in test setup/teardown

---

## Contributing

When adding new tests:

1. Follow existing test structure and naming
2. Include detailed comments for complex scenarios
3. Add performance baselines for new operations
4. Update this README with new test coverage
5. Ensure tests are deterministic and fast
6. Clean up resources in `afterAll` hooks

---

## License

MIT - See LICENSE file in package root
