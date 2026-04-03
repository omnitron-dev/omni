/**
 * Migration Plugin / Hooks Tests
 *
 * Tests for the @kysera/migrations MigrationPlugin lifecycle hooks
 * exposed via MigrationRunnerWithPlugins.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Application } from '@omnitron-dev/titan/application';
import { Module } from '@omnitron-dev/titan/decorators';
import {
  TitanDatabaseModule,
  MigrationRunnerWithPlugins,
  DATABASE_MANAGER,
  setupMigrations,
  createMigration,
} from '../src/index.js';
import type { IDatabaseManager } from '../src/index.js';
import type { MigrationPlugin } from '@kysera/migrations';
import type { Migration as KyseraMigration } from '@kysera/migrations';
import { Kysely } from 'kysely';

// ---------------------------------------------------------------------------
// Test migration
// ---------------------------------------------------------------------------

const testMigration: KyseraMigration = createMigration(
  '001_create_hook_test_table',
  async (db: Kysely<any>) => {
    await db.schema
      .createTable('hook_test_table')
      .ifNotExists()
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('name', 'varchar(100)', (col) => col.notNull())
      .execute();
  },
  async (db: Kysely<any>) => {
    await db.schema.dropTable('hook_test_table').ifExists().execute();
  },
);

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

describe('Migration Hooks (MigrationPlugin)', () => {
  let app: Application;
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

    await setupMigrations(db);
  });

  afterEach(async () => {
    if (app) {
      await app.stop();
    }
    await TitanDatabaseModule.resetForTesting();
  });

  describe('beforeMigration', () => {
    it('should call beforeMigration before running each migration', async () => {
      const beforeSpy = vi.fn();
      const plugin: MigrationPlugin = {
        name: 'test-before',
        version: '1.0.0',
        beforeMigration: beforeSpy,
      };

      const runner = new MigrationRunnerWithPlugins(db, [testMigration], {
        plugins: [plugin],
      });

      await runner.up();

      expect(beforeSpy).toHaveBeenCalledTimes(1);
      expect(beforeSpy).toHaveBeenCalledWith(
        expect.objectContaining({ name: '001_create_hook_test_table' }),
        'up',
      );
    });
  });

  describe('afterMigration', () => {
    it('should call afterMigration after each migration completes', async () => {
      const afterSpy = vi.fn();
      const plugin: MigrationPlugin = {
        name: 'test-after',
        version: '1.0.0',
        afterMigration: afterSpy,
      };

      const runner = new MigrationRunnerWithPlugins(db, [testMigration], {
        plugins: [plugin],
      });

      await runner.up();

      expect(afterSpy).toHaveBeenCalledTimes(1);
      const [migration, operation, duration] = afterSpy.mock.calls[0];
      expect(migration.name).toBe('001_create_hook_test_table');
      expect(operation).toBe('up');
      expect(typeof duration).toBe('number');
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('should not call afterMigration when no migrations to run', async () => {
      const afterSpy = vi.fn();
      const plugin: MigrationPlugin = {
        name: 'test-after-empty',
        version: '1.0.0',
        afterMigration: afterSpy,
      };

      // First run to apply all
      const runner1 = new MigrationRunnerWithPlugins(db, [testMigration], {
        plugins: [plugin],
      });
      await runner1.up();
      afterSpy.mockClear();

      // Second run - no pending migrations
      const runner2 = new MigrationRunnerWithPlugins(db, [testMigration], {
        plugins: [plugin],
      });
      await runner2.up();

      expect(afterSpy).not.toHaveBeenCalled();
    });
  });

  describe('onMigrationError', () => {
    it('should call onMigrationError when a migration fails', async () => {
      const errorSpy = vi.fn();
      const plugin: MigrationPlugin = {
        name: 'test-error',
        version: '1.0.0',
        onMigrationError: errorSpy,
      };

      const failingMigration = createMigration(
        '002_failing',
        async () => {
          throw new Error('Intentional test failure');
        },
      );

      const runner = new MigrationRunnerWithPlugins(
        db,
        [testMigration, failingMigration],
        { plugins: [plugin] },
      );

      // up() throws when stopOnError is true (default) and a migration fails
      try {
        await runner.up();
      } catch {
        // Expected MigrationError
      }

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [migration, operation, error] = errorSpy.mock.calls[0];
      expect(migration.name).toBe('002_failing');
      expect(operation).toBe('up');
      expect(error).toBeDefined();
    });
  });

  describe('Multiple hooks order', () => {
    it('should call hooks in correct order: before -> after', async () => {
      const calls: string[] = [];

      const plugin: MigrationPlugin = {
        name: 'test-order',
        version: '1.0.0',
        beforeMigration: () => {
          calls.push('before');
        },
        afterMigration: () => {
          calls.push('after');
        },
      };

      const runner = new MigrationRunnerWithPlugins(db, [testMigration], {
        plugins: [plugin],
      });

      await runner.up();

      expect(calls).toEqual(['before', 'after']);
    });
  });

  describe('onInit', () => {
    it('should call onInit when runner is created via factory', async () => {
      const { createMigrationRunnerWithPlugins } = await import('../src/index.js');
      const initSpy = vi.fn();
      const plugin: MigrationPlugin = {
        name: 'test-init',
        version: '1.0.0',
        onInit: initSpy,
      };

      // onInit is called by the factory function, not the constructor
      const _runner = await createMigrationRunnerWithPlugins(db, [testMigration], {
        plugins: [plugin],
      });

      expect(initSpy).toHaveBeenCalled();
    });
  });

  describe('Plugin-free backward compatibility', () => {
    it('should work without any plugins', async () => {
      const runner = new MigrationRunnerWithPlugins(db, [testMigration]);

      const result = await runner.up();
      expect(result.executed).toHaveLength(1);
      expect(result.failed).toHaveLength(0);
    });

    it('should work with partial plugin (only some hooks defined)', async () => {
      const beforeSpy = vi.fn();
      const plugin: MigrationPlugin = {
        name: 'test-partial',
        version: '1.0.0',
        beforeMigration: beforeSpy,
        // No afterMigration, onMigrationError, or onInit
      };

      const runner = new MigrationRunnerWithPlugins(db, [testMigration], {
        plugins: [plugin],
      });

      const result = await runner.up();
      expect(result.executed).toHaveLength(1);
      expect(beforeSpy).toHaveBeenCalled();
    });
  });

  describe('Down operation hooks', () => {
    it('should call hooks with down operation during rollback', async () => {
      const calls: Array<{ name: string; op: string }> = [];
      const plugin: MigrationPlugin = {
        name: 'test-down-hooks',
        version: '1.0.0',
        beforeMigration: (m, op) => {
          calls.push({ name: m.name, op });
        },
        afterMigration: (m, op) => {
          calls.push({ name: m.name, op: `after-${op}` });
        },
      };

      const runner = new MigrationRunnerWithPlugins(db, [testMigration], {
        plugins: [plugin],
      });

      // Run up first
      await runner.up();
      calls.length = 0; // reset

      // Now rollback
      await runner.down(1);

      const downCalls = calls.filter((c) => c.op === 'down' || c.op === 'after-down');
      expect(downCalls.length).toBeGreaterThanOrEqual(1);
    });
  });
});
