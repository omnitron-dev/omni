/**
 * DaemonStateStore — open, close, reopen.
 *
 * The store carries two handles (a Kysely one and a raw better-sqlite3 one
 * for the sync callers) and a single `initialized` flag guarding the DDL.
 * That combination has one failure shape worth pinning: a store that reports
 * itself initialised while holding nothing, so `getDb()` hands back a live
 * object over a closed or empty database and the queries fail one level
 * further down, where the cause is no longer visible.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';

const silentLogger: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

describe('DaemonStateStore lifecycle', () => {
  let tmpDir: string;
  let dbPath: string;
  let store: DaemonStateStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-state-'));
    dbPath = path.join(tmpDir, 'nested', 'daemon-state.db');
    store = new DaemonStateStore(silentLogger, dbPath);
  });

  afterEach(async () => {
    await store.dispose().catch(() => {});
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('serves reads and writes again after a dispose', async () => {
    // The regression this exists for: `initialized` was set on first open
    // and never cleared, so a reopened store skipped `createTables()`. It
    // survives here only because the tables are on disk — the same shape
    // over `:memory:`, or after the DDL gains a table, returns a store that
    // is "initialised" and missing its schema.
    await store.kvSet('k', { v: 1 });
    await store.dispose();

    await store.kvSet('k', { v: 2 });
    expect(await store.kvGet('k')).toEqual({ v: 2 });
  });

  it('re-applies the schema after a dispose, not just the connection', async () => {
    await store.kvSet('k', { v: 1 });
    await store.dispose();

    // Delete the file out from under the store — the sharpest available
    // stand-in for "the tables are gone". If the DDL is skipped on reopen,
    // this throws `no such table: state_kv`.
    for (const f of fs.readdirSync(path.dirname(dbPath))) {
      fs.rmSync(path.join(path.dirname(dbPath), f), { force: true });
    }

    await store.kvSet('k', { v: 3 });
    expect(await store.kvGet('k')).toEqual({ v: 3 });
  });

  it('drops the sync handle on dispose and opens a fresh one on demand', async () => {
    // `dispose()` used to close only the Kysely handle. The raw one stayed
    // open, so the sync API kept serving — and kept its WAL lock — through
    // a connection the caller believed closed. The data still comes back
    // afterwards, so a read alone proves nothing; what has to be true is
    // that it comes back through a *new* handle.
    const before = store.initSync();
    store.kvSetSync('k', { v: 1 });

    await store.dispose();
    expect(before.open).toBe(false);

    const after = store.initSync();
    expect(after).not.toBe(before);
    expect(store.kvGetSync('k')).toEqual({ v: 1 });
  });

  it('tolerates a dispose before anything was opened', async () => {
    await expect(store.dispose()).resolves.toBeUndefined();
    await expect(store.dispose()).resolves.toBeUndefined();
  });

  it('shares one connection between the sync and async handles', async () => {
    // Not cosmetic: two connections to one file mean a same-process writer
    // can only wait the other out on `busy_timeout`, and a sync write is
    // invisible to an in-flight async transaction. `rawSqlite` documents
    // itself as "same connection the Kysely instance wraps" — this asserts
    // the documentation.
    // `getDb()` first: it must publish its handle, so the sync path adopts
    // it instead of opening a second one. This is the assertion that
    // discriminates — before the unification `rawSqlite` stayed null here.
    await store.getDb();
    const published = (store as unknown as { rawSqlite: import('better-sqlite3').Database | null }).rawSqlite;
    expect(published).not.toBeNull();
    expect(store.initSync()).toBe(published);

    // `initSync()` first: `getDb()` must adopt the existing handle, and
    // closing the Kysely side must therefore close that one handle.
    await store.dispose();
    const fresh = new DaemonStateStore(silentLogger, dbPath);
    const raw = fresh.initSync();
    await fresh.getDb();
    expect((fresh as unknown as { rawSqlite: unknown }).rawSqlite).toBe(raw);
    await fresh.dispose();
    expect(raw.open).toBe(false);
  });

  it('writes through one handle and reads through the other', async () => {
    store.initSync();
    store.kvSetSync('sync-written', { from: 'sync' });

    expect(await store.kvGet('sync-written')).toEqual({ from: 'sync' });

    await store.kvSet('async-written', { from: 'async' });
    expect(store.kvGetSync('async-written')).toEqual({ from: 'async' });
  });
});
