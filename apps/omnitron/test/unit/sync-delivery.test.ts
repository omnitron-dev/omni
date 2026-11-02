import { SlaveConnector } from '../../src/cluster/slave-connector.js';
import { afterEach, describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Kysely, SqliteDialect } from 'kysely';
import { withDateBinding } from '../../src/database/sqlite-date-binding.js';

import { SyncService } from '../../src/services/sync.service.js';

const silentLogger: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => silentLogger,
};

const databases: Kysely<any>[] = [];
afterEach(async () => { await Promise.all(databases.splice(0).map(db => db.destroy())); });

/** A real legacy SQLite buffer: receipt and query behavior must match storage. */
function stubDb(pending: Array<{ id: string }>) {
  const raw = new Database(':memory:');
  raw.exec(`CREATE TABLE sync_buffer (id TEXT PRIMARY KEY, category TEXT, payload TEXT, createdAt TEXT NOT NULL, syncedAt TEXT)`);
  const insert = raw.prepare('INSERT INTO sync_buffer (id, category, payload, createdAt) VALUES (?, ?, ?, ?)');
  for (const row of pending) insert.run(row.id, 'metrics', JSON.stringify({ name: 'cpu', value: 1 }), new Date().toISOString());
  const markedSynced: string[] = [];
  raw.function('record_release', (id: unknown) => { markedSynced.push(String(id)); return 1; });
  raw.exec(`CREATE TRIGGER record_release AFTER UPDATE OF syncedAt ON sync_buffer
    WHEN OLD.syncedAt IS NULL AND NEW.syncedAt IS NOT NULL BEGIN SELECT record_release(NEW.id); END`);
  const db = new Kysely<any>({ dialect: new SqliteDialect({ database: withDateBinding(raw) }) });
  databases.push(db);
  return { db, markedSynced };
}

describe('controller pull from a real worker outbox', () => {
  async function pull(response: unknown) {
    const { db, markedSynced } = stubDb([{ id: 'a' }, { id: 'b' }]);
    const worker = new SyncService(db, silentLogger, 'claimed-by-worker', 'slave');
    const ingest = vi.fn(async () => { if (response instanceof Error) throw response; return response; });
    const controller = new SlaveConnector(silentLogger, { receiveBatch: ingest } as never);
    const conn = { config: { nodeId: 'registered-node', host: 'worker.test', port: 9700 }, status: 'connected', lastPullError: null,
      authenticated: true,
    link: { via: 'ssh-tunnel', url: 'tcp://127.0.0.1:1', token: 'worker-service', expiresAt: Date.now() + 300_000 },
      peer: { queryInterface: async () => ({
        drainBuffer: ({ limit }: { limit: number }) => worker.drainBuffer(limit),
        ackDrained: ({ ids }: { ids: string[] }) => worker.ackDrained(ids),
      }) },
    };
    await (controller as any).pullSyncData('worker.test:9700', conn);
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'registered-node' }));
    return { markedSynced, error: conn.lastPullError, ingest };
  }
  it('releases confirmed entries while retaining a refused row in SQLite', async () => {
    const result = await pull({ acceptedIds: ['a'], duplicateIds: [], discardedIds: [], failedIds: ['b'] });
    expect(result.markedSynced).toEqual(['a']);
    expect(result.error).toMatch(/stalled/);
  });
  it('releases duplicates along with newly accepted entries', async () => {
    const result = await pull({ acceptedIds: ['a'], duplicateIds: ['b'], discardedIds: [] });
    expect(result.markedSynced.sort()).toEqual(['a', 'b']);
    expect(result.error).toBeNull();
  });
  it.each([{ accepted: 2 }, { acceptedIds: [], failedIds: ['a','b'] }, new Error('master database unavailable')])(
    'keeps every row pending when ingestion fails or no IDs are acknowledged', async response => {
      const result = await pull(response);
      expect(result.markedSynced).toEqual([]);
      expect(result.error).toBeTruthy();
      expect(result.ingest).toHaveBeenCalledOnce();
    },
  );
});

describe('drainBuffer — the pull path', () => {
  it('hands entries over without releasing them', async () => {
    // It used to mark them synced before returning, and called that
    // idempotent. A response lost in transit then lost the data on both
    // sides, and the caller logged it at debug level.
    const { db, markedSynced } = stubDb([{ id: 'a' }, { id: 'b' }]);
    const service = new SyncService(db, silentLogger, 'node-1', 'slave', { interval: 60_000 });

    const batch = await service.drainBuffer(10);

    expect(batch.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(markedSynced, 'nothing may be released before the master acknowledges').toEqual([]);
  });

  it('releases exactly what the master acknowledges', async () => {
    const { db, markedSynced } = stubDb([{ id: 'a' }, { id: 'b' }]);
    const service = new SyncService(db, silentLogger, 'node-1', 'slave', { interval: 60_000 });

    await service.drainBuffer(10);
    const result = await service.ackDrained(['a']);

    expect(result).toEqual({ released: 1 });
    expect(markedSynced).toEqual(['a']);
  });

  it('accepts an empty acknowledgement without touching the buffer', async () => {
    const { db, markedSynced } = stubDb([]);
    const service = new SyncService(db, silentLogger, 'node-1', 'slave', { interval: 60_000 });

    expect(await service.ackDrained([])).toEqual({ released: 0 });
    expect(markedSynced).toEqual([]);
  });
});
