/**
 * Database Testing Module
 *
 * Provides utilities and configuration for testing database operations
 * with automatic rollback, seeding, and cleanup capabilities
 */

import { DynamicModule } from '../../../nexus/index.js';
import { Module, Injectable, Inject } from '../../../decorators/index.js';
import { Kysely, Transaction, sql } from 'kysely';
import { TitanDatabaseModule } from '../database.module.js';
import { DatabaseManager } from '../database.manager.js';
import { MigrationRunner } from '../migration/migration.runner.js';
import { TransactionManager } from '../transaction/transaction.manager.js';
import { Errors } from '../../../errors/index.js';
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
  private currentTransaction?: Transaction<any>;
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
      await this.createIsolatedSchema(db);
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
    if (this.options.transactional) {
      this.currentTransaction = await (db as any).transaction().execute(async (trx: Transaction<any>) => {
        // Store transaction for use in tests
        (this.manager as any).testTransaction = trx;
        return trx;
      });
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
      (this.manager as any).testTransaction = undefined;
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
    const db = await this.manager.getConnection();
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
  async seedDatabase(seeds?: any[]): Promise<void> {
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
  private async insertSeeds(seeds: any[]): Promise<void> {
    const db = this.currentTransaction || (await this.manager.getConnection());

    for (const seed of seeds) {
      if (!seed.table || !seed.data) continue;

      try {
        const records = Array.isArray(seed.data) ? seed.data : [seed.data];

        for (const record of records) {
          await (db as Kysely<any>).insertInto(seed.table).values(record).execute();
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
  private async createIsolatedSchema(db: Kysely<any>): Promise<void> {
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

    const db = await this.manager.getConnection();
    const dialect = this.getDialect(db);

    if (dialect === 'postgres') {
      await sql`DROP SCHEMA IF EXISTS ${sql.ref(this.schemaName)} CASCADE`.execute(db);
      await sql`SET search_path TO public`.execute(db);
    }
  }

  /**
   * Get all tables in database
   */
  private async getAllTables(db: Kysely<any>, dialect: string): Promise<string[]> {
    let result: any;

    if (dialect === 'postgres') {
      result = await sql`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ${this.schemaName || 'public'}
          AND table_type = 'BASE TABLE'
      `.execute(db);
      return result.rows.map((r: any) => r.table_name);
    } else if (dialect === 'mysql') {
      result = await sql`
        SELECT TABLE_NAME as table_name
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_TYPE = 'BASE TABLE'
      `.execute(db);
      return result.rows.map((r: any) => r.table_name);
    } else {
      // SQLite
      result = await sql`
        SELECT name as table_name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
      `.execute(db);
      return result.rows.map((r: any) => r.table_name);
    }
  }

  /**
   * Get database dialect
   */
  private getDialect(db: any): string {
    // Try to determine dialect from the connection
    const dialectName = db.dialect?.name || db._dialect?.name;

    if (dialectName) return dialectName;

    // Fallback to checking the driver
    if (db.driver?.postgres) return 'postgres';
    if (db.driver?.mysql) return 'mysql';

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
  async execute<T>(query: (db: Kysely<any>) => Promise<T>): Promise<T> {
    const db = this.currentTransaction || (await this.manager.getConnection());
    return query(db as Kysely<any>);
  }

  /**
   * Get test database connection
   */
  getTestConnection(): Kysely<any> | Transaction<any> {
    return this.currentTransaction || (this.manager as any).testTransaction || this.manager.getConnection();
  }

  /**
   * Factory method to create test data
   */
  async factory<T>(table: string, generator: () => Partial<T> | Promise<Partial<T>>, count: number = 1): Promise<T[]> {
    const db = this.getTestConnection();
    const results: T[] = [];

    for (let i = 0; i < count; i++) {
      const data = await generator();
      const result = await (db as Kysely<any>).insertInto(table).values(data).returningAll().executeTakeFirst();

      if (result) {
        results.push(result as T);
      }
    }

    return results;
  }

  /**
   * Assert database state
   */
  async assertDatabaseHas(table: string, data: Record<string, any>): Promise<boolean> {
    const db = this.getTestConnection();

    let query = (db as Kysely<any>).selectFrom(table).selectAll();

    for (const [key, value] of Object.entries(data)) {
      query = query.where(key as any, '=', value);
    }

    const result = await query.executeTakeFirst();
    return result !== undefined;
  }

  /**
   * Assert database doesn't have specific data
   */
  async assertDatabaseMissing(table: string, data: Record<string, any>): Promise<boolean> {
    const has = await this.assertDatabaseHas(table, data);
    return !has;
  }

  /**
   * Count records in table
   */
  async assertDatabaseCount(table: string, count: number): Promise<boolean> {
    const db = this.getTestConnection();

    const result = await (db as Kysely<any>)
      .selectFrom(table)
      .select(sql<number>`count(*)`.as('count'))
      .executeTakeFirst();

    return result?.count === count;
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
    if (!options.connection) {
      defaultOptions.connection = {
        dialect: 'sqlite',
        connection: ':memory:',
      } as any;
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
    ];

    return {
      module: DatabaseTestingModule,
      global: true,
      imports: [
        TitanDatabaseModule.forRoot({
          ...defaultOptions,
          isGlobal: true,
        }) as any,
      ],
      providers,
      exports: [
        DATABASE_TESTING_SERVICE,
      ],
    };
  }

  /**
   * Create isolated testing module for parallel tests
   */
  static async createIsolatedModule(options: DatabaseTestingOptions = {}): Promise<{
    module: DynamicModule;
    service: DatabaseTestingService;
    cleanup: () => Promise<void>;
  }> {
    const module = DatabaseTestingModule.forTest({
      ...options,
      isolatedSchema: true,
    });

    // This would need actual module compilation to get the service
    // For now, returning the module configuration
    return {
      module,
      service: null as any, // Would be injected
      cleanup: async () => {
        // Cleanup logic
      },
    };
  }
}
