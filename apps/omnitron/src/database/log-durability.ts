import { sql, type Transaction } from 'kysely';
import type { OmnitronDatabase } from './schema.js';
import { dialectOf } from './dialect.js';

/** A successful SQL statement alone is not a durable log receipt. */
export async function assertLogDurability(trx: Transaction<OmnitronDatabase>): Promise<'persistent' | 'volatile'> {
  if (dialectOf(trx) === 'postgres') {
    const result = await sql<{ fsync: string; pages: string; persistence: string }>`SELECT
      set_config('synchronous_commit', 'on', true), set_config('statement_timeout', '10000', true),
      current_setting('fsync') AS fsync, current_setting('full_page_writes') AS pages,
      (SELECT relpersistence FROM pg_class WHERE oid = 'logs'::regclass) AS persistence`.execute(trx);
    const state = result.rows[0];
    if (state?.fsync !== 'on' || state.pages !== 'on' || state.persistence !== 'p') {
      throw new Error('Durable logs require PostgreSQL fsync=on, full_page_writes=on and a logged logs table');
    }
    return 'persistent';
  }
  if (dialectOf(trx) !== 'sqlite') throw new Error('Unknown log database durability');
  const databases = await sql<{ name: string; file: string }>`PRAGMA database_list`.execute(trx);
  if (!databases.rows.find(row => row.name === 'main')?.file) return 'volatile';
  const sync = Number((await sql<{ synchronous: number }>`PRAGMA synchronous`.execute(trx)).rows[0]?.synchronous);
  const mode = (await sql<{ journal_mode: string }>`PRAGMA journal_mode`.execute(trx)).rows[0]?.journal_mode;
  if (!mode || !['wal', 'delete', 'truncate', 'persist'].includes(mode) || sync < (mode === 'wal' ? 2 : 3)) {
    throw new Error('Durable logs require SQLite WAL with synchronous=FULL/EXTRA, or a disk rollback journal with EXTRA');
  }
  return 'persistent';
}
