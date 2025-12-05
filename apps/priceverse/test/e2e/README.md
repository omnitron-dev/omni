# Priceverse 2.0 - E2E Tests

End-to-end tests for the Priceverse application that test the running server through HTTP and Netron RPC endpoints.

## Overview

These tests start a real instance of the Priceverse server and make actual HTTP requests to test functionality from a client perspective.

## Test Files

### `setup.ts`
Test utilities and server lifecycle management:
- `startTestServer()` - Starts the Priceverse server on a test port
- `stopTestServer()` - Gracefully shuts down the test server
- `setupTestServer()` - Vitest lifecycle hooks for automatic server management
- `invokeRpc()` - Helper for making JSON-RPC requests to Netron
- `waitFor()` - Utility for waiting on async conditions

### `health.test.ts`
Tests for the HTTP health check endpoint (`GET /health`):
- Response structure validation
- Health status values (healthy/degraded/unhealthy)
- Timestamp and uptime validation
- Component health checks (Redis, exchanges)
- Performance and concurrency tests
- Response time requirements

### `api.test.ts`
Tests for Netron RPC endpoints (`POST /netron/invoke`):

**HealthService@1.0.0:**
- `check()` - Comprehensive health check
- `live()` - Liveness probe
- `ready()` - Readiness probe

**PricesService@2.0.0:**
- `getPrice(pair)` - Single price retrieval
- `getMultiplePrices(pairs)` - Batch price retrieval
- `getPriceChange(pair, period, from?, to?)` - Price change calculation

**Protocol Tests:**
- HTTP method validation (POST only)
- Content-Type validation
- JSON parsing
- Service/method existence validation
- Concurrent request handling

## Running Tests

### Run all E2E tests
```bash
pnpm test:e2e
```

### Run specific test file
```bash
pnpm vitest test/e2e/health.test.ts
pnpm vitest test/e2e/api.test.ts
```

### Run in watch mode
```bash
pnpm vitest test/e2e --watch
```

## Prerequisites

The E2E tests require:
1. Node.js >= 22.0.0
2. Dependencies installed (`pnpm install`)
3. Available ports (default: 3001)

**Note:** The tests will start their own server instance, so you don't need to manually start the server.

## Configuration

Test server configuration is done via environment variables:
- `PRICEVERSE_APP_PORT` - Test server port (default: 3001)
- `PRICEVERSE_APP_HOST` - Test server host (default: localhost)
- `PRICEVERSE_LOGGING_LEVEL` - Log level during tests (default: error)

## Test Coverage

These E2E tests validate:

### HTTP Endpoints
- ✅ Health check endpoint structure and timing
- ✅ Content-Type headers
- ✅ Status codes
- ✅ Concurrent request handling

### Netron RPC
- ✅ JSON-RPC protocol compliance
- ✅ Service versioning (e.g., `PricesService@2.0.0`)
- ✅ Method invocation
- ✅ Parameter validation
- ✅ Error handling (non-existent services/methods)
- ✅ Input validation (Zod schemas)

### Business Logic
- ✅ Health checks for all components
- ✅ Price retrieval (when data available)
- ✅ Price change calculations
- ✅ Multi-pair batch operations

## Edge Cases Handled

1. **Empty Database**: Tests gracefully handle missing price data
2. **Service Dependencies**: Tests check for Redis/database availability
3. **Concurrent Requests**: Load testing with 10+ simultaneous requests
4. **Invalid Inputs**: Parameter validation and error messages
5. **Response Times**: Performance requirements (< 500ms for health)

## Debugging Failed Tests

If tests fail:

1. **Check server output**: The setup captures stdout/stderr
2. **Verify port availability**: Ensure port 3001 is not in use
3. **Check dependencies**: Redis, PostgreSQL must be running for full functionality
4. **Increase timeouts**: Server startup timeout is 35s, adjust if needed
5. **Run single test**: Use `.only` to isolate failing tests

Example:
```typescript
it.only('should return 200 OK status', async () => {
  // This test will run in isolation
});
```

## Performance Targets

- Health endpoint: < 500ms response time
- RPC calls: < 1000ms for simple operations
- Server startup: < 30s
- Graceful shutdown: < 5s

## Best Practices

1. **Server Reuse**: Setup starts server once per test file (beforeAll)
2. **Cleanup**: AfterAll ensures server shutdown
3. **Isolation**: Each test is independent
4. **Error Handling**: Tests handle expected errors gracefully
5. **Realistic Data**: Tests use actual supported pairs (btc-usd, eth-usd, etc.)

## Future Enhancements

Potential additions:
- [ ] WebSocket streaming tests (for `streamPrices`)
- [ ] Authentication/authorization tests
- [ ] Rate limiting tests
- [ ] Load testing with k6 or Artillery
- [ ] Integration with CI/CD pipelines
- [ ] Database seeding for deterministic tests
