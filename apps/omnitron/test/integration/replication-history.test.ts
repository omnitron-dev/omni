import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { PostgresMetricsStorage } from '@omnitron-dev/titan-metrics';
import { HISTORY_EMPTY_DIGEST, historicalLog, historyCoverage, historyGapDigest, historyJson, historyLogKey,
  historyPageDigest, reconcileHistoryPage, type HistoryEntry, type HistoryManifest, type HistoryPage } from '../../src/services/replication-history.js';
import { replicatedMetric } from '../../src/services/replication-reconciliation.js';
import { historyWords, syncFinding, syncWords } from '../../src/shared/sync-reading.js';
import { requiresTestPostgres } from './requires-test-postgres.js';
import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';

const url = process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test';
const available = await requiresTestPostgres(url);
const nodeId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
let own: OwnDatabase, storage: PostgresMetricsStorage;
beforeAll(async () => {
  if (available.ok) { own = await databaseOfItsOwn(url, `omnitron_history_${process.pid}`); storage = new PostgresMetricsStorage(own.db); }
});
afterAll(async () => { await own?.drop(); });
beforeEach(async () => {
  if (!available.ok) return;
  await sql`TRUNCATE metrics_samples, logs, sync_ingested`.execute(own.db);
  if ((await sql<{ t: string | null }>`SELECT to_regclass('sync_history_sources')::text t`.execute(own.db)).rows[0]!.t) {
    await sql`TRUNCATE sync_history_pages, sync_history_sources`.execute(own.db);
  }
});

function metric(id: string, timestamp = Date.now() - 3600000): HistoryEntry {
  return { id, createdAt: new Date(timestamp).toISOString(), payload: { name: 'cpu_percent', value: 42, timestamp, app: 'api', labels: {} } };
}
function source(category: 'metrics' | 'logs', chunks: HistoryEntry[][]) {
  let previousDigest = HISTORY_EMPTY_DIGEST;
  const pages = chunks.map((entries, index): HistoryPage => {
    const page = { index, previousDigest, entries }; previousDigest = historyPageDigest(page); return page;
  });
  const times = chunks.flat().map(e => new Date(e.payload['timestamp'] as string | number).toISOString()).sort();
  const manifest: HistoryManifest = { id: 'a'.repeat(64), nodeId, category, sourceDigest: 'b'.repeat(64),
    expectedRows: chunks.flat().reduce((sum, e) => sum + (e.count ?? 1), 0), expectedPages: pages.length,
    firstAt: times[0]!, lastAt: times.at(-1)!, rootDigest: previousDigest,
    gaps: [{ reason: 'No earlier retained source', from: null, to: times[0]!, rows: null }] };
  return { manifest, pages };
}
const reconcile = (manifest: HistoryManifest, page: HistoryPage, restore = true) => reconcileHistoryPage(own.db, storage, manifest, page, { restore });

describe.skipIf(!available.ok)('pre-receipt history with PostgreSQL transaction proofs', () => {
  it('inspects without installing a journal or trusting an old released claim', async () => {
    const { manifest, pages } = source('metrics', [[metric('10')]]);
    await own.db.insertInto('sync_ingested').values({ nodeId, entryId: '10', outcome: 'unverified' }).execute();
    expect(await reconcile(manifest, pages[0]!, false)).toMatchObject({ present: 0, missing: 1, replay: false });
    expect((await sql<{ t: string | null }>`SELECT to_regclass('sync_history_sources')::text t`.execute(own.db)).rows[0]!.t).toBeNull();
  });
  it('restores original metric time and content, reuses existing history and preserves original claims', async () => {
    const a = metric('10'), b = metric('11', Number(a.payload['timestamp']) + 5);
    const { manifest, pages } = source('metrics', [[a, b]]);
    await storage.write([{ ...replicatedMetric(nodeId, { ...a, category: 'metrics' }), id: 'existing-original' }]);
    await own.db.insertInto('sync_ingested').values({ nodeId, entryId: '11', outcome: 'unverified' }).execute();
    expect(await reconcile(manifest, pages[0]!)).toMatchObject({ present: 1, missing: 1 });
    expect(await reconcile(manifest, pages[0]!)).toMatchObject({ replay: true });
    expect(await reconcile(manifest, pages[0]!, false)).toMatchObject({ present: 2, missing: 0 });
    expect(await own.db.selectFrom('sync_ingested').select('outcome').execute()).toEqual([{ outcome: 'unverified' }]);
    const coverage = (await historyCoverage(own.db))[0]!;
    expect(coverage).toMatchObject({ status: 'verified', restoredRows: 1, presentRows: 1, processedRows: 2, gaps: manifest.gaps });
    expect(historyWords(coverage)).toContain('unknown row count');
  });
  it('rejects mismatched identities and rolls back a page whose final hash is wrong', async () => {
    const a = metric('10'), { manifest, pages } = source('metrics', [[a]]);
    const wrong = { ...manifest, rootDigest: 'c'.repeat(64) };
    await expect(reconcile(wrong, pages[0]!)).rejects.toThrow('final hash');
    expect((await sql<{ n: string }>`SELECT count(*) n FROM metrics_samples`.execute(own.db)).rows[0]!.n).toBe('0');
    expect(await historyCoverage(own.db)).toEqual([]);
    await storage.write([{ ...replicatedMetric(nodeId, { ...a, category: 'metrics' }), value: 999 }]);
    await expect(reconcile(manifest, pages[0]!)).rejects.toThrow('identity conflicts');
  });
  it('resumes only the next hash-linked page and refuses a changed replay', async () => {
    const { manifest, pages } = source('metrics', [[metric('10')], [metric('11')]]);
    await expect(reconcile(manifest, pages[1]!)).rejects.toThrow('out of order');
    await reconcile(manifest, pages[0]!);
    expect((await historyCoverage(own.db))[0]!.status).toBe('partial');
    const tampered = { ...pages[0]!, entries: [{ ...pages[0]!.entries[0]!, payload: { ...pages[0]!.entries[0]!.payload, value: 9 } }] };
    await expect(reconcile(manifest, tampered)).rejects.toThrow('committed proof');
    await reconcile(manifest, pages[1]!);
    expect((await historyCoverage(own.db))[0]!.status).toBe('verified');
  });
  it('matches logs at retained precision without collapsing equal records or adding duplicates', async () => {
    const payload = { timestamp: new Date(Date.now() - 3600000).toISOString(), app: 'api', level: 'info', message: 'job finished',
      metadata: { a: 1, nested: { z: 2, a: ['one', 'two'] } } };
    const row = historicalLog(payload), entry = { id: historyLogKey(payload), payload, createdAt: payload.timestamp, count: 2 };
    const { manifest, pages } = source('logs', [[entry]]);
    await own.db.insertInto('logs').values({ nodeId, timestamp: payload.timestamp.replace('Z', '123Z'), app: 'api', level: 'info',
      message: 'job finished', labels: null, metadata: JSON.stringify({ nested: { a: ['one', 'two'], z: 2 }, a: 1 }) }).execute();
    expect(await reconcile(manifest, pages[0]!)).toMatchObject({ present: 1, missing: 1 });
    expect(await reconcile(manifest, pages[0]!, false)).toMatchObject({ present: 2, missing: 0 });
    expect((await sql<{ n: string }>`SELECT count(*) n FROM logs`.execute(own.db)).rows[0]!.n).toBe('2');
    expect((await historyCoverage(own.db))[0]!.precision).toBe('millisecond');
    expect(historyLogKey(row)).toBe(entry.id);
    expect(historyJson({ b: 1, a: [2, 1] })).toBe('{"a":[2,1],"b":1}');
  });
  it('serializes simultaneous repair attempts and refuses expired metrics', async () => {
    const { manifest, pages } = source('metrics', [[metric('10')]]);
    const results = await Promise.all([reconcile(manifest, pages[0]!), reconcile(manifest, pages[0]!)]);
    expect(results.filter(r => r.replay)).toHaveLength(1);
    expect((await historyCoverage(own.db))[0]!.processedRows).toBe(1);
    const expired = source('metrics', [[metric('20', Date.now() - 8 * 86400000)]]);
    await expect(reconcile(expired.manifest, expired.pages[0]!)).rejects.toThrow('retention horizon');
  });
  it('rejects tampered log fingerprints and oversized multiplicity before any write', async () => {
    const payload = { timestamp: new Date().toISOString(), message: 'event' };
    const data = source('logs', [[{ id: createHash('sha256').update('wrong').digest('hex'), payload, createdAt: payload.timestamp }]]);
    await expect(reconcile(data.manifest, data.pages[0]!)).rejects.toThrow('fingerprint');
    const large = source('logs', [[{ id: historyLogKey(payload), payload, createdAt: payload.timestamp, count: 10000 }]]);
    await expect(reconcile(large.manifest, large.pages[0]!)).rejects.toThrow('row budget');
  });
  it('accounts for expired logs as preserved source history without resurrecting the live retention window', async () => {
    const payload = { timestamp: new Date(Date.now() - 15 * 86400000).toISOString(), message: 'old event' };
    const { manifest, pages } = source('logs', [[{ id: historyLogKey(payload), payload, createdAt: payload.timestamp, count: 2 }]]);
    expect(await reconcile(manifest, pages[0]!)).toMatchObject({ present: 0, missing: 0, expired: 2 });
    expect((await sql<{ n: string }>`SELECT count(*) n FROM logs`.execute(own.db)).rows[0]!.n).toBe('0');
    expect((await historyCoverage(own.db))[0]).toMatchObject({ status: 'verified', processedRows: 2, expiredRows: 2 });
  });
  it('refuses an unlogged proof journal even when the metric table is durable', async () => {
    const { manifest, pages } = source('metrics', [[metric('10')], [metric('11')]]);
    await reconcile(manifest, pages[0]!);
    await sql`ALTER TABLE sync_history_pages SET UNLOGGED`.execute(own.db);
    try { await expect(reconcile(manifest, pages[1]!)).rejects.toThrow('logged PostgreSQL'); }
    finally { await sql`ALTER TABLE sync_history_pages SET LOGGED`.execute(own.db); }
    expect((await historyCoverage(own.db))[0]).toMatchObject({ status: 'partial', processedRows: 1 });
  });
  it('resolves a reviewed collision through a separate commit without rewriting the original audit', async () => {
    const timestamp = new Date(Date.now() - 3600000).toISOString();
    const entry = (workerId: string): HistoryEntry => {
      const payload = { timestamp, app: 'api', level: 'info', message: 'Worker exited cleanly', metadata: { workerId } };
      return { id: historyLogKey(payload), payload, createdAt: timestamp };
    };
    const original = source('logs', [[entry('first')]]);
    original.manifest.gaps = [{ reason: 'Same time and message, unresolved worker identity', from: timestamp, to: timestamp, rows: 1 }];
    await reconcile(original.manifest, original.pages[0]!);
    const recovery = source('logs', [[entry('second')]]);
    recovery.manifest = { ...recovery.manifest, id: 'c'.repeat(64), gaps: [], resolvesGap: {
      sourceId: original.manifest.id, gapIndex: 0, gapDigest: historyGapDigest(original.manifest.gaps[0]!),
      evidenceDigest: 'd'.repeat(64), explanation: 'Independent worker identities confirmed in the original archive',
    } };
    expect(await reconcile(recovery.manifest, recovery.pages[0]!, false)).toMatchObject({ present: 0, missing: 1 });
    expect((await historyCoverage(own.db))[0]!.gaps[0]!.resolution).toBeUndefined();
    expect(await reconcile(recovery.manifest, recovery.pages[0]!)).toMatchObject({ present: 0, missing: 1 });
    expect(await reconcile(recovery.manifest, recovery.pages[0]!)).toMatchObject({ replay: true });
    expect(await reconcile(recovery.manifest, recovery.pages[0]!, false)).toMatchObject({ present: 1, missing: 0 });
    const coverage = await historyCoverage(own.db), parent = coverage.find(r => r.sourceId === original.manifest.id)!;
    expect(parent.gaps[0]).toMatchObject({ ...original.manifest.gaps[0], resolution: { sourceId: recovery.manifest.id } });
    expect(historyWords(parent)).toContain('resolved: Independent worker identities');
    expect(historyWords(parent)).not.toContain('; gaps:');
    expect(syncWords(syncFinding({ pendingItems: 0, lastSyncAt: null, history: coverage }))).not.toContain('coverage gaps');
    const stored = (await sql<{ manifest: string }>`SELECT manifest FROM sync_history_sources WHERE id=${original.manifest.id}`.execute(own.db)).rows[0]!;
    expect(stored.manifest).toBe(historyJson(original.manifest));
    expect((await sql<{ n: string }>`SELECT count(*) n FROM logs`.execute(own.db)).rows[0]!.n).toBe('2');
    const duplicate = { ...recovery.manifest, id: 'e'.repeat(64) };
    await expect(reconcile(duplicate, recovery.pages[0]!)).rejects.toThrow('already claims');
    expect(await historyCoverage(own.db)).toHaveLength(2);
  });
  it('refuses changed gap fingerprints, unknown counts and incomplete parents', async () => {
    const now = Date.now() - 3600000;
    const original = source('metrics', [[metric('10', now)], [metric('11', now + 5)]]);
    original.manifest.gaps[0]!.rows = 1;
    const recovered = metric('12', Number(original.pages[0]!.entries[0]!.payload['timestamp']));
    const repair = source('metrics', [[recovered]]);
    repair.manifest = { ...repair.manifest, id: 'c'.repeat(64), gaps: [], resolvesGap: {
      sourceId: original.manifest.id, gapIndex: 0, gapDigest: historyGapDigest(original.manifest.gaps[0]!),
      evidenceDigest: 'd'.repeat(64), explanation: 'Reviewed retained source',
    } };
    await reconcile(original.manifest, original.pages[0]!);
    await expect(reconcile(repair.manifest, repair.pages[0]!)).rejects.toThrow('verified, bounded');
    await reconcile(original.manifest, original.pages[1]!);
    repair.manifest.resolvesGap!.gapDigest = 'e'.repeat(64);
    await expect(reconcile(repair.manifest, repair.pages[0]!)).rejects.toThrow('verified, bounded');
    const unknown = source('metrics', [[metric('10', now)]]);
    unknown.manifest.id = 'e'.repeat(64);
    await reconcile(unknown.manifest, unknown.pages[0]!);
    repair.manifest.resolvesGap = { ...repair.manifest.resolvesGap!, sourceId: unknown.manifest.id,
      gapDigest: historyGapDigest(unknown.manifest.gaps[0]!) };
    await expect(reconcile(repair.manifest, repair.pages[0]!)).rejects.toThrow('verified, bounded');
    expect(await historyCoverage(own.db)).toHaveLength(2);
    expect((await sql<{ n: string }>`SELECT count(*) n FROM metrics_samples`.execute(own.db)).rows[0]!.n).toBe('2');
  });
  it('does not close a gap until every recovery page commits and rejects expired recovery', async () => {
    const now = Date.now() - 3600000;
    const original = source('metrics', [[metric('10', now)]]);
    original.manifest.gaps = [{ reason: 'Two retained originals missing', from: null, to: null, rows: 2 }];
    await reconcile(original.manifest, original.pages[0]!);
    const repair = source('metrics', [[metric('11', now + 5)], [metric('12', now + 10)]]);
    repair.manifest = { ...repair.manifest, id: 'c'.repeat(64), gaps: [], resolvesGap: {
      sourceId: original.manifest.id, gapIndex: 0, gapDigest: historyGapDigest(original.manifest.gaps[0]!),
      evidenceDigest: 'd'.repeat(64), explanation: 'Both originals recovered',
    } };
    await reconcile(repair.manifest, repair.pages[0]!);
    expect((await historyCoverage(own.db)).find(r => r.sourceId === original.manifest.id)!.gaps[0]!.resolution).toBeUndefined();
    await reconcile(repair.manifest, repair.pages[1]!);
    expect((await historyCoverage(own.db)).find(r => r.sourceId === original.manifest.id)!.gaps[0]!.resolution).toBeDefined();

    const payload = { timestamp: new Date(Date.now() - 15 * 86400000).toISOString(), message: 'old event' };
    const expired = source('logs', [[{ id: historyLogKey(payload), payload, createdAt: payload.timestamp }]]);
    const parent = { ...expired.manifest, id: 'e'.repeat(64), gaps: [{ reason: 'Old missing event', from: null, to: null, rows: 1 }] };
    await reconcile(parent, expired.pages[0]!);
    expired.manifest = { ...expired.manifest, id: 'f'.repeat(64), gaps: [], resolvesGap: {
      sourceId: parent.id, gapIndex: 0, gapDigest: historyGapDigest(parent.gaps[0]!),
      evidenceDigest: 'd'.repeat(64), explanation: 'Cannot restore an expired event',
    } };
    await expect(reconcile(expired.manifest, expired.pages[0]!)).rejects.toThrow('Expired history');
    expect((await historyCoverage(own.db)).find(r => r.sourceId === parent.id)!.gaps[0]!.resolution).toBeUndefined();
  });
});
