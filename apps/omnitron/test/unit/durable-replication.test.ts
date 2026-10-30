import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { SlaveStorageService } from '../../src/services/slave-storage.service.js';
import { SyncService } from '../../src/services/sync.service.js';
import { syncFinding, syncSeverity, syncWords } from '../../src/shared/sync-reading.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';

const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const undo of cleanup.splice(0).reverse()) await undo(); });
function temporary() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-receipts-'));
  cleanup.push(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'slave.db');
}
async function open(file = temporary(), maxBufferSize = 1024 * 1024) {
  const storage = new SlaveStorageService(createNullLogger(), file);
  cleanup.push(() => storage.dispose());
  const db = await storage.getDb() as unknown as Kysely<OmnitronDatabase>;
  const service = new SyncService(db, createNullLogger(), 'test-node', 'slave', { maxBufferSize });
  const append = async (...messages: string[]) => {
    await service.bufferBatch(messages.map(message => ({ category: 'logs', payload: { message } })));
    return (await service.drainBuffer()).entries.map(entry => entry.id);
  };
  return { file, storage, db, service, append };
}

describe('durable replication evidence', () => {
  it('keeps contiguous receipts, actual UTF-8 bytes and last release across restart and retention', async () => {
    const { file, storage, service, append, db } = await open();
    const ids = await append('я', 'two', 'three');
    const pendingBytes = ['я', 'two', 'three'].reduce((total, message) => total + Buffer.byteLength(JSON.stringify({ message })), 0);
    expect(await service.getStatus()).toMatchObject({ pendingItems: 3, bufferSize: pendingBytes, bufferSizeAccuracy: 'measured' });
    await service.ackDrained([ids[1]!, ids[2]!], { version: 1, committedIds: [ids[1]!, ids[2]!], discardedIds: [] });
    expect((await service.getStatus()).evidence).toMatchObject({ committedRows: 2, committedThrough: '0', releasedThrough: '0' });
    await service.ackDrained([ids[0]!], { version: 1, committedIds: [ids[0]!], discardedIds: [] });
    const before = await service.getStatus();
    expect(before.evidence).toMatchObject({ committedRows: 3, committedThrough: '3', releasedThrough: '3' });
    await sql`DELETE FROM sync_buffer WHERE syncedAt IS NOT NULL`.execute(db);
    await storage.dispose();
    const reopened = await open(file);
    const after = await reopened.service.getStatus();
    expect(after.evidence).toEqual(before.evidence);
    expect(after).toMatchObject({ pendingItems: 0, bufferSize: 0, retainedBufferSize: 0, lastSyncAt: before.lastSyncAt });
    expect(after.lastSyncAgeMs).toBeGreaterThanOrEqual(0);
    expect(await reopened.service.ackDrained(ids)).toEqual({ released: 0 });
  });

  it('never turns a discarded or unverified receipt into a durable frontier, including retries', async () => {
    const { service, append } = await open();
    const ids = await append('stored', 'rejected', 'legacy');
    const receipt = { version: 1 as const, committedIds: [ids[0]!], discardedIds: [ids[1]!] };
    expect(await service.ackDrained(ids, receipt)).toEqual({ released: 3 });
    expect(await service.ackDrained(ids, receipt)).toEqual({ released: 0 });
    const status = await service.getStatus();
    expect(status.evidence).toMatchObject({ committedRows: 1, discardedRows: 1, unverifiedRows: 1, evictedRows: 0,
      committedThrough: '1', releasedThrough: '3' });
    expect(syncSeverity(syncFinding(status))).toBe('warning');
    expect(syncWords(syncFinding(status))).toContain('rejected permanently');
    expect(syncWords(syncFinding(status))).toContain('without durable payload proof');
  });

  it('keeps a durable loss record when the offline buffer must evict undelivered data', async () => {
    const { service, append, storage, file } = await open(undefined, 1);
    await append('old', 'new');
    await (service as unknown as { enforceBufferBounds(): Promise<void> }).enforceBufferBounds();
    expect(await service.getStatus()).toMatchObject({ pendingItems: 0, bufferSize: 0,
      evidence: { evictedRows: 2, committedThrough: '0', releasedThrough: '2' } });
    await storage.dispose();
    expect((await (await open(file)).service.getStatus()).evidence?.evictedRows).toBe(2);
  });

  it('adopts a legacy buffer without renaming in-flight IDs and namespaces new entries', async () => {
    const file = temporary();
    const raw = new Database(file);
    raw.exec(`CREATE TABLE sync_buffer (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL,
      payload TEXT NOT NULL, createdAt TEXT NOT NULL DEFAULT (datetime('now')), syncedAt TEXT);
      INSERT INTO sync_buffer (category, payload) VALUES ('logs', '{}');
      INSERT INTO sync_buffer (category, payload, syncedAt) VALUES ('logs', '{}', '2026-10-20T12:00:00.000Z');`);
    raw.close();
    const { service, append, storage } = await open(file);
    const before = await service.getStatus();
    const ids = await append('new');
    expect(ids).toEqual(['1', `${before.evidence!.epoch}:3`]);
    expect(before.evidence).toMatchObject({ firstTrackedId: '1', unverifiedRows: 1, committedThrough: '0' });
    await service.ackDrained(ids, { version: 1, committedIds: ids, discardedIds: [] });
    expect((await service.getStatus()).evidence?.committedThrough).toBe('1');
    await storage.dispose();
    const again = await open(file);
    expect((await again.service.getStatus()).evidence?.epoch).toBe(before.evidence!.epoch);
    const fresh = await open();
    expect((await fresh.append('new'))[0]).not.toBe(`${before.evidence!.epoch}:1`);
  });

  it('rolls back release and evidence together when a later classified ID belongs to another epoch', async () => {
    const { service, append } = await open();
    const [id] = await append('keep');
    const foreign = 'ffffffffffffffffffffffffffffffff:2';
    await expect(service.ackDrained([id!, foreign], { version: 1, committedIds: [id!], discardedIds: [foreign] }))
      .rejects.toThrow('different buffer epoch');
    expect(await service.getStatus()).toMatchObject({ pendingItems: 1, lastSyncAt: null, evidence: { committedRows: 0, discardedRows: 0 } });
    await expect(service.ackDrained([id!], { version: 1, committedIds: [id!], discardedIds: [id!] })).rejects.toThrow('Conflicting');
    await expect(service.drainBuffer(1_000_000)).rejects.toThrow('10000');
  });

  it('keeps the queue and counters pending after a real writer dies before committing its receipt', async () => {
    const { service, append, file } = await open();
    await append('keep');
    const driver = createRequire(import.meta.url).resolve('better-sqlite3');
    const script = `const D = require(process.argv[1]); const db = new D(process.argv[2]);
      db.pragma('synchronous = FULL'); db.exec('BEGIN IMMEDIATE');
      db.prepare("UPDATE sync_buffer SET syncedAt = ?, syncOutcome = 'committed' WHERE id = 1").run(new Date().toISOString());
      process.send('uncommitted'); setInterval(() => {}, 1000);`;
    const child = spawn(process.execPath, ['-e', script, driver, file], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const exited = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', () => resolve()); });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Fixture writer did not report its open transaction')), 5000);
        child.once('message', () => { clearTimeout(timer); resolve(); });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', () => { clearTimeout(timer); reject(new Error('Fixture writer exited before opening the transaction')); });
      });
      child.kill('SIGKILL'); await exited;
      expect(await service.getStatus()).toMatchObject({ pendingItems: 1, lastSyncAt: null, evidence: { committedRows: 0, committedThrough: '0' } });
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; }
  });

  it('reads status with indexed seeks and refuses missing evidence rather than reporting a healthy empty queue', async () => {
    const { file, append, db } = await open(); await append('one', 'two');
    const queries: string[] = [];
    const observed = new Kysely<OmnitronDatabase>({ dialect: new SqliteDialect({ database: new Database(file) }),
      log: event => { if (event.level === 'query') queries.push(event.query.sql); } });
    cleanup.push(() => observed.destroy());
    const service = new SyncService(observed, createNullLogger(), 'node', 'slave');
    await service.getStatus();
    const statement = queries.find(query => query.includes('FROM sync_replication_state'))!;
    const plan = await sql.raw('EXPLAIN QUERY PLAN ' + statement).execute(observed);
    const details = plan.rows.map(row => String((row as { detail: string }).detail));
    expect(details.some(detail => /SCAN sync_buffer\b/.test(detail))).toBe(false);
    expect(details.some(detail => detail.includes('idx_sync_pending_id'))).toBe(true);
    expect(details.some(detail => detail.includes('idx_sync_pending '))).toBe(true);
    await sql`DELETE FROM sync_replication_state`.execute(db);
    await expect(service.getStatus()).rejects.toThrow('singleton is missing');
  });
});
