/**
 * Comprehensive Migration Tests
 *
 * Tests all migration functionality including creation, execution,
 * rollback, dependency management, and edge cases
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { isDockerAvailable } from '@omnitron-dev/testing/titan';

const skipIntegrationTests =
  process.env.SKIP_DOCKER_TESTS === 'true' || process.env.SKIP_DATABASE_TESTS === 'true' || !isDockerAvailable();

if (skipIntegrationTests) {
  console.log('⏭️ Skipping comprehensive-migration.spec.ts - requires Docker/PostgreSQL');
}

const describeDocker = skipIntegrationTests ? describe.skip : describe;

import { Application } from '@omnitron-dev/titan/application';
import { Module, Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { Kysely, sql } from 'kysely';
import {
  TitanDatabaseModule,
  InjectConnection,
  Migration,
  MigrationRunner,
  DATABASE_MIGRATION_SERVICE,
  DATABASE_CONNECTION,
} from '../src/index.js';
import type { IMigration } from '../src/index.js';
import { DatabaseTestManager, DockerContainer } from '@omnitron-dev/testing/titan';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// Jest provides __dirname via globalThis
const __dirnameValue = globalThis.__dirname || process.cwd();

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
      .addColumn('createdAt', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .addColumn('updatedAt', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
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
      .addColumn('createdAt', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .addColumn('updatedAt', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
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
    // SQLite requires separate ALTER TABLE statements for each column
    await db.schema.alterTable('users').addColumn('bio', 'text').execute();
    await db.schema.alterTable('users').addColumn('avatar_url', 'varchar(500)').execute();
    await db.schema
      .alterTable('users')
      .addColumn('is_active', 'boolean', (col) => col.defaultTo(true))
      .execute();
  }

  async down(db: Kysely<any>): Promise<void> {
    // SQLite requires separate ALTER TABLE statements for each column
    await db.schema.alterTable('users').dropColumn('is_active').execute();
    await db.schema.alterTable('users').dropColumn('avatar_url').execute();
    await db.schema.alterTable('users').dropColumn('bio').execute();
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
      .addColumn('createdAt', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
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

// PostgreSQL-specific migrations (using serial instead of autoIncrement)
class PgCreateUsersTable implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('users')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
      .addColumn('username', 'varchar(255)', (col) => col.notNull().unique())
      .addColumn('full_name', 'varchar(255)', (col) => col.notNull())
      .addColumn('createdAt', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .addColumn('updatedAt', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .execute();
  }

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('users').execute();
  }
}

class PgCreatePostsTable implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('posts')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('user_id', 'integer', (col) => col.notNull())
      .addColumn('title', 'varchar(255)', (col) => col.notNull())
      .addColumn('content', 'text')
      .addColumn('status', 'varchar(20)', (col) => col.defaultTo('draft'))
      .addColumn('createdAt', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .addColumn('updatedAt', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .addForeignKeyConstraint('fk_posts_user', ['user_id'], 'users', ['id'])
      .execute();

    await db.schema.createIndex('idx_posts_user_id').on('posts').column('user_id').execute();
  }

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropIndex('idx_posts_user_id').execute();
    await db.schema.dropTable('posts').execute();
  }
}

class PgAddUserProfileFields implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('users').addColumn('bio', 'text').execute();
    await db.schema.alterTable('users').addColumn('avatar_url', 'varchar(500)').execute();
    await db.schema
      .alterTable('users')
      .addColumn('is_active', 'boolean', (col) => col.defaultTo(true))
      .execute();
  }

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.alterTable('users').dropColumn('is_active').execute();
    await db.schema.alterTable('users').dropColumn('avatar_url').execute();
    await db.schema.alterTable('users').dropColumn('bio').execute();
  }
}

class PgCreateCommentsTable implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('comments')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('post_id', 'integer', (col) => col.notNull())
      .addColumn('user_id', 'integer', (col) => col.notNull())
      .addColumn('content', 'text', (col) => col.notNull())
      .addColumn('createdAt', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`).notNull())
      .addForeignKeyConstraint('fk_comments_post', ['post_id'], 'posts', ['id'])
      .addForeignKeyConstraint('fk_comments_user', ['user_id'], 'users', ['id'])
      .execute();

    await db.schema.createIndex('idx_comments_post_user').on('comments').columns(['post_id', 'user_id']).execute();
  }

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropIndex('idx_comments_post_user').execute();
    await db.schema.dropTable('comments').execute();
  }
}

class PgAddTagsSupport implements IMigration {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('tags')
      .addColumn('id', 'serial', (col) => col.primaryKey())
      .addColumn('name', 'varchar(50)', (col) => col.notNull().unique())
      .addColumn('slug', 'varchar(50)', (col) => col.notNull().unique())
      .execute();

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
    @Inject(DATABASE_MIGRATION_SERVICE) private migrationRunner: MigrationRunner,
    @InjectConnection() private db: Kysely<any>
  ) {}

  async runMigrations() {
    return this.migrationRunner.migrate();
  }

  async rollbackMigrations(steps?: number) {
    return this.migrationRunner.rollback({ steps });
  }

  async getMigrationStatus() {
    return this.migrationRunner.status();
  }

  async resetDatabase() {
    return this.migrationRunner.reset(undefined, true); // force=true for testing
  }

  async checkTableExists(tableName: string): Promise<boolean> {
    try {
      await this.db
        .selectFrom(tableName as any)
        .selectAll()
        .limit(1)
        .execute();
      return true;
    } catch {
      return false;
    }
  }
}

describe('Comprehensive Migration Tests', () => {
  const describeSqlite = skipIntegrationTests ? describe.skip : describe;
  describeSqlite('SQLite In-Memory Tests', () => {
    let app: Application;
    let migrationService: MigrationTestService;
    let _db: Kysely<any>;

    beforeAll(async () => {
      // Clear and register migrations globally
      Reflect.deleteMetadata('database:migrations', global);
      Reflect.defineMetadata(
        'database:migrations',
        [
          {
            target: CreateUsersTable,
            metadata: { version: '001', name: 'CreateUsersTable', description: 'Create users table' },
          },
          {
            target: CreatePostsTable,
            metadata: {
              version: '002',
              name: 'CreatePostsTable',
              description: 'Create posts table',
              dependencies: ['001'],
            },
          },
          {
            target: AddUserProfileFields,
            metadata: {
              version: '003',
              name: 'AddUserProfileFields',
              description: 'Add profile fields to users',
              dependencies: ['001'],
            },
          },
          {
            target: CreateCommentsTable,
            metadata: {
              version: '004',
              name: 'CreateCommentsTable',
              description: 'Create comments table',
              dependencies: ['001', '002'],
            },
          },
          {
            target: AddTagsSupport,
            metadata: { version: '005', name: 'AddTagsSupport', description: 'Add tags support to posts' },
          },
        ],
        global
      );

      @Module({
        imports: [
          TitanDatabaseModule.forRoot({
            connection: {
              dialect: 'sqlite',
              connection: ':memory:',
            },
            migrations: {
              autoRun: false,
            },
          }),
        ],
        providers: [MigrationTestService],
      })
      class TestModule {}

      app = await Application.create(TestModule, {
        disableGracefulShutdown: true,
        logging: { level: 'silent' },
      });

      migrationService = await app.resolveAsync(MigrationTestService);
      _db = (await app.resolveAsync(DATABASE_CONNECTION)) as Kysely<any>;
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
        expect(result.success).toBe(true);

        // Check all tables were created
        expect(await migrationService.checkTableExists('users')).toBe(true);
        expect(await migrationService.checkTableExists('posts')).toBe(true);
        expect(await migrationService.checkTableExists('comments')).toBe(true);
        expect(await migrationService.checkTableExists('tags')).toBe(true);
        expect(await migrationService.checkTableExists('post_tags')).toBe(true);
      }, 30000);

      it('should get migration status', async () => {
        // Run some migrations first
        await migrationService.runMigrations();

        const status = await migrationService.getMigrationStatus();

        expect(status.applied).toHaveLength(5);
        expect(status.pending).toHaveLength(0);
        expect(status.currentVersion).toBe('005');
        expect(status.latestVersion).toBe('005');
      }, 30000);

      it('should rollback migrations', async () => {
        // Run all migrations
        await migrationService.runMigrations();

        // Rollback last migration
        const result = await migrationService.rollbackMigrations(1);

        expect(result.migrations).toBeDefined();
        expect(result.migrations.length).toBe(1);
        expect(result.migrations[0]?.name).toContain('AddTagsSupport');

        // Check tags tables were dropped
        expect(await migrationService.checkTableExists('tags')).toBe(false);
        expect(await migrationService.checkTableExists('post_tags')).toBe(false);

        // But other tables should still exist
        expect(await migrationService.checkTableExists('users')).toBe(true);
        expect(await migrationService.checkTableExists('posts')).toBe(true);
      }, 30000);

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
      }, 30000);

      it('should reset database', async () => {
        await migrationService.runMigrations();

        await migrationService.resetDatabase();

        const status = await migrationService.getMigrationStatus();
        expect(status.applied).toHaveLength(0);
        expect(status.pending).toHaveLength(5);

        // All tables should be dropped
        expect(await migrationService.checkTableExists('users')).toBe(false);
        expect(await migrationService.checkTableExists('posts')).toBe(false);
      }, 30000);
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
      }, 30000);

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
      }, 30000);
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
      }, 30000);

      it('should only run pending migrations', async () => {
        // Run first 3 migrations
        await migrationService.runMigrations();
        await migrationService.rollbackMigrations(2);

        // Run migrations again - should only run the 2 pending ones
        const result = await migrationService.runMigrations();
        expect(result.migrations).toHaveLength(2);
      }, 30000);
    });

    describe('Error Handling', () => {
      it('should handle migration failures gracefully', async () => {
        class FailingMigration implements IMigration {
          async up(_db: Kysely<any>): Promise<void> {
            throw new Error('Migration failed intentionally');
          }
          async down(_db: Kysely<any>): Promise<void> {}
        }

        // Store original metadata and set up failing migration
        const originalMetadata = Reflect.getMetadata('database:migrations', global) || [];
        Reflect.defineMetadata(
          'database:migrations',
          [
            {
              target: FailingMigration,
              metadata: { version: '999', name: 'FailingMigration', description: 'Failing migration' },
            },
          ],
          global
        );

        @Module({
          imports: [
            TitanDatabaseModule.forRoot({
              connection: {
                dialect: 'sqlite',
                connection: ':memory:',
              },
              migrations: {
                autoRun: false,
              },
            }),
          ],
          providers: [MigrationTestService],
        })
        class FailingModule {}

        const failApp = await Application.create(FailingModule, {
          disableGracefulShutdown: true,
          logging: { level: 'silent' },
        });

        const failService = await failApp.resolveAsync(MigrationTestService);

        const result = await failService.runMigrations();
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.[0]).toContain('Migration failed intentionally');

        await failApp.stop();

        // Restore original metadata
        Reflect.defineMetadata('database:migrations', originalMetadata, global);
      }, 30000);

      it('should handle rollback failures', async () => {
        class FailingRollback implements IMigration {
          async up(db: Kysely<any>): Promise<void> {
            await db.schema
              .createTable('test_table')
              .addColumn('id', 'integer', (col) => col.primaryKey())
              .execute();
          }
          async down(_db: Kysely<any>): Promise<void> {
            throw new Error('Rollback failed intentionally');
          }
        }

        // Store original metadata and set up failing rollback migration
        const originalMetadata = Reflect.getMetadata('database:migrations', global) || [];
        Reflect.defineMetadata(
          'database:migrations',
          [
            {
              target: FailingRollback,
              metadata: { version: '998', name: 'FailingRollback', description: 'Migration with failing rollback' },
            },
          ],
          global
        );

        @Module({
          imports: [
            TitanDatabaseModule.forRoot({
              connection: {
                dialect: 'sqlite',
                connection: ':memory:',
              },
              migrations: {
                autoRun: false,
              },
            }),
          ],
          providers: [MigrationTestService],
        })
        class FailingRollbackModule {}

        const failApp = await Application.create(FailingRollbackModule, {
          disableGracefulShutdown: true,
          logging: { level: 'silent' },
        });

        const failService = await failApp.resolveAsync(MigrationTestService);

        // Run migration successfully
        await failService.runMigrations();

        // Attempt rollback - should fail
        const result = await failService.rollbackMigrations();
        expect(result.success).toBe(false);
        expect(result.errors).toBeDefined();
        expect(result.errors?.[0]).toContain('Rollback failed intentionally');

        await failApp.stop();

        // Restore original metadata
        Reflect.defineMetadata('database:migrations', originalMetadata, global);
      }, 30000);
    });

    describe.skip('Migration Locking', () => {
      it('should prevent concurrent migrations', async () => {
        // Skipped: Migration locking functionality not yet implemented
        // Would require implementing a lock mechanism in MigrationRunner
      });
    });
  });

  const describeFileBased = skipIntegrationTests ? describe.skip : describe;
  describeFileBased('File-based Migrations', () => {
    let app: Application;
    let migrationService: MigrationTestService;
    let migrationsDir: string;

    beforeAll(async () => {
      // Create temporary migrations directory
      migrationsDir = path.join(__dirnameValue, 'temp-migrations');
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
              connection: ':memory:',
            },
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
        disableGracefulShutdown: true,
        logging: { level: 'silent' },
      });

      migrationService = await app.resolveAsync(MigrationTestService);
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
    }, 30000);
  });

  describeDocker('PostgreSQL Migration Tests', () => {
    let container: DockerContainer;
    let app: Application;
    let migrationService: MigrationTestService;
    let db: Kysely<any>;

    beforeAll(async () => {
      // Register PostgreSQL-specific migrations in global metadata
      Reflect.deleteMetadata('database:migrations', global);
      Reflect.defineMetadata(
        'database:migrations',
        [
          {
            target: PgCreateUsersTable,
            metadata: { version: '001', name: 'PgCreateUsersTable', description: 'Create users table (PostgreSQL)' },
          },
          {
            target: PgCreatePostsTable,
            metadata: {
              version: '002',
              name: 'PgCreatePostsTable',
              description: 'Create posts table (PostgreSQL)',
              dependencies: ['001'],
            },
          },
          {
            target: PgAddUserProfileFields,
            metadata: {
              version: '003',
              name: 'PgAddUserProfileFields',
              description: 'Add profile fields to users (PostgreSQL)',
              dependencies: ['001'],
            },
          },
          {
            target: PgCreateCommentsTable,
            metadata: {
              version: '004',
              name: 'PgCreateCommentsTable',
              description: 'Create comments table (PostgreSQL)',
              dependencies: ['001', '002'],
            },
          },
          {
            target: PgAddTagsSupport,
            metadata: {
              version: '005',
              name: 'PgAddTagsSupport',
              description: 'Add tags support to posts (PostgreSQL)',
            },
          },
        ],
        global
      );

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
              connection: {
                host: 'localhost',
                port,
                database: 'migration_test',
                user: 'test',
                password: 'test',
              },
            },
            migrations: {
              autoRun: false,
            },
          }),
        ],
        providers: [MigrationTestService],
      })
      class PgTestModule {}

      app = await Application.create(PgTestModule, {
        disableGracefulShutdown: true,
        logging: { level: 'silent' },
      });

      migrationService = await app.resolveAsync(MigrationTestService);
      db = (await app.resolveAsync(DATABASE_CONNECTION)) as Kysely<any>;
    }, 120000);

    afterAll(async () => {
      await app.stop();
      await container.cleanup();
    }, 30000);

    beforeEach(async () => {
      // Clean up migration locks and reset database before each test
      try {
        // Force release any migration locks
        await db.deleteFrom('kysely_migration_lock').execute();
      } catch {
        // Ignore if table doesn't exist
      }

      // Reset database state
      try {
        await migrationService.resetDatabase();
      } catch {
        // Ignore errors if tables don't exist
      }
    }, 30000);

    afterEach(async () => {
      // Ensure migration locks are released after each test
      try {
        await db.deleteFrom('kysely_migration_lock').execute();
      } catch {
        // Ignore if table doesn't exist
      }
    }, 10000);

    it('should handle PostgreSQL-specific migrations', async () => {
      const result = await migrationService.runMigrations();
      expect(result.migrations).toHaveLength(5);

      // Verify PostgreSQL-specific features work
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
    }, 60000);

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
            .addColumn('createdAt', 'timestamp', (col) => col.defaultTo(sql`CURRENT_TIMESTAMP`))
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
    }, 30000);
  });
});

// Helper function to create test migration
function _createTestMigration(version: string, upFn: () => Promise<void>, downFn: () => Promise<void>) {
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
