# E2E Tests - Quick Start Guide

## Run Tests

```bash
# Run all E2E tests
pnpm test:e2e

# Run specific test file
pnpm vitest test/e2e/health.test.ts
pnpm vitest test/e2e/api.test.ts

# Run in watch mode
pnpm vitest test/e2e --watch

# Run with verbose output
pnpm vitest test/e2e --reporter=verbose
```

## Test Files

### `setup.ts`
Server lifecycle and utilities

### `health.test.ts`
HTTP health endpoint tests (10 tests)

### `api.test.ts`
Netron RPC API tests (18 tests)

## What Gets Tested

### Health Endpoint
- GET /health returns 200
- Response structure (status, timestamp, uptime, version, checks)
- Timestamp is recent and ISO formatted
- Version is 2.0.0
- Response time < 500ms
- Handles concurrent requests

### RPC Endpoints
- HealthService@1.0.0: check(), live(), ready()
- PricesService@2.0.0: getPrice(), getMultiplePrices(), getPriceChange()
- Parameter validation
- Error handling
- Concurrent requests

## Prerequisites

- Node.js >= 22.0.0
- Port 3001 available
- Dependencies installed (pnpm install)

**Note:** Redis and PostgreSQL are optional - tests handle missing data gracefully.

## Common Issues

### Port Already in Use
Change port in tests:
```typescript
const testContext = setupTestServer(3002); // Use different port
```

### Server Startup Timeout
Increase timeout in beforeAll:
```typescript
beforeAll(async () => {
  server = await startTestServer(port);
}, 60000); // 60s instead of 35s
```

### Tests Fail with Database Errors
This is expected if Redis/PostgreSQL aren't running. Tests will log notes and continue.

## Test Output

Successful run:
```
✓ test/e2e/health.test.ts (10 tests)
✓ test/e2e/api.test.ts (18 tests)

Test Files  2 passed (2)
Tests  28 passed (28)
```

## Debug Single Test

```typescript
// In test file, add .only
it.only('should return 200 OK status', async () => {
  // This test runs alone
});
```

## Environment Variables

```bash
# Override test server config
PRICEVERSE_APP_PORT=3002 pnpm test:e2e
PRICEVERSE_LOGGING_LEVEL=debug pnpm test:e2e
```

## Next Steps

1. Run `pnpm test:e2e` to verify all tests pass
2. Review test output for any warnings
3. Check README.md for detailed documentation
4. Add new tests as needed
