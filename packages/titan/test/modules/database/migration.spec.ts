/**
 * Migration System Tests
 *
 * Tests for database migration functionality
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Application } from '../../../src/application.js';
import { Module } from '../../../src/decorators/index.js';
import {
  TitanDatabaseModule,
  MigrationRunner,
  Migration,
  DATABASE_MIGRATION_SERVICE,
  DATABASE_MANAGER,
} from '../../../src/modules/database/index.js';
import type { IMigration, IDatabaseManager } from '../../../src/modules/database/index.js';
import { Kysely, sql } from 'kysely';
import { DatabaseTestManager } from '../../utils/docker-test-manager.js';

// Skip Docker tests if env var is set
const skipIntegrationTests = process.env.SKIP_DOCKER_TESTS === 'true' ||
                            process.env.USE_MOCK_REDIS === 'true' ||
                            process.env.CI === 'true';

if (skipIntegrationTests) {
  console.log('⏭️ Skipping migration.spec.ts - requires Docker/PostgreSQL');
}

const describeOrSkip = skipIntegrationTests ? describe.skip : describe;

// Test migrations
@Migration({
  version: '001',
  description: 'Create test table',
})
class CreateTestTableMigration implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('test_table')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('name', 'varchar(100)', (col) => col.notNull())
      .addColumn('value', 'integer', (col) => col.defaultTo(0))
      .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
      .execute();
  }

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('test_table').execute();
  }
}

@Migration({
  version: '002',
  description: 'Add column to test table',
  dependencies: ['001'],
})
class AddColumnMigration implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('test_table').addColumn('description', 'text').execute();
  }

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('test_table').dropColumn('description').execute();
  }
}

@Migration({
  version: '003',
  description: 'Create index',
  dependencies: ['001', '002'],
})
class CreateIndexMigration implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema.createIndex('idx_test_name').on('test_table').column('name').execute();
  }

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropIndex('idx_test_name').execute();
  }
}

// Test module with migrations
@Module({
  imports: [TitanDatabaseModule.forFeature([])],
})
class TestModule {}

describe('Migration System', () => {
  describe('SQLite (in-memory)', () => {
    let app: Application;
    let migrationRunner: MigrationRunner;
    let dbManager: IDatabaseManager;

    beforeEach(async () => {
      // Clear global migration registry
      Reflect.deleteMetadata('database:migrations', global);

      // Register test migrations
      Reflect.defineMetadata(
        'database:migrations',
        [
          {
            target: CreateTestTableMigration,
            metadata: { version: '001', name: 'CreateTestTableMigration', description: 'Create test table' },
          },
          {
            target: AddColumnMigration,
            metadata: {
              version: '002',
              name: 'AddColumnMigration',
              description: 'Add column to test table',
              dependencies: ['001'],
            },
          },
          {
            target: CreateIndexMigration,
            metadata: {
              version: '003',
              name: 'CreateIndexMigration',
              description: 'Create index',
              dependencies: ['001', '002'],
            },
          },
        ],
        global
      );

      // Create application with SQLite
      app = await Application.create({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: {
              dialect: 'sqlite',
              connection: ':memory:',
            },
            migrations: {
              tableName: 'test_migrations',
              lockTableName: 'test_migration_lock',
              validateChecksums: false, // Disable for tests
            },
            autoMigrate: false, // Manual migration for tests
            isGlobal: true,
          }),
          TestModule,
        ],
      });

      await app.start();

      // Get services
      migrationRunner = await app.resolveAsync(DATABASE_MIGRATION_SERVICE);
      dbManager = await app.resolveAsync(DATABASE_MANAGER);

      // Initialize migration tables
      await migrationRunner.init();
    });

    afterEach(async () => {
      if (app) {
        await app.stop();
      }
      // Reset static singleton for next test
      await TitanDatabaseModule.resetForTesting();
    });

    it('should get migration status', async () => {
      const status = await migrationRunner.status();

      expect(status).toBeDefined();
      expect(status.applied).toEqual([]);
      expect(status.pending).toHaveLength(3);
      expect(status.isUpToDate).toBe(false);
    });

    it('should run all migrations', async () => {
      const result = await migrationRunner.migrate();

      expect(result.success).toBe(true);
      expect(result.migrations).toHaveLength(3);
      expect(result.migrations[0].version).toBe('001');
      expect(result.migrations[1].version).toBe('002');
      expect(result.migrations[2].version).toBe('003');

      // Check status after migration
      const status = await migrationRunner.status();
      expect(status.applied).toHaveLength(3);
      expect(status.pending).toHaveLength(0);
      expect(status.isUpToDate).toBe(true);

      // Verify table exists
      const db = await dbManager.getConnection();
      const tables = await sql`
        SELECT name FROM sqlite_master WHERE type='table' AND name='test_table'
      `.execute(db);
      expect(tables.rows.length).toBe(1);
    });

    it('should run specific migrations', async () => {
      const result = await migrationRunner.migrateUp(['001', '002']);

      expect(result.success).toBe(true);
      expect(result.migrations).toHaveLength(2);

      const status = await migrationRunner.status();
      expect(status.applied).toHaveLength(2);
      expect(status.pending).toHaveLength(1);
    });

    it('should rollback migrations', async () => {
      // First run all migrations
      await migrationRunner.migrate();

      // Rollback one migration
      const rollbackResult = await migrationRunner.rollback();

      expect(rollbackResult.success).toBe(true);
      expect(rollbackResult.migrations).toHaveLength(1);
      expect(rollbackResult.migrations[0].version).toBe('003');
      expect(rollbackResult.migrations[0].direction).toBe('down');

      const status = await migrationRunner.status();
      expect(status.applied).toHaveLength(2);
      expect(status.pending).toHaveLength(1);
    });

    it('should rollback to specific version', async () => {
      // Run all migrations
      await migrationRunner.migrate();

      // Rollback to version 001
      const result = await migrationRunner.rollbackTo('002');

      expect(result.success).toBe(true);
      expect(result.migrations).toHaveLength(2); // Should rollback 003 and 002

      const status = await migrationRunner.status();
      expect(status.applied).toHaveLength(1);
      expect(status.currentVersion).toBe('001');
    });

    it('should handle dry run', async () => {
      const result = await migrationRunner.dryRun();

      expect(result.success).toBe(true);
      expect(result.dryRun).toBe(true);
      expect(result.migrations).toHaveLength(3);

      // Check that no actual migrations were run
      const status = await migrationRunner.status();
      expect(status.applied).toHaveLength(0);
    });

    it('should validate migrations', async () => {
      const validation = await migrationRunner.validate();

      expect(validation.valid).toBe(true);
      expect(validation.issues).toBeUndefined();
    });

    it('should detect pending migrations', async () => {
      const hasPending = await migrationRunner.hasPendingMigrations();
      expect(hasPending).toBe(true);

      await migrationRunner.migrate();

      const hasPendingAfter = await migrationRunner.hasPendingMigrations();
      expect(hasPendingAfter).toBe(false);
    });

    it('should track migration events', async () => {
      const events: string[] = [];

      migrationRunner.on('migration.starting', (event) => {
        events.push(`starting:${event.version}`);
      });

      migrationRunner.on('migration.completed', (event) => {
        events.push(`completed:${event.version}`);
      });

      await migrationRunner.migrate();

      expect(events).toContain('starting:001');
      expect(events).toContain('completed:001');
      expect(events).toContain('starting:002');
      expect(events).toContain('completed:002');
      expect(events).toContain('starting:003');
      expect(events).toContain('completed:003');
    });
  });

  describeOrSkip('PostgreSQL (Docker)', () => {
    let app: Application;
    let migrationRunner: MigrationRunner;
    let dbManager: IDatabaseManager;
    let container: import('../../utils/docker-test-manager.js').DockerContainer;

    beforeEach(async () => {
      // Create PostgreSQL container directly (not using withPostgres to keep it alive)
      container = await DatabaseTestManager.createPostgresContainer({
        database: 'test_migrations_db',
        user: 'testuser',
        password: 'testpass',
      });

      const port = container.ports.get(5432)!;
      const connectionString = `postgresql://testuser:testpass@localhost:${port}/test_migrations_db`;

      // Parse connection string
      const url = new URL(connectionString);

      // Clear and register migrations
      Reflect.deleteMetadata('database:migrations', global);
      Reflect.defineMetadata(
        'database:migrations',
        [
          {
            target: CreateTestTableMigration,
            metadata: { version: '001', name: 'CreateTestTableMigration', description: 'Create test table' },
          },
          {
            target: AddColumnMigration,
            metadata: {
              version: '002',
              name: 'AddColumnMigration',
              description: 'Add column to test table',
              dependencies: ['001'],
            },
          },
          {
            target: CreateIndexMigration,
            metadata: {
              version: '003',
              name: 'CreateIndexMigration',
              description: 'Create index',
              dependencies: ['001', '002'],
            },
          },
        ],
        global
      );

      // Create application with PostgreSQL
      app = await Application.create({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: {
              dialect: 'postgres',
              connection: {
                host: url.hostname,
                port: parseInt(url.port || '5432'),
                user: url.username,
                password: url.password,
                database: url.pathname.slice(1),
              },
            },
            migrations: {
              tableName: 'test_migrations',
              lockTableName: 'test_migration_lock',
              transactional: true,
            },
            autoMigrate: false,
            isGlobal: true,
          }),
          TestModule,
        ],
      });

      await app.start();

      // Get services
      migrationRunner = await app.resolveAsync(DATABASE_MIGRATION_SERVICE);
      dbManager = await app.resolveAsync(DATABASE_MANAGER);

      // Initialize migration tables
      await migrationRunner.init();
    }, 60000);

    afterEach(async () => {
      if (app) {
        await app.stop();
      }
      if (container) {
        await container.cleanup();
      }
      // Reset static singleton for next test
      await TitanDatabaseModule.resetForTesting();
    });

    it('should handle concurrent migration attempts', async () => {
      // Try to run migrations concurrently
      const results = await Promise.allSettled([
        migrationRunner.migrate(),
        migrationRunner.migrate(),
        migrationRunner.migrate(),
      ]);

      // At least one should succeed
      const succeeded = results.filter((r) => r.status === 'fulfilled');
      expect(succeeded.length).toBeGreaterThanOrEqual(1);

      // Check final status
      const status = await migrationRunner.status();
      expect(status.applied).toHaveLength(3);
      expect(status.isUpToDate).toBe(true);
    });

    it('should handle transaction rollback on failure', async () => {
      // Register a failing migration
      @Migration({
        version: '004',
        description: 'Failing migration',
      })
      class FailingMigration implements IMigration {
        async up(db: Kysely<any>): Promise<void> {
          // Create a table
          await db.schema
            .createTable('will_be_rolled_back')
            .addColumn('id', 'serial', (col) => col.primaryKey())
            .execute();

          // Then fail
          throw new Error('Intentional failure');
        }

        async down(db: Kysely<any>): Promise<void> {
          await db.schema.dropTable('will_be_rolled_back').execute();
        }
      }

      // Add to registry
      const migrations = Reflect.getMetadata('database:migrations', global) || [];
      migrations.push({
        target: FailingMigration,
        metadata: { version: '004', name: 'FailingMigration', description: 'Failing migration' },
      });
      Reflect.defineMetadata('database:migrations', migrations, global);

      // Run first 3 migrations successfully
      await migrationRunner.migrateUp(['001', '002', '003']);

      // Try to run the failing migration
      const result = await migrationRunner.migrateUp(['004']);

      expect(result.success).toBe(false);
      expect(result.migrations[0].status).toBe('failed');

      // Verify table was rolled back
      const db = await dbManager.getConnection();
      const tables = await sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'will_be_rolled_back'
      `.execute(db);
      expect(tables.rows.length).toBe(0);

      // Verify previous migrations are still applied
      const status = await migrationRunner.status();
      expect(status.applied).toHaveLength(3);
    });
  });
});
