/**
 * The same query worked on the master and threw on every slave.
 *
 * The daemon runs one set of services against two stores: a master on
 * Postgres, a slave on SQLite. Postgres's driver serialises a `Date`
 * parameter; `better-sqlite3` binds "numbers, strings, bigints, buffers, and
 * null" and refuses one outright. The Kysely schema types describe the
 * master, so a query written with a `Date` type-checks, runs here, and fails
 * there.
 *
 * Measured 2026-09-14 on a provisioned slave node:
 *
 *     ERROR  Log retention pass failed
 *       error: "SQLite3 can only bind numbers, strings, bigints, buffers, and null"
 *     WARN   Sync buffer retention pass failed
 *       error: "SQLite3 can only bind numbers, strings, bigints, buffers, and null"
 *
 * — the second every thirty seconds, with the buffer's bound bounding
 * nothing. Both were unreachable until this week: the slave replication path
 * had no producer, and the bound only ran at the end of a SUCCESSFUL cycle,
 * which is the one case where the buffer is already draining. Making them run
 * is what made them fail.
 *
 * Converting at the two call sites was the obvious fix and the wrong one.
 * There are two today because there are two features; the next query written
 * against a slave's storage with a `Date` in it fails identically, and
 * nothing would have caught it. The driver is the one place every parameter
 * passes through.
 */

import { describe, it, expect, vi } from 'vitest';

import { serialiseDates, withDateBinding } from '../../src/database/sqlite-date-binding.js';

describe('serialising the parameters a statement is given', () => {
  it('converts a Date inside the ARRAY a driver passes', () => {
    // The form that matters, and the one the first version of this test did
    // not use. Kysely's SQLite driver calls `stmt.all(parameters)` and
    // `stmt.run(parameters)` — one argument, which IS the binding array.
    // Converting only the spread form left the defect in place and the test
    // green, and the failure went on every thirty seconds on a real node.
    const at = new Date('2026-09-15T05:53:02.160Z');

    expect(serialiseDates([['app', at, 42]])).toEqual([['app', '2026-09-15T05:53:02.160Z', 42]]);
  });

  it('leaves an array alone when it holds no Date', () => {
    const params = [['app', 1, null]];

    expect(serialiseDates(params)).toBe(params);
  });

  it('turns a Date into the ISO form these columns hold', () => {
    const at = new Date('2026-09-14T19:12:46.085Z');

    expect(serialiseDates([at])).toEqual(['2026-09-14T19:12:46.085Z']);
  });

  it('leaves everything better-sqlite3 already accepts alone', () => {
    // Numbers, strings, bigints, buffers and null — the driver's own list.
    // "Helpfully" converting any of these would break a query that works.
    const params = [1, 'text', 10n, Buffer.from('x'), null, undefined, true];

    expect(serialiseDates(params)).toEqual(params);
  });

  it('returns the same array when there is nothing to change', () => {
    // Every statement on this database passes through here, including the
    // hot ones. An allocation per call for the common case is a cost paid
    // for nothing.
    const params = ['a', 1, null];

    expect(serialiseDates(params)).toBe(params);
  });

  it('converts a Date among other values', () => {
    const at = new Date('2026-01-02T03:04:05.000Z');

    expect(serialiseDates(['app', at, 42])).toEqual(['app', '2026-01-02T03:04:05.000Z', 42]);
  });
});

describe('wrapping the database', () => {
  /** A better-sqlite3 stand-in that records what its statements were bound. */
  function fakeDatabase() {
    const bound: unknown[][] = [];
    const statement = {
      run: (...p: unknown[]) => { bound.push(p); return { changes: p.length }; },
      get: (...p: unknown[]) => { bound.push(p); return null; },
      all: (...p: unknown[]) => { bound.push(p); return []; },
      iterate: (...p: unknown[]) => { bound.push(p); return [][Symbol.iterator](); },
    };
    return { bound, statement, prepare: vi.fn(() => statement) };
  }

  it('serialises for the calling convention Kysely uses', () => {
    // Not a restatement of the unit above: this pins the whole path, from the
    // wrapped statement down, in the exact shape the only real caller uses.
    const db = fakeDatabase();
    const wrapped = withDateBinding(db as never) as unknown as typeof db;
    const at = new Date('2026-09-15T00:00:00.000Z');

    const s = wrapped.prepare('delete from sync_buffer where syncedAt < ?') as typeof db.statement;
    s.run([at]);

    expect(db.bound).toEqual([[['2026-09-15T00:00:00.000Z']]]);
  });

  it('serialises for every method a statement is run through', () => {
    // Kysely reaches for `all` on a select, `run` on a delete, `iterate` on a
    // stream. Wrapping one of them fixes one kind of query.
    const db = fakeDatabase();
    const wrapped = withDateBinding(db as never) as unknown as typeof db;
    const at = new Date('2026-09-14T00:00:00.000Z');

    const s = wrapped.prepare('delete from logs where timestamp < ?') as typeof db.statement;
    s.run(at); s.get(at); s.all(at); [...s.iterate(at)];

    expect(db.bound).toEqual([
      ['2026-09-14T00:00:00.000Z'], ['2026-09-14T00:00:00.000Z'],
      ['2026-09-14T00:00:00.000Z'], ['2026-09-14T00:00:00.000Z'],
    ]);
  });

  it('keeps what the underlying statement returns', () => {
    // The wrapper is about the way in. A result the caller relies on must
    // come back unchanged.
    const db = fakeDatabase();
    const wrapped = withDateBinding(db as never) as unknown as typeof db;

    const s = wrapped.prepare('x') as typeof db.statement;

    expect(s.run(1, 2, 3)).toEqual({ changes: 3 });
  });

  it('returns the same database object, so callers keep their handle', () => {
    const db = fakeDatabase();

    expect(withDateBinding(db as never)).toBe(db);
  });

  it('does not convert results coming back', () => {
    // These columns are TEXT and every reader expects a string. Parsing them
    // into Dates would change what each one receives, which is a far larger
    // claim than fixing the bind.
    const db = fakeDatabase();
    db.statement.get = (...p: unknown[]) => { db.bound.push(p); return { timestamp: '2026-01-01T00:00:00.000Z' } as never; };
    const wrapped = withDateBinding(db as never) as unknown as typeof db;

    const row = (wrapped.prepare('select') as typeof db.statement).get();

    expect(row).toEqual({ timestamp: '2026-01-01T00:00:00.000Z' });
  });
});
