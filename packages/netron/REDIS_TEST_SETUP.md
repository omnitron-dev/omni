# Redis Test Setup for Netron

This document describes the automatic Redis test setup implemented for the Netron package.

## Overview

The Netron test suite now automatically manages Redis instances for testing, eliminating the need for manual Redis server management and avoiding port conflicts.

## Features

1. **Automatic Redis Startup**: Tests automatically start a Redis instance on a non-standard port (6400+)
2. **Dynamic Port Allocation**: Finds available ports to avoid conflicts
3. **Multiple Fallback Options**:
   - Local redis-server (preferred)
   - Docker container (if redis-server not available)
   - Mock Redis implementation (for CI environments)
4. **Automatic Cleanup**: Redis instances are properly stopped and cleaned up after tests

## Implementation Details

### Core Components

1. **RedisTestHelper** (`test/helpers/redis-test-helper.ts`)
   - Singleton class that manages Redis lifecycle
   - Supports dynamic port allocation
   - Provides fallback to Docker or mock Redis

2. **MockRedis** (`test/helpers/mock-redis.ts`)
   - In-memory Redis implementation for CI environments
   - Supports basic Redis operations needed for tests

3. **RedisDockerTestHelper** (`test/helpers/redis-test-helper-docker.ts`)
   - Alternative helper that uses Docker when redis-server is not available

4. **Test Utilities** (`test/helpers/test-utils.ts`)
   - `createTestRedisClient(db)`: Creates a Redis client for tests
   - `getTestRedisUrl(db)`: Gets the test Redis connection URL
   - `cleanupRedis(redis)`: Cleans up Redis database

### Jest Configuration

- **jest.setup.ts**: Global setup/teardown for Redis
- **jest.config.ts**: Configured to use setup file and increased timeout

## Usage in Tests

### Service Discovery Tests
```typescript
import { createTestRedisClient, cleanupRedis } from '../helpers/test-utils';

describe('ServiceDiscovery', () => {
  let redis: Redis;

  beforeEach(async () => {
    redis = createTestRedisClient(2); // Use database 2
    await cleanupRedis(redis);
  });

  afterEach(async () => {
    redis.disconnect();
  });
});
```

### Integration Tests
```typescript
import { getTestRedisUrl } from './helpers/test-utils';

const netron = await Netron.create({
  discoveryEnabled: true,
  discoveryRedisUrl: getTestRedisUrl(2),
});
```

## Environment Variables

- `CI=true`: Forces use of mock Redis (automatically set in CI environments)
- `USE_MOCK_REDIS=true`: Manually force mock Redis usage

## Benefits

1. **No Manual Setup**: Developers don't need to install or start Redis manually
2. **Isolation**: Each test run uses a unique Redis instance/port
3. **CI-Friendly**: Automatically uses mock Redis in CI environments
4. **Reliable**: Multiple fallback options ensure tests can run in various environments
5. **Clean State**: Automatic cleanup ensures tests start with a clean Redis state

## Running Tests

Simply run:
```bash
yarn test
```

The Redis instance will be automatically managed throughout the test lifecycle.