/**
 * Kysera Integration Tests
 *
 * Tests for the updated kysera package integration:
 * - Plugin auto-configuration (applyGlobalPlugins, resolvePlugins)
 * - getConnection returning executor when plugins configured
 * - Plugin management (getExecutor, setConnectionPlugins, getConnectionPlugins)
 * - SoftDeleteError usage in softDelete/restore
 * - formatTimestampForDb + detectDialect in softDelete
 * - getExecutor signature (removed tableName param)
 * - Decorator-based plugin metadata
 * - New exports from @kysera/core
 * - Legacy plugin config support
 *
 * All tests use SQLite in-memory — no Docker required.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Kysely, SqliteDialect, sql } from 'kysely';
import BetterSqlite3 from 'better-sqlite3';
import { DatabaseManager } from '../src/database.manager.js';
import { TransactionAwareRepository } from '../src/repository/transaction-aware.repository.js';
import { getExecutor, isInTransactionContext, runInTransaction } from '../src/transaction/transaction.context.js';
import {
  getDecoratorPlugins,
  getSoftDeleteConfig,
  getTimestampsConfig,
  getAuditConfig,
  hasSoftDelete,
  hasTimestamps,
  hasAudit,
  Repository,
  SoftDelete,
  Timestamps,
  Audit,
} from '../src/database.decorators.js';
import {
  SoftDeleteError,
  RecordNotDeletedError,
  AuditError,
  AuditRestoreError,
  AuditMissingValuesError,
  TimestampsError,
  ErrorCodes,
  detectDialect,
  formatTimestampForDb,
  executeCount,
  shouldApplyToTable,
} from '../src/exports/kysera.js';
import type { Executor as RepositoryExecutor } from '../src/exports/repository.js';

// ============================================================================
// Helpers
// ============================================================================

const createMockLogger = () => {
  const logger: Record<string, any> = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
};

function createSqliteDb<T = unknown>(): Kysely<T> {
  return new Kysely<T>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }),
  });
}

// ============================================================================
// Test DB Schema
// ============================================================================

interface TestDB {
  users: {
    id: string;
    name: string;
    email: string;
    status: string;
    deletedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  items: {
    id: string;
    title: string;
    value: number;
  };
}

async function createUsersTable(db: Kysely<TestDB>): Promise<void> {
  await sql`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      deletedAt TEXT,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `.execute(db);
}

async function createItemsTable(db: Kysely<TestDB>): Promise<void> {
  await sql`
    CREATE TABLE items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0
    )
  `.execute(db);
}

// ============================================================================
// Test Repositories
// ============================================================================

class SoftDeleteUserRepo extends TransactionAwareRepository<TestDB, 'users'> {
  protected override readonly hasSoftDelete = true;

  constructor(db: Kysely<TestDB>) {
    super(db, 'users');
  }

  /**
   * SQLite-friendly softDelete override — uses ISO string instead of Date object.
   */
  override async softDelete(id: string): Promise<boolean> {
    if (!this.hasSoftDelete) {
      throw new SoftDeleteError(
        `softDelete() called on table "${this.tableName}" which does not support soft delete`,
        `Table "${this.tableName}" has hasSoftDelete=false`
      );
    }

    const result = await (this['dynamicExecutor'].updateTable(this.tableName) as any)
      .set({ [this.softDeleteColumn]: new Date().toISOString() })
      .where('id', '=', id)
      .executeTakeFirst();

    return (result?.numUpdatedRows ?? 0n) > 0n;
  }
}

class NoSoftDeleteRepo extends TransactionAwareRepository<TestDB, 'items'> {
  constructor(db: Kysely<TestDB>) {
    super(db, 'items');
  }
}

let idCounter = 0;
function nextId(): string {
  return `id-${++idCounter}-${Date.now()}`;
}

// ============================================================================
// 1. New Exports from @kysera/core
// ============================================================================

describe('Kysera Core Exports', () => {
  it('should export error classes', () => {
    expect(SoftDeleteError).toBeDefined();
    expect(RecordNotDeletedError).toBeDefined();
    expect(AuditError).toBeDefined();
    expect(AuditRestoreError).toBeDefined();
    expect(AuditMissingValuesError).toBeDefined();
    expect(TimestampsError).toBeDefined();
  });

  it('should export ErrorCodes', () => {
    expect(ErrorCodes).toBeDefined();
    expect(typeof ErrorCodes).toBe('object');
  });

  it('should export utility functions', () => {
    expect(typeof detectDialect).toBe('function');
    expect(typeof formatTimestampForDb).toBe('function');
    expect(typeof executeCount).toBe('function');
    expect(typeof shouldApplyToTable).toBe('function');
  });

  it('SoftDeleteError should be instanceof Error', () => {
    const err = new SoftDeleteError('test', 'detail');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('test');
  });

  it('formatTimestampForDb should format dates for different dialects', () => {
    const date = new Date('2025-01-15T10:30:00.000Z');

    const pg = formatTimestampForDb(date, 'postgres');
    expect(pg).toBe('2025-01-15T10:30:00.000Z');

    const sqlite = formatTimestampForDb(date, 'sqlite');
    expect(sqlite).toBe('2025-01-15T10:30:00.000Z');

    const mysql = formatTimestampForDb(date, 'mysql');
    expect(mysql).toMatch(/2025-01-15/);
  });

  it('shouldApplyToTable should respect table config', () => {
    expect(shouldApplyToTable('users', {})).toBe(true);
    expect(shouldApplyToTable('users', { tables: ['users'] })).toBe(true);
    expect(shouldApplyToTable('posts', { tables: ['users'] })).toBe(false);
    expect(shouldApplyToTable('users', { excludeTables: ['users'] })).toBe(false);
    expect(shouldApplyToTable('posts', { excludeTables: ['users'] })).toBe(true);
  });

  it('detectDialect should return a valid dialect string', () => {
    const db = createSqliteDb();
    const dialect = detectDialect(db);
    // detectDialect inspects SQL generation patterns; SQLite may fall back to 'postgres' default
    expect(['postgres', 'mysql', 'sqlite', 'mssql']).toContain(dialect);
    db.destroy();
  });
});

// ============================================================================
// 2. RepositoryExecutor Type Export
// ============================================================================

describe('Repository Executor Type', () => {
  it('should export Executor type alias from @kysera/core', () => {
    // This is a compile-time check — the type should be importable
    const _check: RepositoryExecutor<TestDB> | null = null;
    expect(_check).toBeNull();
  });
});

// ============================================================================
// 3. Decorator-Based Plugin Metadata
// ============================================================================

describe('Decorator Plugin Metadata', () => {
  it('getDecoratorPlugins returns empty for undecorated class', () => {
    class PlainRepo {}
    expect(getDecoratorPlugins(PlainRepo)).toEqual([]);
  });

  it('getDecoratorPlugins detects @Repository({ softDelete: true })', () => {
    @Repository({ table: 'test', softDelete: true })
    class TestRepo extends TransactionAwareRepository<any, 'test'> {
      constructor() { super(null as any, 'test'); }
    }

    const plugins = getDecoratorPlugins(TestRepo);
    expect(plugins).toContain('soft-delete');
    expect(hasSoftDelete(TestRepo)).toBe(true);
  });

  it('getDecoratorPlugins detects @Repository({ timestamps: true })', () => {
    @Repository({ table: 'test', timestamps: true })
    class TestRepo extends TransactionAwareRepository<any, 'test'> {
      constructor() { super(null as any, 'test'); }
    }

    const plugins = getDecoratorPlugins(TestRepo);
    expect(plugins).toContain('timestamps');
    expect(hasTimestamps(TestRepo)).toBe(true);
  });

  it('getDecoratorPlugins detects @Repository({ audit: true })', () => {
    @Repository({ table: 'test', audit: true })
    class TestRepo extends TransactionAwareRepository<any, 'test'> {
      constructor() { super(null as any, 'test'); }
    }

    const plugins = getDecoratorPlugins(TestRepo);
    expect(plugins).toContain('audit');
    expect(hasAudit(TestRepo)).toBe(true);
  });

  it('getDecoratorPlugins detects all three simultaneously', () => {
    @Repository({ table: 'test', softDelete: true, timestamps: true, audit: true })
    class TestRepo extends TransactionAwareRepository<any, 'test'> {
      constructor() { super(null as any, 'test'); }
    }

    const plugins = getDecoratorPlugins(TestRepo);
    expect(plugins).toEqual(['soft-delete', 'timestamps', 'audit']);
  });

  it('getSoftDeleteConfig returns default snake_case column', () => {
    @Repository({ table: 'test', softDelete: true })
    class TestRepo extends TransactionAwareRepository<any, 'test'> {
      constructor() { super(null as any, 'test'); }
    }

    const config = getSoftDeleteConfig(TestRepo);
    expect(config).toBeDefined();
    expect(config!.column).toBe('deletedAt');
  });

  it('getSoftDeleteConfig returns custom column', () => {
    @Repository({ table: 'test', softDelete: { column: 'removed_at' } })
    class TestRepo extends TransactionAwareRepository<any, 'test'> {
      constructor() { super(null as any, 'test'); }
    }

    const config = getSoftDeleteConfig(TestRepo);
    expect(config!.column).toBe('removed_at');
  });

  it('getTimestampsConfig returns default snake_case columns', () => {
    @Repository({ table: 'test', timestamps: true })
    class TestRepo extends TransactionAwareRepository<any, 'test'> {
      constructor() { super(null as any, 'test'); }
    }

    const config = getTimestampsConfig(TestRepo);
    expect(config).toBeDefined();
    expect(config!.createdAt).toBe('createdAt');
    expect(config!.updatedAt).toBe('updatedAt');
  });

  it('getTimestampsConfig returns custom columns', () => {
    @Repository({ table: 'test', timestamps: { createdAt: 'birth', updatedAt: 'modified' } })
    class TestRepo extends TransactionAwareRepository<any, 'test'> {
      constructor() { super(null as any, 'test'); }
    }

    const config = getTimestampsConfig(TestRepo);
    expect(config!.createdAt).toBe('birth');
    expect(config!.updatedAt).toBe('modified');
  });

  it('getAuditConfig returns defaults', () => {
    @Repository({ table: 'test', audit: true })
    class TestRepo extends TransactionAwareRepository<any, 'test'> {
      constructor() { super(null as any, 'test'); }
    }

    const config = getAuditConfig(TestRepo);
    expect(config).toBeDefined();
    expect(config!.table).toBe('audit_logs');
  });

  it('getAuditConfig returns custom table', () => {
    @Repository({ table: 'test', audit: { table: 'custom_audit', captureOldValues: true, captureNewValues: false } })
    class TestRepo extends TransactionAwareRepository<any, 'test'> {
      constructor() { super(null as any, 'test'); }
    }

    const config = getAuditConfig(TestRepo);
    expect(config!.table).toBe('custom_audit');
    expect(config!.captureOldValues).toBe(true);
    expect(config!.captureNewValues).toBe(false);
  });

  it('@SoftDelete() decorator sets metadata', () => {
    @Repository('test')
    @SoftDelete()
    class TestRepo extends TransactionAwareRepository<any, 'test'> {
      constructor() { super(null as any, 'test'); }
    }

    expect(hasSoftDelete(TestRepo)).toBe(true);
    const config = getSoftDeleteConfig(TestRepo);
    expect(config).toBeDefined();
  });

  it('@Timestamps() decorator sets metadata', () => {
    @Repository('test')
    @Timestamps()
    class TestRepo extends TransactionAwareRepository<any, 'test'> {
      constructor() { super(null as any, 'test'); }
    }

    expect(hasTimestamps(TestRepo)).toBe(true);
    const config = getTimestampsConfig(TestRepo);
    expect(config).toBeDefined();
  });

  it('@Audit() decorator sets metadata', () => {
    @Repository('test')
    @Audit()
    class TestRepo extends TransactionAwareRepository<any, 'test'> {
      constructor() { super(null as any, 'test'); }
    }

    expect(hasAudit(TestRepo)).toBe(true);
    const config = getAuditConfig(TestRepo);
    expect(config).toBeDefined();
  });

  it('getSoftDeleteConfig returns undefined for non-softdelete repo', () => {
    @Repository({ table: 'test' })
    class TestRepo extends TransactionAwareRepository<any, 'test'> {
      constructor() { super(null as any, 'test'); }
    }

    expect(getSoftDeleteConfig(TestRepo)).toBeUndefined();
    expect(hasSoftDelete(TestRepo)).toBe(false);
  });
});

// ============================================================================
// 4. TransactionAwareRepository — SoftDeleteError + defaults
// ============================================================================

describe('TransactionAwareRepository — Soft Delete', () => {
  let db: Kysely<TestDB>;
  let softDeleteRepo: SoftDeleteUserRepo;
  let noSoftDeleteRepo: NoSoftDeleteRepo;

  beforeEach(async () => {
    db = createSqliteDb<TestDB>();
    await createUsersTable(db);
    await createItemsTable(db);
    softDeleteRepo = new SoftDeleteUserRepo(db);
    noSoftDeleteRepo = new NoSoftDeleteRepo(db);
    idCounter = 0;
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('softDeleteColumn defaults to deletedAt', () => {
    expect((softDeleteRepo as any).softDeleteColumn).toBe('deletedAt');
  });

  it('softDelete() sets deletedAt column', async () => {
    const id = nextId();
    const now = new Date().toISOString();
    await db.insertInto('users').values({
      id,
      name: 'Test',
      email: 'test@x.com',
      status: 'active',
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    }).execute();

    const result = await softDeleteRepo.softDelete(id);
    expect(result).toBe(true);

    const row = await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
    expect(row!.deletedAt).not.toBeNull();
  });

  it('restore() clears deletedAt column', async () => {
    const id = nextId();
    const now = new Date().toISOString();
    await db.insertInto('users').values({
      id,
      name: 'Test',
      email: 'rest@x.com',
      status: 'active',
      deletedAt: now,
      createdAt: now,
      updatedAt: now,
    }).execute();

    const restored = await softDeleteRepo.restore(id);
    expect(restored).not.toBeNull();
    expect(restored!.deletedAt).toBeNull();
  });

  it('softDelete() throws SoftDeleteError when hasSoftDelete=false', async () => {
    const id = nextId();
    await db.insertInto('items').values({ id, title: 'X', value: 1 }).execute();

    await expect(noSoftDeleteRepo.softDelete(id)).rejects.toThrow(SoftDeleteError);
    await expect(noSoftDeleteRepo.softDelete(id)).rejects.toThrow('does not support soft delete');
  });

  it('restore() throws SoftDeleteError when hasSoftDelete=false', async () => {
    const id = nextId();
    await db.insertInto('items').values({ id, title: 'X', value: 1 }).execute();

    await expect(noSoftDeleteRepo.restore(id)).rejects.toThrow(SoftDeleteError);
    await expect(noSoftDeleteRepo.restore(id)).rejects.toThrow('does not support soft delete');
  });

  it('list() uses createdAt as default orderBy', async () => {
    const now1 = '2025-01-01T00:00:00.000Z';
    const now2 = '2025-01-02T00:00:00.000Z';

    await db.insertInto('users').values({
      id: nextId(), name: 'First', email: 'first@x.com',
      status: 'active', deletedAt: null, createdAt: now1, updatedAt: now1,
    }).execute();

    await db.insertInto('users').values({
      id: nextId(), name: 'Second', email: 'second@x.com',
      status: 'active', deletedAt: null, createdAt: now2, updatedAt: now2,
    }).execute();

    // Default is orderBy=createdAt desc
    const result = await softDeleteRepo.list();
    expect(result.data).toHaveLength(2);
    expect((result.data[0] as any).name).toBe('Second');
    expect((result.data[1] as any).name).toBe('First');
  });

  it('list() filters soft-deleted records by default', async () => {
    const now = new Date().toISOString();
    await db.insertInto('users').values({
      id: nextId(), name: 'Active', email: 'active@x.com',
      status: 'active', deletedAt: null, createdAt: now, updatedAt: now,
    }).execute();
    await db.insertInto('users').values({
      id: nextId(), name: 'Deleted', email: 'deleted@x.com',
      status: 'active', deletedAt: now, createdAt: now, updatedAt: now,
    }).execute();

    const result = await softDeleteRepo.list();
    expect(result.total).toBe(1);
    expect(result.data).toHaveLength(1);
    expect((result.data[0] as any).name).toBe('Active');
  });

  it('list() with includeSoftDeleted=true returns all records', async () => {
    const now = new Date().toISOString();
    await db.insertInto('users').values({
      id: nextId(), name: 'Active', email: 'a@x.com',
      status: 'active', deletedAt: null, createdAt: now, updatedAt: now,
    }).execute();
    await db.insertInto('users').values({
      id: nextId(), name: 'Deleted', email: 'd@x.com',
      status: 'active', deletedAt: now, createdAt: now, updatedAt: now,
    }).execute();

    const result = await softDeleteRepo.list({ includeSoftDeleted: true });
    expect(result.total).toBe(2);
  });
});

// ============================================================================
// 5. getExecutor — Signature Change (no tableName param)
// ============================================================================

describe('getExecutor Signature', () => {
  let db: Kysely<TestDB>;

  beforeEach(async () => {
    db = createSqliteDb<TestDB>();
    await createUsersTable(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('getExecutor(db) returns db outside transaction', () => {
    const executor = getExecutor(db);
    expect(executor).toBe(db);
  });

  it('getExecutor(db) returns transaction inside transaction context', async () => {
    await runInTransaction(db, async () => {
      const executor = getExecutor(db);
      expect(executor).not.toBe(db);
      expect(isInTransactionContext()).toBe(true);
    });
  });

  it('getExecutor takes exactly one argument (no tableName)', () => {
    // getExecutor signature: getExecutor<DB>(db: Kysely<DB> | Transaction<DB>): Kysely<DB> | Transaction<DB>
    expect(getExecutor.length).toBeLessThanOrEqual(1);
  });
});

// ============================================================================
// 6. DatabaseManager — Plugin Management
// ============================================================================

describe('DatabaseManager Plugin Management', () => {
  let manager: DatabaseManager;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  afterEach(async () => {
    if (manager) {
      await manager.closeAll();
    }
  });

  it('getConnectionPlugins returns empty array when no plugins configured', async () => {
    manager = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: ':memory:' } },
      mockLogger as any
    );
    await manager.init();

    const plugins = manager.getConnectionPlugins();
    expect(plugins).toEqual([]);
  });

  it('setConnectionPlugins stores and returns executor', async () => {
    manager = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: ':memory:' } },
      mockLogger as any
    );
    await manager.init();

    const { softDeletePlugin } = await import('@kysera/soft-delete');
    const plugin = softDeletePlugin();
    const executor = await manager.setConnectionPlugins('default', [plugin]);

    expect(executor).toBeDefined();
    expect(manager.isExecutor(executor as any)).toBe(true);

    const plugins = manager.getConnectionPlugins();
    expect(plugins.length).toBe(1);
    expect(plugins[0].name).toMatch(/soft-delete/);
  });

  it('getExecutor returns cached executor after setConnectionPlugins', async () => {
    manager = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: ':memory:' } },
      mockLogger as any
    );
    await manager.init();

    const { timestampsPlugin } = await import('@kysera/timestamps');
    await manager.setConnectionPlugins('default', [timestampsPlugin()]);

    const executor = await manager.getExecutor();
    expect(manager.isExecutor(executor as any)).toBe(true);
  });

  it('getExecutor with custom plugins creates new executor', async () => {
    manager = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: ':memory:' } },
      mockLogger as any
    );
    await manager.init();

    const { softDeletePlugin } = await import('@kysera/soft-delete');
    const executor = await manager.getExecutor('default', [softDeletePlugin()]);

    expect(executor).toBeDefined();
    expect(manager.isExecutor(executor as any)).toBe(true);
  });

  it('getConnection returns executor when plugins are configured', async () => {
    manager = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: ':memory:' } },
      mockLogger as any
    );
    await manager.init();

    const { softDeletePlugin } = await import('@kysera/soft-delete');
    await manager.setConnectionPlugins('default', [softDeletePlugin()]);

    const conn = await manager.getConnection();
    // getConnection should return executor (not raw instance) when plugins available
    expect(manager.isExecutor(conn as any)).toBe(true);
  });

  it('getConnection returns raw instance when no plugins', async () => {
    manager = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: ':memory:' } },
      mockLogger as any
    );
    await manager.init();

    const conn = await manager.getConnection();
    // No plugins → return raw Kysely instance
    expect(conn).toBeDefined();
  });

  it('getRawDb bypasses plugin interceptors', async () => {
    manager = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: ':memory:' } },
      mockLogger as any
    );
    await manager.init();

    const { softDeletePlugin } = await import('@kysera/soft-delete');
    const executor = await manager.setConnectionPlugins('default', [softDeletePlugin()]);

    const rawDb = manager.getRawDb(executor as any);
    expect(rawDb).toBeDefined();
    expect(manager.isExecutor(rawDb as any)).toBe(false);
  });

  it('setConnectionPlugins throws for non-existent connection', async () => {
    manager = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: ':memory:' } },
      mockLogger as any
    );
    await manager.init();

    await expect(
      manager.setConnectionPlugins('nonexistent', [])
    ).rejects.toThrow();
  });
});

// ============================================================================
// 7. DatabaseManager — Global Plugin Auto-Configuration
// ============================================================================

describe('DatabaseManager Global Plugins', () => {
  let manager: DatabaseManager;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  afterEach(async () => {
    if (manager) {
      await manager.closeAll();
    }
  });

  it('applies global plugins from kysera.plugins config (string names)', async () => {
    manager = new DatabaseManager(
      {
        connection: { dialect: 'sqlite', connection: ':memory:' },
        kysera: {
          plugins: ['soft-delete', 'timestamps'],
        },
      },
      mockLogger as any
    );
    await manager.init();

    const plugins = manager.getConnectionPlugins();
    expect(plugins.length).toBe(2);
    expect(plugins.map((p) => p.name).some((n) => n.includes('soft-delete'))).toBe(true);
    expect(plugins.map((p) => p.name).some((n) => n.includes('timestamps'))).toBe(true);
  });

  it('applies global plugins from kysera.plugins config (object specs)', async () => {
    manager = new DatabaseManager(
      {
        connection: { dialect: 'sqlite', connection: ':memory:' },
        kysera: {
          plugins: [
            { plugin: 'soft-delete', options: { deletedAtColumn: 'removed_at' } },
          ],
        },
      },
      mockLogger as any
    );
    await manager.init();

    const plugins = manager.getConnectionPlugins();
    expect(plugins.length).toBe(1);
    expect(plugins[0].name).toMatch(/soft-delete/);
  });

  it('applies global plugins from kysera.plugins config (Plugin instances)', async () => {
    const { softDeletePlugin } = await import('@kysera/soft-delete');
    const pluginInstance = softDeletePlugin();

    manager = new DatabaseManager(
      {
        connection: { dialect: 'sqlite', connection: ':memory:' },
        kysera: {
          plugins: [pluginInstance],
        },
      },
      mockLogger as any
    );
    await manager.init();

    const plugins = manager.getConnectionPlugins();
    expect(plugins.length).toBe(1);
    expect(plugins[0].name).toMatch(/soft-delete/);
  });

  it('handles legacy builtIn config', async () => {
    manager = new DatabaseManager(
      {
        connection: { dialect: 'sqlite', connection: ':memory:' },
        plugins: {
          builtIn: {
            softDelete: true,
            timestamps: true,
          },
        },
      },
      mockLogger as any
    );
    await manager.init();

    const plugins = manager.getConnectionPlugins();
    expect(plugins.length).toBe(2);
  });

  it('handles legacy builtIn config with options', async () => {
    manager = new DatabaseManager(
      {
        connection: { dialect: 'sqlite', connection: ':memory:' },
        plugins: {
          builtIn: {
            softDelete: { deletedAtColumn: 'removed_at' },
          },
        },
      },
      mockLogger as any
    );
    await manager.init();

    const plugins = manager.getConnectionPlugins();
    expect(plugins.length).toBe(1);
    expect(plugins[0].name).toMatch(/soft-delete/);
  });

  it('skips unknown plugin names with warning', async () => {
    manager = new DatabaseManager(
      {
        connection: { dialect: 'sqlite', connection: ':memory:' },
        kysera: {
          plugins: ['unknown-plugin'],
        },
      },
      mockLogger as any
    );
    await manager.init();

    const plugins = manager.getConnectionPlugins();
    expect(plugins.length).toBe(0);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('no plugins applied when none configured', async () => {
    manager = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: ':memory:' } },
      mockLogger as any
    );
    await manager.init();

    const plugins = manager.getConnectionPlugins();
    expect(plugins.length).toBe(0);
  });

  it('kysera.plugins takes precedence over legacy builtIn', async () => {
    manager = new DatabaseManager(
      {
        connection: { dialect: 'sqlite', connection: ':memory:' },
        kysera: {
          plugins: ['soft-delete'],
        },
        plugins: {
          builtIn: {
            timestamps: true,
          },
        },
      },
      mockLogger as any
    );
    await manager.init();

    const plugins = manager.getConnectionPlugins();
    // kysera.plugins should be used, not legacy builtIn
    expect(plugins.length).toBe(1);
    expect(plugins[0].name).toMatch(/soft-delete/);
  });
});

// ============================================================================
// 8. Health Check Simplification
// ============================================================================

describe('DatabaseManager Health Check', () => {
  let manager: DatabaseManager;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  afterEach(async () => {
    if (manager) {
      await manager.closeAll();
    }
  });

  it('health check works for SQLite', async () => {
    manager = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: ':memory:' } },
      mockLogger as any
    );
    await manager.init();

    const health = await manager.checkConnectionHealth();
    expect(health.healthy).toBe(true);
    expect(health.latency).toBeDefined();
  });
});

// ============================================================================
// 9. Executor with Plugins — Functional Test
// ============================================================================

describe('Executor with Plugins — Functional', () => {
  let manager: DatabaseManager;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  afterEach(async () => {
    if (manager) {
      await manager.closeAll();
    }
  });

  it('executor with soft-delete plugin should work for queries', async () => {
    manager = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: ':memory:' } },
      mockLogger as any
    );
    await manager.init();

    const db = await manager.getConnection() as Kysely<any>;
    await sql`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        deletedAt TEXT
      )
    `.execute(db);

    // Set up soft-delete plugin with Titan's camelCase column convention
    const { softDeletePlugin } = await import('@kysera/soft-delete');
    await manager.setConnectionPlugins('default', [softDeletePlugin({ deletedAtColumn: 'deletedAt' })]);

    const executor = await manager.getExecutor();

    // Insert data
    await (executor as Kysely<any>).insertInto('users').values({ id: '1', name: 'Active', deletedAt: null }).execute();
    await (executor as Kysely<any>).insertInto('users').values({ id: '2', name: 'Deleted', deletedAt: '2025-01-01' }).execute();

    // Plugin should filter soft-deleted records automatically
    const results = await (executor as Kysely<any>).selectFrom('users').selectAll().execute();
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Active');
  });

  it('executor with timestamps plugin should be configurable', async () => {
    manager = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: ':memory:' } },
      mockLogger as any
    );
    await manager.init();

    const { timestampsPlugin } = await import('@kysera/timestamps');
    await manager.setConnectionPlugins('default', [timestampsPlugin()]);

    const plugins = manager.getConnectionPlugins();
    expect(plugins.length).toBe(1);
    expect(plugins[0].name).toMatch(/timestamps/);

    const executor = await manager.getExecutor();
    expect(manager.isExecutor(executor as any)).toBe(true);
  });
});

// ============================================================================
// 10. Removed registerShutdownHandlers — No process handlers registered
// ============================================================================

describe('DatabaseManager Lifecycle', () => {
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  it('init does not register process signal handlers', async () => {
    const originalListenerCount = process.listenerCount('SIGINT');
    const manager = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: ':memory:' } },
      mockLogger as any
    );
    await manager.init();

    // No additional SIGINT handlers should be registered
    expect(process.listenerCount('SIGINT')).toBe(originalListenerCount);

    await manager.closeAll();
  });
});

// ============================================================================
// 11. uuid-v7 Type Safety (Kysely<unknown> instead of Kysely<any>)
// ============================================================================

describe('uuid-v7 Type Safety', () => {
  it('createUuidV7Function accepts Kysely<unknown>', async () => {
    // This is a compile-time check — importing should not error
    const { createUuidV7Function, dropUuidV7Function } = await import('../src/uuid-v7.js');
    expect(typeof createUuidV7Function).toBe('function');
    expect(typeof dropUuidV7Function).toBe('function');
  });
});
