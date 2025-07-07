# Redis Test Setup

This document explains how to set up and run tests that require Redis in the monorepo.

## TypeScript Configuration

The project uses strict TypeScript settings, including `noPropertyAccessFromIndexSignature: true`. This means that accessing `process.env` properties must use bracket notation:

```typescript
// ❌ Wrong
process.env.CI

// ✅ Correct
process.env['CI']
```

## Test Helper Configuration

The Redis test helper (`packages/netron/test/helpers/redis-test-helper.ts`) supports multiple modes:

### 1. Mock Redis (Default in CI)
When `CI=true` or `USE_MOCK_REDIS=true`, tests will use a mock Redis implementation:
```bash
CI=true yarn test
# or
USE_MOCK_REDIS=true yarn test
```

### 2. Local Redis Server
If you have Redis installed locally, tests will attempt to start a temporary Redis instance on a random port.

### 3. Docker Redis
If Redis is not installed but Docker is available, tests will attempt to use a Redis container.

## Running Tests

### Run all tests
```bash
yarn test
```

### Run tests for a specific package
```bash
yarn workspace @devgrid/netron test
yarn workspace @devgrid/rotif test
```

### Run tests with mock Redis
```bash
USE_MOCK_REDIS=true yarn test
```

## Troubleshooting

### TypeScript Errors with process.env

If you see errors like:
```
Property 'CI' comes from an index signature, so it must be accessed with ['CI']
```

Fix by using bracket notation:
```typescript
process.env['CI'] // instead of process.env.CI
```

### Redis Connection Errors

1. **Check if Redis is running:**
   ```bash
   redis-cli ping
   ```

2. **Use mock Redis for tests:**
   ```bash
   USE_MOCK_REDIS=true yarn test
   ```

3. **Install Redis locally:**
   - macOS: `brew install redis`
   - Ubuntu: `sudo apt-get install redis-server`
   - Or use Docker: `docker run -d -p 6379:6379 redis`

### Type Errors with Redis Client

If you see errors like `Type 'Redis | null' is not assignable to type 'Redis'`, ensure that:

1. Return types are properly cast:
   ```typescript
   return this.redisClient as Redis;
   ```

2. Null checks are in place:
   ```typescript
   if (!this.redisClient) {
     throw new Error('Redis not initialized');
   }
   return this.redisClient;
   ```

## Environment Variables

- `CI` - Set to 'true' to use mock Redis in tests
- `USE_MOCK_REDIS` - Set to 'true' to force mock Redis usage
- `REDIS_TEST_PORT` - Override the random port selection (optional)