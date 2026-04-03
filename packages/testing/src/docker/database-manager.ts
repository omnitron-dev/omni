/**
 * Database Test Manager
 *
 * Provides specialized helpers for creating and managing database containers
 * in tests. Supports PostgreSQL and MySQL with sensible defaults.
 */

import { DockerTestManager } from './docker-test-manager.js';
import type { DockerContainer } from './types.js';

/**
 * Database Test Manager
 *
 * Provides convenient methods for creating PostgreSQL and MySQL containers
 * with proper health checks and connection strings.
 *
 * @example
 * ```typescript
 * // Create a PostgreSQL container
 * const pg = await DatabaseTestManager.createPostgresContainer({
 *   database: 'mydb',
 *   user: 'myuser',
 *   password: 'mypass',
 * });
 *
 * // Use with helper
 * await DatabaseTestManager.withPostgres(async (container, connStr) => {
 *   // Run tests with database
 * });
 * ```
 */
export class DatabaseTestManager {
  private static _dockerManager: DockerTestManager | null = null;

  /**
   * Get the Docker manager instance
   * @private
   */
  private static getDockerManager(): DockerTestManager {
    if (!DatabaseTestManager._dockerManager) {
      DatabaseTestManager._dockerManager = DockerTestManager.getInstance();
    }
    return DatabaseTestManager._dockerManager;
  }

  /**
   * Create a PostgreSQL container
   *
   * @param options - PostgreSQL configuration options
   * @returns Promise resolving to DockerContainer
   *
   * @example
   * ```typescript
   * const container = await DatabaseTestManager.createPostgresContainer({
   *   database: 'testdb',
   *   user: 'testuser',
   *   password: 'testpass',
   * });
   *
   * const port = container.ports.get(5432)!;
   * const connStr = `postgresql://testuser:testpass@localhost:${port}/testdb`;
   * ```
   */
  static async createPostgresContainer(options?: {
    /** Container name (auto-generated if not provided) */
    name?: string;
    /** Host port or 'auto' for dynamic allocation (default: 'auto') */
    port?: number | 'auto';
    /** Database name (default: 'testdb') */
    database?: string;
    /** Database user (default: 'testuser') */
    user?: string;
    /** Database password (default: 'testpass') */
    password?: string;
  }): Promise<DockerContainer> {
    const port = options?.port || 'auto';
    const database = options?.database || 'testdb';
    const user = options?.user || 'testuser';
    const password = options?.password || 'testpass';

    return DatabaseTestManager.getDockerManager().createContainer({
      name: options?.name,
      image: 'postgres:16-alpine',
      ports: { 5432: port },
      environment: {
        POSTGRES_DB: database,
        POSTGRES_USER: user,
        POSTGRES_PASSWORD: password,
        POSTGRES_HOST_AUTH_METHOD: 'trust',
      },
      healthcheck: {
        test: ['CMD-SHELL', `pg_isready -U ${user}`],
        interval: '1s',
        timeout: '5s',
        retries: 30,
        startPeriod: '5s',
      },
      waitFor: {
        healthcheck: true,
        timeout: 45000,
      },
    });
  }

  /**
   * Create a MySQL container
   *
   * @param options - MySQL configuration options
   * @returns Promise resolving to DockerContainer
   *
   * @example
   * ```typescript
   * const container = await DatabaseTestManager.createMySQLContainer({
   *   database: 'testdb',
   *   user: 'testuser',
   *   password: 'testpass',
   * });
   *
   * const port = container.ports.get(3306)!;
   * const connStr = `mysql://testuser:testpass@localhost:${port}/testdb`;
   * ```
   */
  static async createMySQLContainer(options?: {
    /** Container name (auto-generated if not provided) */
    name?: string;
    /** Host port or 'auto' for dynamic allocation (default: 'auto') */
    port?: number | 'auto';
    /** Database name (default: 'testdb') */
    database?: string;
    /** Database user (default: 'testuser') */
    user?: string;
    /** Database password (default: 'testpass') */
    password?: string;
    /** Root password (default: 'rootpass') */
    rootPassword?: string;
  }): Promise<DockerContainer> {
    const port = options?.port || 'auto';
    const database = options?.database || 'testdb';
    const user = options?.user || 'testuser';
    const password = options?.password || 'testpass';
    const rootPassword = options?.rootPassword || 'rootpass';

    return DatabaseTestManager.getDockerManager().createContainer({
      name: options?.name,
      image: 'mysql:8.0',
      ports: { 3306: port },
      environment: {
        MYSQL_DATABASE: database,
        MYSQL_USER: user,
        MYSQL_PASSWORD: password,
        MYSQL_ROOT_PASSWORD: rootPassword,
        MYSQL_ALLOW_EMPTY_PASSWORD: 'yes',
      },
      healthcheck: {
        test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost'],
        interval: '2s',
        timeout: '10s',
        retries: 25,
        startPeriod: '20s',
      },
      waitFor: {
        healthcheck: true,
        timeout: 90000, // MySQL 8.0 can take longer to initialize
      },
    });
  }

  /**
   * Run tests with a PostgreSQL container
   *
   * Creates a PostgreSQL container, runs the test function, and cleans up.
   *
   * @param testFn - Test function that receives container and connection string
   * @param options - PostgreSQL configuration options
   * @returns Promise resolving to test function result
   *
   * @example
   * ```typescript
   * await DatabaseTestManager.withPostgres(async (container, connectionString) => {
   *   const client = new Client({ connectionString });
   *   await client.connect();
   *   // Run tests...
   *   await client.end();
   * });
   * ```
   */
  static async withPostgres<T>(
    testFn: (container: DockerContainer, connectionString: string) => Promise<T>,
    options?: Parameters<typeof DatabaseTestManager.createPostgresContainer>[0]
  ): Promise<T> {
    const container = await DatabaseTestManager.createPostgresContainer(options);

    const port = container.ports.get(5432)!;
    const database = options?.database || 'testdb';
    const user = options?.user || 'testuser';
    const password = options?.password || 'testpass';
    const connectionString = `postgresql://${user}:${password}@localhost:${port}/${database}`;

    try {
      return await testFn(container, connectionString);
    } finally {
      await container.cleanup();
    }
  }

  /**
   * Run tests with a MySQL container
   *
   * Creates a MySQL container, runs the test function, and cleans up.
   *
   * @param testFn - Test function that receives container and connection string
   * @param options - MySQL configuration options
   * @returns Promise resolving to test function result
   *
   * @example
   * ```typescript
   * await DatabaseTestManager.withMySQL(async (container, connectionString) => {
   *   const connection = await mysql.createConnection(connectionString);
   *   // Run tests...
   *   await connection.end();
   * });
   * ```
   */
  static async withMySQL<T>(
    testFn: (container: DockerContainer, connectionString: string) => Promise<T>,
    options?: Parameters<typeof DatabaseTestManager.createMySQLContainer>[0]
  ): Promise<T> {
    const container = await DatabaseTestManager.createMySQLContainer(options);

    const port = container.ports.get(3306)!;
    const database = options?.database || 'testdb';
    const user = options?.user || 'testuser';
    const password = options?.password || 'testpass';
    const connectionString = `mysql://${user}:${password}@localhost:${port}/${database}`;

    try {
      return await testFn(container, connectionString);
    } finally {
      await container.cleanup();
    }
  }
}
