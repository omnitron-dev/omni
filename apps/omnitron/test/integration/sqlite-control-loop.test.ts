import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'kysely';
import { openSqliteDatabase } from '@omnitron-dev/titan-database/sqlite';
import { describe, expect, it, vi } from 'vitest';
import { SlaveStorageService } from '../../src/services/slave-storage.service.js';

describe('node storage under contention', () => {
  it('serves the control loop while another writer holds the WAL, then commits exactly once', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'sqlite-control-'));
    const file = path.join(root, 'node.db');
    const storage = new SlaveStorageService({ info: vi.fn(), debug: vi.fn(), warn: vi.fn() } as never, file);
    const lock = openSqliteDatabase(file);
    try {
      const db = await storage.getDb();
      expect((await sql`PRAGMA synchronous`.execute(db)).rows).toEqual([{ synchronous: 2 }]);
      expect((await sql`PRAGMA journal_mode`.execute(db)).rows).toEqual([{ journal_mode: 'wal' }]);
      await sql`CREATE TABLE samples (id INTEGER PRIMARY KEY, content BLOB, stamp TEXT, enabled INTEGER)`.execute(db);
      lock.exec('BEGIN IMMEDIATE');
      const stamp = new Date('2025-01-02T03:04:05Z');
      const write = sql`INSERT INTO samples VALUES (1, ${Buffer.from('data')}, ${stamp}, ${true})`.execute(db);
      // This timer runs on the same loop as Netron. A synchronous writer cannot release this lock.
      const unlock = new Promise<void>(resolve => setTimeout(() => { lock.exec('ROLLBACK'); resolve(); }, 150));
      const [result] = await Promise.all([write, unlock]);
      expect(result.numAffectedRows).toBe(1n);
      await expect(db.transaction().execute(async trx => {
        await sql`INSERT INTO samples (id) VALUES (2)`.execute(trx);
        throw Error('rollback');
      })).rejects.toThrow('rollback');
      expect((await sql`SELECT * FROM samples`.execute(db)).rows)
        .toEqual([{ id: 1, content: Buffer.from('data'), stamp: stamp.toISOString(), enabled: 1 }]);
      await expect(sql`INSERT INTO samples (id) VALUES (1)`.execute(db)).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' });
      await sql`INSERT INTO sync_buffer (category, payload) VALUES ('logs', '{}'), ('logs', '{}')`.execute(db);
      const stream = db.selectFrom('sync_buffer').select('id').orderBy('id').stream(1);
      expect((await stream.next()).done).toBe(false);
      await stream.return?.(undefined);
      const ids: unknown[] = [];
      for await (const row of db.selectFrom('sync_buffer').select('id').orderBy('id').stream(2)) ids.push(row.id);
      expect(ids).toEqual([1, 2]);
      await storage.dispose();
      const reopened = await storage.getDb();
      expect((await sql`SELECT count(*) AS count FROM samples`.execute(reopened)).rows).toEqual([{ count: 1 }]);
    } finally {
      lock.close();
      await storage.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
