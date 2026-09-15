/**
 * The log filter that could not run on the machines you filter logs for.
 *
 * `queryLogs` and `getRecentLogs` narrow by label with `labels @> ?::jsonb`
 * — Postgres containment, and the operator the master's GIN index answers.
 * The same service runs on a slave, where the database is SQLite and `@` is
 * not a token. Not a wrong answer: a refused statement.
 *
 * Asked of the live node's own database file:
 *
 *     select count(*) from logs where labels @> '{}'::jsonb
 *     → ERROR: unrecognized token: "@"
 *
 * A remote node is exactly where someone goes looking for logs, and the
 * label filter is how the console narrows to an app, an environment or a
 * region. On every one of them it threw.
 *
 * Second defect, same function: the rows and the count were two lists of
 * filters maintained apart, and they had drifted — the rows honoured
 * `nodeId` and `labels`, the count honoured neither. A view filtered to one
 * node showed that node's lines under a total counting every node's.
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, PostgresDialect, DummyDriver, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';

import { LogCollectorService } from '../../src/services/log-collector.service.js';
import { dialectOf, jsonContains } from '../../src/database/dialect.js';

/** The slave's own `logs` DDL, in shape: TEXT columns, JSON as text. */
const sqliteDb = () => {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE logs (
      id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, nodeId TEXT,
      app TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL DEFAULT '', labels TEXT, traceId TEXT,
      spanId TEXT, metadata TEXT
    )
  `);
  const insert = database.prepare(
    'INSERT INTO logs (id, timestamp, nodeId, app, level, message, labels) VALUES (?,?,?,?,?,?,?)',
  );
  let n = 0;
  const add = (nodeId: string, labels: Record<string, string>, message: string) =>
    insert.run(`l${++n}`, `2026-09-15T06:0${n}:00.000Z`, nodeId, 'payments', 'info', message, JSON.stringify(labels));

  add('edge-7', { env: 'prod', region: 'eu' }, 'prod eu');
  add('edge-7', { env: 'prod', region: 'us' }, 'prod us');
  add('edge-8', { env: 'staging', region: 'eu' }, 'staging eu');

  return new Kysely<any>({ dialect: new SqliteDialect({ database }) });
};

/** A Postgres that compiles statements and runs none. */
const postgresDb = () =>
  new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db: any) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

describe('a label filter on a slave', () => {
  it('runs at all', async () => {
    const collector = new LogCollectorService(sqliteDb(), undefined as never);

    // Before: "unrecognized token" out of the driver, for every label filter
    // on every slave in the fleet.
    const result = await collector.queryLogs({ labels: { env: 'prod' } });

    expect(result.entries.map((e) => e.message).sort()).toEqual(['prod eu', 'prod us']);
  });

  it('ands the pairs, as containment does', async () => {
    const collector = new LogCollectorService(sqliteDb(), undefined as never);

    const both = await collector.queryLogs({ labels: { env: 'prod', region: 'eu' } });
    const neither = await collector.queryLogs({ labels: { env: 'prod', region: 'ap' } });

    expect(both.entries.map((e) => e.message)).toEqual(['prod eu']);
    expect(neither.entries).toEqual([]);
  });

  it('narrows the live tail the same way', async () => {
    const collector = new LogCollectorService(sqliteDb(), undefined as never);

    // A filter honoured by the paginated query and not by the live tail is
    // how a viewer changes its answer when you press Live.
    const recent = await collector.getRecentLogs({ labels: { env: 'staging' } } as never);

    expect(recent.map((e) => e.message)).toEqual(['staging eu']);
  });
});

describe('the total counts the rows it returned', () => {
  it('counts through a label filter', async () => {
    const collector = new LogCollectorService(sqliteDb(), undefined as never);

    const result = await collector.queryLogs({ labels: { env: 'prod' } });

    // The count query applied neither `labels` nor `nodeId`: three.
    expect(result.total).toBe(2);
    expect(result.total).toBe(result.entries.length);
  });

  it('counts through a node filter', async () => {
    const collector = new LogCollectorService(sqliteDb(), undefined as never);

    const result = await collector.queryLogs({ nodeId: 'edge-8' });

    expect(result.total).toBe(1);
    expect(result.entries.map((e) => e.nodeId)).toEqual(['edge-8']);
  });

  it('still counts everything when nothing is filtered', async () => {
    const collector = new LogCollectorService(sqliteDb(), undefined as never);

    // An empty filter must not become "match nothing" — the unfiltered view
    // is the default one.
    const result = await collector.queryLogs({});

    expect(result.total).toBe(3);
    expect(result.entries).toHaveLength(3);
  });
});

describe('the dialect decides how to ask', () => {
  it('names each engine from the object itself', () => {
    expect(dialectOf(sqliteDb())).toBe('sqlite');
    expect(dialectOf(postgresDb())).toBe('postgres');
  });

  it('keeps containment on Postgres, where the index answers it', () => {
    const db = postgresDb();
    const compiled = db
      .selectFrom('logs')
      .selectAll()
      .where(jsonContains(db, 'labels', { env: 'prod' }) as never)
      .compile();

    // The master's `logs` table reached 13 GB on a development host. The
    // portable form is correct there and would give up the GIN index.
    expect(compiled.sql).toContain('@>');
    expect(compiled.sql).toContain('::jsonb');
    expect(compiled.parameters).toContain('{"env":"prod"}');
  });

  it('asks SQLite in the form SQLite has', async () => {
    const db = sqliteDb();
    const compiled = db
      .selectFrom('logs')
      .selectAll()
      .where(jsonContains(db, 'labels', { env: 'prod', region: 'eu' }) as never)
      .compile();

    expect(compiled.sql).not.toContain('@>');
    expect(compiled.sql).not.toContain('jsonb');
    expect(compiled.sql).toContain('->>');
    // The key is bound, not interpolated.
    expect(compiled.parameters).toEqual(['env', 'prod', 'region', 'eu']);
  });

  it('falls back to the portable form for an engine it cannot name', () => {
    // Correct everywhere, slower on the master — the right way round for a
    // branch that might one day be taken by mistake.
    const unknown = { getExecutor: () => ({ adapter: {} }) } as never;
    expect(dialectOf(unknown)).toBe('unknown');
    expect(jsonContains(unknown, 'labels', { env: 'prod' }).compile(sqliteDb()).sql).toContain('->>');
  });

  it('constrains nothing when given nothing', () => {
    const db = sqliteDb();
    expect(jsonContains(db, 'labels', {}).compile(db).sql).toBe('(1 = 1)');
  });
});
