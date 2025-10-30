/**
 * Database Testing Utilities
 *
 * Provides utilities for testing database operations with real databases in Docker containers
 * Falls back to SQLite when Docker is not available
 */

import { DockerTestManager, DatabaseTestManager, DockerContainer } from '../../../testing/docker-test-manager.js';
import type { DatabaseModuleOptions } from '../database.types.js';

export interface DatabaseTestOptions {
  /**
   * Preferred database dialect to use for testing
   * If Docker is available, will start a container with this database
   * If Docker is not available, falls back to SQLite in-memory
   */
  dialect?: 'postgres' | 'mysql' | 'mariadb' | 'sqlite';

  /**
   * Database name
   */
  database?: string;

  /**
   * Database user
   */
  user?: string;

  /**
   * Database password
   */
  password?: string;

  /**
   * Custom Docker path
   */
  dockerPath?: string;

  /**
   * Force SQLite even if Docker is available
   */
  forceSqlite?: boolean;

  /**
   * Verbose logging
   */
  verbose?: boolean;

  /**
   * Custom port (or 'auto' for automatic port allocation)
   */
  port?: number | 'auto';
}

export interface DatabaseTestContext {
  /**
   * Database connection configuration
   */
  connection: DatabaseModuleOptions['connection'];

  /**
   * Dialect being used
   */
  dialect: 'postgres' | 'mysql' | 'mariadb' | 'sqlite';

  /**
   * Docker container (if using Docker)
   */
  container?: DockerContainer;

  /**
   * Cleanup function to stop container and release resources
   */
  cleanup: () => Promise<void>;

  /**
   * Whether Docker is being used
   */
  isDocker: boolean;
}

/**
 * Check if Docker is available
 */
export function isDockerAvailable(dockerPath?: string): boolean {
  try {
    DockerTestManager.getInstance({ dockerPath });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a test database context with automatic Docker detection
 *
 * This function will:
 * 1. Check if Docker is available
 * 2. If Docker is available and not forceSqlite, start a database container
 * 3. If Docker is not available or forceSqlite is true, use in-memory SQLite
 * 4. Return a context object with connection config and cleanup function
 */
export async function createTestDatabase(options: DatabaseTestOptions = {}): Promise<DatabaseTestContext> {
  const {
    dialect = 'postgres',
    database = 'testdb',
    user = 'testuser',
    password = 'testpass',
    dockerPath,
    forceSqlite = false,
    verbose = false,
    port = 'auto',
  } = options;

  // Check if Docker is available
  const dockerAvailable = !forceSqlite && isDockerAvailable(dockerPath);

  if (dockerAvailable) {
    try {
      if (verbose) {
        console.log(`Starting ${dialect} container for testing...`);
      }

      let container: DockerContainer;
      let connectionConfig: any;

      switch (dialect) {
        case 'postgres':
          container = await DatabaseTestManager.createPostgresContainer({
            port,
            database,
            user,
            password,
          });
          connectionConfig = {
            dialect: 'postgres',
            connection: {
              host: container.host,
              port: container.ports.get(5432)!,
              database,
              user,
              password,
              // Optimize for testing
              connectionTimeoutMillis: 5000,
              idleTimeoutMillis: 10000,
              max: 10,
            },
          };
          break;

        case 'mysql':
        case 'mariadb':
          container = await DatabaseTestManager.createMySQLContainer({
            port,
            database,
            user,
            password,
          });
          connectionConfig = {
            dialect: 'mysql',
            connection: {
              host: container.host,
              port: container.ports.get(3306)!,
              database,
              user,
              password,
              // Optimize for testing
              connectionLimit: 10,
              connectTimeout: 5000,
            },
          };
          break;

        default:
          throw new Error(`Unsupported dialect for Docker: ${dialect}`);
      }

      if (verbose) {
        console.log(`${dialect} container started on port ${container.port}`);
      }

      return {
        connection: connectionConfig,
        dialect,
        container,
        isDocker: true,
        cleanup: async () => {
          if (verbose) {
            console.log(`Stopping ${dialect} container...`);
          }
          await container.cleanup();
        },
      };
    } catch (error) {
      console.warn(`Failed to start Docker container, falling back to SQLite: ${error}`);
      // Fall through to SQLite fallback
    }
  }

  // Fallback to SQLite
  if (verbose && !forceSqlite) {
    console.log('Docker not available, using in-memory SQLite for testing');
  } else if (verbose) {
    console.log('Using in-memory SQLite for testing (forced)');
  }

  return {
    connection: {
      dialect: 'sqlite',
      connection: 'file::memory:?cache=shared',
    } as any,
    dialect: 'sqlite',
    isDocker: false,
    cleanup: async () => {
      // No cleanup needed for in-memory SQLite
    },
  };
}

/**
 * Helper function to run tests with a specific database
 *
 * @example
 * ```typescript
 * await withTestDatabase({ dialect: 'postgres' }, async (context) => {
 *   const app = await Application.create(MyModule, {
 *     config: {
 *       database: context.connection,
 *     },
 *   });
 *
 *   // Run tests...
 *
 *   await app.stop();
 * });
 * ```
 */
export async function withTestDatabase<T>(
  options: DatabaseTestOptions,
  testFn: (context: DatabaseTestContext) => Promise<T>
): Promise<T> {
  const context = await createTestDatabase(options);

  try {
    return await testFn(context);
  } finally {
    await context.cleanup();
  }
}

/**
 * Create test database configuration for multiple dialects
 *
 * This is useful for parameterized tests that run against multiple database types
 *
 * @example
 * ```typescript
 * const configs = await createTestDatabaseConfigs(['postgres', 'mysql', 'sqlite']);
 *
 * describe.each(configs)('Database Tests - $dialect', ({ dialect, context, cleanup }) => {
 *   afterAll(async () => {
 *     await cleanup();
 *   });
 *
 *   it('should work with ' + dialect, async () => {
 *     // Test code using context.connection
 *   });
 * });
 * ```
 */
export async function createTestDatabaseConfigs(
  dialects: Array<'postgres' | 'mysql' | 'mariadb' | 'sqlite'>,
  options: Omit<DatabaseTestOptions, 'dialect'> = {}
): Promise<
  Array<{
    dialect: string;
    context: DatabaseTestContext;
    cleanup: () => Promise<void>;
  }>
> {
  const configs: Array<{
    dialect: string;
    context: DatabaseTestContext;
    cleanup: () => Promise<void>;
  }> = [];

  for (const dialect of dialects) {
    const context = await createTestDatabase({
      ...options,
      dialect,
    });

    configs.push({
      dialect,
      context,
      cleanup: context.cleanup,
    });
  }

  return configs;
}

/**
 * Cleanup all test database contexts
 */
export async function cleanupTestDatabaseConfigs(
  configs: Array<{
    cleanup: () => Promise<void>;
  }>
): Promise<void> {
  await Promise.all(configs.map((config) => config.cleanup()));
}

/**
 * Get recommended database for CI/CD environment
 *
 * Returns the best database to use based on the environment:
 * - CI environments: SQLite (fast, no dependencies)
 * - Local development with Docker: PostgreSQL
 * - Local development without Docker: SQLite
 */
export async function getRecommendedTestDatabase(options: DatabaseTestOptions = {}): Promise<DatabaseTestContext> {
  const isCI = process.env['CI'] === 'true' || process.env['GITHUB_ACTIONS'] === 'true';

  if (isCI) {
    // Use SQLite in CI for speed and simplicity
    return createTestDatabase({
      ...options,
      forceSqlite: true,
    });
  }

  // Use preferred dialect with automatic fallback
  return createTestDatabase(options);
}
