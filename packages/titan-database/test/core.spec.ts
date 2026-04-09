/**
 * Core Database Module Tests
 *
 * Tests the essential Titan database module functionality with real SQLite DB.
 * No mocks — all queries hit a real in-memory database.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, sql, type Generated, type ColumnType, type Selectable } from 'kysely';
import { TransactionAwareRepository } from '../src/repository/transaction-aware.repository.js';
import {
  runInTransaction,
  getExecutor,
  isInTransactionContext,
  registerTablePlugins,
  getTablePlugins,
  clearPluginRegistry,
} from '../src/transaction/transaction.context.js';

// ============================================================================
// Test Schema
// ============================================================================

interface UsersTable {
  id: Generated<number>;
  username: string;
  email: string;
  status: string;
  deletedAt: ColumnType<string | null, string | null | undefined, string | null>;
  createdAt: ColumnType<string, string | undefined, string>;
}

interface PostsTable {
  id: Generated<number>;
  title: string;
  authorId: number;
}

interface TestDB {
  users: UsersTable;
  posts: PostsTable;
}

type User = Selectable<UsersTable>;

// ============================================================================
// Test Repository (with soft-delete)
// ============================================================================

class UserRepository extends TransactionAwareRepository<TestDB, 'users'> {
  protected override readonly hasSoftDelete = true;

  constructor(db: Kysely<TestDB>) {
    super(db, 'users');
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.findOneBy('username', username);
  }
}

// ============================================================================
// Test Repository (WITHOUT soft-delete)
// ============================================================================

class PostRepository extends TransactionAwareRepository<TestDB, 'posts'> {
  // hasSoftDelete defaults to false

  constructor(db: Kysely<TestDB>) {
    super(db, 'posts');
  }
}

// ============================================================================
// Setup
// ============================================================================

let db: Kysely<TestDB>;
let userRepo: UserRepository;
let postRepo: PostRepository;

beforeAll(async () => {
  db = new Kysely<TestDB>({
    dialect: new SqliteDialect({ database: new Database(':memory:') }),
  });

  await db.schema
    .createTable('users')
    .addColumn('id', 'integer', (col) => col.primaryKey())
    .addColumn('username', 'text', (col) => col.notNull())
    .addColumn('email', 'text', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull().defaultTo('active'))
    .addColumn('deletedAt', 'text')
    .addColumn('createdAt', 'text', (col) => col.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createTable('posts')
    .addColumn('id', 'integer', (col) => col.primaryKey())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('authorId', 'integer', (col) => col.notNull())
    .execute();

  userRepo = new UserRepository(db);
  postRepo = new PostRepository(db);
});

afterAll(async () => {
  await db.destroy();
});

beforeEach(async () => {
  await db.deleteFrom('users').execute();
  await db.deleteFrom('posts').execute();
  clearPluginRegistry();
});

// ============================================================================
// Tests
// ============================================================================

describe('TransactionAwareRepository', () => {
  describe('CRUD Operations', () => {
    it('should create and find by ID', async () => {
      const created = await userRepo.create({
        username: 'alice',
        email: 'alice@test.com',
      } as any);
      expect(created).toBeDefined();
      expect(created.username).toBe('alice');

      const found = await userRepo.findById(String(created.id));
      expect(found).not.toBeNull();
      expect(found!.username).toBe('alice');
    });

    it('should find by field (findOneBy)', async () => {
      await userRepo.create({ username: 'bob', email: 'bob@test.com' } as any);

      const found = await userRepo.findByUsername('bob');
      expect(found).not.toBeNull();
      expect(found!.email).toBe('bob@test.com');
    });

    it('should return null for non-existent user', async () => {
      const found = await userRepo.findByUsername('nonexistent');
      expect(found).toBeNull();
    });

    it('should update entity', async () => {
      const created = await userRepo.create({ username: 'charlie', email: 'old@test.com' } as any);
      const updated = await userRepo.update(String(created.id), { email: 'new@test.com' } as any);

      expect(updated).not.toBeNull();
      expect(updated!.email).toBe('new@test.com');
    });

    it('should delete entity', async () => {
      const created = await userRepo.create({ username: 'dave', email: 'dave@test.com' } as any);
      await userRepo.delete(String(created.id));

      const found = await userRepo.findById(String(created.id));
      expect(found).toBeNull();
    });

    it('should find multiple by IDs', async () => {
      const u1 = await userRepo.create({ username: 'a', email: 'a@test.com' } as any);
      const u2 = await userRepo.create({ username: 'b', email: 'b@test.com' } as any);
      await userRepo.create({ username: 'c', email: 'c@test.com' } as any);

      const found = await userRepo.findByIds([String(u1.id), String(u2.id)]);
      expect(found).toHaveLength(2);
    });
  });

  describe('Soft Delete', () => {
    it('should soft-delete with hasSoftDelete=true', async () => {
      const created = await userRepo.create({ username: 'soft', email: 'soft@test.com' } as any);
      await userRepo.softDelete(String(created.id));

      // Direct query should find it with deletedAt set
      const direct = await db.selectFrom('users').selectAll().where('id', '=', created.id).executeTakeFirst();
      expect(direct).toBeDefined();
      expect(direct!.deletedAt).not.toBeNull();

      // findById should still find it (findOneBy doesn't filter soft-deleted)
      const found = await userRepo.findById(String(created.id));
      expect(found).not.toBeNull();
    });

    it('should restore soft-deleted entity', async () => {
      const created = await userRepo.create({ username: 'restore', email: 'restore@test.com' } as any);
      await userRepo.softDelete(String(created.id));
      await userRepo.restore(String(created.id));

      const direct = await db.selectFrom('users').selectAll().where('id', '=', created.id).executeTakeFirst();
      expect(direct!.deletedAt).toBeNull();
    });

    it('should throw on softDelete when hasSoftDelete=false', async () => {
      const post = await postRepo.create({ title: 'test', authorId: 1 } as any);
      await expect(postRepo.softDelete(String(post.id))).rejects.toThrow('does not support soft delete');
    });

    it('should throw on restore when hasSoftDelete=false', async () => {
      const post = await postRepo.create({ title: 'test', authorId: 1 } as any);
      await expect(postRepo.restore(String(post.id))).rejects.toThrow('does not support soft delete');
    });
  });
});

describe('Transaction Context', () => {
  it('should return db outside transaction', () => {
    const executor = getExecutor(db);
    expect(executor).toBe(db);
  });

  it('should return false for isInTransactionContext outside', () => {
    expect(isInTransactionContext()).toBe(false);
  });

  it('should commit transaction on success', async () => {
    await runInTransaction(db, async () => {
      expect(isInTransactionContext()).toBe(true);
      const executor = getExecutor(db);
      expect(executor).not.toBe(db); // Should be transaction

      await executor.insertInto('users').values({
        username: 'txn_user',
        email: 'txn@test.com',
        status: 'active',
        createdAt: new Date().toISOString(),
      } as any).execute();
    });

    const found = await db.selectFrom('users').selectAll().where('username', '=', 'txn_user').executeTakeFirst();
    expect(found).toBeDefined();
    expect(found!.username).toBe('txn_user');
  });

  it('should rollback transaction on error', async () => {
    try {
      await runInTransaction(db, async () => {
        const executor = getExecutor(db);
        await executor.insertInto('users').values({
          username: 'rollback_user',
          email: 'rollback@test.com',
          status: 'active',
          createdAt: new Date().toISOString(),
        } as any).execute();
        throw new Error('Intentional rollback');
      });
    } catch {
      // Expected
    }

    const found = await db.selectFrom('users').selectAll().where('username', '=', 'rollback_user').executeTakeFirst();
    expect(found).toBeUndefined();
  });

  it('should reuse transaction in nested runInTransaction', async () => {
    await runInTransaction(db, async () => {
      const outerExecutor = getExecutor(db);

      await runInTransaction(db, async () => {
        const innerExecutor = getExecutor(db);
        // Nested should reuse outer transaction
        expect(innerExecutor).toBe(outerExecutor);
      });
    });
  });
});

describe('Table Plugin Registry', () => {
  it('should register and retrieve plugins', () => {
    const mockPlugin = { name: 'test', version: '1.0' };
    registerTablePlugins('users', [mockPlugin as any]);

    const plugins = getTablePlugins('users');
    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe('test');
  });

  it('should return empty array for unregistered table', () => {
    expect(getTablePlugins('nonexistent')).toHaveLength(0);
  });

  it('should clear all plugins', () => {
    registerTablePlugins('a', [{ name: 'x', version: '1' } as any]);
    registerTablePlugins('b', [{ name: 'y', version: '1' } as any]);

    clearPluginRegistry();

    expect(getTablePlugins('a')).toHaveLength(0);
    expect(getTablePlugins('b')).toHaveLength(0);
  });
});
