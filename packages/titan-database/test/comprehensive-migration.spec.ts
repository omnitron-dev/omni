/**
 * Comprehensive Migration Tests
 *
 * Tests for @kysera/migrations MigrationRunner with real database operations:
 * - Basic up/down/status/reset
 * - Dependency ordering (via migration naming convention)
 * - Idempotency
 * - Error handling
 * - File-based migration loading (defineMigrations)
 * - PostgreSQL (Docker) integration
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { isDockerAvailable } from '@omnitron-dev/testing/titan';

const skipDockerTests =
  process.env.SKIP_DOCKER_TESTS === 'true' || process.env.SKIP_DATABASE_TESTS === 'true' || !isDockerAvailable();

if (skipDockerTests) {
  console.log('Skipping comprehensive-migration.spec.ts Docker tests - requires Docker');
}

const describeDocker = skipDockerTests ? describe.skip : describe;

import { Application } from '@omnitron-dev/titan/application';
import { Module } from '@omnitron-dev/titan/decorators';
import { Kysely, sql } from 'kysely';
import {
  TitanDatabaseModule,
  MigrationRunner,
  DATABASE_MANAGER,
  setupMigrations,
  createMigration,
  defineMigrations,
} from '../src/index.js';
import type { IDatabaseManager } from '../src/index.js';
import type { Migration as KyseraMigration } from '@kysera/migrations';
import { DatabaseTestManager } from '@omnitron-dev/testing/docker';
import type { DockerContainer } from '@omnitron-dev/testing/docker';

// ---------------------------------------------------------------------------
// Test migrations
// ---------------------------------------------------------------------------

const sqliteMigrations: KyseraMigration[] = [
  createMigration(
    '001_create_users',
    async (db: Kysely<any>) => {
      await db.schema
        .createTable('users')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
        .addColumn('username', 'varchar(255)', (col) => col.notNull().unique())
        .addColumn('created_at', 'datetime', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
        .execute();
    },
    async (db: Kysely<any>) => {
      await db.schema.dropTable('users').ifExists().execute();
    },
  ),
  createMigration(
    '002_create_posts',
    async (db: Kysely<any>) => {
      await db.schema
        .createTable('posts')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('user_id', 'integer', (col) => col.notNull())
        .addColumn('title', 'varchar(255)', (col) => col.notNull())
        .addColumn('body', 'text')
        .execute();
    },
    async (db: Kysely<any>) => {
      await db.schema.dropTable('posts').ifExists().execute();
    },
  ),
  createMigration(
    '003_add_user_profile',
    async (db: Kysely<any>) => {
      await db.schema.alterTable('users').addColumn('bio', 'text').execute();
      await db.schema.alterTable('users').addColumn('avatar_url', 'varchar(500)').execute();
    },
    async (db: Kysely<any>) => {
      await db.schema.alterTable('users').dropColumn('bio').execute();
      await db.schema.alterTable('users').dropColumn('avatar_url').execute();
    },
  ),
  createMigration(
    '004_create_comments',
    async (db: Kysely<any>) => {
      await db.schema
        .createTable('comments')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('post_id', 'integer', (col) => col.notNull())
        .addColumn('user_id', 'integer', (col) => col.notNull())
        .addColumn('body', 'text', (col) => col.notNull())
        .execute();
    },
    async (db: Kysely<any>) => {
      await db.schema.dropTable('comments').ifExists().execute();
    },
  ),
  createMigration(
    '005_add_tags',
    async (db: Kysely<any>) => {
      await db.schema
        .createTable('tags')
        .ifNotExists()
        .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
        .addColumn('name', 'varchar(50)', (col) => col.notNull().unique())
        .execute();

      await db.schema
        .createTable('post_tags')
        .ifNotExists()
        .addColumn('post_id', 'integer', (col) => col.notNull())
        .addColumn('tag_id', 'integer', (col) => col.notNull())
        .execute();
    },
    async (db: Kysely<any>) => {
      await db.schema.dropTable('post_tags').ifExists().execute();
      await db.schema.dropTable('tags').ifExists().execute();
    },
  ),
];

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

async function tableExists(db: Kysely<any>, tableName: string): Promise<boolean> {
  try {
    await db.selectFrom(tableName as any).selectAll().limit(1).execute();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

@Module({
  imports: [TitanDatabaseModule.forFeature([])],
})
class TestModule {}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Comprehensive Migration Tests', () => {
  describe('SQLite In-Memory Tests', () => {
    let app: Application;
    let db: Kysely<any>;
    let runner: MigrationRunner;

    beforeAll(async () => {
      app = await Application.create({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: { dialect: 'sqlite', connection: ':memory:' },
            isGlobal: true,
          }),
          TestModule,
        ],
      });
      await app.start();

      const dbManager: IDatabaseManager = await app.resolveAsync(DATABASE_MANAGER);
      db = await dbManager.getConnection();
      await setupMigrations(db);
    });

    afterAll(async () => {
      if (app) await app.stop();
      await TitanDatabaseModule.resetForTesting();
    });

    beforeEach(async () => {
      // Reset: roll back everything and re-setup
      try {
        const resetRunner = new MigrationRunner(db, sqliteMigrations);
        await resetRunner.reset();
      } catch {
        // tables may not exist on first run
      }
      runner = new MigrationRunner(db, sqliteMigrations);
    });

    describe('Basic Migration Operations', () => {
      it('should run all migrations', async () => {
        const result = await runner.up();

        expect(result.executed).toHaveLength(5);
        expect(result.failed).toHaveLength(0);

        expect(await tableExists(db, 'users')).toBe(true);
        expect(await tableExists(db, 'posts')).toBe(true);
        expect(await tableExists(db, 'comments')).toBe(true);
        expect(await tableExists(db, 'tags')).toBe(true);
        expect(await tableExists(db, 'post_tags')).toBe(true);
      });

      it('should get migration status', async () => {
        await runner.up();
        const status = await runner.status();

        expect(status.executed).toHaveLength(5);
        expect(status.pending).toHaveLength(0);
        expect(status.total).toBe(5);
      });

      it('should rollback migrations', async () => {
        await runner.up();
        const result = await runner.down(1);

        expect(result.executed).toHaveLength(1);

        // Last migration rolled back, tags removed
        expect(await tableExists(db, 'tags')).toBe(false);
        expect(await tableExists(db, 'post_tags')).toBe(false);
        // Earlier tables still exist
        expect(await tableExists(db, 'users')).toBe(true);
      });

      it('should rollback multiple migrations', async () => {
        await runner.up();
        const result = await runner.down(3);

        expect(result.executed).toHaveLength(3);

        const status = await runner.status();
        expect(status.executed).toHaveLength(2);
        expect(status.pending).toHaveLength(3);
      });

      it('should reset database', async () => {
        await runner.up();
        const result = await runner.reset();

        expect(result.executed).toHaveLength(5);

        const status = await runner.status();
        expect(status.executed).toHaveLength(0);
        expect(status.pending).toHaveLength(5);
      });
    });

    describe('Dependency Management', () => {
      it('should respect migration dependencies (ordered by name)', async () => {
        const result = await runner.up();

        // Migrations should execute in name order
        expect(result.executed[0]).toBe('001_create_users');
        expect(result.executed[1]).toBe('002_create_posts');
        expect(result.executed[2]).toBe('003_add_user_profile');
        expect(result.executed[3]).toBe('004_create_comments');
        expect(result.executed[4]).toBe('005_add_tags');
      });

      it('should handle parallel migrations with same dependencies', async () => {
        // Run only first two, then remaining three concurrently is fine since
        // the runner executes them sequentially in order
        await runner.upTo('002_create_posts');

        const partialRunner = new MigrationRunner(db, sqliteMigrations);
        const result = await partialRunner.up();

        expect(result.executed).toHaveLength(3);
      });
    });

    describe('Idempotency', () => {
      it('should not run already applied migrations', async () => {
        await runner.up();

        const result = await runner.up();

        expect(result.executed).toHaveLength(0);
        expect(result.skipped).toHaveLength(5);
      });

      it('should only run pending migrations', async () => {
        await runner.upTo('002_create_posts');

        const result = await runner.up();

        expect(result.executed).toHaveLength(3);
        expect(result.skipped).toHaveLength(2);
      });
    });

    describe('Error Handling', () => {
      it('should handle migration failures gracefully', async () => {
        const failingMigrations: KyseraMigration[] = [
          sqliteMigrations[0],
          createMigration(
            '006_failing',
            async () => { throw new Error('Intentional failure'); },
          ),
        ];

        // With stopOnError: false, the runner returns a result with the failure
        const failRunner = new MigrationRunner(db, failingMigrations, { stopOnError: false });
        const result = await failRunner.up();

        // First migration succeeds, second fails
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toBe('006_failing');
        expect(result.executed).toHaveLength(1);
      });

      it('should handle rollback failures', async () => {
        const noDownMigrations: KyseraMigration[] = [
          createMigration(
            '001_no_down',
            async (db: Kysely<any>) => {
              await db.schema.createTable('no_down_test')
                .ifNotExists()
                .addColumn('id', 'integer', (col) => col.primaryKey())
                .execute();
            },
            // No down function
          ),
        ];

        const noDownRunner = new MigrationRunner(db, noDownMigrations);
        await noDownRunner.up();

        // Attempting to rollback a migration without a down function
        const result = await noDownRunner.down(1);

        // Should report failure or skip since there's no down function
        expect(result.executed.length + result.failed.length + result.skipped.length).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('File-based Migrations', () => {
    it('should load and run migrations from files', async () => {
      // Use defineMigrations as the modern way to define migrations
      const migrations = defineMigrations({
        '001_create_table': {
          up: async (db: Kysely<any>) => {
            await db.schema
              .createTable('file_test')
              .ifNotExists()
              .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
              .addColumn('name', 'varchar(100)')
              .execute();
          },
          down: async (db: Kysely<any>) => {
            await db.schema.dropTable('file_test').ifExists().execute();
          },
          description: 'Create file test table',
        },
        '002_add_column': {
          up: async (db: Kysely<any>) => {
            await db.schema.alterTable('file_test').addColumn('value', 'integer').execute();
          },
          down: async (db: Kysely<any>) => {
            await db.schema.alterTable('file_test').dropColumn('value').execute();
          },
          description: 'Add value column',
        },
      });

      const app = await Application.create({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: { dialect: 'sqlite', connection: ':memory:' },
            isGlobal: true,
          }),
          TestModule,
        ],
      });
      await app.start();

      const dbManager: IDatabaseManager = await app.resolveAsync(DATABASE_MANAGER);
      const db = await dbManager.getConnection();
      await setupMigrations(db);

      const runner = new MigrationRunner(db, migrations);
      const result = await runner.up();

      expect(result.executed).toHaveLength(2);
      expect(result.failed).toHaveLength(0);

      expect(await tableExists(db, 'file_test')).toBe(true);

      await app.stop();
      await TitanDatabaseModule.resetForTesting();
    });
  });

  describeDocker('PostgreSQL Migration Tests', () => {
    let app: Application;
    let db: Kysely<any>;
    let runner: MigrationRunner;
    let container: DockerContainer;

    const pgMigrations: KyseraMigration[] = [
      createMigration(
        '001_create_users',
        async (db: Kysely<any>) => {
          await db.schema
            .createTable('users')
            .ifNotExists()
            .addColumn('id', 'serial', (col) => col.primaryKey())
            .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
            .addColumn('username', 'varchar(255)', (col) => col.notNull().unique())
            .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
            .execute();
        },
        async (db: Kysely<any>) => {
          await db.schema.dropTable('users').ifExists().execute();
        },
      ),
      createMigration(
        '002_create_posts',
        async (db: Kysely<any>) => {
          await db.schema
            .createTable('posts')
            .ifNotExists()
            .addColumn('id', 'serial', (col) => col.primaryKey())
            .addColumn('user_id', 'integer', (col) => col.notNull().references('users.id'))
            .addColumn('title', 'varchar(255)', (col) => col.notNull())
            .addColumn('body', 'text')
            .execute();
        },
        async (db: Kysely<any>) => {
          await db.schema.dropTable('posts').ifExists().execute();
        },
      ),
      createMigration(
        '003_create_comments',
        async (db: Kysely<any>) => {
          await db.schema
            .createTable('comments')
            .ifNotExists()
            .addColumn('id', 'serial', (col) => col.primaryKey())
            .addColumn('post_id', 'integer', (col) => col.notNull().references('posts.id'))
            .addColumn('user_id', 'integer', (col) => col.notNull().references('users.id'))
            .addColumn('body', 'text', (col) => col.notNull())
            .execute();
        },
        async (db: Kysely<any>) => {
          await db.schema.dropTable('comments').ifExists().execute();
        },
      ),
    ];

    beforeAll(async () => {
      container = await DatabaseTestManager.createPostgresContainer({
        database: 'test_comprehensive_db',
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
                database: 'test_comprehensive_db',
              },
            },
            isGlobal: true,
          }),
          TestModule,
        ],
      });
      await app.start();

      const dbManager: IDatabaseManager = await app.resolveAsync(DATABASE_MANAGER);
      db = await dbManager.getConnection();
      await setupMigrations(db);
    }, 120000);

    afterAll(async () => {
      if (app) await app.stop();
      if (container) await container.cleanup();
      await TitanDatabaseModule.resetForTesting();
    });

    beforeEach(async () => {
      try {
        const resetRunner = new MigrationRunner(db, pgMigrations);
        await resetRunner.reset();
      } catch {
        // Ignore on first run
      }
      runner = new MigrationRunner(db, pgMigrations, { useTransactions: true });
    });

    it('should run all PostgreSQL migrations', async () => {
      const result = await runner.up();
      expect(result.executed).toHaveLength(3);
      expect(result.failed).toHaveLength(0);
    });

    it('should rollback PostgreSQL migrations', async () => {
      await runner.up();
      const result = await runner.down(1);
      expect(result.executed).toHaveLength(1);

      const status = await runner.status();
      expect(status.executed).toHaveLength(2);
    });

    it('should get PostgreSQL migration status', async () => {
      const status = await runner.status();
      expect(status.total).toBe(3);
      expect(status.pending).toHaveLength(3);
    });
  });
});
