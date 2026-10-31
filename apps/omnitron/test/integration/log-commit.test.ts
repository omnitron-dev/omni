import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { LogCollectorService } from '../../src/services/log-collector.service.js';
import { requiresTestPostgres } from './requires-test-postgres.js';
import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';

const url = process.env['TEST_DATABASE_URL'];
const available = url ? await requiresTestPostgres(url) : { ok: false };
let own: OwnDatabase;
let collector: LogCollectorService;
beforeAll(async () => { if (available.ok) own = await databaseOfItsOwn(url!, `omnitron_log_commit_${process.pid}`); });
beforeEach(async () => {
  if (!available.ok) return;
  await sql`TRUNCATE logs`.execute(own.db);
  collector = new LogCollectorService(own.db);
});
afterAll(async () => { await own?.drop(); });

describe.skipIf(!available.ok)('PostgreSQL log commit boundary', () => {
  it('preserves source microseconds and verifies a repeated commit without another row', async () => {
    const entry = { id: randomUUID(), app: 'probe', level: 'error', message: 'failure\n    at boot', timestamp: '2026-10-31T01:02:03.004567Z' };
    try {
      await collector.persistCaptured([entry]);
      await collector.persistCaptured([entry]);
      const rows = await sql<{ exact: string }>`SELECT to_char(timestamp AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS exact FROM logs`.execute(own.db);
      expect(rows.rows).toEqual([{ exact: entry.timestamp }]);
      await expect(collector.persistCaptured([{ ...entry, timestamp: '2026-10-31T01:02:03.004568Z' }])).rejects.toThrow('identity conflict');
    } finally { await collector.dispose(); }
  });

  it('uses a durable transaction and rolls back logs if their outbox cannot commit', async () => {
    const entry = { id: randomUUID(), app: 'probe', level: 'warn', message: 'retry' };
    try {
      collector.setSyncSink(async (_entries, trx) => {
        const settings = await sql<{ synchronous_commit: string }>`SHOW synchronous_commit`.execute(trx);
        expect(settings.rows[0]!.synchronous_commit).toBe('on');
        throw new Error('outbox refused');
      });
      await expect(collector.persistCaptured([entry])).rejects.toThrow('outbox refused');
      expect(await own.db.selectFrom('logs').select('id').execute()).toEqual([]);
      collector.setSyncSink(null);
      await collector.persistCaptured([entry]);
      expect(await own.db.selectFrom('logs').select('id').execute()).toEqual([{ id: entry.id }]);
    } finally { await collector.dispose(); }
  });

  it('refuses to acknowledge rows in an unlogged table', async () => {
    try {
      await sql`ALTER TABLE logs SET UNLOGGED`.execute(own.db);
      await expect(collector.persistCaptured([{ app: 'probe', level: 'error', message: 'keep pending' }])).rejects.toThrow('logged logs table');
      expect(await own.db.selectFrom('logs').select('id').execute()).toEqual([]);
    } finally {
      await sql`ALTER TABLE logs SET LOGGED`.execute(own.db);
      await collector.dispose();
    }
  });
});
