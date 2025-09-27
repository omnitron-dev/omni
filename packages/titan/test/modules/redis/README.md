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