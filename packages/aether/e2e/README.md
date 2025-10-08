# Aether Netron E2E Tests

Comprehensive end-to-end tests validating browser Netron client integration with Titan backend server.

## Overview

These tests verify:
- **HTTP Transport**: Basic RPC and advanced fluent API features
- **WebSocket Transport**: Real-time events, subscriptions, and streams
- **Browser Compatibility**: Cross-browser testing (Chromium, Firefox, WebKit)
- **Stream Implementation**: Correct browser stream handling
- **API Compatibility**: Full compatibility between browser and Node.js versions

## Test Structure

```
e2e/
├── fixtures/
│   └── titan-app/          # Test Titan application
│       ├── index.ts        # Application entry point
│       └── services/       # Test services
│           ├── user.service.ts    # HTTP CRUD operations
│           ├── stream.service.ts  # WebSocket streams
│           └── event.service.ts   # WebSocket events
├── pages/
│   └── index.html          # Test HTML page
├── tests/
│   ├── http-transport.spec.ts      # HTTP transport tests
│   ├── websocket-streams.spec.ts   # WebSocket stream tests
│   ├── websocket-events.spec.ts    # WebSocket event tests
│   └── compatibility.spec.ts       # Cross-runtime compatibility
└── playwright.config.ts    # Playwright configuration
```

## Running Tests

### Prerequisites

```bash
# Install dependencies
yarn install

# Build Aether package
yarn build
```

### Run All E2E Tests

```bash
# Run all tests
yarn test:e2e

# Run with UI mode
yarn test:e2e:ui

# Run in debug mode
yarn test:e2e:debug

# Run specific browser
yarn test:e2e --project=chromium
yarn test:e2e --project=firefox
yarn test:e2e --project=webkit
```

### Run Specific Test Files

```bash
# HTTP transport tests
yarn test:e2e e2e/tests/http-transport.spec.ts

# WebSocket stream tests
yarn test:e2e e2e/tests/websocket-streams.spec.ts

# WebSocket event tests
yarn test:e2e e2e/tests/websocket-events.spec.ts

# Compatibility tests
yarn test:e2e e2e/tests/compatibility.spec.ts
```

## Test Scenarios

### HTTP Transport Tests

#### Basic RPC
- Get all users
- Get user by ID
- Create user
- Update user
- Delete user
- Find users with filters
- Handle non-existent entities

#### Fluent API Features
- **Caching**: TTL-based caching with cache keys
- **Retry Logic**: Exponential backoff, configurable attempts
- **Optimistic Updates**: Immediate UI updates with automatic rollback
- **Request Deduplication**: Single network call for identical concurrent requests
- **Transform & Validate**: Response processing pipeline
- **Timeout & Cancellation**: AbortController-based cancellation
- **Background Refetch**: Keep data fresh automatically
- **Tag-based Invalidation**: Invalidate multiple cache entries

#### Advanced Features
- Multiple options chaining
- Cache invalidation (by key and tags)
- Error handling and retries
- Performance optimization

### WebSocket Stream Tests

#### Basic Operations
- **Readable Streams**: Generate data streams
- **Writable Streams**: Consume data streams
- **Duplex Streams**: Bidirectional communication (echo)
- **Transform Streams**: Data transformation (uppercase, lowercase, reverse)

#### Advanced Operations
- **Stream Merging**: Combine multiple streams
- **Large Data**: Stream 10MB+ efficiently
- **Backpressure**: Proper flow control
- **Error Handling**: Stream errors and cancellation

#### Transformation Patterns
- String transformations (uppercase, lowercase, reverse)
- Stream chaining
- Empty stream handling
- Complex transformation pipelines

#### Performance
- High-frequency chunks (1000+ items)
- Large data streaming (10MB+)
- Throughput testing (MB/s)

### WebSocket Event Tests

#### Subscriptions
- Subscribe to chat messages
- Subscribe to notifications
- Subscribe to task progress
- Unsubscribe functionality
- Subscription count tracking

#### Real-time Updates
- Periodic notifications (5s interval)
- Concurrent subscriptions
- Multi-step task progress
- Event delivery ordering

#### High Frequency
- 100 events with 10ms interval
- 500 events with 5ms interval (stress test)
- Rapid subscribe/unsubscribe cycles
- Event order preservation
- Throughput measurement (events/sec)

#### Error Handling
- Callback errors (graceful degradation)
- WebSocket reconnection
- Connection state management

### Compatibility Tests

#### Cross-runtime Compatibility
- Identical API surface between browser and Node.js
- Data serialization/deserialization consistency
- Binary data handling
- Error handling consistency

#### Browser-specific Features
- Native AbortController integration
- Window Performance API usage
- Browser ReadableStream/WritableStream
- SSR-safe implementation (no globals at module level)

#### Multi-browser
- Chromium compatibility
- Firefox compatibility
- WebKit (Safari) compatibility

## Test Services

### UserService

Test service for HTTP transport CRUD operations.

**Methods**:
- `getUser(id: string)`: Get user by ID
- `getUsers()`: Get all users
- `findUsers(filters)`: Find users with filters
- `createUser(dto)`: Create new user
- `updateUser(id, dto)`: Update user
- `deleteUser(id)`: Delete user
- `unreliableMethod(shouldFail)`: Test retry logic
- `slowMethod(delayMs)`: Test timeout

**Seeded Data**: 3 test users (Alice, Bob, Charlie)

### StreamService

Test service for WebSocket streams.

**Methods**:
- `generateStream(count, intervalMs)`: Generate readable stream
- `consumeStream(stream)`: Consume writable stream
- `echoStream(inputStream)`: Echo stream (duplex)
- `transformStream(inputStream, operation)`: Transform stream
- `mergeStreams(streams)`: Merge multiple streams
- `streamLargeData(sizeMB, chunkSizeKB)`: Large data stream
- `backpressureStream(itemCount, fast)`: Backpressure test

### EventService

Test service for WebSocket events and subscriptions.

**Methods**:
- `sendMessage(userId, userName, message)`: Send chat message
- `sendNotification(type, title, message)`: Send notification
- `startTask(taskId, durationMs)`: Start task with progress events
- `subscribeToMessages(callback)`: Subscribe to chat messages
- `subscribeToNotifications(callback)`: Subscribe to notifications
- `subscribeToTaskProgress(taskId, callback)`: Subscribe to task progress
- `emitHighFrequency(count, intervalMs)`: High-frequency event emission
- `getSubscriptionCount()`: Get active subscription counts

**Background Events**: Periodic notifications every 5 seconds

## Architecture

### Titan Test Application

The test application runs on:
- **HTTP Transport**: `http://localhost:3333`
- **WebSocket Transport**: `ws://localhost:3334`
- **Health Check**: `http://localhost:3333/health`

Services are registered with Netron and available for browser clients.

### Browser Test Page

Static HTML page served on:
- **Test Page**: `http://localhost:3456`

Loads Aether bundle and provides test interface for Playwright.

### Test Execution Flow

1. Playwright starts Titan test application
2. Playwright starts static HTTP server for test page
3. Browser navigates to test page
4. Test code evaluates in browser context
5. Browser Netron client connects to Titan server
6. Tests execute real-world scenarios
7. Results validated in test assertions

## Configuration

### Playwright Config

- **Parallel Execution**: Tests run in parallel
- **Multi-browser**: Chromium, Firefox, WebKit
- **Retries**: 2 retries on CI, 0 locally
- **Timeouts**: 60s test timeout, 10s action timeout
- **Artifacts**: Screenshots and videos on failure
- **Reporters**: HTML, list, JSON

### Web Servers

Two servers auto-started by Playwright:

1. **Titan Application** (`tsx e2e/fixtures/titan-app/index.ts`)
   - Port: 3333
   - Health check: `/health`
   - Reuse existing server in local dev

2. **Static HTTP Server** (`npx http-server e2e/pages -p 3456 --cors`)
   - Port: 3456
   - Serves test HTML pages
   - CORS enabled

## Best Practices

### Test Organization

- Group related tests in describe blocks
- Use beforeEach/afterEach for setup/teardown
- Always disconnect peers after tests
- Clean up subscriptions to prevent memory leaks

### Browser Context

- Use `page.evaluate()` for browser code
- Import Aether modules dynamically in browser
- Store test state in `window.testState`
- Use helper functions for common operations

### Debugging

```bash
# Run with UI mode for visual debugging
yarn test:e2e:ui

# Run in debug mode with inspector
yarn test:e2e:debug

# Run specific test in debug mode
yarn test:e2e --debug e2e/tests/http-transport.spec.ts

# Generate trace
yarn test:e2e --trace on
```

### Performance Testing

- Use `performance.now()` for timing
- Measure throughput (items/sec, MB/s)
- Test with realistic data volumes
- Validate against performance baselines

### Error Handling

- Test both success and failure paths
- Verify error messages and stack traces
- Test retry mechanisms
- Validate graceful degradation

## Troubleshooting

### Titan App Won't Start

```bash
# Check if port 3333 is in use
lsof -i :3333

# Kill process using port
kill -9 <PID>

# Start manually for debugging
cd packages/aether
tsx e2e/fixtures/titan-app/index.ts
```

### WebSocket Connection Fails

- Verify Titan app is running
- Check WebSocket server port (3334)
- Ensure firewall allows connections
- Check browser console for errors

### Test Timeouts

- Increase timeout in playwright.config.ts
- Check network latency
- Verify server response times
- Review async operation chains

### Browser-specific Issues

- Run individual browsers to isolate
- Check browser console logs
- Use Playwright Inspector
- Review browser compatibility matrix

## CI/CD Integration

### GitHub Actions Example

```yaml
- name: Install dependencies
  run: yarn install

- name: Install Playwright browsers
  run: npx playwright install --with-deps

- name: Build Aether
  run: yarn workspace @omnitron-dev/aether build

- name: Run E2E tests
  run: yarn workspace @omnitron-dev/aether test:e2e

- name: Upload test results
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: packages/aether/playwright-report/
```

## Contributing

When adding new tests:

1. Follow existing test patterns
2. Add appropriate describe blocks
3. Include setup/teardown
4. Test both success and failure cases
5. Add comments for complex scenarios
6. Update this README if needed

## Resources

- [Playwright Documentation](https://playwright.dev)
- [Netron Documentation](../../docs/netron.md)
- [Titan Documentation](../../docs/titan.md)
- [Aether Documentation](../../docs/aether.md)
