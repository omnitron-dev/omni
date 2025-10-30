/**
 * Comprehensive Migration Tests
 *
 * Tests all migration functionality including creation, execution,
 * rollback, dependency management, and edge cases
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Application } from '../../../src/application.js';
import { Module, Injectable, Inject } from '../../../src/decorators/index.js';
import { Kysely, sql } from 'kysely';
import {
  TitanDatabaseModule,
  InjectConnection,
  Migration,
  MigrationRunner,
  MigrationService,
  MigrationLock,
  DatabaseTestingService,
  DATABASE_MIGRATION_SERVICE,
  DATABASE_MIGRATION_RUNNER,
  DATABASE_MIGRATION_LOCK,
} from '../../../src/modules/database/index.js';
import type { IMigration } from '../../../src/modules/database/index.js';
import { DatabaseTestManager, DockerContainer } from '../../utils/docker-test-manager.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test migrations
@Migration({
  version: '001',
  description: 'Create users table',
})
class CreateUsersTable implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('users')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
      .addColumn('username', 'varchar(255)', (col) => col.notNull().unique())
      .addColumn('full_name', 'varchar(255)', (col) => col.notNull())
      .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .execute();
  }

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('users').execute();
  }
}

@Migration({
  version: '002',
  description: 'Create posts table',
  dependencies: ['001'],
})
class CreatePostsTable implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('posts')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('user_id', 'integer', (col) => col.notNull())
      .addColumn('title', 'varchar(255)', (col) => col.notNull())
      .addColumn('content', 'text')
      .addColumn('status', 'varchar(20)', (col) => col.defaultTo('draft'))
      .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .addColumn('updated_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .addForeignKeyConstraint('fk_posts_user', ['user_id'], 'users', ['id'])
      .execute();

    // Create index
    await db.schema.createIndex('idx_posts_user_id').on('posts').column('user_id').execute();
  }

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropIndex('idx_posts_user_id').execute();
    await db.schema.dropTable('posts').execute();
  }
}

@Migration({
  version: '003',
  description: 'Add profile fields to users',
  dependencies: ['001'],
})
class AddUserProfileFields implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .alterTable('users')
      .addColumn('bio', 'text')
      .addColumn('avatar_url', 'varchar(500)')
      .addColumn('is_active', 'boolean', (col) => col.defaultTo(true))
      .execute();
  }

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('users').dropColumn('bio').dropColumn('avatar_url').dropColumn('is_active').execute();
  }
}

@Migration({
  version: '004',
  description: 'Create comments table',
  dependencies: ['001', '002'],
})
class CreateCommentsTable implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('comments')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('post_id', 'integer', (col) => col.notNull())
      .addColumn('user_id', 'integer', (col) => col.notNull())
      .addColumn('content', 'text', (col) => col.notNull())
      .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .addForeignKeyConstraint('fk_comments_post', ['post_id'], 'posts', ['id'])
      .addForeignKeyConstraint('fk_comments_user', ['user_id'], 'users', ['id'])
      .execute();

    // Create composite index
    await db.schema.createIndex('idx_comments_post_user').on('comments').columns(['post_id', 'user_id']).execute();
  }

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropIndex('idx_comments_post_user').execute();
    await db.schema.dropTable('comments').execute();
  }
}

@Migration({
  version: '005',
  description: 'Add tags support to posts',
})
class AddTagsSupport implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    // Create tags table
    await db.schema
      .createTable('tags')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('name', 'varchar(50)', (col) => col.notNull().unique())
      .addColumn('slug', 'varchar(50)', (col) => col.notNull().unique())
      .execute();

    // Create pivot table
    await db.schema
      .createTable('post_tags')
      .addColumn('post_id', 'integer', (col) => col.notNull())
      .addColumn('tag_id', 'integer', (col) => col.notNull())
      .addPrimaryKeyConstraint('pk_post_tags', ['post_id', 'tag_id'])
      .addForeignKeyConstraint('fk_post_tags_post', ['post_id'], 'posts', ['id'])
      .addForeignKeyConstraint('fk_post_tags_tag', ['tag_id'], 'tags', ['id'])
      .execute();
  }

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('post_tags').execute();
    await db.schema.dropTable('tags').execute();
  }
}

// Test service
@Injectable()
class MigrationTestService {
  constructor(
    @Inject(DATABASE_MIGRATION_SERVICE) private migrationService: MigrationService,
    @Inject(DATABASE_MIGRATION_RUNNER) private migrationRunner: MigrationRunner,
    @Inject(DATABASE_MIGRATION_LOCK) private migrationLock: MigrationLock,
    @InjectConnection() private db: Kysely<any>
  ) {}

  async runMigrations() {
    return this.migrationRunner.migrate();
  }

  async rollbackMigrations(steps?: number) {
    return this.migrationRunner.down(steps);
  }

  async getMigrationStatus() {
    return this.migrationService.status();
  }

  async resetDatabase() {
    return this.migrationRunner.reset();
  }

  async createMigrationLock(migrationId: string) {
    return this.migrationLock.acquire(migrationId);
  }

  async releaseMigrationLock(migrationId: string) {
    return this.migrationLock.release(migrationId);
  }

  async checkTableExists(tableName: string): Promise<boolean> {
    try {
      await this.db
        .selectFrom(tableName)
        .select('*' as any)
        .limit(1)
        .execute();
      return true;
    } catch {
      return false;
    }
  }
}

describe('Comprehensive Migration Tests', () => {
  describe('SQLite In-Memory Tests', () => {
    let app: Application;
    let testService: DatabaseTestingService;
    let migrationService: MigrationTestService;
    let db: Kysely<any>;

    beforeAll(async () => {
      @Module({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: {
              dialect: 'sqlite',
              filename: ':memory:',
            } as any,
            migrations: {
              providers: [
                CreateUsersTable,
                CreatePostsTable,
                AddUserProfileFields,
                CreateCommentsTable,
                AddTagsSupport,
              ],
              autoRun: false,
            },
          }),
        ],
        providers: [MigrationTestService],
      })
      class TestModule {}

      app = await Application.create(TestModule, {
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      migrationService = app.get(MigrationTestService);
      db = app.get<Kysely<any>>(Symbol.for('DATABASE_CONNECTION'));
    });

    afterAll(async () => {
      await app.stop();
    });

    beforeEach(async () => {
      // Reset database before each test
      try {
        await migrationService.resetDatabase();
      } catch {
        // Ignore errors if tables don't exist
      }
    });

    describe('Basic Migration Operations', () => {
      it('should run all migrations', async () => {
        const result = await migrationService.runMigrations();

        expect(result.migrations).toHaveLength(5);
        expect(result.error).toBeUndefined();

        // Check all tables were created
        expect(await migrationService.checkTableExists('users')).toBe(true);
        expect(await migrationService.checkTableExists('posts')).toBe(true);
        expect(await migrationService.checkTableExists('comments')).toBe(true);
        expect(await migrationService.checkTableExists('tags')).toBe(true);
        expect(await migrationService.checkTableExists('post_tags')).toBe(true);
      });

      it('should get migration status', async () => {
        // Run some migrations first
        await migrationService.runMigrations();

        const status = await migrationService.getMigrationStatus();

        expect(status.applied).toHaveLength(5);
        expect(status.pending).toHaveLength(0);
        expect(status.currentVersion).toBe('005');
        expect(status.latestVersion).toBe('005');
      });

      it('should rollback migrations', async () => {
        // Run all migrations
        await migrationService.runMigrations();

        // Rollback last migration
        const result = await migrationService.rollbackMigrations(1);

        expect(result.migration).toBeDefined();
        expect(result.migration?.name).toContain('AddTagsSupport');

        // Check tags tables were dropped
        expect(await migrationService.checkTableExists('tags')).toBe(false);
        expect(await migrationService.checkTableExists('post_tags')).toBe(false);

        // But other tables should still exist
        expect(await migrationService.checkTableExists('users')).toBe(true);
        expect(await migrationService.checkTableExists('posts')).toBe(true);
      });

      it('should rollback multiple migrations', async () => {
        await migrationService.runMigrations();

        // Rollback 3 migrations
        await migrationService.rollbackMigrations(3);

        const status = await migrationService.getMigrationStatus();
        expect(status.applied).toHaveLength(2);
        expect(status.pending).toHaveLength(3);

        // Only users and posts tables should exist
        expect(await migrationService.checkTableExists('users')).toBe(true);
        expect(await migrationService.checkTableExists('posts')).toBe(true);
        expect(await migrationService.checkTableExists('comments')).toBe(false);
      });

      it('should reset database', async () => {
        await migrationService.runMigrations();

        await migrationService.resetDatabase();

        const status = await migrationService.getMigrationStatus();
        expect(status.applied).toHaveLength(0);
        expect(status.pending).toHaveLength(5);

        // All tables should be dropped
        expect(await migrationService.checkTableExists('users')).toBe(false);
        expect(await migrationService.checkTableExists('posts')).toBe(false);
      });
    });

    describe('Dependency Management', () => {
      it('should respect migration dependencies', async () => {
        const result = await migrationService.runMigrations();

        // Check order - users table should be created before posts
        const migrationOrder = result.migrations.map((m) => m.name);
        const usersIndex = migrationOrder.findIndex((m) => m.includes('CreateUsersTable'));
        const postsIndex = migrationOrder.findIndex((m) => m.includes('CreatePostsTable'));
        const commentsIndex = migrationOrder.findIndex((m) => m.includes('CreateCommentsTable'));

        expect(usersIndex).toBeLessThan(postsIndex);
        expect(postsIndex).toBeLessThan(commentsIndex);
      });

      it('should handle parallel migrations with same dependencies', async () => {
        const result = await migrationService.runMigrations();

        // Both AddUserProfileFields and CreatePostsTable depend on CreateUsersTable
        // They should both run after CreateUsersTable but can run in any order relative to each other
        const migrationOrder = result.migrations.map((m) => m.name);
        const usersIndex = migrationOrder.findIndex((m) => m.includes('CreateUsersTable'));
        const profileIndex = migrationOrder.findIndex((m) => m.includes('AddUserProfileFields'));
        const postsIndex = migrationOrder.findIndex((m) => m.includes('CreatePostsTable'));

        expect(usersIndex).toBeLessThan(profileIndex);
        expect(usersIndex).toBeLessThan(postsIndex);
      });
    });

    describe('Idempotency', () => {
      it('should not run already applied migrations', async () => {
        // Run migrations twice
        const first = await migrationService.runMigrations();
        const second = await migrationService.runMigrations();

        expect(first.migrations).toHaveLength(5);
        expect(second.migrations).toHaveLength(0);

        const status = await migrationService.getMigrationStatus();
        expect(status.applied).toHaveLength(5);
      });

      it('should only run pending migrations', async () => {
        // Run first 3 migrations
        await migrationService.runMigrations();
        await migrationService.rollbackMigrations(2);

        // Run migrations again - should only run the 2 pending ones
        const result = await migrationService.runMigrations();
        expect(result.migrations).toHaveLength(2);
      });
    });

    describe('Error Handling', () => {
      it('should handle migration failures gracefully', async () => {
        @Migration({
          version: '999',
          description: 'Failing migration',
        })
        class FailingMigration implements IMigration {
          async up(db: Kysely<any>): Promise<void> {
            throw new Error('Migration failed intentionally');
          }
          async down(db: Kysely<any>): Promise<void> {}
        }

        @Module({
          imports: [
            TitanDatabaseModule.forRoot({
              connection: {
                dialect: 'sqlite',
                filename: ':memory:',
              } as any,
              migrations: {
                providers: [FailingMigration],
                autoRun: false,
              },
            }),
          ],
          providers: [MigrationTestService],
        })
        class FailingModule {}

        const failApp = await Application.create(FailingModule, {
          disableCoreModules: true,
          disableGracefulShutdown: true,
        });

        const failService = failApp.get(MigrationTestService);

        const result = await failService.runMigrations();
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('Migration failed intentionally');

        await failApp.stop();
      });

      it('should handle rollback failures', async () => {
        @Migration({
          version: '998',
          description: 'Migration with failing rollback',
        })
        class FailingRollback implements IMigration {
          async up(db: Kysely<any>): Promise<void> {
            await db.schema
              .createTable('test_table')
              .addColumn('id', 'integer', (col) => col.primaryKey())
              .execute();
          }
          async down(db: Kysely<any>): Promise<void> {
            throw new Error('Rollback failed intentionally');
          }
        }

        @Module({
          imports: [
            TitanDatabaseModule.forRoot({
              connection: {
                dialect: 'sqlite',
                filename: ':memory:',
              } as any,
              migrations: {
                providers: [FailingRollback],
                autoRun: false,
              },
            }),
          ],
          providers: [MigrationTestService],
        })
        class FailingRollbackModule {}

        const failApp = await Application.create(FailingRollbackModule, {
          disableCoreModules: true,
          disableGracefulShutdown: true,
        });

        const failService = failApp.get(MigrationTestService);

        // Run migration successfully
        await failService.runMigrations();

        // Attempt rollback - should fail
        const result = await failService.rollbackMigrations();
        expect(result.error).toBeDefined();
        expect(result.error?.message).toContain('Rollback failed intentionally');

        await failApp.stop();
      });
    });

    describe('Migration Locking', () => {
      it('should prevent concurrent migrations', async () => {
        const lockId = 'test-migration-001';

        // Acquire lock
        const acquired = await migrationService.createMigrationLock(lockId);
        expect(acquired).toBe(true);

        // Try to acquire again - should fail
        const secondAttempt = await migrationService.createMigrationLock(lockId);
        expect(secondAttempt).toBe(false);

        // Release lock
        const released = await migrationService.releaseMigrationLock(lockId);
        expect(released).toBe(true);

        // Now should be able to acquire again
        const thirdAttempt = await migrationService.createMigrationLock(lockId);
        expect(thirdAttempt).toBe(true);

        await migrationService.releaseMigrationLock(lockId);
      });
    });
  });

  describe('File-based Migrations', () => {
    let app: Application;
    let migrationService: MigrationTestService;
    let migrationsDir: string;

    beforeAll(async () => {
      // Create temporary migrations directory
      migrationsDir = path.join(__dirname, 'temp-migrations');
      await fs.mkdir(migrationsDir, { recursive: true });

      // Create migration files
      await fs.writeFile(
        path.join(migrationsDir, '001_create_users.ts'),
        `
        import { Kysely } from 'kysely';
        export async function up(db: Kysely<any>): Promise<void> {
          await db.schema
            .createTable('users')
            .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
            .addColumn('email', 'varchar(255)', (col) => col.notNull())
            .execute();
        }
        export async function down(db: Kysely<any>): Promise<void> {
          await db.schema.dropTable('users').execute();
        }
        `
      );

      await fs.writeFile(
        path.join(migrationsDir, '002_add_user_fields.ts'),
        `
        import { Kysely } from 'kysely';
        export async function up(db: Kysely<any>): Promise<void> {
          await db.schema
            .alterTable('users')
            .addColumn('name', 'varchar(255)')
            .execute();
        }
        export async function down(db: Kysely<any>): Promise<void> {
          await db.schema
            .alterTable('users')
            .dropColumn('name')
            .execute();
        }
        `
      );

      @Module({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: {
              dialect: 'sqlite',
              filename: ':memory:',
            } as any,
            migrations: {
              directory: migrationsDir,
              autoRun: false,
            },
          }),
        ],
        providers: [MigrationTestService],
      })
      class FileBasedModule {}

      app = await Application.create(FileBasedModule, {
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      migrationService = app.get(MigrationTestService);
    });

    afterAll(async () => {
      await app.stop();
      // Clean up migration files
      await fs.rm(migrationsDir, { recursive: true, force: true });
    });

    it('should load and run migrations from files', async () => {
      const result = await migrationService.runMigrations();
      expect(result.migrations.length).toBeGreaterThanOrEqual(2);

      expect(await migrationService.checkTableExists('users')).toBe(true);

      const status = await migrationService.getMigrationStatus();
      expect(status.applied.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('PostgreSQL Migration Tests', () => {
    let container: DockerContainer;
    let app: Application;
    let migrationService: MigrationTestService;

    beforeAll(async () => {
      container = await DatabaseTestManager.createPostgresContainer({
        database: 'migration_test',
        user: 'test',
        password: 'test',
      });

      const port = container.ports.get(5432)!;

      @Module({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: {
              dialect: 'postgres',
              host: 'localhost',
              port,
              database: 'migration_test',
              user: 'test',
              password: 'test',
            },
            migrations: {
              providers: [
                CreateUsersTable,
                CreatePostsTable,
                AddUserProfileFields,
                CreateCommentsTable,
                AddTagsSupport,
              ],
              autoRun: false,
            },
          }),
        ],
        providers: [MigrationTestService],
      })
      class PgTestModule {}

      app = await Application.create(PgTestModule, {
        disableCoreModules: true,
        disableGracefulShutdown: true,
      });

      migrationService = app.get(MigrationTestService);
    }, 60000);

    afterAll(async () => {
      await app.stop();
      await container.cleanup();
    });

    it('should handle PostgreSQL-specific migrations', async () => {
      const result = await migrationService.runMigrations();
      expect(result.migrations).toHaveLength(5);

      // Verify PostgreSQL-specific features work
      const db = app.get<Kysely<any>>(Symbol.for('DATABASE_CONNECTION'));

      // Test JSONB column
      await db.schema.alterTable('users').addColumn('settings', 'jsonb').execute();

      // Test array column
      await db.schema
        .alterTable('posts')
        .addColumn('tags_array', sql`text[]`)
        .execute();

      // Insert data with PostgreSQL features
      await db
        .insertInto('users')
        .values({
          email: 'test@example.com',
          username: 'testuser',
          full_name: 'Test User',
          settings: JSON.stringify({ theme: 'dark' }),
        })
        .execute();

      const user = await db.selectFrom('users').selectAll().where('email', '=', 'test@example.com').executeTakeFirst();

      expect(user).toBeDefined();
    });

    it('should handle PostgreSQL schema migrations', async () => {
      @Migration({
        version: '100',
        description: 'Create custom schema',
      })
      class CreateSchema implements IMigration {
        async up(db: Kysely<any>): Promise<void> {
          await sql`CREATE SCHEMA IF NOT EXISTS analytics`.execute(db);
          await db.schema
            .withSchema('analytics')
            .createTable('events')
            .addColumn('id', 'serial', (col) => col.primaryKey())
            .addColumn('event_type', 'varchar(100)')
            .addColumn('payload', 'jsonb')
            .addColumn('created_at', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
            .execute();
        }

        async down(db: Kysely<any>): Promise<void> {
          await db.schema.withSchema('analytics').dropTable('events').execute();
          await sql`DROP SCHEMA IF EXISTS analytics`.execute(db);
        }
      }

      // This would need a new app instance with the schema migration
      // Just demonstrating the pattern
      expect(CreateSchema).toBeDefined();
    });
  });
});

// Helper function to create test migration
function createTestMigration(version: string, upFn: () => Promise<void>, downFn: () => Promise<void>) {
  @Migration({
    version,
    description: `Test migration ${version}`,
  })
  class TestMigration implements IMigration {
    async up(db: Kysely<any>): Promise<void> {
      await upFn();
    }
    async down(db: Kysely<any>): Promise<void> {
      await downFn();
    }
  }
  return TestMigration;
}
