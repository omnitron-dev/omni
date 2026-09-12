/**
 * `registerTablePlugins()` had no reader, so everything registered was inert.
 *
 * The registry is a process-global Map in `transaction.context.ts`. Across
 * omni AND downstream the only callers of the matching `getTablePlugins()` were the
 * three registrars themselves — main's RLS policies, payments's database
 * plugins and messaging's invite-policy trigger bridge — each reading back
 * what it had just written in order to merge. Nothing consulted that Map when
 * a query was built, so two complete row-level-security policy sets never
 * filtered a row.
 *
 * The break was DELIVERY, not identity: every downstream backend already runs each
 * RPC inside `rlsContext.runAsync(...)` via its bootstrap's
 * `invocationWrapper`, so the auth context those policies read is live. The
 * repositories just never saw the plugins — they are handed
 * `DATABASE_CONNECTION`, a plain Kysely, and `TransactionAwareRepository`
 * returned it unchanged.
 *
 * `applyTablePlugins` is the reader, and it is OFF by default on purpose:
 * turning row-level security on for a schema that has never enforced it
 * changes what every query returns. These tests pin both halves — that the
 * default changes nothing, and that opting in actually applies the plugin.
 *
 * SQLite in-memory — no Docker required.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kysely, SqliteDialect, sql, type Generated, type SelectQueryBuilder } from 'kysely';
import BetterSqlite3 from 'better-sqlite3';
import { createExecutorSync, type Plugin } from '@kysera/executor';

import { TransactionAwareRepository } from '../../src/repository/transaction-aware.repository.js';
import {
  registerTablePlugins,
  clearPluginRegistry,
  runInTransaction,
} from '../../src/transaction/transaction.context.js';

interface NotesTable {
  id: Generated<number>;
  owner: string;
  body: string;
}
interface OtherTable {
  id: Generated<number>;
  body: string;
}
interface TestDB {
  notes: NotesTable;
  other: OtherTable;
}

/** Counts interceptions and narrows every select to one owner. */
function ownerOnlyPlugin(owner: string, seen: { count: number }): Plugin {
  return {
    name: 'test-owner-only',
    version: '1.0.0',
    interceptQuery<QB>(qb: QB, context: { operation?: string }): QB {
      seen.count++;
      if (context.operation !== 'select') return qb;
      type AnySelect = SelectQueryBuilder<Record<string, unknown>, string, Record<string, unknown>>;
      return (qb as unknown as AnySelect).where('owner', '=', owner) as unknown as QB;
    },
  };
}

class OptedOutRepo extends TransactionAwareRepository<TestDB, 'notes'> {
  constructor(db: Kysely<TestDB>) {
    super(db, 'notes');
  }
}

class OptedInRepo extends TransactionAwareRepository<TestDB, 'notes'> {
  protected override readonly applyTablePlugins = true;
  constructor(db: Kysely<TestDB>) {
    super(db, 'notes');
  }
}

class OptedInOtherTableRepo extends TransactionAwareRepository<TestDB, 'other'> {
  protected override readonly applyTablePlugins = true;
  constructor(db: Kysely<TestDB>) {
    super(db, 'other');
  }
}

let db: Kysely<TestDB>;

beforeEach(async () => {
  clearPluginRegistry();
  db = new Kysely<TestDB>({
    dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }),
  });
  await sql`CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, body TEXT NOT NULL)`.execute(db);
  await sql`CREATE TABLE other (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL)`.execute(db);
  await db.insertInto('notes').values([
    { owner: 'alice', body: 'a1' },
    { owner: 'alice', body: 'a2' },
    { owner: 'bob', body: 'b1' },
  ]).execute();
  await db.insertInto('other').values({ body: 'x' }).execute();
});

afterEach(async () => {
  clearPluginRegistry();
  await db.destroy();
});

describe('a registered plugin reaches the query — or deliberately does not', () => {
  it('does nothing by default, however loudly it was registered', async () => {
    // This is the state the whole platform was in: a policy registered for a
    // table, and every row still returned.
    const seen = { count: 0 };
    registerTablePlugins('notes', [ownerOnlyPlugin('alice', seen)]);

    const rows = await new OptedOutRepo(db).findAll();

    expect(rows).toHaveLength(3);
    expect(seen.count, 'the plugin must not have been consulted').toBe(0);
  });

  it('filters once the repository opts in', async () => {
    const seen = { count: 0 };
    registerTablePlugins('notes', [ownerOnlyPlugin('alice', seen)]);

    const rows = await new OptedInRepo(db).findAll();

    expect(rows.map((r) => r.body).sort()).toEqual(['a1', 'a2']);
    expect(seen.count).toBeGreaterThan(0);
  });

  it('leaves a table with nothing registered alone', async () => {
    // Staging a rollout is done by choosing which TABLES are registered, so
    // an opted-in repository over an unregistered table must be untouched.
    const seen = { count: 0 };
    registerTablePlugins('notes', [ownerOnlyPlugin('alice', seen)]);

    const rows = await new OptedInOtherTableRepo(db).findAll();

    expect(rows).toHaveLength(1);
    expect(seen.count).toBe(0);
  });

  it('applies inside a transaction, against the transaction itself', async () => {
    // The wrapper is keyed on the target's identity: inside a transaction the
    // target is a fresh `Transaction`, and a plugin bound to the pooled
    // connection would run the transaction's statements outside it.
    const seen = { count: 0 };
    registerTablePlugins('notes', [ownerOnlyPlugin('bob', seen)]);
    const repo = new OptedInRepo(db);

    const outside = await repo.findAll();
    const inside = await runInTransaction(db as never, async () => repo.findAll());

    expect(outside.map((r) => r.body)).toEqual(['b1']);
    expect(inside.map((r) => r.body)).toEqual(['b1']);
  });

  it('does not wrap a connection that is already plugin-aware', async () => {
    // The `@Repository(...)` path hands over a kysera executor that already
    // carries the plugins. Wrapping it again runs every interceptor twice —
    // for an RLS filter that is a duplicated WHERE, for a counter a wrong
    // number.
    const seen = { count: 0 };
    const plugin = ownerOnlyPlugin('alice', seen);
    registerTablePlugins('notes', [plugin]);

    const executor = createExecutorSync(db, [plugin]) as unknown as Kysely<TestDB>;
    const rows = await new OptedInRepo(executor).findAll();

    expect(rows.map((r) => r.body).sort()).toEqual(['a1', 'a2']);
    // Once per query, not twice.
    expect(seen.count).toBe(1);
  });
});
