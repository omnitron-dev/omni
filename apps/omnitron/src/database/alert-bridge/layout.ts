import { sql, type Kysely, type Transaction } from 'kysely';
import { dialectOf } from '../dialect.js';
import type { OmnitronDatabase } from '../schema.js';

export const STORAGE_ORIGIN_ROLLBACK = {
  protocol: 1,
  master: '60a0c65ce23823b38676cef63d0c90b0b3fa7d56b021c6467c9a8831cbcfbb41',
  node: 'c3db5c37a9fc110dcb6f6cabf3b304da4407530de99286d77bdff41646a20105',
} as const;

/** A decision taken before ALTER TABLE may classify a claimed origin only as unverified. */
export async function alertLayout(db: Kysely<OmnitronDatabase>) {
  const dialect = dialectOf(db);
  if (dialect !== 'postgres' && dialect !== 'sqlite') throw Error('Cannot identify the database holding alert history');
  const columns = dialect === 'postgres'
    ? (await sql<{ name: string }>`select attname as name from pg_attribute
      where attrelid = 'alert_events'::regclass and attnum > 0 and not attisdropped`.execute(db)).rows
    : (await sql<{ name: string }>`pragma table_info(alert_events)`.execute(db)).rows;
  const names = new Set(columns.map(row => row.name));
  if (!names.has('annotations') || names.has('originNode') !== names.has('legacyOrigin'))
    throw Error('Cannot qualify the layout of alert_events');
  const expanded = names.has('originNode');
  const legacy = expanded ? sql<boolean>`"alert_events"."legacyOrigin"` : dialect === 'postgres'
    ? sql<boolean>`jsonb_typeof("alert_events"."annotations" -> 'node') IS NOT DISTINCT FROM 'string'` : sql<boolean>`false`;
  const origin = expanded ? sql<string | null>`"alert_events"."originNode"` : sql<string | null>`null`;
  return { expanded, ambiguousAnnotations: !expanded && dialect === 'postgres', origin, legacy, local: sql<boolean>`${origin} IS NULL AND NOT (${legacy})` };
}

/** Pin the observed columns through receipt and INSERT. ALTER TABLE takes a conflicting lock. */
export async function ingestAlertLayout(db: Transaction<OmnitronDatabase>) {
  if (dialectOf(db) === 'postgres') await sql`lock table alert_events in row exclusive mode`.execute(db);
  return alertLayout(db);
}
