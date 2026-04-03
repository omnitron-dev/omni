/**
 * Migration System Tests
 *
 * Tests for database migration functionality using @kysera/migrations MigrationRunner.
 * The migration runner is used directly (not via DI) since titan-database delegates
 * migrations to @kysera/migrations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Application } from '@omnitron-dev/titan/application';
import { Module } from '@omnitron-dev/titan/decorators';
import {
  TitanDatabaseModule,
  MigrationRunner,
  DATABASE_MANAGER,
  setupMigrations,
  createMigration,
} from '../src/index.js';
import type { IDatabaseManager } from '../src/index.js';
import { Kysely, sql } from 'kysely';
import { DatabaseTestManager } from '@omnitron-dev/testing/docker';
import { isDockerAvailable } from '@omnitron-dev/testing/titan';
import type { Migration as KyseraMigration } from '@kysera/migrations';

// Skip Docker tests if env var is set or Docker is not available
const skipIntegrationTests =
  process.env.SKIP_DOCKER_TESTS === 'true' || process.env.SKIP_DATABASE_TESTS === 'true' || !isDockerAvailable();

if (skipIntegrationTests) {
  console.log('Skipping migration.spec.ts Docker tests - requires Docker/PostgreSQL');
}

const describeOrSkip = skipIntegrationTests ? describe.skip : describe;

// ---------------------------------------------------------------------------
// Test migrations (using @kysera/migrations Migration interface)
// ---------------------------------------------------------------------------

const testMigrations: KyseraMigration[] = [
  createMigration(
    '001_create_test_table',
    async (db: Kysely<any>) => {
      await db.schema
        .createTable('test_table')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('name', 'varchar(100)', (col) => col.notNull())
        .addColumn('value', 'integer', (col) => col.defaultTo(0))
        .execute();
    },
    async (db: Kysely<any>) => {
      await db.schema.dropTable('test_table').ifExists().execute();
    },
  ),
  createMigration(
    '002_add_description_column',
    async (db: Kysely<any>) => {
      await db.schema.alterTable('test_table').addColumn('description', 'text').execute();
    },
    async (db: Kysely<any>) => {
      await db.schema.alterTable('test_table').dropColumn('description').execute();
    },
  ),
  createMigration(
    '003_create_index',
    async (db: Kysely<any>) => {
      await db.schema.createIndex('idx_test_name').on('test_table').column('name').execute();
    },
    async (db: Kysely<any>) => {
      await db.schema.dropIndex('idx_test_name').execute();
    },
  ),
];

// Test module (just imports TitanDatabaseModule)
@Module({
  imports: [TitanDatabaseModule.forFeature([])],
})
class TestModule {}

describe('Migration System', () => {
  describe('SQLite (in-memory)', () => {
    let app: Application;
    let runner: MigrationRunner;
    let dbManager: IDatabaseManager;
    let db: Kysely<any>;

    beforeEach(async () => {
      app = await Application.create({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: {
              dialect: 'sqlite',
              connection: ':memory:',
            },
            autoMigrate: false,
            isGlobal: true,
          }),
          TestModule,
        ],
      });

      await app.start();

      dbManager = await app.resolveAsync(DATABASE_MANAGER);
      db = await dbManager.getConnection();

      // Setup migrations tracking table
      await setupMigrations(db);

      // Create runner with test migrations
      runner = new MigrationRunner(db, testMigrations);
    });

    afterEach(async () => {
      if (app) {
        await app.stop();
      }
      await TitanDatabaseModule.resetForTesting();
    });

    it('should get migration status', async () => {
      const status = await runner.status();

      expect(status).toBeDefined();
      expect(status.executed).toEqual([]);
      expect(status.pending).toHaveLength(3);
      expect(status.total).toBe(3);
    });

    it('should run all migrations', async () => {
      const result = await runner.up();

      expect(result.executed).toHaveLength(3);
      expect(result.failed).toHaveLength(0);
      expect(result.dryRun).toBe(false);

      // Check status after migration
      const status = await runner.status();
      expect(status.executed).toHaveLength(3);
      expect(status.pending).toHaveLength(0);

      // Verify table exists
      const tables = await sql`
        SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'
      `.execute(db);
      expect(tables.rows.length).toBe(1);
    });

    it('should run migrations up to a specific target', async () => {
      const result = await runner.upTo('002_add_description_column');

      expect(result.executed).toHaveLength(2);

      const status = await runner.status();
      expect(status.executed).toHaveLength(2);
      expect(status.pending).toHaveLength(1);
    });

    it('should rollback migrations', async () => {
      // First run all migrations
      await runner.up();

      // Rollback one migration
      const rollbackResult = await runner.down(1);

      expect(rollbackResult.executed).toHaveLength(1);

      const status = await runner.status();
      expect(status.executed).toHaveLength(2);
      expect(status.pending).toHaveLength(1);
    });

    it('should rollback multiple migrations', async () => {
      // Run all migrations
      await runner.up();

      // Rollback all
      const result = await runner.down(3);

      expect(result.executed).toHaveLength(3);

      const status = await runner.status();
      expect(status.executed).toHaveLength(0);
      expect(status.pending).toHaveLength(3);
    });

    it('should handle dry run mode', async () => {
      const dryRunner = new MigrationRunner(db, testMigrations, { dryRun: true });

      const result = await dryRunner.up();

      expect(result.dryRun).toBe(true);
      // In dry run, migrations should be reported but not actually executed
      expect(result.executed).toHaveLength(3);

      // Check that no actual migrations were run
      const status = await runner.status();
      expect(status.executed).toHaveLength(0);
    });

    it('should not re-run already applied migrations', async () => {
      // Run all
      await runner.up();

      // Run again
      const result = await runner.up();

      expect(result.executed).toHaveLength(0);
      expect(result.skipped).toHaveLength(3);
    });

    it('should detect pending migrations after partial run', async () => {
      await runner.upTo('001_create_test_table');

      const status = await runner.status();
      expect(status.executed).toHaveLength(1);
      expect(status.pending).toHaveLength(2);
    });

    it('should reset all migrations', async () => {
      // Run all
      await runner.up();
      expect((await runner.status()).executed).toHaveLength(3);

      // Reset (rolls back all)
      const result = await runner.reset();
      expect(result.executed).toHaveLength(3);

      const status = await runner.status();
      expect(status.executed).toHaveLength(0);
    });
  });

  describeOrSkip('PostgreSQL (Docker)', () => {
    // PostgreSQL-compatible migrations (no autoIncrement - use serial instead)
    const pgMigrations: KyseraMigration[] = [
      createMigration(
        '001_create_test_table',
        async (db: Kysely<any>) => {
          await db.schema
            .createTable('test_table')
            .ifNotExists()
            .addColumn('id', 'serial', (col) => col.primaryKey())
            .addColumn('name', 'varchar(100)', (col) => col.notNull())
            .addColumn('value', 'integer', (col) => col.defaultTo(0))
            .execute();
        },
        async (db: Kysely<any>) => {
          await db.schema.dropTable('test_table').ifExists().execute();
        },
      ),
      createMigration(
        '002_add_description_column',
        async (db: Kysely<any>) => {
          await db.schema.alterTable('test_table').addColumn('description', 'text').execute();
        },
        async (db: Kysely<any>) => {
          await db.schema.alterTable('test_table').dropColumn('description').execute();
        },
      ),
      createMigration(
        '003_create_index',
        async (db: Kysely<any>) => {
          await db.schema.createIndex('idx_test_name').on('test_table').column('name').execute();
        },
        async (db: Kysely<any>) => {
          await db.schema.dropIndex('idx_test_name').execute();
        },
      ),
    ];

    let app: Application;
    let runner: MigrationRunner;
    let dbManager: IDatabaseManager;
    let db: Kysely<any>;
    let container: Awaited<ReturnType<typeof DatabaseTestManager.createPostgresContainer>>;

    beforeEach(async () => {
      container = await DatabaseTestManager.createPostgresContainer({
        database: 'test_migrations_db',
        user: 'testuser',
        password: 'testpass',
      });

      const port = container.ports.get(5432)!;

      app = await Application.create({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: {
              dialect: 'postgres',
              connection: {
                host: 'localhost',
                port,
                user: 'testuser',
                password: 'testpass',
                database: 'test_migrations_db',
              },
            },
            autoMigrate: false,
            isGlobal: true,
          }),
          TestModule,
        ],
      });

      await app.start();

      dbManager = await app.resolveAsync(DATABASE_MANAGER);
      db = await dbManager.getConnection();

      await setupMigrations(db);

      runner = new MigrationRunner(db, pgMigrations, { useTransactions: true });
    }, 120000);

    afterEach(async () => {
      if (app) {
        await app.stop();
      }
      if (container) {
        await container.cleanup();
      }
      await TitanDatabaseModule.resetForTesting();
    });

    it('should handle concurrent migration attempts', async () => {
      const results = await Promise.allSettled([
        runner.up(),
        runner.up(),
        runner.up(),
      ]);

      // At least one should succeed
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThanOrEqual(1);

      // Check final status
      const status = await runner.status();
      expect(status.executed).toHaveLength(3);
    });

    it('should handle transaction rollback on failure', async () => {
      const failingMigrations: KyseraMigration[] = [
        ...pgMigrations,
        createMigration(
          '004_failing_migration',
          async (db: Kysely<any>) => {
            await db.schema
              .createTable('will_be_rolled_back')
              .addColumn('id', 'serial', (col) => col.primaryKey())
              .execute();
            throw new Error('Intentional failure');
          },
          async (db: Kysely<any>) => {
            await db.schema.dropTable('will_be_rolled_back').execute();
          },
        ),
      ];

      const failRunner = new MigrationRunner(db, failingMigrations, {
        useTransactions: true,
        stopOnError: true,
      });

      // up() throws when stopOnError is true and a migration fails
      let result;
      try {
        result = await failRunner.up();
      } catch {
        // MigrationError thrown - expected with stopOnError
      }

      // If we got a result, check it; otherwise the error itself proves failure handling
      if (result) {
        expect(result.failed).toHaveLength(1);
      }

      // Verify the failed table was rolled back (transaction should revert it)
      const tables = await sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'will_be_rolled_back'
      `.execute(db);
      expect(tables.rows.length).toBe(0);
    });
  });
});
