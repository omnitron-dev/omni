import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Kysely, SqliteDialect, sql } from 'kysely';
import Database from 'better-sqlite3';
import { getExecutor, getTransactionContext, runInTransaction } from '../../src/transaction/transaction.context.js';

describe('ambient transaction connection boundaries', () => {
  let first: Kysely<unknown>;
  let second: Kysely<unknown>;
  const makeDb = () => new Kysely<unknown>({ dialect: new SqliteDialect({ database: new Database(':memory:') }) });
  beforeEach(async () => {
    first = makeDb(); second = makeDb();
    for (const db of [first, second]) await sql`create table records (value text)`.execute(db);
  });
  afterEach(async () => { await first.destroy(); await second.destroy(); });
  const rows = async (db: Kysely<unknown>) => (await sql<{ value: string }>`select value from records`.execute(db)).rows.map(row => row.value);

  it('keeps independent databases separate and restores their enclosing contexts', async () => {
    await expect(runInTransaction(first, async () => {
      const outer = getExecutor(first);
      expect(getExecutor(second)).toBe(second);
      await sql`insert into records values ('first')`.execute(getExecutor(first));
      await runInTransaction(second, async () => {
        expect(getExecutor(first)).toBe(outer);
        expect(getExecutor(second)).not.toBe(second);
        await sql`insert into records values ('second')`.execute(getExecutor(second));
      }, { connectionName: 'audit' });
      expect(getExecutor(first)).toBe(outer);
      throw new Error('rollback first only');
    })).rejects.toThrow('rollback first only');
    expect(await rows(first)).toEqual([]);
    expect(await rows(second)).toEqual(['second']);
    expect(getTransactionContext()).toBeUndefined();
  });

  it('uses a savepoint for the same database, including a schema/plugin view', async () => {
    await runInTransaction(first, async () => {
      await sql`insert into records values ('retained')`.execute(getExecutor(first));
      await expect(runInTransaction(first.withSchema('main'), async () => {
        expect(getTransactionContext()?.depth).toBe(2);
        await sql`insert into records values ('discarded')`.execute(getExecutor(first));
        throw new Error('nested failure');
      })).rejects.toThrow('nested failure');
      expect(getTransactionContext()?.depth).toBe(1);
      await sql`insert into records values ('continued')`.execute(getExecutor(first));
    });
    expect(await rows(first)).toEqual(['retained', 'continued']);
  });
});
