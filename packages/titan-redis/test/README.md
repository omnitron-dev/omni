# Redis Module Testing

This directory contains comprehensive tests for the Titan Redis module, including both unit tests with mocks and integration tests with real Redis instances.

## Test Files

- `redis.service.spec.ts` - Unit tests with mocked Redis clients
- `redis.service.real.spec.ts` - Integration tests with real Redis connections
- `redis.manager.spec.ts` - RedisManager unit tests
- `redis.module.spec.ts` - Redis module integration tests

## Running Tests

### Quick Start

```bash
# Run all Redis tests with real connections
npm run test:redis:all

# Run specific test file with real Redis
npm run test:redis

# Run with verbose output
npm run test:redis:verbose

# Run unit tests only (no Redis required)
npm test test/modules/redis/redis.service.spec.ts
```

### Manual Redis Container Management

```bash
# Start Redis container for testing
npm run redis:start

# Check status of test containers
npm run redis:status

# Stop Redis container
npm run redis:stop

# Clean up all test containers, networks, and volumes
npm run redis:cleanup
```

## Test Infrastructure

### Docker Configuration

The tests use Docker to spin up isolated Redis instances. Configuration is in:
- `test/docker/docker-compose.test.yml` - Docker Compose configuration
- `scripts/test-redis.sh` - Shell script for container management

### Test Utilities

- `test/utils/redis-test-manager.ts` - Manages Redis containers for tests
- `test/setup/redis-setup.ts` - Test setup and configuration helpers

### Features

1. **Isolated Containers**: Each test suite gets its own Redis container on a random port
2. **Parallel Execution**: Multiple test suites can run concurrently without conflicts
3. **Automatic Cleanup**: Containers are cleaned up after tests complete
4. **Cluster Support**: Can spin up Redis clusters for cluster-specific tests
5. **CI/CD Ready**: GitHub Actions workflow for automated testing

## Environment Variables

- `USE_REAL_REDIS=true` - Enable tests that require real Redis connections
- `REDIS_VERBOSE=true` - Enable verbose output for debugging
- `REDIS_NO_CLEANUP=true` - Disable automatic cleanup (for debugging)
- `REDIS_BASE_PORT=16379` - Base port for test containers (default: 16379)

## Writing New Tests

### Using Real Redis

```typescript
import { describeWithRedis, RedisTestManager } from '../../setup/redis-setup';

describeWithRedis('My Redis Test', () => {
  it('should connect to real Redis', async () => {
    await RedisTestManager.withRedis(async (container) => {
      // Your test code here
      // container.client is a connected Redis client
      // container.url is the connection URL
    });
  });
});
```

### Using Redis Cluster

```typescript
it('should work with cluster', async () => {
  await RedisTestManager.withCluster(async (containers) => {
    // containers is an array of Redis nodes
    // Set up your cluster client here
  }, { nodes: 3 });
});
```

## Troubleshooting

### Docker Not Found

If you see "Docker is not available", ensure Docker is installed and running:
```bash
docker version
docker ps
```

### Port Conflicts

The test manager automatically finds available ports starting from 16379. If you have conflicts:
```bash
export REDIS_BASE_PORT=26379
npm run test:redis:all
```

### Cleanup Issues

If containers are not cleaned up properly:
```bash
# Force cleanup all test containers
npm run redis:cleanup

# Manual cleanup
docker ps -a --filter "label=test.cleanup=true" -q | xargs -r docker rm -f
docker network prune
docker volume prune
```

### Debugging

To keep containers running for debugging:
```bash
REDIS_NO_CLEANUP=true npm run test:redis
# Containers will stay running, check with:
npm run redis:status
# Manual cleanup when done:
npm run redis:cleanup
```

## CI/CD Integration

The project includes GitHub Actions workflow that:
1. Tests against multiple Node.js versions (20.x, 22.x)
2. Tests against multiple Redis versions (6, 7)
3. Runs cluster tests
4. Uploads test results as artifacts

See `.github/workflows/test-redis.yml` for details.

## Performance Considerations

- Container startup: ~1-2 seconds per container
- Container cleanup: ~0.5 seconds per container
- Port allocation: Automatic, no conflicts
- Memory usage: ~10-20MB per Redis container
- Disk usage: Minimal (no persistence by default)

## Security

- Containers run on localhost only
- No authentication (test environment)
- Automatic cleanup prevents data leaks
- Isolated networks per test suite

---

# Redis Test Infrastructure (New)

## Overview

The new comprehensive Redis test infrastructure provides Docker-based test environments for:
- **Standalone Redis** containers
- **Redis Cluster** support (3+ masters with replicas)
- **Redis Sentinel** support (master + replicas + sentinels)
- **Automatic cleanup** and lifecycle management
- **Test isolation** with proper resource cleanup

## Quick Start Examples

### Standalone Redis

```typescript
import { RedisTestManager } from '@omnitron-dev/titan/testing';

it('should work with standalone Redis', async () => {
  await RedisTestManager.withRedis(async (container, connectionString) => {
    const Redis = require('ioredis');
    const client = new Redis(connectionString);

    await client.set('key', 'value');
    const result = await client.get('key');
    expect(result).toBe('value');

    await client.quit();
  });
});
```

### Redis Cluster

```typescript
import { RedisTestManager } from '@omnitron-dev/titan/testing';

it('should work with Redis cluster', async () => {
  await RedisTestManager.withRedisCluster(async (cluster) => {
    const Cluster = require('ioredis').Cluster;
    const client = new Cluster(cluster.nodes);

    await client.set('cluster-key', 'cluster-value');
    expect(await client.get('cluster-key')).toBe('cluster-value');

    await client.quit();
  }, {
    masterCount: 3,
    replicasPerMaster: 1,
  });
}, 60000);
```

### Using Fixtures

```typescript
import {
  createDockerRedisFixture,
  withDockerRedis
} from './utils/redis-test-utils';

it('should use fixture', async () => {
  const fixture = await createDockerRedisFixture({
    password: 'secure-pass',
    database: 5,
  });

  try {
    await fixture.client.set('key', 'value');
    expect(await fixture.client.get('key')).toBe('value');
  } finally {
    await fixture.cleanup();
  }
});

// Or with auto-cleanup:
it('should use helper', async () => {
  await withDockerRedis(async (fixture) => {
    await fixture.client.set('key', 'value');
    expect(await fixture.client.get('key')).toBe('value');
  });
});
```

## Core Components

### RedisTestManager

Location: `/packages/titan/src/testing/docker-test-manager.ts`

Main class for Docker container management:

```typescript
class RedisTestManager {
  // Create containers
  static async createRedisContainer(options?: RedisContainerOptions): Promise<DockerContainer>
  static async createRedisCluster(options?: RedisClusterOptions): Promise<RedisClusterContainers>
  static async createRedisSentinel(options?: RedisSentinelOptions): Promise<RedisSentinelContainers>

  // Helper wrappers with auto-cleanup
  static async withRedis<T>(testFn, options?): Promise<T>
  static async withRedisCluster<T>(testFn, options?): Promise<T>
  static async withRedisSentinel<T>(testFn, options?): Promise<T>
}
```

### Test Utils

Location: `/packages/titan/test/modules/redis/utils/redis-test-utils.ts`

Provides fixtures and helpers:

```typescript
// Docker fixtures
createDockerRedisFixture(options?): Promise<DockerRedisTestFixture>
createDockerRedisClusterFixture(options?): Promise<DockerRedisClusterFixture>
createDockerRedisSentinelFixture(options?): Promise<DockerRedisSentinelFixture>

// Helpers
buildRedisConnectionString(options): string
waitForRedisReady(client, timeout?): Promise<void>
flushRedis(client): Promise<void>

// Wrappers with auto-cleanup
withDockerRedis<T>(testFn, options?): Promise<T>
withDockerRedisCluster<T>(testFn, options?): Promise<T>
withDockerRedisSentinel<T>(testFn, options?): Promise<T>

// Mock client for unit tests
createMockRedisClient(): MockRedisClient
```

## Configuration Options

### RedisContainerOptions

```typescript
interface RedisContainerOptions {
  name?: string;           // Container name
  port?: number | 'auto';  // Host port (auto = random)
  password?: string;       // Redis password
  database?: number;       // Database number (0-15)
  maxMemory?: string;      // Max memory (e.g., '256mb')
  requirePass?: boolean;   // Require password
}
```

### RedisClusterOptions

```typescript
interface RedisClusterOptions {
  masterCount?: number;        // Number of masters (default: 3)
  replicasPerMaster?: number;  // Replicas per master (default: 1)
  basePort?: number;           // Starting port (default: 7000)
  password?: string;           // Cluster password
  network?: string;            // Docker network
}
```

### RedisSentinelOptions

```typescript
interface RedisSentinelOptions {
  masterName?: string;    // Master name (default: 'mymaster')
  replicaCount?: number;  // Number of replicas (default: 2)
  sentinelCount?: number; // Number of sentinels (default: 3)
  basePort?: number;      // Sentinel base port (default: 26379)
  password?: string;      // Redis password
  network?: string;       // Docker network
}
```

## Integration Tests

See `/packages/titan/test/modules/redis/redis.docker-integration.spec.ts` for comprehensive examples of:
- Standalone Redis operations
- Redis Cluster operations
- Hash tags and slot distribution
- Pub/sub messaging
- Transactions
- Sorted sets
- Key expiration

## Best Practices

1. **Use auto-cleanup helpers** (`withRedis`, `withDockerRedis`) when possible
2. **Set timeouts** for cluster/sentinel tests (60s recommended)
3. **Cleanup in finally blocks** when using fixtures directly
4. **Use unique databases** or separate containers for test isolation
5. **Use mock clients** for unit tests

## Migration from Old Infrastructure

Old pattern:
```typescript
// Old
import { RedisTestHelper } from './utils/redis-test-utils';
const helper = new RedisTestHelper();
const client = helper.createClient();
```

New pattern:
```typescript
// New - with Docker isolation
import { withDockerRedis } from './utils/redis-test-utils';
await withDockerRedis(async (fixture) => {
  // fixture.client is ready to use
});
```

## Exports

All new infrastructure is exported from `@omnitron-dev/titan/testing`:

```typescript
export {
  RedisTestManager,
  type DockerContainer,
  type RedisContainerOptions,
  type RedisClusterOptions,
  type RedisClusterContainers,
  type RedisSentinelOptions,
  type RedisSentinelContainers,
} from '@omnitron-dev/titan/testing';
```