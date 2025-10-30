# Docker-Based Database Testing

The Titan database module provides powerful utilities for testing with real databases in Docker containers, with automatic fallback to SQLite when Docker is not available.

## Features

- **Automatic Docker Detection**: Detects Docker availability across platforms (macOS, Linux, Windows)
- **Cross-Platform Support**: Works on macOS (Intel & Apple Silicon), Linux, and Windows
- **Multiple Database Support**: PostgreSQL, MySQL, MariaDB, and SQLite
- **Automatic Fallback**: Falls back to in-memory SQLite when Docker is unavailable
- **Container Lifecycle Management**: Automatic cleanup of containers and resources
- **CI/CD Optimized**: Smart defaults for CI environments (uses SQLite for speed)
- **Port Management**: Automatic port allocation to avoid conflicts
- **Health Checking**: Waits for database to be ready before running tests

## Quick Start

### Basic Usage

```typescript
import { createTestDatabase, withTestDatabase } from '@omnitron-dev/titan/module/database';

// Create a test database with automatic Docker detection
const context = await createTestDatabase({
  dialect: 'postgres',
  verbose: true,
});

console.log(`Using ${context.dialect} (Docker: ${context.isDocker})`);

// Use the database
const app = await Application.create(MyModule, {
  config: {
    database: context.connection,
  },
});

// Run tests...

// Cleanup
await context.cleanup();
await app.stop();
```

### Using `withTestDatabase` Helper

The `withTestDatabase` helper automatically handles cleanup:

```typescript
await withTestDatabase({ dialect: 'postgres' }, async (context) => {
  const app = await Application.create(MyModule, {
    config: {
      database: context.connection,
    },
  });

  // Run tests...

  await app.stop();
  // Cleanup happens automatically
});
```

## Configuration Options

### `DatabaseTestOptions`

```typescript
interface DatabaseTestOptions {
  /**
   * Preferred database dialect
   * If Docker is available, will start a container with this database
   * If Docker is not available, falls back to SQLite
   */
  dialect?: 'postgres' | 'mysql' | 'mariadb' | 'sqlite';

  /**
   * Database name (default: 'testdb')
   */
  database?: string;

  /**
   * Database user (default: 'testuser')
   */
  user?: string;

  /**
   * Database password (default: 'testpass')
   */
  password?: string;

  /**
   * Custom Docker path
   * Useful if Docker is installed in a non-standard location
   */
  dockerPath?: string;

  /**
   * Force SQLite even if Docker is available
   * Useful for testing SQLite-specific behavior
   */
  forceSqlite?: boolean;

  /**
   * Verbose logging
   * Logs Docker operations and container startup
   */
  verbose?: boolean;

  /**
   * Custom port or 'auto' for automatic allocation
   * Default: 'auto'
   */
  port?: number | 'auto';
}
```

## Docker Path Detection

The system automatically detects Docker across different platforms:

### macOS
- `/usr/local/bin/docker` (Intel Mac / Docker Desktop)
- `/opt/homebrew/bin/docker` (Apple Silicon Mac / Homebrew)
- `/Applications/Docker.app/Contents/Resources/bin/docker` (Docker Desktop)

### Linux
- `/usr/bin/docker` (Most common)
- `/usr/local/bin/docker` (Alternative)
- `/snap/bin/docker` (Snap package)
- `/var/lib/snapd/snap/bin/docker` (Snap on some distros)
- `/opt/docker/bin/docker` (Custom installations)

### Windows
- `docker.exe` in PATH
- `C:\Program Files\Docker\Docker\resources\bin\docker.exe`
- `C:\ProgramData\DockerDesktop\version-bin\docker.exe`

### Custom Docker Path

If Docker is installed in a non-standard location:

```typescript
const context = await createTestDatabase({
  dialect: 'postgres',
  dockerPath: '/custom/path/to/docker',
});
```

## Database Support

### PostgreSQL

```typescript
const context = await createTestDatabase({
  dialect: 'postgres',
  database: 'mydb',
  user: 'myuser',
  password: 'mypass',
});

// Connection config will be:
// {
//   dialect: 'postgres',
//   connection: {
//     host: '127.0.0.1',
//     port: 10234, // auto-allocated
//     database: 'mydb',
//     user: 'myuser',
//     password: 'mypass',
//   }
// }
```

**Image**: `postgres:16-alpine`
**Performance Optimizations**:
- `shared_buffers=256MB`
- `max_connections=200`
- `fsync=off` (test only!)
- `synchronous_commit=off` (test only!)
- Data stored in tmpfs for speed

### MySQL

```typescript
const context = await createTestDatabase({
  dialect: 'mysql',
  database: 'mydb',
  user: 'myuser',
  password: 'mypass',
});

// Connection config will be:
// {
//   dialect: 'mysql',
//   connection: {
//     host: '127.0.0.1',
//     port: 10235, // auto-allocated
//     database: 'mydb',
//     user: 'myuser',
//     password: 'mypass',
//   }
// }
```

**Image**: `mysql:8.0`
**Performance Optimizations**:
- `innodb-buffer-pool-size=256M`
- `innodb-flush-log-at-trx-commit=0` (test only!)
- `skip-log-bin` (test only!)
- Data stored in tmpfs for speed

### MariaDB

```typescript
const context = await createTestDatabase({
  dialect: 'mariadb',
  database: 'mydb',
  user: 'myuser',
  password: 'mypass',
});
```

**Image**: `mariadb:11`
**Note**: MariaDB uses the `mysql` dialect in connection config (compatible with MySQL)

### SQLite (Fallback)

When Docker is not available or `forceSqlite: true`:

```typescript
const context = await createTestDatabase({
  dialect: 'postgres', // Will fallback to SQLite
  forceSqlite: true,
});

// Connection config will be:
// {
//   dialect: 'sqlite',
//   connection: 'file::memory:?cache=shared',
// }
```

## Advanced Usage

### Check Docker Availability

```typescript
import { isDockerAvailable } from '@omnitron-dev/titan/module/database';

if (isDockerAvailable()) {
  console.log('Docker is available - using real databases');
} else {
  console.log('Docker not available - using SQLite fallback');
}
```

### Multiple Database Configurations

Test against multiple databases in parallel:

```typescript
import { createTestDatabaseConfigs, cleanupTestDatabaseConfigs } from '@omnitron-dev/titan/module/database';

const configs = await createTestDatabaseConfigs(['postgres', 'mysql', 'sqlite']);

describe.each(configs)('Database Tests - $dialect', ({ dialect, context, cleanup }) => {
  afterAll(async () => {
    await cleanup();
  });

  it('should work with ' + dialect, async () => {
    const app = await Application.create(MyModule, {
      config: {
        database: context.connection,
      },
    });

    // Run tests...

    await app.stop();
  });
});
```

### CI/CD Optimization

Automatically use SQLite in CI for speed:

```typescript
import { getRecommendedTestDatabase } from '@omnitron-dev/titan/module/database';

// In CI: uses SQLite
// In local dev: uses preferred dialect with Docker
const context = await getRecommendedTestDatabase({
  dialect: 'postgres', // Only used in local dev
});
```

## Jest Integration

### Basic Test Suite

```typescript
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createTestDatabase, DatabaseTestContext } from '@omnitron-dev/titan/module/database';

describe('User Service', () => {
  let context: DatabaseTestContext;
  let app: Application;

  beforeAll(async () => {
    context = await createTestDatabase({
      dialect: 'postgres',
      verbose: true,
    });

    app = await Application.create(MyModule, {
      config: {
        database: context.connection,
      },
    });

    // Create schema
    const db = await app.resolve(DatabaseManager).getConnection();
    await createSchema(db);
  }, 60000); // Increase timeout for Docker startup

  afterAll(async () => {
    await app.stop();
    await context.cleanup();
  });

  it('should create users', async () => {
    const userService = await app.resolve(UserService);
    const user = await userService.create({ name: 'Test' });
    expect(user).toBeDefined();
  });
});
```

### Parameterized Tests

Test against multiple databases:

```typescript
import { createTestDatabaseConfigs } from '@omnitron-dev/titan/module/database';

const databaseConfigs = await createTestDatabaseConfigs(['postgres', 'mysql', 'sqlite']);

describe.each(databaseConfigs)('User Service - $dialect', ({ dialect, context, cleanup }) => {
  let app: Application;

  beforeAll(async () => {
    app = await Application.create(MyModule, {
      config: {
        database: context.connection,
      },
    });
  });

  afterAll(async () => {
    await app.stop();
    await cleanup();
  });

  it('should work with ' + dialect, async () => {
    // Tests run against all databases
  });
});
```

## Docker Compose

The system includes a `docker-compose.test.yml` with pre-configured services:

```yaml
# Start all test databases
docker-compose -f test/docker/docker-compose.test.yml up -d

# Start specific database
docker-compose -f test/docker/docker-compose.test.yml up -d postgres-test

# Stop all
docker-compose -f test/docker/docker-compose.test.yml down

# View logs
docker-compose -f test/docker/docker-compose.test.yml logs -f postgres-test
```

### Environment Variables

Customize containers with environment variables:

```bash
# PostgreSQL
POSTGRES_PORT=5433 POSTGRES_DB=customdb docker-compose up postgres-test

# MySQL
MYSQL_PORT=3307 MYSQL_DATABASE=customdb docker-compose up mysql-test

# Test suite isolation
TEST_SUITE_ID=my-tests docker-compose up
```

## Best Practices

### 1. Use Appropriate Timeouts

Docker containers take time to start:

```typescript
beforeAll(async () => {
  context = await createTestDatabase({ dialect: 'postgres' });
  // ...
}, 60000); // 60 second timeout
```

### 2. Create Schema in beforeAll

```typescript
beforeAll(async () => {
  context = await createTestDatabase({ dialect: 'postgres' });
  app = await Application.create(MyModule, {
    config: { database: context.connection },
  });

  // Create schema once
  const db = await app.resolve(DatabaseManager).getConnection();
  await createSchema(db);
});
```

### 3. Clean Data Between Tests

```typescript
beforeEach(async () => {
  // Clean tables between tests
  const db = await app.resolve(DatabaseManager).getConnection();
  await db.deleteFrom('users').execute();
  await db.deleteFrom('orders').execute();
});
```

### 4. Use Transactions for Isolation

```typescript
import { DatabaseTestingModule } from '@omnitron-dev/titan/module/database';

@Module({
  imports: [
    DatabaseTestingModule.forTest({
      connection: context.connection,
      transactional: true, // Auto-rollback after each test
      autoClean: true,
    }),
  ],
})
class TestModule {}
```

### 5. Handle Docker Unavailability

Always design tests to work with both Docker and SQLite:

```typescript
beforeAll(async () => {
  context = await createTestDatabase({
    dialect: 'postgres',
    verbose: true,
  });

  if (!context.isDocker) {
    console.warn('Docker not available - using SQLite fallback');
  }
});
```

### 6. Use Shared Connections

For SQLite in-memory, use shared cache:

```typescript
const context = await createTestDatabase({
  dialect: 'sqlite',
  // Uses 'file::memory:?cache=shared' automatically
});
```

## Troubleshooting

### Docker Not Found

**Problem**: `Docker executable not found`

**Solutions**:
1. Install Docker: https://docs.docker.com/get-docker/
2. Ensure Docker is in PATH
3. Provide custom path:
   ```typescript
   createTestDatabase({
     dockerPath: '/usr/local/bin/docker',
   });
   ```

### Port Already in Use

**Problem**: Container fails to start due to port conflict

**Solution**: Use automatic port allocation (default):
```typescript
createTestDatabase({
  dialect: 'postgres',
  port: 'auto', // Default - finds available port
});
```

### Container Startup Timeout

**Problem**: Container doesn't become healthy in time

**Solutions**:
1. Increase test timeout:
   ```typescript
   beforeAll(async () => {
     // ...
   }, 120000); // 2 minutes
   ```

2. Check Docker resources (CPU, memory)

3. Pull images before running tests:
   ```bash
   docker pull postgres:16-alpine
   docker pull mysql:8.0
   ```

### Cleanup Issues

**Problem**: Containers not cleaned up after tests

**Solution**: Ensure cleanup is called:
```typescript
afterAll(async () => {
  await app.stop();
  await context.cleanup(); // Always cleanup!
});
```

Manual cleanup:
```bash
# Remove all test containers
docker ps -a --filter "label=test.cleanup=true" -q | xargs docker rm -f

# Remove test networks
docker network ls --filter "label=test.cleanup=true" -q | xargs docker network rm
```

## Performance Tips

### 1. Reuse Containers

For multiple test files, consider reusing containers:

```typescript
// setup-test-db.ts
export const globalContext = await createTestDatabase({
  dialect: 'postgres',
});

// test-file.ts
import { globalContext } from './setup-test-db';

// Use globalContext.connection in tests
```

### 2. Use tmpfs

Containers automatically use tmpfs for data storage (much faster than disk):

```yaml
postgres-test:
  tmpfs:
    - /var/lib/postgresql/data
```

### 3. Optimize Container Settings

Test containers are pre-configured with settings optimized for testing:
- Reduced fsync for speed
- Increased buffer sizes
- Disabled binary logging
- Reduced connection overhead

### 4. CI/CD

In CI, prefer SQLite for speed:

```typescript
const context = await getRecommendedTestDatabase({
  dialect: 'postgres',
});
// In CI: uses SQLite (fast)
// Locally: uses Postgres in Docker (realistic)
```

## Examples

See complete examples in:
- `/test/modules/database/docker-integration.spec.ts` - Docker integration tests
- `/test/modules/database/real-world-ecommerce.spec.ts` - Real-world application tests
- `/test/utils/docker-detection.spec.ts` - Docker detection tests

## API Reference

### `createTestDatabase(options?: DatabaseTestOptions): Promise<DatabaseTestContext>`

Creates a test database with automatic Docker detection and fallback.

### `withTestDatabase<T>(options: DatabaseTestOptions, testFn: (context: DatabaseTestContext) => Promise<T>): Promise<T>`

Runs a test function with a database context, automatically cleaning up afterwards.

### `isDockerAvailable(dockerPath?: string): boolean`

Checks if Docker is available on the system.

### `createTestDatabaseConfigs(dialects: string[], options?: Omit<DatabaseTestOptions, 'dialect'>): Promise<Array<{dialect, context, cleanup}>>`

Creates multiple database configurations for parameterized tests.

### `getRecommendedTestDatabase(options?: DatabaseTestOptions): Promise<DatabaseTestContext>`

Returns the recommended database for the current environment (CI vs local).

### `DatabaseTestContext`

```typescript
interface DatabaseTestContext {
  connection: DatabaseModuleOptions['connection'];
  dialect: 'postgres' | 'mysql' | 'mariadb' | 'sqlite';
  container?: DockerContainer;
  cleanup: () => Promise<void>;
  isDocker: boolean;
}
```

## Related

- [Database Testing Module](./testing.md)
- [Database Module](./README.md)
- [Repository Pattern](./repositories.md)
- [Migrations](./migrations.md)
