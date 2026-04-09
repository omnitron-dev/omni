/**
 * Comprehensive Database Module Tests
 *
 * Tests the core database abstractions using SQLite in-memory databases:
 * A. TransactionAwareRepository with soft-delete enabled
 * B. TransactionAwareRepository without soft-delete
 * C. runInTransaction / getExecutor / isInTransactionContext
 * D. registerTablePlugins / getTablePlugins / clearPluginRegistry
 * E. DatabaseManager with SQLite
 *
 * All tests use better-sqlite3 in-memory databases - no Docker required.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Kysely, SqliteDialect, sql } from 'kysely';
import BetterSqlite3 from 'better-sqlite3';
import {
  TransactionAwareRepository,
  runInTransaction,
  getExecutor,
  isInTransactionContext,
  getTransactionContext,
  registerTablePlugins,
  getTablePlugins,
  clearPluginRegistry,
  DatabaseManager,
} from '../src/index.js';

// ============================================================================
// Test Database Schema
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

// ============================================================================
// Repository implementations
// ============================================================================

class SoftDeleteUserRepository extends TransactionAwareRepository<TestDB, 'users'> {
  protected override readonly hasSoftDelete = true;

  constructor(db: Kysely<TestDB>) {
    super(db, 'users');
  }

  /**
   * Override softDelete to use ISO string instead of Date object.
   * The base class uses `new Date()` which works for PostgreSQL/MySQL
   * but SQLite's better-sqlite3 driver cannot bind Date objects.
   */
  override async softDelete(id: string): Promise<boolean> {
    if (!this.hasSoftDelete) {
      throw new Error(`softDelete() called on table "${this.tableName}" which does not support soft delete`);
    }

    const result = await (this['dynamicExecutor'].updateTable(this.tableName) as any)
      .set({ [this.softDeleteColumn]: new Date().toISOString() })
      .where('id', '=', id)
      .executeTakeFirst();

    return (result?.numUpdatedRows ?? 0n) > 0n;
  }
}

class HardDeleteUserRepository extends TransactionAwareRepository<TestDB, 'users'> {
  // hasSoftDelete defaults to false
  constructor(db: Kysely<TestDB>) {
    super(db, 'users');
  }
}

class ItemRepository extends TransactionAwareRepository<TestDB, 'items'> {
  constructor(db: Kysely<TestDB>) {
    super(db, 'items');
  }
}

// ============================================================================
// Helpers
// ============================================================================

function createSqliteDb(): Kysely<TestDB> {
  const nativeDb = new BetterSqlite3(':memory:');
  return new Kysely<TestDB>({
    dialect: new SqliteDialect({ database: nativeDb }),
  });
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

function createMockLogger() {
  const logger: any = {
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
}

let idCounter = 0;
function nextId(): string {
  return `id-${++idCounter}-${Date.now()}`;
}

// ============================================================================
// A. TransactionAwareRepository WITH soft-delete
// ============================================================================

describe('TransactionAwareRepository with hasSoftDelete = true', () => {
  let db: Kysely<TestDB>;
  let repo: SoftDeleteUserRepository;

  beforeEach(async () => {
    db = createSqliteDb();
    await createUsersTable(db);
    repo = new SoftDeleteUserRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  // ---------- create / createMany ----------

  it('should create a single record and return it', async () => {
    const id = nextId();
    const user = await repo.create({
      id,
      name: 'Alice',
      email: 'alice@test.com',
      status: 'active',
      deletedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);

    expect(user).toBeDefined();
    expect(user.id).toBe(id);
    expect(user.name).toBe('Alice');
    expect(user.email).toBe('alice@test.com');
  });

  it('should create many records at once', async () => {
    const now = new Date().toISOString();
    const records = [
      { id: nextId(), name: 'Bob', email: 'bob@test.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now },
      { id: nextId(), name: 'Carol', email: 'carol@test.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now },
    ];

    const users = await repo.createMany(records as any);
    expect(users).toHaveLength(2);
    expect(users[0].name).toBe('Bob');
    expect(users[1].name).toBe('Carol');
  });

  it('should return empty array when createMany receives empty array', async () => {
    const result = await repo.createMany([]);
    expect(result).toEqual([]);
  });

  // ---------- findById / findByIds ----------

  it('should findById for an existing record', async () => {
    const id = nextId();
    const now = new Date().toISOString();
    await repo.create({ id, name: 'Dave', email: 'dave@test.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);

    const found = await repo.findById(id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Dave');
  });

  it('should return null from findById for non-existent id', async () => {
    const found = await repo.findById('nonexistent');
    expect(found).toBeNull();
  });

  it('should findByIds for multiple records', async () => {
    const now = new Date().toISOString();
    const id1 = nextId();
    const id2 = nextId();
    await repo.create({ id: id1, name: 'Eve', email: 'eve@test.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);
    await repo.create({ id: id2, name: 'Frank', email: 'frank@test.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);

    const found = await repo.findByIds([id1, id2]);
    expect(found).toHaveLength(2);
  });

  it('should return empty array from findByIds when given empty array', async () => {
    const result = await repo.findByIds([]);
    expect(result).toEqual([]);
  });

  // ---------- update ----------

  it('should update a record and return updated row', async () => {
    const id = nextId();
    const now = new Date().toISOString();
    await repo.create({ id, name: 'Grace', email: 'grace@test.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);

    const updated = await repo.update(id, { name: 'Grace Updated' } as any);
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Grace Updated');
    expect(updated!.email).toBe('grace@test.com'); // unchanged
  });

  it('should return null when updating non-existent record', async () => {
    const result = await repo.update('nonexistent', { name: 'X' } as any);
    expect(result).toBeNull();
  });

  // ---------- delete (hard) ----------

  it('should hard-delete a record and return true', async () => {
    const id = nextId();
    const now = new Date().toISOString();
    await repo.create({ id, name: 'Hank', email: 'hank@test.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);

    const deleted = await repo.delete(id);
    expect(deleted).toBe(true);

    const afterDelete = await repo.findById(id);
    expect(afterDelete).toBeNull();
  });

  it('should return false when hard-deleting non-existent record', async () => {
    const result = await repo.delete('nonexistent');
    expect(result).toBe(false);
  });

  // ---------- softDelete / restore ----------

  it('should soft-delete a record by setting deletedAt', async () => {
    const id = nextId();
    const now = new Date().toISOString();
    await repo.create({ id, name: 'Ivy', email: 'ivy@test.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);

    const result = await repo.softDelete(id);
    expect(result).toBe(true);

    // Record still in DB but has deletedAt set
    const raw = await sql`SELECT * FROM users WHERE id = ${id}`.execute(db);
    expect(raw.rows).toHaveLength(1);
    expect((raw.rows[0] as any).deletedAt).not.toBeNull();
  });

  it('should return false when soft-deleting non-existent record', async () => {
    const result = await repo.softDelete('nonexistent');
    expect(result).toBe(false);
  });

  it('should restore a soft-deleted record', async () => {
    const id = nextId();
    const now = new Date().toISOString();
    await repo.create({ id, name: 'Jack', email: 'jack@test.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);

    await repo.softDelete(id);
    const restored = await repo.restore(id);
    expect(restored).not.toBeNull();
    expect(restored!.deletedAt).toBeNull();
    expect(restored!.name).toBe('Jack');
  });

  // ---------- list (soft-delete aware) ----------

  it('list() should exclude soft-deleted records by default', async () => {
    const now = new Date().toISOString();
    const id1 = nextId();
    const id2 = nextId();
    const id3 = nextId();
    await repo.create({ id: id1, name: 'A', email: 'a@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);
    await repo.create({ id: id2, name: 'B', email: 'b@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);
    await repo.create({ id: id3, name: 'C', email: 'c@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);

    await repo.softDelete(id2);

    const result = await repo.list();
    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
    expect(result.data.map((u: any) => u.id)).not.toContain(id2);
  });

  it('list() with includeSoftDeleted=true should include all records', async () => {
    const now = new Date().toISOString();
    const id1 = nextId();
    const id2 = nextId();
    await repo.create({ id: id1, name: 'D', email: 'd@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);
    await repo.create({ id: id2, name: 'E', email: 'e@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);

    await repo.softDelete(id1);

    const result = await repo.list({ includeSoftDeleted: true });
    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
  });

  it('list() should respect limit and offset', async () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 5; i++) {
      await repo.create({
        id: nextId(),
        name: `User${i}`,
        email: `u${i}@t.com`,
        status: 'active',
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      } as any);
    }

    const page = await repo.list({ limit: 2, offset: 1 });
    expect(page.data).toHaveLength(2);
    expect(page.limit).toBe(2);
    expect(page.offset).toBe(1);
    expect(page.total).toBe(5);
    expect(page.hasMore).toBe(true);
  });

  // ---------- exists / count ----------

  it('exists() should exclude soft-deleted by default', async () => {
    const id = nextId();
    const now = new Date().toISOString();
    await repo.create({ id, name: 'Kate', email: 'kate@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);

    expect(await repo.exists(id)).toBe(true);

    await repo.softDelete(id);
    expect(await repo.exists(id)).toBe(false);
    expect(await repo.exists(id, true)).toBe(true); // includeSoftDeleted
  });

  it('count() should exclude soft-deleted by default', async () => {
    const now = new Date().toISOString();
    await repo.create({ id: nextId(), name: 'L1', email: 'l1@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);
    await repo.create({ id: nextId(), name: 'L2', email: 'l2@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);

    const id3 = nextId();
    await repo.create({ id: id3, name: 'L3', email: 'l3@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);
    await repo.softDelete(id3);

    expect(await repo.count()).toBe(2);
    expect(await repo.count(true)).toBe(3); // includeSoftDeleted
  });

  // ---------- findAll ----------

  it('findAll() should return all records (no soft-delete filter)', async () => {
    const now = new Date().toISOString();
    await repo.create({ id: nextId(), name: 'M1', email: 'm1@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);
    await repo.create({ id: nextId(), name: 'M2', email: 'm2@t.com', status: 'active', deletedAt: now, createdAt: now, updatedAt: now } as any);

    // findAll is NOT soft-delete aware (it's a raw query helper)
    const all = await (repo as any).findAll();
    expect(all).toHaveLength(2);
  });

  // ---------- parseError ----------

  it('parseError should wrap unknown errors', () => {
    const err = new Error('some error');
    const parsed = repo.parseError(err, 'sqlite');
    expect(parsed).toBeDefined();
    expect(parsed.message).toContain('some error');
  });
});

// ============================================================================
// B. TransactionAwareRepository WITHOUT soft-delete
// ============================================================================

describe('TransactionAwareRepository with hasSoftDelete = false (default)', () => {
  let db: Kysely<TestDB>;
  let repo: HardDeleteUserRepository;

  beforeEach(async () => {
    db = createSqliteDb();
    await createUsersTable(db);
    repo = new HardDeleteUserRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('softDelete() should throw when hasSoftDelete is false', async () => {
    await expect(repo.softDelete('any-id')).rejects.toThrow(
      'softDelete() called on table "users" which does not support soft delete'
    );
  });

  it('restore() should throw when hasSoftDelete is false', async () => {
    await expect(repo.restore('any-id')).rejects.toThrow(
      'restore() called on table "users" which does not support soft delete'
    );
  });

  it('list() should NOT filter by deletedAt when hasSoftDelete is false', async () => {
    const now = new Date().toISOString();
    // Insert a record with deletedAt set (simulating pre-existing data)
    await repo.create({
      id: nextId(),
      name: 'Deleted',
      email: 'del@t.com',
      status: 'active',
      deletedAt: now,
      createdAt: now,
      updatedAt: now,
    } as any);
    await repo.create({
      id: nextId(),
      name: 'Active',
      email: 'act@t.com',
      status: 'active',
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    } as any);

    const result = await repo.list();
    // Should see both records because soft-delete filtering is off
    expect(result.total).toBe(2);
    expect(result.data).toHaveLength(2);
  });

  it('exists() should NOT filter by deletedAt when hasSoftDelete is false', async () => {
    const id = nextId();
    const now = new Date().toISOString();
    await repo.create({ id, name: 'X', email: 'x@t.com', status: 'active', deletedAt: now, createdAt: now, updatedAt: now } as any);

    // Even though deletedAt is set, exists() returns true because no soft-delete filtering
    expect(await repo.exists(id)).toBe(true);
  });

  it('count() should NOT filter by deletedAt when hasSoftDelete is false', async () => {
    const now = new Date().toISOString();
    await repo.create({ id: nextId(), name: 'Y', email: 'y@t.com', status: 'active', deletedAt: now, createdAt: now, updatedAt: now } as any);
    await repo.create({ id: nextId(), name: 'Z', email: 'z@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);

    expect(await repo.count()).toBe(2);
  });

  it('findById works correctly without soft-delete awareness', async () => {
    const id = nextId();
    const now = new Date().toISOString();
    await repo.create({ id, name: 'Plain', email: 'plain@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);

    const found = await repo.findById(id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Plain');
  });
});

// ============================================================================
// C. runInTransaction / getExecutor / isInTransactionContext
// ============================================================================

describe('Transaction context functions', () => {
  let db: Kysely<TestDB>;
  let repo: ItemRepository;

  beforeEach(async () => {
    db = createSqliteDb();
    await createItemsTable(db);
    repo = new ItemRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('outside transaction: getExecutor returns the db instance', () => {
    const executor = getExecutor(db);
    expect(executor).toBe(db);
  });

  it('outside transaction: isInTransactionContext returns false', () => {
    expect(isInTransactionContext()).toBe(false);
  });

  it('outside transaction: getTransactionContext returns undefined', () => {
    expect(getTransactionContext()).toBeUndefined();
  });

  it('inside runInTransaction: isInTransactionContext returns true', async () => {
    await runInTransaction(db, async () => {
      expect(isInTransactionContext()).toBe(true);
    });
  });

  it('inside runInTransaction: getExecutor returns the transaction, not db', async () => {
    await runInTransaction(db, async () => {
      const executor = getExecutor(db);
      expect(executor).not.toBe(db);
      // Transaction has the same interface but is not the same object
      expect(typeof (executor as any).selectFrom).toBe('function');
    });
  });

  it('inside runInTransaction: getTransactionContext has expected fields', async () => {
    await runInTransaction(db, async () => {
      const ctx = getTransactionContext();
      expect(ctx).toBeDefined();
      expect(ctx!.depth).toBe(1);
      expect(ctx!.connectionName).toBe('default');
      expect(ctx!.startedAt).toBeInstanceOf(Date);
      expect(ctx!.transaction).toBeDefined();
    });
  });

  it('transaction commits on success', async () => {
    const id = nextId();
    await runInTransaction(db, async () => {
      const executor = getExecutor(db);
      await sql`INSERT INTO items (id, title, value) VALUES (${id}, 'committed', 42)`.execute(executor);
    });

    // Should be visible outside the transaction
    const row = await sql`SELECT * FROM items WHERE id = ${id}`.execute(db);
    expect(row.rows).toHaveLength(1);
    expect((row.rows[0] as any).title).toBe('committed');
  });

  it('transaction rolls back on error', async () => {
    const id = nextId();
    try {
      await runInTransaction(db, async () => {
        const executor = getExecutor(db);
        await sql`INSERT INTO items (id, title, value) VALUES (${id}, 'rolled-back', 99)`.execute(executor);
        throw new Error('intentional rollback');
      });
    } catch (e: any) {
      expect(e.message).toBe('intentional rollback');
    }

    // Should NOT be visible
    const row = await sql`SELECT * FROM items WHERE id = ${id}`.execute(db);
    expect(row.rows).toHaveLength(0);
  });

  it('nested runInTransaction reuses the outer transaction', async () => {
    const outerCtx: any = {};
    const innerCtx: any = {};

    await runInTransaction(db, async () => {
      outerCtx.trx = getTransactionContext()?.transaction;
      outerCtx.depth = getTransactionContext()?.depth;

      await runInTransaction(db, async () => {
        innerCtx.trx = getTransactionContext()?.transaction;
        innerCtx.depth = getTransactionContext()?.depth;
      });
    });

    // Both should have the same transaction object since inner reuses outer
    expect(outerCtx.trx).toBe(innerCtx.trx);
    // Depth stays 1 because inner call just reuses outer (no new context created)
    expect(outerCtx.depth).toBe(1);
    expect(innerCtx.depth).toBe(1);
  });

  it('repository executor switches to transaction inside runInTransaction', async () => {
    const id = nextId();
    await runInTransaction(db, async () => {
      // The repository's executor getter should return the transaction
      expect(repo['inTransaction']).toBe(true);
      const executor = repo['executor'];
      expect(executor).not.toBe(db);

      await sql`INSERT INTO items (id, title, value) VALUES (${id}, 'via-repo-trx', 10)`.execute(executor);
    });

    const row = await sql`SELECT * FROM items WHERE id = ${id}`.execute(db);
    expect(row.rows).toHaveLength(1);
  });

  it('after transaction completes, context is cleared', async () => {
    await runInTransaction(db, async () => {
      expect(isInTransactionContext()).toBe(true);
    });

    expect(isInTransactionContext()).toBe(false);
    expect(getTransactionContext()).toBeUndefined();
  });

  it('repository CRUD works inside a transaction', async () => {
    const id = nextId();

    await runInTransaction(db, async () => {
      const item = await repo.create({ id, title: 'Transactional', value: 100 } as any);
      expect(item.id).toBe(id);

      const found = await repo.findById(id);
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Transactional');
    });

    // Verify committed
    const result = await repo.findById(id);
    expect(result).not.toBeNull();
  });
});

// ============================================================================
// D. registerTablePlugins / getTablePlugins / clearPluginRegistry
// ============================================================================

describe('Plugin Registry', () => {
  afterEach(() => {
    clearPluginRegistry();
  });

  it('should store and retrieve plugins for a table', () => {
    const fakePlugin = { name: 'test-plugin', transformQuery: vi.fn() };
    registerTablePlugins('orders', [fakePlugin]);

    const plugins = getTablePlugins('orders');
    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe('test-plugin');
  });

  it('should return empty array for unregistered table', () => {
    const plugins = getTablePlugins('nonexistent_table');
    expect(plugins).toEqual([]);
  });

  it('should overwrite plugins when registering for the same table', () => {
    const p1 = { name: 'p1' };
    const p2 = { name: 'p2' };

    registerTablePlugins('products', [p1] as any);
    registerTablePlugins('products', [p2] as any);

    const plugins = getTablePlugins('products');
    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe('p2');
  });

  it('clearPluginRegistry should remove all registered plugins', () => {
    registerTablePlugins('t1', [{ name: 'x' }] as any);
    registerTablePlugins('t2', [{ name: 'y' }] as any);

    clearPluginRegistry();

    expect(getTablePlugins('t1')).toEqual([]);
    expect(getTablePlugins('t2')).toEqual([]);
  });

  it('should handle multiple tables independently', () => {
    const pA = { name: 'pluginA' };
    const pB = { name: 'pluginB' };
    const pC = { name: 'pluginC' };

    registerTablePlugins('tableA', [pA] as any);
    registerTablePlugins('tableB', [pB, pC] as any);

    expect(getTablePlugins('tableA')).toHaveLength(1);
    expect(getTablePlugins('tableB')).toHaveLength(2);
  });
});

// ============================================================================
// E. DatabaseManager with SQLite
// ============================================================================

describe('DatabaseManager with SQLite', () => {
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

  it('should connect with in-memory SQLite', async () => {
    manager = new DatabaseManager(
      {
        connection: { dialect: 'sqlite', connection: ':memory:' },
        healthCheck: false,
      },
      mockLogger as any,
    );
    await manager.init();

    expect(manager.isConnected('default')).toBe(true);
  });

  it('should return connection via getConnection()', async () => {
    manager = new DatabaseManager(
      {
        connection: { dialect: 'sqlite', connection: ':memory:' },
        healthCheck: false,
      },
      mockLogger as any,
    );
    await manager.init();

    const conn = await manager.getConnection();
    expect(conn).toBeDefined();
    // Verify it is a Kysely instance by checking for selectFrom
    expect(typeof (conn as any).selectFrom).toBe('function');
  });

  it('should execute queries on the connection', async () => {
    manager = new DatabaseManager(
      {
        connection: { dialect: 'sqlite', connection: ':memory:' },
        healthCheck: false,
      },
      mockLogger as any,
    );
    await manager.init();

    const conn = await manager.getConnection();
    await sql`CREATE TABLE test_tbl (id INTEGER PRIMARY KEY, val TEXT)`.execute(conn);
    await sql`INSERT INTO test_tbl (id, val) VALUES (1, 'hello')`.execute(conn);

    const result = await sql`SELECT * FROM test_tbl`.execute(conn);
    expect(result.rows).toHaveLength(1);
    expect((result.rows[0] as any).val).toBe('hello');
  });

  it('closeAll() should disconnect', async () => {
    manager = new DatabaseManager(
      {
        connection: { dialect: 'sqlite', connection: ':memory:' },
        healthCheck: false,
      },
      mockLogger as any,
    );
    await manager.init();
    expect(manager.isConnected('default')).toBe(true);

    await manager.closeAll();
    expect(manager.isConnected('default')).toBe(false);
  });

  it('init() should be idempotent', async () => {
    manager = new DatabaseManager(
      {
        connection: { dialect: 'sqlite', connection: ':memory:' },
        healthCheck: false,
      },
      mockLogger as any,
    );
    await manager.init();
    await manager.init(); // second call should be no-op

    expect(manager.isConnected('default')).toBe(true);
  });

  it('should support multiple named connections', async () => {
    manager = new DatabaseManager(
      {
        connections: {
          primary: { dialect: 'sqlite', connection: ':memory:' },
          secondary: { dialect: 'sqlite', connection: ':memory:' },
        },
        healthCheck: false,
      },
      mockLogger as any,
    );
    await manager.init();

    expect(manager.isConnected('primary')).toBe(true);
    expect(manager.isConnected('secondary')).toBe(true);
    expect(manager.getConnectionNames()).toContain('primary');
    expect(manager.getConnectionNames()).toContain('secondary');
  });

  it('getConnection() should throw for unknown connection name', async () => {
    manager = new DatabaseManager(
      {
        connection: { dialect: 'sqlite', connection: ':memory:' },
        healthCheck: false,
      },
      mockLogger as any,
    );
    await manager.init();

    await expect(manager.getConnection('nonexistent')).rejects.toThrow();
  });
});

// ============================================================================
// F. Protected helper methods on TransactionAwareRepository
// ============================================================================

describe('TransactionAwareRepository protected helpers', () => {
  let db: Kysely<TestDB>;
  let repo: SoftDeleteUserRepository;

  beforeEach(async () => {
    db = createSqliteDb();
    await createUsersTable(db);
    repo = new SoftDeleteUserRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('findOneBy should find a single record by field value', async () => {
    const now = new Date().toISOString();
    const id = nextId();
    await repo.create({ id, name: 'FindOne', email: 'fo@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);

    const found = await (repo as any).findOneBy('email', 'fo@t.com');
    expect(found).not.toBeNull();
    expect(found.name).toBe('FindOne');
  });

  it('findOneBy should return null when no match', async () => {
    const found = await (repo as any).findOneBy('email', 'nobody@t.com');
    expect(found).toBeNull();
  });

  it('findManyBy should return matching records', async () => {
    const now = new Date().toISOString();
    await repo.create({ id: nextId(), name: 'A1', email: 'a1@t.com', status: 'vip', deletedAt: null, createdAt: now, updatedAt: now } as any);
    await repo.create({ id: nextId(), name: 'A2', email: 'a2@t.com', status: 'vip', deletedAt: null, createdAt: now, updatedAt: now } as any);
    await repo.create({ id: nextId(), name: 'B1', email: 'b1@t.com', status: 'regular', deletedAt: null, createdAt: now, updatedAt: now } as any);

    const vips = await (repo as any).findManyBy('status', 'vip');
    expect(vips).toHaveLength(2);
  });

  it('countBy should return count for matching records', async () => {
    const now = new Date().toISOString();
    await repo.create({ id: nextId(), name: 'C1', email: 'c1@t.com', status: 'gold', deletedAt: null, createdAt: now, updatedAt: now } as any);
    await repo.create({ id: nextId(), name: 'C2', email: 'c2@t.com', status: 'gold', deletedAt: null, createdAt: now, updatedAt: now } as any);
    await repo.create({ id: nextId(), name: 'C3', email: 'c3@t.com', status: 'silver', deletedAt: null, createdAt: now, updatedAt: now } as any);

    const count = await (repo as any).countBy('status', 'gold');
    expect(count).toBe(2);
  });

  it('existsBy should return true/false for matching records', async () => {
    const now = new Date().toISOString();
    await repo.create({ id: nextId(), name: 'Ex', email: 'ex@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);

    expect(await (repo as any).existsBy('email', 'ex@t.com')).toBe(true);
    expect(await (repo as any).existsBy('email', 'nope@t.com')).toBe(false);
  });
});

// ============================================================================
// G. Edge cases
// ============================================================================

describe('Edge cases', () => {
  let db: Kysely<TestDB>;

  beforeEach(async () => {
    db = createSqliteDb();
    await createUsersTable(db);
    await createItemsTable(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('multiple repositories can share the same db and transaction', async () => {
    const userRepo = new SoftDeleteUserRepository(db);
    const itemRepo = new ItemRepository(db);

    const userId = nextId();
    const itemId = nextId();
    const now = new Date().toISOString();

    await runInTransaction(db, async () => {
      await userRepo.create({ id: userId, name: 'Multi', email: 'multi@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);
      await itemRepo.create({ id: itemId, title: 'Shared', value: 55 } as any);
    });

    expect(await userRepo.findById(userId)).not.toBeNull();
    expect(await itemRepo.findById(itemId)).not.toBeNull();
  });

  it('transaction rollback affects all repositories', async () => {
    const userRepo = new SoftDeleteUserRepository(db);
    const itemRepo = new ItemRepository(db);

    const userId = nextId();
    const itemId = nextId();
    const now = new Date().toISOString();

    try {
      await runInTransaction(db, async () => {
        await userRepo.create({ id: userId, name: 'RollAll', email: 'rollall@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);
        await itemRepo.create({ id: itemId, title: 'RollAll', value: 77 } as any);
        throw new Error('rollback both');
      });
    } catch {}

    expect(await userRepo.findById(userId)).toBeNull();
    expect(await itemRepo.findById(itemId)).toBeNull();
  });

  it('unique constraint violation is detectable via parseError', async () => {
    const repo = new SoftDeleteUserRepository(db);
    const now = new Date().toISOString();
    const id1 = nextId();
    const id2 = nextId();

    await repo.create({ id: id1, name: 'Dup', email: 'dup@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);

    try {
      await repo.create({ id: id2, name: 'Dup2', email: 'dup@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);
      expect.fail('Should have thrown');
    } catch (e: any) {
      const parsed = repo.parseError(e, 'sqlite');
      expect(parsed).toBeDefined();
    }
  });

  it('list() hasMore is false when all records fit on one page', async () => {
    const repo = new SoftDeleteUserRepository(db);
    const now = new Date().toISOString();

    await repo.create({ id: nextId(), name: 'Only', email: 'only@t.com', status: 'active', deletedAt: null, createdAt: now, updatedAt: now } as any);

    const result = await repo.list({ limit: 10 });
    expect(result.hasMore).toBe(false);
    expect(result.total).toBe(1);
  });
});
