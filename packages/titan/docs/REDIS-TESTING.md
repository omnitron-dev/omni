# Redis Testing Infrastructure for Titan

## Overview

A comprehensive testing infrastructure has been created for the Redis module in the Titan framework. This infrastructure supports:
- Parallel test execution with isolated Redis containers
- Automatic port allocation to avoid conflicts
- Docker-based container management
- Fallback options for environments without Docker
- Complete cleanup after test execution

## Files Created

### 1. Docker Configuration
- **`test/docker/docker-compose.test.yml`** - Docker Compose configuration for Redis containers
  - Supports standalone Redis instances
  - Supports Redis cluster with 3 nodes
  - Automatic health checks
  - Resource limits (256MB memory)
  - Test suite isolation via environment variables

### 2. Test Utilities
- **`test/utils/redis-test-manager.ts`** - Main utility for managing Redis containers
  - Automatic port allocation (starting from 16379)
  - Container lifecycle management
  - Cluster initialization support
  - Cleanup on process exit
  - Helper methods for testing

- **`test/utils/redis-fallback.ts`** - Fallback for environments without Docker
  - Detects available Redis instances
  - Provides setup instructions per platform
  - Tries local Redis before failing

### 3. Test Setup
- **`test/setup/redis-setup.ts`** - Global test configuration and helpers
  - `setupRedisTests()` - Initialize test infrastructure
  - `describeWithRedis()` - Conditional test execution
  - `itWithRedis()` - Conditional test cases
  - Environment variable configuration

### 4. Test Files
- **`test/modules/redis/redis.service.real.spec.ts`** - Real Redis connection tests
  - Complete coverage of Redis operations
  - String, Hash, List, Set, Sorted Set operations
  - Transactions and pipelines
  - Pub/Sub functionality
  - Lock mechanisms
  - Caching functionality

- **`test/modules/redis/redis-validation.spec.ts`** - Validation tests (no Redis required)
  - API structure validation
  - Type safety checks
  - Error handling validation
  - Configuration validation
  - Logic validation without actual Redis

### 5. Scripts and Automation
- **`scripts/test-redis.sh`** - Bash script for container management
  - Start/stop Redis containers
  - Status checking
  - Full cleanup
  - Verbose mode support

- **`.github/workflows/test-redis.yml`** - GitHub Actions workflow
  - Matrix testing (Node 20.x, 22.x with Redis 6, 7)
  - Cluster testing
  - Artifact upload

### 6. Documentation
- **`test/modules/redis/README.md`** - Comprehensive testing documentation
  - Setup instructions
  - Usage examples
  - Troubleshooting guide
  - Environment variables
  - Performance considerations

## NPM Scripts Added

```json
{
  "test:redis": "USE_REAL_REDIS=true jest test/modules/redis/redis.service.real.spec.ts --forceExit",
  "test:redis:verbose": "USE_REAL_REDIS=true REDIS_VERBOSE=true jest test/modules/redis/redis.service.real.spec.ts --forceExit",
  "test:redis:all": "USE_REAL_REDIS=true jest test/modules/redis --forceExit",
  "redis:start": "./scripts/test-redis.sh start",
  "redis:stop": "./scripts/test-redis.sh stop",
  "redis:cleanup": "./scripts/test-redis.sh cleanup",
  "redis:status": "./scripts/test-redis.sh status"
}
```

## Key Features

### 1. Parallel Test Execution
- Each test suite gets its own Redis container
- Automatic port allocation prevents conflicts
- Unique container names via TEST_SUITE_ID

### 2. Automatic Cleanup
- Containers are removed after tests complete
- Process exit handlers ensure cleanup
- Force cleanup option for stuck containers
- Network and volume cleanup

### 3. Flexibility
- Works with Docker containers (preferred)
- Falls back to local Redis if available
- Provides clear setup instructions if neither is available
- Can be disabled via environment variables

### 4. Developer Experience
- Verbose mode for debugging
- Status checking commands
- Clear error messages
- Platform-specific setup instructions

## Usage Examples

### Basic Testing
```bash
# With Docker installed
npm run redis:start
npm run test:redis
npm run redis:stop

# Automatic (Docker required)
USE_REAL_REDIS=true npm test test/modules/redis
```

### Debugging
```bash
# Verbose output
npm run test:redis:verbose

# Keep containers after tests
REDIS_NO_CLEANUP=true npm run test:redis

# Check container status
npm run redis:status
```

### CI/CD
```yaml
- name: Run Redis tests
  env:
    USE_REAL_REDIS: true
  run: npm run test:redis:all
```

## Architecture Decisions

### Why Docker?
- Consistent environment across all systems
- Easy cluster setup for advanced testing
- Resource isolation and limits
- Quick spin-up and teardown

### Why Random Ports?
- Enables parallel test execution
- Avoids conflicts with local Redis
- Supports multiple test suites simultaneously

### Why Separate Test Files?
- `*.spec.ts` - Unit tests with mocks (fast, no dependencies)
- `*.real.spec.ts` - Integration tests with real Redis (slower, requires Redis)
- `*-validation.spec.ts` - Structure validation (no Redis needed)

## Requirements

### For Full Functionality
- Docker or Docker Desktop
- Node.js 20+ or 22+
- npm or yarn

### For Basic Testing (Fallback)
- Local Redis installation
- Or Redis accessible via REDIS_URL environment variable

## Troubleshooting

### Docker Issues
```bash
# Check Docker status
docker version
docker ps

# Force cleanup
docker ps -a --filter "label=test.cleanup=true" -q | xargs -r docker rm -f
docker network prune
docker volume prune
```

### Port Conflicts
```bash
# Use different base port
export REDIS_BASE_PORT=26379
npm run test:redis
```

### Test Failures
```bash
# Run with verbose output
REDIS_VERBOSE=true npm run test:redis

# Check Redis connection manually
redis-cli -p <port> ping
```

## Future Enhancements

1. **Redis Sentinel Support** - Add high availability testing
2. **Performance Benchmarks** - Add performance regression tests
3. **Memory Leak Detection** - Monitor memory usage during tests
4. **Multi-Region Testing** - Test with latency simulation
5. **Redis Modules** - Support for RedisJSON, RediSearch, etc.

## Conclusion

This testing infrastructure provides a robust, scalable, and maintainable way to test Redis functionality in the Titan framework. It supports both local development and CI/CD pipelines, with automatic cleanup and parallel execution capabilities.