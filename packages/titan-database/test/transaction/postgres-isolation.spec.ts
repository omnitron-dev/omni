import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import { Application } from '@omnitron-dev/titan/application';
import { DatabaseManager, TitanDatabaseModule, getExecutor, runInTransaction } from '../../src/index.js';

const connection = process.env.TEST_DATABASE_URL;
describe.skipIf(!connection)('PostgreSQL transaction isolation', () => {
  let app: Application;
  let db: Kysely<unknown>;
  beforeAll(async () => {
    const uri = new URL(connection!);
    const options = uri.searchParams.get('options');
    uri.searchParams.set('options', [options, '-c omni.qualification=receipt'].filter(Boolean).join(' '));
    app = await Application.create({
      imports: [TitanDatabaseModule.forRoot({
        connection: { dialect: 'postgres', connection: uri.toString() },
        defaultSchema: 'public',
        transactionOptions: { defaultIsolationLevel: 'repeatable read' },
      })],
      disableGracefulShutdown: true,
    });
    const manager = await app.resolveAsync(DatabaseManager);
    db = await manager.getExecutor();
  });
  afterAll(async () => { await app?.stop({ force: true }); await app?.container.dispose(); });

  it('applies isolation to managed views, every retry and same-connection savepoints', async () => {
    const startup = await sql<{ value: string; schema: string }>`SELECT current_setting('omni.qualification') AS value, current_schema() AS schema`.execute(db);
    expect(startup.rows).toEqual([{ value: 'receipt', schema: 'public' }]);
    const view = db.withSchema('public');
    const level = async () => (await sql<{ transaction_isolation: string }>`SHOW transaction_isolation`
      .execute(getExecutor(view))).rows[0]!.transaction_isolation;
    expect(await runInTransaction(view, level)).toBe('repeatable read');

    const transactions = new Set<string>();
    let attempts = 0;
    await runInTransaction(view, async () => {
      expect(await level()).toBe('serializable');
      const result = await sql<{ id: string }>`SELECT txid_current()::text AS id`.execute(getExecutor(view));
      transactions.add(result.rows[0]!.id);
      if (++attempts === 1) {
        await sql`DO $$ BEGIN RAISE EXCEPTION 'retry' USING ERRCODE = '40001'; END $$`.execute(getExecutor(view));
      }
      expect(await runInTransaction(db, level, { isolationLevel: 'serializable' })).toBe('serializable');
      await expect(runInTransaction(db, level, { isolationLevel: 'read committed' })).rejects.toThrow('isolation level');
    }, { isolationLevel: 'serializable', retry: 2 });
    expect(transactions.size).toBe(2);
    expect(await runInTransaction(view, level)).toBe('repeatable read');
  });
});
