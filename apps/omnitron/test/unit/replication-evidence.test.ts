import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { withDateBinding } from '../../src/database/sqlite-date-binding.js';
import { SyncService } from '../../src/services/sync.service.js';
import { inSync, syncFinding, syncWords } from '../../src/shared/sync-reading.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';

const databases: Kysely<OmnitronDatabase>[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(databases.splice(0).map(db => db.destroy())); });
async function fixture() {
  const db = new Kysely<OmnitronDatabase>({ dialect: new SqliteDialect({ database: withDateBinding(new Database(':memory:')) }) });
  databases.push(db);
  await sql`CREATE TABLE sync_buffer (id TEXT PRIMARY KEY, category TEXT, payload TEXT, createdAt TEXT NOT NULL, syncedAt TEXT)`.execute(db);
  const service = new SyncService(db, createNullLogger(), 'node', 'slave');
  return { db, service, add: async (id: string, age: number) => {
    await sql`INSERT INTO sync_buffer (id, createdAt) VALUES (${id}, ${new Date(Date.now() - age).toISOString()})`.execute(db);
  } };
}

describe('replication evidence from the buffer', () => {
  it('distinguishes a healthy current batch from a backlog with recent acknowledgements', async () => {
    const { service, add } = await fixture();
    await add('oldest', 3_600_000); await add('acknowledged', 1000); await add('newest', 100);
    await service.ackDrained(['acknowledged']);
    const status = await service.getStatus();
    expect(status.pendingItems).toBe(2);
    expect(status.oldestPendingAgeMs).toBeGreaterThanOrEqual(3_600_000);
    const finding = syncFinding(status);
    expect(finding.state).toBe('catching-up'); expect(inSync(finding)).toBe(false);
    expect(syncWords(finding)).toContain('oldest 3600 s');
    await service.ackDrained(['oldest']);
    expect(syncFinding(await service.getStatus()).state).toBe('pulling');
    await service.ackDrained(['newest']);
    expect(await service.getStatus()).toMatchObject({ pendingItems: 0, oldestPendingAgeMs: null });
  });

  it('counts real acknowledgements once and ages throughput through an idle minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { service, add } = await fixture(); await add('one', 1000);
    expect(await service.ackDrained(['one', 'one', 'missing'])).toEqual({ released: 1 });
    const first = await service.getStatus();
    vi.setSystemTime(Date.now() + 30_000);
    expect(await service.ackDrained(['one'])).toEqual({ released: 0 });
    expect(await service.getStatus()).toMatchObject({ lastSyncAt: first.lastSyncAt, lastSyncAgeMs: 30_000, deliveryRatePerSecond: 1 / 60 });
    vi.setSystemTime(Date.now() + 30_000);
    expect((await service.getStatus()).deliveryRatePerSecond).toBe(0);
  });

  it('does not turn a database read error into an empty, healthy queue', async () => {
    const { db, service } = await fixture();
    await sql`DROP TABLE sync_buffer`.execute(db);
    await expect(service.getStatus()).rejects.toThrow('sync_buffer');
  });

  it('keeps older peer evidence unknown and uses node-local ages across clock skew', () => {
    const status = { pendingItems: 50000, lastSyncAt: Date.now() };
    expect(syncFinding(status).state).toBe('unknown');
    expect(inSync(syncFinding(status))).toBe(false);
    expect(syncWords(syncFinding(status))).toContain('queue age unavailable');
    expect(syncFinding({ ...status, lastSyncAgeMs: 5000, oldestPendingAgeMs: 2000 }, Date.now() + 3_600_000).state).toBe('pulling');
    expect(syncFinding({ ...status, lastSyncAgeMs: 61_000, oldestPendingAgeMs: 2000 }).state).toBe('behind');
  });
});
