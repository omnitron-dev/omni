import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { LogJournal } from '../../src/monitoring/log-journal.js';
import { LineAssembler, type LogRecord } from '../../src/monitoring/log-line.js';
import { logEntryOf } from '../../src/monitoring/log-entry.js';
import { LogCollectorService } from '../../src/services/log-collector.service.js';
import { withDateBinding } from '../../src/database/sqlite-date-binding.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';
import type { LogEntry } from '../../src/shared/dto/logs.js';
import { readLogIngestion } from '../../src/shared/log-ingestion-reading.js';

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

function directory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-delivery-'));
  cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function database(dir: string) {
  const sqlite = new Database(path.join(dir, 'logs.sqlite'));
  sqlite.pragma('journal_mode=WAL');
  sqlite.pragma('synchronous=FULL');
  sqlite.exec(`CREATE TABLE logs(id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, nodeId TEXT, app TEXT NOT NULL,
    level TEXT NOT NULL, message TEXT NOT NULL, labels TEXT, traceId TEXT, spanId TEXT, metadata TEXT);
    CREATE TABLE deliveries(id TEXT PRIMARY KEY, payload TEXT NOT NULL);`);
  const db = new Kysely<OmnitronDatabase>({ dialect: new SqliteDialect({ database: withDateBinding(sqlite) }) });
  cleanup.push(() => db.destroy());
  return db;
}

function collector(db: Kysely<OmnitronDatabase>, filename: string) {
  const service = new LogCollectorService(db);
  service.useJournal(new LogJournal<LogEntry>(filename));
  cleanup.push(() => service.dispose());
  return service;
}

describe('durable log delivery', () => {
  it('preserves trailing spaces and blank lines inside a captured multiline message', () => {
    const records: LogRecord[] = [];
    const assembler = new LineAssembler((_app, record) => records.push(record));
    for (const [sequence, line] of ['Error: padded  ', '    at boot  ', '', '    at main'].entries()) {
      assembler.push('app', line, { id: randomUUID(), processId: 'worker', stream: 'stderr', sequence, capturedAt: '2026-10-31T01:02:03.004Z' });
    }
    assembler.dispose();
    expect(records).toHaveLength(1);
    expect(records[0]!.message).toBe('Error: padded  \n    at boot  \n\n    at main');
  });
  it('deduplicates a single batch before replication and rejects conflicting batch identities atomically', async () => {
    const dir = directory(), db = database(dir), service = collector(db, path.join(dir, 'queue.sqlite'));
    const entry = { id: randomUUID(), app: 'probe', level: 'error', message: 'one', timestamp: '2026-10-31T01:02:03.004Z' };
    const delivered: string[] = [];
    service.setSyncSink(async entries => { delivered.push(...entries.map(item => item.id!)); });
    await service.persistCaptured([entry, entry]);
    expect(delivered).toEqual([entry.id]);
    expect((await service.queryLogs({ app: 'probe' })).entries[0]!.metadata).toHaveProperty('_omnitronPayloadSha256');
    const conflicting = { ...entry, id: randomUUID() };
    await expect(service.persistCaptured([conflicting, { ...conflicting, message: 'different' }])).rejects.toThrow('identity conflict');
    expect((await db.selectFrom('logs').selectAll().execute()).map(item => item.id)).toEqual([entry.id]);
  });

  it('drains every ready source batch at shutdown and leaves a shared sink open for late events', async () => {
    const dir = directory(), db = database(dir);
    const source = new LogJournal<{ app: string; record: LogRecord }>(path.join(dir, 'source.sqlite'));
    cleanup.push(() => source.close());
    const shared = new LogJournal<LogEntry>(path.join(dir, 'backend.sqlite'));
    cleanup.push(() => shared.close());
    const service = new LogCollectorService(db);
    service.useJournal(shared, false); service.setSourceJournal(source);
    for (let i = 0; i < 501; i++) {
      const record: LogRecord = { id: randomUUID(), time: 1793408523004, timestamp: '2026-10-31T01:02:03.004Z',
        level: 'info', message: String(i), lines: 1 };
      source.put(record.id!, { app: 'probe', record });
    }
    await service.dispose();
    expect(source.stats().pending).toBe(0);
    expect(await db.selectFrom('logs').select('id').execute()).toHaveLength(501);
    shared.put('late', { id: 'late', app: 'omnitron', level: 'info', message: 'late shutdown event' });
    const next = collector(db, path.join(dir, 'next.sqlite'));
    next.useJournal(shared, false);
    await next.flush();
    expect(await db.selectFrom('logs').select('id').where('id', '=', 'late').execute()).toHaveLength(1);
  });
  it('keeps multiline startup output separate for every worker and stream, with original time and identity', () => {
    const dir = directory();
    const journal = new LogJournal<{ app: string; record: LogRecord }>(path.join(dir, 'capture.sqlite'));
    cleanup.push(() => journal.close());
    const assembler = new LineAssembler((app, record) => journal.put(record.id!, { app, record }), {
      onPending: (app, record) => journal.put(record.id!, { app, record }, false), idleMs: 60_000,
    });
    const push = (worker: string, sequence: number, line: string, stream: 'stdout' | 'stderr' = 'stderr') => {
      const context = { id: randomUUID(), processId: worker, sequence, stream, capturedAt: '2026-10-31T01:02:03.004Z' };
      assembler.push('app', line, context);
      return context;
    };
    const first = push('a', 1, 'node:internal/modules/run_main:123');
    push('b', 1, 'Error: another worker');
    push('a', 2, 'Error [ERR_MODULE_NOT_FOUND]: missing');
    push('a', 3, '    at loader');
    push('a', 4, 'stdout is separate', 'stdout');
    expect(journal.stats()).toMatchObject({ pending: 3, assembling: 3 });
    assembler.dispose();
    const records = journal.peek().map(item => item.value.record);
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({ id: first.id, message: 'node:internal/modules/run_main:123\nError [ERR_MODULE_NOT_FOUND]: missing\n    at loader',
      timestamp: first.capturedAt, capture: { timeBasis: 'captured', sequence: 1, processId: 'a' } });
  });

  it('commits a replay once and refuses an identity with different bytes', async () => {
    const dir = directory(), db = database(dir), service = collector(db, path.join(dir, 'queue.sqlite'));
    const entry = { id: randomUUID(), app: 'probe', level: 'error', message: 'failure\n    at boot', timestamp: '2026-10-31T01:02:03.004Z' };
    await service.persistCaptured([entry]);
    // Simulate a lost commit response/owner acknowledgment.
    await service.persistCaptured([entry]);
    expect(await db.selectFrom('logs').selectAll().execute()).toHaveLength(1);
    await expect(service.persistCaptured([{ ...entry, message: 'different' }])).rejects.toThrow('identity conflict');
    expect((await db.selectFrom('logs').selectAll().execute())[0]!.message).toBe(entry.message);
  });

  it('rolls local logs back when transactional replication fails, then retries the same ID', async () => {
    const dir = directory(), db = database(dir), service = collector(db, path.join(dir, 'queue.sqlite'));
    const id = randomUUID();
    service.setSyncSink(async () => { throw new Error('outbox unavailable'); });
    service.ingestLog({ id, app: 'probe', level: 'error', message: 'one' });
    await service.flush();
    expect(await db.selectFrom('logs').selectAll().execute()).toHaveLength(0);
    expect(service.getIngestionStats()).toMatchObject({ bufferSize: 1, lastError: 'outbox unavailable', droppedTotal: 0 });
    service.setSyncSink(async (entries, transaction) => {
      for (const entry of entries) await sql`INSERT INTO deliveries(id, payload) VALUES (${entry.id}, ${JSON.stringify(entry)})`.execute(transaction);
    });
    await service.flush();
    expect((await db.selectFrom('logs').select('id').execute()).map(row => row.id)).toEqual([id]);
    expect((await sql`SELECT * FROM deliveries`.execute(db)).rows).toHaveLength(1);
    expect(service.getIngestionStats().bufferSize).toBe(0);
  });

  it('recovers a local queue after an unavailable DB and preserves the original timestamp', async () => {
    const dir = directory(), db = database(dir), filename = path.join(dir, 'queue.sqlite');
    const service = collector(db, filename);
    const entry = { id: randomUUID(), app: 'probe', level: 'error', message: 'before outage', timestamp: '2026-10-31T01:02:03.004Z' };
    await sql`ALTER TABLE logs RENAME TO unavailable_logs`.execute(db);
    service.ingestLog(entry);
    await service.flush();
    expect(readLogIngestion(service.getIngestionStats()).severity).toBe('error');
    cleanup.pop();
    await expect(service.dispose()).rejects.toThrow();
    await sql`ALTER TABLE unavailable_logs RENAME TO logs`.execute(db);
    const restarted = collector(db, filename);
    expect(restarted.getIngestionStats().bufferSize).toBe(1);
    await restarted.flush();
    expect((await db.selectFrom('logs').selectAll().execute())[0]).toMatchObject(entry);
  });

  it('keeps supplied fractional precision instead of inventing microseconds for ordering', () => {
    const records: LogRecord[] = [];
    const assembler = new LineAssembler((_app, record) => records.push(record));
    assembler.push('app', '{"time":"2026-10-31T01:02:03.004567Z","level":50,"msg":"one"}');
    assembler.push('app', '{"time":"2026-10-31T01:02:03.004567Z","level":50,"msg":"two"}');
    expect(records.map(record => logEntryOf('app', record).timestamp)).toEqual(['2026-10-31T01:02:03.004567Z', '2026-10-31T01:02:03.004567Z']);
    expect(records[0]!.id).not.toBe(records[1]!.id);
  });

  it('rejects acknowledgment of unfinished or altered captured output', () => {
    const dir = directory(), journal = new LogJournal<LogEntry>(path.join(dir, 'queue.sqlite'));
    cleanup.push(() => journal.close());
    const id = randomUUID();
    journal.put(id, { id, app: 'probe', level: 'error', message: 'partial' }, false);
    expect(journal.peek()).toEqual([]);
    expect(() => journal.acknowledge([{ id, digest: '0'.repeat(64) }])).toThrow();
    journal.put(id, { id, app: 'probe', level: 'error', message: 'complete' });
    const receipt = journal.peek();
    expect(() => journal.acknowledge([{ id, digest: '0'.repeat(64) }])).toThrow();
    journal.acknowledge(receipt);
    journal.acknowledge(receipt);
    expect(journal.stats()).toMatchObject({ pending: 0, assembling: 0, bytes: 0 });
  });
});
