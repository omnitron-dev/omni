/**
 * TAR × kysera executor plugin chain
 *
 * Verifies TransactionAwareRepository's plugin/decorator contract:
 * - timestamps: OPT-IN per repository via @Timestamps() (or hasTimestamps
 *   override); injected on create/createMany/update regardless of executor
 *   plugins, explicit values win, non-opted repos are never touched
 * - soft-delete: when the @kysera/soft-delete executor plugin is active it
 *   owns read filtering; restore and hard delete opt out of mutation
 *   narrowing via scoped metadata; includeSoftDeleted reads work
 * - raw Kysely (no executor): native soft-delete filter still applies
 *
 * SQLite in-memory — no Docker required.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kysely, SqliteDialect, sql, type Generated } from 'kysely';
import BetterSqlite3 from 'better-sqlite3';
import { createExecutor } from '@kysera/executor';
import { softDeletePlugin } from '@kysera/soft-delete';
import { TransactionAwareRepository } from '../../src/repository/transaction-aware.repository.js';
import { Timestamps } from '../../src/database.decorators.js';

interface UsersTable {
  id: Generated<number>;
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
  deletedAt: string | null;
}

interface TestDB {
  users: UsersTable;
}

@Timestamps()
class StampedRepo extends TransactionAwareRepository<TestDB, 'users'> {
  protected override readonly hasSoftDelete = true;

  constructor(db: Kysely<TestDB>) {
    super(db, 'users');
  }
}

class PlainRepo extends TransactionAwareRepository<TestDB, 'users'> {
  protected override readonly hasSoftDelete = true;

  constructor(db: Kysely<TestDB>) {
    super(db, 'users');
  }
}

async function createDb(): Promise<Kysely<TestDB>> {
  const db = new Kysely<TestDB>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }),
  });
  await sql`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      "createdAt" TEXT,
      "updatedAt" TEXT,
      "deletedAt" TEXT
    )
  `.execute(db);
  return db;
}

describe('TAR × executor plugin chain', () => {
  describe('with the soft-delete plugin on the executor', () => {
    let db: Kysely<TestDB>;
    let repo: StampedRepo;

    beforeEach(async () => {
      db = await createDb();
      const executor = await createExecutor(db, [softDeletePlugin({ deletedAtColumn: 'deletedAt' })]);
      repo = new StampedRepo(executor as Kysely<TestDB>);
    });

    afterEach(async () => {
      await db.destroy();
    });

    it('injects createdAt/updatedAt on create for @Timestamps repos', async () => {
      const row = await repo.create({ name: 'alice' });
      expect(row.createdAt).toBeTruthy();
      expect(row.updatedAt).toBeTruthy();
    });

    it('never injects into repos without the opt-in', async () => {
      const plain = new PlainRepo(
        (await createExecutor(db, [softDeletePlugin({ deletedAtColumn: 'deletedAt' })])) as Kysely<TestDB>
      );
      const row = await plain.create({ name: 'nobody' });
      expect(row.createdAt).toBeNull();
      expect(row.updatedAt).toBeNull();
    });

    it('keeps explicitly provided timestamp values', async () => {
      const explicit = '2020-01-01T00:00:00.000Z';
      const row = await repo.create({ name: 'bob', createdAt: explicit });
      expect(row.createdAt).toBe(explicit);
      expect(row.updatedAt).toBeTruthy();
    });

    it('injects timestamps on every createMany row', async () => {
      const rows = await repo.createMany([{ name: 'a' }, { name: 'b' }]);
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.createdAt).toBeTruthy();
        expect(row.updatedAt).toBeTruthy();
      }
    });

    it('bumps updatedAt on update', async () => {
      const stale = '2020-01-01T00:00:00.000Z';
      const row = await repo.create({ name: 'carol', updatedAt: stale });
      expect(row.updatedAt).toBe(stale);

      const updated = await repo.update(String(row.id), { name: 'carol2' });
      expect(updated?.name).toBe('carol2');
      expect(updated?.updatedAt).toBeTruthy();
      expect(updated?.updatedAt).not.toBe(stale);
    });

    it('soft-deleted rows disappear from reads via the PLUGIN filter', async () => {
      const row = await repo.create({ name: 'dave' });
      expect(await repo.softDelete(String(row.id))).toBe(true);

      expect(await repo.exists(String(row.id))).toBe(false);
      expect(await repo.count()).toBe(0);
      expect((await repo.list()).data).toHaveLength(0);
    });

    it('includeSoftDeleted opts out of the plugin filter for this statement', async () => {
      const row = await repo.create({ name: 'erin' });
      await repo.softDelete(String(row.id));

      expect(await repo.exists(String(row.id), true)).toBe(true);
      expect(await repo.count(true)).toBe(1);
      expect((await repo.list({ includeSoftDeleted: true })).data).toHaveLength(1);
    });

    it('restore reaches soft-deleted rows despite UPDATE narrowing', async () => {
      const row = await repo.create({ name: 'frank' });
      await repo.softDelete(String(row.id));

      const restored = await repo.restore(String(row.id));
      expect(restored).not.toBeNull();
      expect(restored?.deletedAt).toBeNull();
      expect(await repo.exists(String(row.id))).toBe(true);
    });

    it('delete() hard-deletes even a soft-deleted row', async () => {
      const row = await repo.create({ name: 'grace' });
      await repo.softDelete(String(row.id));

      expect(await repo.delete(String(row.id))).toBe(true);
      expect(await repo.count(true)).toBe(0);
    });
  });

  describe('with a raw Kysely instance (no executor)', () => {
    let db: Kysely<TestDB>;

    beforeEach(async () => {
      db = await createDb();
    });

    afterEach(async () => {
      await db.destroy();
    });

    it('@Timestamps injection works standalone (no executor plugin needed)', async () => {
      const repo = new StampedRepo(db);
      const row = await repo.create({ name: 'henry' });
      expect(row.createdAt).toBeTruthy();
      expect(row.updatedAt).toBeTruthy();
    });

    it('does not inject timestamps without the opt-in', async () => {
      const repo = new PlainRepo(db);
      const row = await repo.create({ name: 'henry' });
      expect(row.createdAt).toBeNull();
      expect(row.updatedAt).toBeNull();
    });

    it('applies the NATIVE soft-delete filter and restore still works', async () => {
      const repo = new PlainRepo(db);
      const row = await repo.create({ name: 'iris' });
      await repo.softDelete(String(row.id));

      expect(await repo.exists(String(row.id))).toBe(false);
      expect((await repo.list()).data).toHaveLength(0);
      expect(await repo.count(true)).toBe(1);

      const restored = await repo.restore(String(row.id));
      expect(restored).not.toBeNull();
      expect(await repo.exists(String(row.id))).toBe(true);
    });
  });
});

describe('TAR list() withTotal: false (kysera 0.10)', () => {
  let db: Kysely<TestDB>
  let repo: PlainRepo

  beforeEach(async () => {
    db = await createDb()
    repo = new PlainRepo(db)
    for (let i = 0; i < 5; i++) {
      await repo.create({ name: `user-${i}` })
    }
  })

  afterEach(async () => {
    await db.destroy()
  })

  it('skips COUNT, reports total=-1, derives hasMore from limit+1 probe', async () => {
    const page1 = await repo.list({ limit: 2, offset: 0, orderBy: 'id', direction: 'asc', withTotal: false })
    expect(page1.total).toBe(-1)
    expect(page1.data).toHaveLength(2)
    expect(page1.hasMore).toBe(true)

    const lastPage = await repo.list({ limit: 2, offset: 4, orderBy: 'id', direction: 'asc', withTotal: false })
    expect(lastPage.data).toHaveLength(1)
    expect(lastPage.hasMore).toBe(false)
  })

  it('default keeps exact totals', async () => {
    const page = await repo.list({ limit: 2, orderBy: 'id' })
    expect(page.total).toBe(5)
  })
})
