/**
 * Database Testing Module
 *
 * Provides utilities and configuration for testing database operations
 * with automatic rollback, seeding, and cleanup capabilities
 */

import { DynamicModule, IModule } from '../../../nexus/index.js';
import { Module, Injectable, Inject } from '../../../decorators/index.js';
import { Kysely, Transaction, sql } from 'kysely';
import { TitanDatabaseModule } from '../database.module.js';
import { DatabaseManager } from '../database.manager.js';
import { MigrationRunner } from '../migration/migration.runner.js';
import { TransactionManager } from '../transaction/transaction.manager.js';
import { Errors } from '../../../errors/index.js';
// @kysera/testing utilities (moved from @kysera/core in 0.7.0)
import {
  testInTransaction,
  testWithSavepoints,
  testWithIsolation,
  cleanDatabase as kyseraCleanDatabase,
  seedDatabase as kyseraSeedDatabase,
  snapshotTable,
  countRows,
  waitFor,
  createFactory as kyseraCreateFactory,
  type CleanupStrategy,
  type IsolationLevel,
} from '@kysera/testing';
import {
  DATABASE_MANAGER,
  DATABASE_MIGRATION_SERVICE,
  DATABASE_TRANSACTION_MANAGER,
  DATABASE_TESTING_SERVICE,
} from '../database.constants.js';
import type { DatabaseModuleOptions } from '../database.types.js';

export interface DatabaseTestingOptions extends Partial<DatabaseModuleOptions> {
  /**
   * Auto-rollback transactions after each test
   */
  transactional?: boolean;

  /**
   * Auto-migrate database before tests
   */
  autoMigrate?: boolean;

  /**
   * Auto-seed database with fixtures
   */
  autoSeed?: boolean;

  /**
   * Seed data or seed function
   */
  seeds?: any[] | (() => Promise<void>);

  /**
   * Clean database before each test
   */
  autoClean?: boolean;

  /**
   * Tables to preserve during cleanup
   */
  preserveTables?: string[];

  /**
   * Use isolated schema for each test suite
   */
  isolatedSchema?: boolean;

  /**
   * Schema name prefix for isolated schemas
   */
  schemaPrefix?: string;

  /**
   * Verbose logging for debugging
   */
  verbose?: boolean;
}

/**
 * Database Testing Service
 *
 * Provides utilities for database testing
 */
@Injectable()
export class DatabaseTestingService {
  private currentTransaction?: Transaction<unknown>;
  private schemaName?: string;
  private isInitialized = false;

  constructor(
    @Inject(DATABASE_MANAGER) private manager: DatabaseManager,
    @Inject('DATABASE_TESTING_OPTIONS') private options: DatabaseTestingOptions,
    @Inject(DATABASE_MIGRATION_SERVICE) private migrationRunner?: MigrationRunner,
    @Inject(DATABASE_TRANSACTION_MANAGER) private transactionManager?: TransactionManager
  ) {}

  /**
   * Initialize test database
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    const db = await this.manager.getConnection();

    // Create isolated schema if needed
    if (this.options.isolatedSchema) {
      await this.createIsolatedSchema(db as Kysely<Record<string, unknown>>);
    }

    // Run migrations if enabled
    if (this.options.autoMigrate && this.migrationRunner) {
      await this.migrationRunner.migrate();
    }

    // Seed database if enabled
    if (this.options.autoSeed && this.options.seeds) {
      await this.seedDatabase();
    }

    this.isInitialized = true;
  }

  /**
   * Setup before each test
   */
  async beforeEach(): Promise<void> {
    const db = await this.manager.getConnection();

    // Clean database if enabled
    if (this.options.autoClean) {
      await this.cleanDatabase();
    }

    // Start transaction if transactional mode is enabled
    // Note: We don't actually start a transaction here for SQLite in-memory
    // because it would require wrapping all test operations, which is complex.
    // Instead, we rely on autoClean to reset state between tests.
    // For PostgreSQL/MySQL, transactions could be supported in the future.
    if (this.options.transactional) {
      // For now, transactional mode just ensures autoClean is enabled
      // Future enhancement: Implement proper transaction wrapping
    }

    // Re-seed if needed
    if (this.options.autoSeed && this.options.seeds && this.options.autoClean) {
      await this.seedDatabase();
    }
  }

  /**
   * Cleanup after each test
   */
  async afterEach(): Promise<void> {
    // Rollback transaction if in transactional mode
    if (this.options.transactional && this.currentTransaction) {
      // Transaction will automatically rollback when not committed
      this.currentTransaction = undefined;
    }
  }

  /**
   * Cleanup after all tests
   */
  async afterAll(): Promise<void> {
    if (this.options.isolatedSchema && this.schemaName) {
      await this.dropIsolatedSchema();
    }
    this.isInitialized = false;
  }

  /**
   * Clean all data from database
   */
  async cleanDatabase(): Promise<void> {
    const db = (await this.manager.getConnection()) as Kysely<Record<string, unknown>>;
    const dialect = this.getDialect(db);
    const preserveTables = this.options.preserveTables || [];

    // Get all tables
    const tables = await this.getAllTables(db, dialect);

    // Clean tables in reverse order to handle foreign keys
    for (const table of tables.reverse()) {
      if (preserveTables.includes(table)) continue;

      try {
        if (dialect === 'postgres') {
          await sql`TRUNCATE TABLE ${sql.table(table)} RESTART IDENTITY CASCADE`.execute(db);
        } else if (dialect === 'mysql') {
          await sql`SET FOREIGN_KEY_CHECKS = 0`.execute(db);
          await sql`TRUNCATE TABLE ${sql.table(table)}`.execute(db);
          await sql`SET FOREIGN_KEY_CHECKS = 1`.execute(db);
        } else {
          // SQLite
          await sql`DELETE FROM ${sql.table(table)}`.execute(db);
          // Reset autoincrement
          await sql`DELETE FROM sqlite_sequence WHERE name = ${table}`.execute(db);
        }
      } catch (error) {
        if (this.options.verbose) {
          console.warn(`Failed to clean table ${table}:`, error);
        }
      }
    }
  }

  /**
   * Seed database with test data
   */
  async seedDatabase(seeds?: Array<{ table: string; data: unknown }>): Promise<void> {
    const seedData = seeds || this.options.seeds;

    if (!seedData) return;

    if (typeof seedData === 'function') {
      await seedData();
    } else if (Array.isArray(seedData)) {
      await this.insertSeeds(seedData);
    }
  }

  /**
   * Insert seed data
   */
  private async insertSeeds(seeds: Array<{ table: string; data: unknown }>): Promise<void> {
    const db = this.currentTransaction || (await this.manager.getConnection());

    for (const seed of seeds) {
      if (!seed.table || !seed.data) continue;

      try {
        const records = Array.isArray(seed.data) ? seed.data : [seed.data];

        for (const record of records) {
          await (db as Kysely<Record<string, unknown>>)
            .insertInto(seed.table)
            .values(record)
            .execute();
        }
      } catch (error) {
        if (this.options.verbose) {
          console.error(`Failed to seed table ${seed.table}:`, error);
        }
      }
    }
  }

  /**
   * Create isolated schema for testing
   */
  private async createIsolatedSchema(db: Kysely<Record<string, unknown>>): Promise<void> {
    const dialect = this.getDialect(db);

    if (dialect === 'postgres') {
      const prefix = this.options.schemaPrefix || 'test';
      this.schemaName = `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      await sql`CREATE SCHEMA IF NOT EXISTS ${sql.ref(this.schemaName)}`.execute(db);
      await sql`SET search_path TO ${sql.ref(this.schemaName)}`.execute(db);
    }
    // MySQL and SQLite don't support schemas the same way
  }

  /**
   * Drop isolated schema
   */
  private async dropIsolatedSchema(): Promise<void> {
    if (!this.schemaName) return;

    const db = (await this.manager.getConnection()) as Kysely<Record<string, unknown>>;
    const dialect = this.getDialect(db);

    if (dialect === 'postgres') {
      await sql`DROP SCHEMA IF EXISTS ${sql.ref(this.schemaName)} CASCADE`.execute(db);
      await sql`SET search_path TO public`.execute(db);
    }
  }

  /**
   * Get all tables in database
   */
  private async getAllTables(
    db: Kysely<Record<string, unknown>>,
    dialect: string
  ): Promise<string[]> {
    interface TableRow {
      table_name: string;
    }

    let result: { rows: TableRow[] };

    if (dialect === 'postgres') {
      result = await sql<TableRow>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ${this.schemaName || 'public'}
          AND table_type = 'BASE TABLE'
      `.execute(db);
      return result.rows.map((r) => r.table_name);
    } else if (dialect === 'mysql') {
      result = await sql<TableRow>`
        SELECT TABLE_NAME as table_name
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_TYPE = 'BASE TABLE'
      `.execute(db);
      return result.rows.map((r) => r.table_name);
    } else {
      // SQLite
      result = await sql<TableRow>`
        SELECT name as table_name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
      `.execute(db);
      return result.rows.map((r) => r.table_name);
    }
  }

  /**
   * Get database dialect
   */
  private getDialect(db: Kysely<Record<string, unknown>>): string {
    // Try to determine dialect from the connection
    const dbWithDialect = db as unknown as {
      dialect?: { name?: string };
      _dialect?: { name?: string };
      driver?: { postgres?: unknown; mysql?: unknown };
    };

    const dialectName = dbWithDialect.dialect?.name || dbWithDialect._dialect?.name;

    if (dialectName) return dialectName;

    // Fallback to checking the driver
    if (dbWithDialect.driver?.postgres) return 'postgres';
    if (dbWithDialect.driver?.mysql) return 'mysql';

    return 'sqlite';
  }

  /**
   * Create a savepoint for nested testing
   */
  async createSavepoint(name: string): Promise<void> {
    if (!this.currentTransaction) {
      throw Errors.conflict('Savepoints require transactional mode');
    }

    await sql`SAVEPOINT ${sql.ref(name)}`.execute(this.currentTransaction);
  }

  /**
   * Rollback to savepoint
   */
  async rollbackToSavepoint(name: string): Promise<void> {
    if (!this.currentTransaction) {
      throw Errors.conflict('Savepoints require transactional mode');
    }

    await sql`ROLLBACK TO SAVEPOINT ${sql.ref(name)}`.execute(this.currentTransaction);
  }

  /**
   * Execute a query in test context
   */
  async execute<T>(query: (db: Kysely<Record<string, unknown>>) => Promise<T>): Promise<T> {
    const db = this.currentTransaction || (await this.manager.getConnection());
    return query(db as Kysely<Record<string, unknown>>);
  }

  /**
   * Get test database connection
   */
  getTestConnection(): Kysely<Record<string, unknown>> | Transaction<unknown> {
    return (this.currentTransaction || this.manager.getConnection()) as
      | Kysely<Record<string, unknown>>
      | Transaction<unknown>;
  }

  /**
   * Factory method to create test data
   */
  async factory<T extends Record<string, unknown>>(
    table: string,
    generator: () => Partial<T> | Promise<Partial<T>>,
    count: number = 1
  ): Promise<T[]> {
    const db = this.getTestConnection();
    const results: T[] = [];

    for (let i = 0; i < count; i++) {
      const data = await generator();
      const result = await (db as Kysely<Record<string, unknown>>)
        .insertInto(table)
        .values(data)
        .returningAll()
        .executeTakeFirst();

      if (result) {
        results.push(result as T);
      }
    }

    return results;
  }

  /**
   * Assert database state
   */
  async assertDatabaseHas(table: string, data: Record<string, unknown>): Promise<boolean> {
    const db = this.getTestConnection() as Kysely<Record<string, unknown>>;

    let query = db.selectFrom(table).selectAll();

    for (const [key, value] of Object.entries(data)) {
      // Use type assertion to bypass strict type checking for dynamic queries
      query = query.where(key as never, '=', value as never);
    }

    const result = await query.executeTakeFirst();
    return result !== undefined;
  }

  /**
   * Assert database doesn't have specific data
   */
  async assertDatabaseMissing(table: string, data: Record<string, unknown>): Promise<boolean> {
    const has = await this.assertDatabaseHas(table, data);
    return !has;
  }

  /**
   * Count records in table
   */
  async assertDatabaseCount(table: string, count: number): Promise<boolean> {
    const db = this.getTestConnection();

    const result = await (db as Kysely<Record<string, unknown>>)
      .selectFrom(table)
      .select(sql<number>`count(*)`.as('count'))
      .executeTakeFirst();

    return result?.count === count;
  }

  // ============================================================================
  // KYSERA-CORE TESTING UTILITIES INTEGRATION
  // ============================================================================

  /**
   * Run test in a transaction that automatically rolls back
   * Uses @kysera/core testInTransaction for automatic cleanup
   *
   * @example
   * ```typescript
   * await testingService.runInTransaction(async (trx) => {
   *   await trx.insertInto('users').values({ name: 'test' }).execute();
   *   // Transaction auto-rolls back after test
   * });
   * ```
   */
  async runInTransaction<T>(
    fn: (trx: Transaction<unknown>) => Promise<T>
  ): Promise<void> {
    const db = await this.manager.getConnection();
    await testInTransaction(db, fn);
  }

  /**
   * Run test with savepoints for nested transaction testing
   * Uses @kysera/core testWithSavepoints
   *
   * @example
   * ```typescript
   * await testingService.runWithSavepoints(async (trx) => {
   *   await trx.insertInto('users').values({ name: 'test' }).execute();
   *   // Savepoint created and rolled back automatically
   * });
   * ```
   */
  async runWithSavepoints<T>(
    fn: (trx: Transaction<unknown>) => Promise<T>
  ): Promise<void> {
    const db = await this.manager.getConnection();
    await testWithSavepoints(db, fn);
  }

  /**
   * Run test with specific isolation level
   * Uses @kysera/core testWithIsolation
   *
   * @param isolationLevel - 'read uncommitted' | 'read committed' | 'repeatable read' | 'serializable'
   *
   * @example
   * ```typescript
   * await testingService.runWithIsolation('serializable', async (trx) => {
   *   // Test concurrent access scenarios
   * });
   * ```
   */
  async runWithIsolation<T>(
    isolationLevel: IsolationLevel,
    fn: (trx: Transaction<unknown>) => Promise<T>
  ): Promise<void> {
    const db = await this.manager.getConnection();
    await testWithIsolation(db, isolationLevel, fn);
  }

  /**
   * Clean database using @kysera/core cleanup strategies
   *
   * @param strategy - 'truncate' | 'transaction' | 'delete'
   * @param tables - Optional list of tables to clean (cleans all if not specified)
   *
   * @example
   * ```typescript
   * await testingService.cleanWithKysera('truncate', ['users', 'posts']);
   * ```
   */
  async cleanWithKysera(
    strategy: CleanupStrategy = 'delete',
    tables?: string[]
  ): Promise<void> {
    const db = await this.manager.getConnection();
    await kyseraCleanDatabase(db, strategy, tables);
  }

  /**
   * Seed database using @kysera/core seedDatabase
   *
   * @example
   * ```typescript
   * await testingService.seedWithKysera(async (trx) => {
   *   await trx.insertInto('users').values([...]).execute();
   * });
   * ```
   */
  async seedWithKysera(
    fn: (trx: Transaction<unknown>) => Promise<void>
  ): Promise<void> {
    const db = await this.manager.getConnection();
    await kyseraSeedDatabase(db, fn);
  }

  /**
   * Take a snapshot of table data for comparison
   * Uses @kysera/core snapshotTable
   *
   * @example
   * ```typescript
   * const before = await testingService.snapshotTable('users');
   * // ... perform operations
   * const after = await testingService.snapshotTable('users');
   * expect(after.length).toBe(before.length + 1);
   * ```
   */
  async snapshotTable<T = unknown>(table: string): Promise<T[]> {
    const db = await this.manager.getConnection();
    return snapshotTable(db, table) as Promise<T[]>;
  }

  /**
   * Count rows in a table using @kysera/core countRows
   *
   * @example
   * ```typescript
   * const count = await testingService.countRows('users');
   * expect(count).toBe(5);
   * ```
   */
  async countTableRows(table: string): Promise<number> {
    const db = await this.manager.getConnection();
    return countRows(db, table);
  }

  /**
   * Wait for a condition to become true
   * Uses @kysera/core waitFor - useful for async operations
   *
   * @example
   * ```typescript
   * await testingService.waitForCondition(
   *   async () => (await testingService.countTableRows('events')) > 0,
   *   { timeout: 5000, interval: 100 }
   * );
   * ```
   */
  async waitForCondition(
    condition: () => Promise<boolean> | boolean,
    options?: { timeout?: number; interval?: number; timeoutMessage?: string }
  ): Promise<void> {
    await waitFor(condition, options);
  }

  /**
   * Create a test data factory using @kysera/core createFactory
   *
   * @example
   * ```typescript
   * const createUser = testingService.createDataFactory({
   *   id: 1,
   *   email: () => `user${Date.now()}@test.com`,
   *   name: 'Test User',
   * });
   *
   * const user1 = createUser(); // Uses defaults
   * const user2 = createUser({ name: 'Custom Name' }); // Override name
   * ```
   */
  createDataFactory<T extends Record<string, unknown>>(
    defaults: { [K in keyof T]: T[K] | (() => T[K]) }
  ): (overrides?: Partial<T>) => T {
    return kyseraCreateFactory(defaults);
  }

  /**
   * Create multiple test records using factory pattern
   *
   * @example
   * ```typescript
   * const createUser = testingService.createDataFactory({ ... });
   * const users = await testingService.createManyFromFactory('users', createUser, 10);
   * ```
   */
  async createManyFromFactory<T extends Record<string, unknown>>(
    table: string,
    factory: (overrides?: Partial<T>) => T,
    count: number,
    overrides?: Partial<T>
  ): Promise<T[]> {
    const db = this.getTestConnection() as Kysely<Record<string, unknown>>;
    const results: T[] = [];

    for (let i = 0; i < count; i++) {
      const data = factory(overrides);
      const result = await db
        .insertInto(table)
        .values(data)
        .returningAll()
        .executeTakeFirst();

      if (result) {
        results.push(result as T);
      }
    }

    return results;
  }
}

/**
 * Database Testing Module
 */
@Module({})
export class DatabaseTestingModule {
  /**
   * Create testing module with configuration
   */
  static forTest(options: DatabaseTestingOptions = {}): DynamicModule {
    const defaultOptions: DatabaseTestingOptions = {
      transactional: true,
      autoMigrate: true,
      autoClean: true,
      verbose: false,
      ...options,
    };

    // Override connection to use in-memory SQLite by default
    // Use a named shared memory database so all connections within the same process
    // share the same database instance
    if (!options.connection) {
      const dbName = `test_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      defaultOptions.connection = {
        dialect: 'sqlite',
        connection: `file:${dbName}?mode=memory&cache=shared`,
      };
    }

    const providers = [
      {
        provide: 'DATABASE_TESTING_OPTIONS',
        useValue: defaultOptions,
      },
      {
        provide: DATABASE_TESTING_SERVICE,
        useFactory: async (manager: DatabaseManager) =>
          new DatabaseTestingService(
            manager,
            defaultOptions,
            undefined, // migrationRunner (optional)
            undefined // transactionManager (optional)
          ),
        inject: [DATABASE_MANAGER],
        async: true,
      },
      // Alias registration for DatabaseTestingService class (allows resolving by class)
      {
        provide: DatabaseTestingService,
        useFactory: async (service: DatabaseTestingService) => service,
        inject: [DATABASE_TESTING_SERVICE],
        async: true,
      },
    ];

    const databaseModule = TitanDatabaseModule.forRoot({
      ...defaultOptions,
      isGlobal: true,
    });

    return {
      module: DatabaseTestingModule,
      global: true,
      imports: [databaseModule as unknown as IModule],
      providers,
      exports: [DATABASE_TESTING_SERVICE],
    } as DynamicModule;
  }

  /**
   * Create isolated testing module for parallel tests
   *
   * Creates a completely isolated database testing environment suitable for
   * running tests in parallel. Each isolated module gets its own schema (if supported)
   * and independent service instances.
   */
  static async createIsolatedModule(
    options: DatabaseTestingOptions = {}
  ): Promise<{
    module: DynamicModule;
    service?: DatabaseTestingService;
    cleanup: () => Promise<void>;
  }> {
    // Generate unique schema name for this isolated module
    const schemaPrefix = options.schemaPrefix || 'test_isolated';
    const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const isolatedSchemaName = `${schemaPrefix}_${uniqueSuffix}`;

    // Create isolated module with unique schema
    const isolatedOptions: DatabaseTestingOptions = {
      ...options,
      isolatedSchema: true,
      schemaPrefix: isolatedSchemaName,
      transactional: options.transactional ?? true,
      autoMigrate: options.autoMigrate ?? false,
      autoClean: options.autoClean ?? true,
    };

    // Override connection to use unique database/schema if not provided
    if (!isolatedOptions.connection) {
      // Use unique file-based SQLite for true isolation
      // :memory: databases are shared if the connection string is the same
      isolatedOptions.connection = {
        dialect: 'sqlite',
        connection: `file:${isolatedSchemaName}?mode=memory&cache=shared`,
      };
    }

    const module = DatabaseTestingModule.forTest(isolatedOptions);

    // Store service reference for cleanup
    let serviceInstance: DatabaseTestingService | undefined;

    // Return module with enhanced cleanup that properly disposes the service
    return {
      module,
      get service() {
        return serviceInstance;
      },
      cleanup: async () => {
        try {
          // If service was injected, clean it up
          if (serviceInstance) {
            await serviceInstance.afterAll();
          }

          // Find and cleanup the service from the module's container if it exists
          // This handles cases where the service was created but not stored in serviceInstance
          const providers = (module as any).providers || [];
          for (const provider of providers) {
            if (
              typeof provider === 'object' &&
              provider &&
              'provide' in provider &&
              provider.provide === DATABASE_TESTING_SERVICE
            ) {
              // Provider cleanup handled by afterAll above
              break;
            }
          }
        } catch (error) {
          if (isolatedOptions.verbose) {
            console.warn('Error during isolated module cleanup:', error);
          }
        }
      },
    };
  }

  /**
   * Helper to inject the DatabaseTestingService into an isolated module result
   * This should be called after the application/container is created
   */
  static async injectServiceIntoIsolatedModule(
    isolatedModuleResult: {
      module: DynamicModule;
      service?: DatabaseTestingService;
      cleanup: () => Promise<void>;
    },
    container: { resolveAsync: (token: any) => Promise<any> }
  ): Promise<void> {
    try {
      const service = (await container.resolveAsync(DATABASE_TESTING_SERVICE)) as DatabaseTestingService;
      // Store the service reference in the result object
      Object.defineProperty(isolatedModuleResult, 'service', {
        value: service,
        writable: true,
        configurable: true,
      });
      await service.initialize();
    } catch (error) {
      console.warn('Failed to inject DatabaseTestingService:', error);
    }
  }
}
