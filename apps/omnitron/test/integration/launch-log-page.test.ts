import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import type { OmnitronDatabase } from '../../src/database/schema.js';
import { LogCollectorService } from '../../src/services/log-collector.service.js';
import { SlaveStorageService } from '../../src/services/slave-storage.service.js';

describe('retained launch output on the recipient', () => {
  it('pages tied timestamps without gaps and confines output to the selected local handles and interval', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'launch-logs-'));
    const storage = new SlaveStorageService({ info: vi.fn(), debug: vi.fn(), warn: vi.fn() } as never, path.join(dir, 'worker.db'));
    let service: LogCollectorService | undefined;
    try {
      const db = await storage.getDb();
      service = new LogCollectorService(db as unknown as Kysely<OmnitronDatabase>);
      const app = 'demo/deployed/main', timestamp = '2025-03-02T02:00:00.123456Z';
      const records = Array.from({ length: 203 }, (_, idx) => ({ app, nodeId: null, timestamp,
        id: String(idx).padStart(4, '0'), level: 'info', message: 'starting' }));
      await db.insertInto('logs').values([...records,
        { ...records[0]!, id: 'replica', nodeId: 'other-node' },
        { ...records[0]!, id: 'neighbour', app: app + '-next' },
        { ...records[0]!, id: 'earlier', timestamp: '2025-03-01T00:00:00.000Z' }]).execute();
      const query = { handles: [app], from: '2025-03-02T01:00:00Z', to: '2025-03-02T03:00:00Z' };
      const latest = await service.readLocalLaunchLogs(query);
      expect(latest.entries).toHaveLength(200);
      expect(latest.earlier).toEqual({ timestamp, id: '0003' });
      const oldest = await service.readLocalLaunchLogs({ ...query, before: latest.earlier! });
      expect(oldest.earlier).toBeNull();
      expect([...latest.entries, ...oldest.entries].map(row => row.id)).toEqual(records.map(row => row.id).reverse());
      await expect(service.readLocalLaunchLogs({ ...query, handles: ['demo/%'] })).rejects.toThrow(/handles/);
      await expect(service.readLocalLaunchLogs({ ...query, before: { id: 'row', timestamp: 'invalid' } })).rejects.toThrow(/cursor/);
    } finally {
      await service?.dispose();
      await storage.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
