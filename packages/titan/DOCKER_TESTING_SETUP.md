# Docker Testing Setup Complete

## Summary

The Titan database module now includes comprehensive Docker support for cross-platform database testing with automatic fallback to SQLite when Docker is not available.

## What Was Implemented

### 1. Cross-Platform Docker Detection
- **File**: `src/testing/docker-test-manager.ts`
- Detects Docker executable across macOS, Linux, and Windows
- Handles platform-specific paths and Docker Desktop installations
- Validates Docker availability before attempting to start containers

**Supported Paths**:
- macOS: `/usr/local/bin/docker`, `/opt/homebrew/bin/docker` (Apple Silicon)
- Linux: `/usr/bin/docker`, `/usr/local/bin/docker`, `/snap/bin/docker`
- Windows: `docker.exe` in PATH, Program Files locations

### 2. Database Testing Utilities
- **File**: `src/modules/database/testing/test-utilities.ts`
- `createTestDatabase()` - Creates test database with auto-detection
- `withTestDatabase()` - Helper for automatic cleanup
- `isDockerAvailable()` - Check Docker availability
- `getRecommendedTestDatabase()` - Smart defaults for CI vs local
- `createTestDatabaseConfigs()` - Multi-database testing support

### 3. Docker Compose Configuration
- **File**: `test/docker/docker-compose.test.yml`
- Pre-configured services: PostgreSQL, MySQL, MariaDB, Redis
- Performance optimizations for testing (tmpfs, reduced fsync, etc.)
- Health checks for reliable container startup
- Automatic cleanup with labels

### 4. Documentation
- **File**: `docs/database/docker-testing.md`
- Comprehensive guide with examples
- Configuration options
- Best practices and troubleshooting
- CI/CD integration patterns

### 5. Example Tests
- **File**: `test/modules/database/docker-integration.spec.ts`
- Demonstrates Docker integration
- Shows fallback behavior
- Cross-database compatibility tests

## Key Features

### Automatic Docker Detection
```typescript
import { createTestDatabase } from '@omnitron-dev/titan/module/database';

// Automatically detects Docker and starts container
// Falls back to SQLite if Docker is not available
const context = await createTestDatabase({
  dialect: 'postgres',
  verbose: true,
});

console.log(`Using ${context.dialect} (Docker: ${context.isDocker})`);
```

### Cross-Platform Support
The system works on:
- **macOS** (Intel and Apple Silicon)
- **Linux** (including Ubuntu, Debian, RHEL, Arch)
- **Windows** (with Docker Desktop or WSL2)

### Multiple Database Support
- PostgreSQL 16 (Alpine)
- MySQL 8.0
- MariaDB 11
- SQLite (fallback)

### Automatic Fallback
When Docker is unavailable:
- Automatically falls back to in-memory SQLite
- Tests continue to run (no Docker required)
- Logs clear messages about fallback

### CI/CD Optimized
```typescript
import { getRecommendedTestDatabase } from '@omnitron-dev/titan/module/database';

// In CI: uses SQLite (fast, no Docker needed)
// Locally: uses preferred dialect with Docker (realistic)
const context = await getRecommendedTestDatabase({
  dialect: 'postgres',
});
```

## Usage Examples

### Basic Test
```typescript
import { withTestDatabase } from '@omnitron-dev/titan/module/database';

await withTestDatabase({ dialect: 'postgres' }, async (context) => {
  const app = await Application.create(MyModule, {
    config: { database: context.connection },
  });

  // Run tests...

  await app.stop();
  // Cleanup happens automatically
});
```

### Multi-Database Tests
```typescript
import { createTestDatabaseConfigs } from '@omnitron-dev/titan/module/database';

const configs = await createTestDatabaseConfigs(['postgres', 'mysql', 'sqlite']);

describe.each(configs)('Tests - $dialect', ({ dialect, context, cleanup }) => {
  afterAll(async () => await cleanup());

  it('should work with ' + dialect, async () => {
    // Test against all databases
  });
});
```

### Check Docker Availability
```typescript
import { isDockerAvailable } from '@omnitron-dev/titan/module/database';

if (isDockerAvailable()) {
  console.log('Using real databases with Docker');
} else {
  console.log('Using SQLite fallback');
}
```

## Docker Path Customization

If Docker is in a non-standard location:

```typescript
const context = await createTestDatabase({
  dialect: 'postgres',
  dockerPath: '/custom/path/to/docker',
});
```

The user mentioned Docker is at `/usr/local/bin/docker` on their system, which is automatically detected by the system (it's in the default search paths).

## Running Tests

### With Docker (Recommended for Local Development)
```bash
# Ensure Docker is running
docker ps

# Run tests (automatically uses Docker if available)
pnpm test test/modules/database/docker-integration.spec.ts
```

### Without Docker (CI/CD or Development)
```bash
# Tests automatically fall back to SQLite
pnpm test test/modules/database/docker-integration.spec.ts
```

### Manual Docker Compose
```bash
# Start all test databases
docker-compose -f test/docker/docker-compose.test.yml up -d

# Run tests
pnpm test

# Stop containers
docker-compose -f test/docker/docker-compose.test.yml down
```

## Configuration Options

### Database Test Options
```typescript
interface DatabaseTestOptions {
  dialect?: 'postgres' | 'mysql' | 'mariadb' | 'sqlite';
  database?: string;
  user?: string;
  password?: string;
  dockerPath?: string;
  forceSqlite?: boolean;
  verbose?: boolean;
  port?: number | 'auto';
}
```

### Environment Variables (Docker Compose)
```bash
# PostgreSQL
POSTGRES_PORT=5433 \
POSTGRES_DB=mydb \
POSTGRES_USER=myuser \
docker-compose up postgres-test

# MySQL
MYSQL_PORT=3307 \
MYSQL_DATABASE=mydb \
docker-compose up mysql-test

# Test suite isolation
TEST_SUITE_ID=my-tests docker-compose up
```

## Files Modified/Created

### Created
- `src/testing/docker-test-manager.ts` - Docker container management
- `src/modules/database/testing/test-utilities.ts` - Database testing utilities
- `test/modules/database/docker-integration.spec.ts` - Example tests
- `docs/database/docker-testing.md` - Comprehensive documentation

### Modified
- `test/docker/docker-compose.test.yml` - Added database services
- `src/modules/database/index.ts` - Exported new utilities
- `src/testing/index.ts` - Exported Docker test manager

## Performance Optimizations

All database containers are configured for testing performance:

### PostgreSQL
- tmpfs storage (fast, in-memory)
- `fsync=off` (don't wait for disk writes)
- `synchronous_commit=off` (async commits)
- Increased shared buffers (256MB)

### MySQL
- tmpfs storage
- `innodb-flush-log-at-trx-commit=0` (don't flush on commit)
- `skip-log-bin` (no binary logging)
- Increased buffer pool (256MB)

### All Databases
- Fast health checks
- Optimized connection limits
- Reduced timeouts

## Next Steps

### For Users
1. Install Docker (optional, but recommended for local development)
2. Run tests with `pnpm test`
3. Tests automatically detect Docker and use it if available
4. If Docker is not available, tests use SQLite automatically

### For CI/CD
1. No Docker installation required
2. Tests automatically use SQLite in CI
3. Fast and reliable without container overhead

### For Development
1. Docker Desktop recommended for realistic testing
2. Use `verbose: true` to see container startup logs
3. Containers automatically cleaned up on test completion
4. Manual cleanup available if needed

## Troubleshooting

### Docker Not Detected
If Docker is installed but not detected:
```typescript
const context = await createTestDatabase({
  dialect: 'postgres',
  dockerPath: '/usr/local/bin/docker', // Your Docker path
  verbose: true,
});
```

### Port Conflicts
Use automatic port allocation (default):
```typescript
const context = await createTestDatabase({
  dialect: 'postgres',
  port: 'auto', // Finds available port
});
```

### Container Cleanup
Manual cleanup if needed:
```bash
# Remove all test containers
docker ps -a --filter "label=test.cleanup=true" -q | xargs docker rm -f

# Remove test networks
docker network ls --filter "label=test.cleanup=true" -q | xargs docker network rm
```

## Verification

To verify the setup is working:

```bash
# Run Docker detection tests
pnpm test test/utils/docker-detection.spec.ts

# Run database integration tests
pnpm test test/modules/database/docker-integration.spec.ts

# Check Docker availability
docker ps
```

## Benefits

1. **Realistic Testing**: Test against actual databases (PostgreSQL, MySQL)
2. **Cross-Platform**: Works on macOS, Linux, Windows
3. **No Configuration**: Automatic Docker detection and fallback
4. **CI/CD Ready**: Works with or without Docker
5. **Performance**: Optimized containers for fast test execution
6. **Clean**: Automatic container cleanup
7. **Flexible**: Easy to customize and extend

## Support

For issues or questions:
1. Check `docs/database/docker-testing.md` for detailed documentation
2. Review example tests in `test/modules/database/docker-integration.spec.ts`
3. Enable verbose logging: `{ verbose: true }`
4. Check Docker installation: `docker ps`
