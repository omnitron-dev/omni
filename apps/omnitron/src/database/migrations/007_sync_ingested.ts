/**
 * Migration 007: sync_ingested — the master's record of what it has taken
 * from each slave.
 *
 * `sync.service.ts` promised "all sync batches are idempotent (safe to
 * retry)" and had nothing implementing it: `batchId` was generated,
 * transmitted, and used only inside log strings. A retried batch was
 * ingested a second time.
 *
 * That was tolerable only because delivery was never retried — the slave
 * marked everything synced whether or not the master kept it. Making
 * delivery honest makes retries real, so the deduplication has to exist
 * first, or silent loss simply becomes silent duplication.
 *
 * The key is (nodeId, entryId): the slave's own `sync_buffer.id`, which is a
 * uuid generated once at buffer time and stable across every retry.
 */

import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('sync_ingested')
    .ifNotExists()
    .addColumn('nodeId', 'varchar(128)', (col) => col.notNull())
    .addColumn('entryId', 'varchar(64)', (col) => col.notNull())
    .addColumn('ingestedAt', 'timestamptz', (col) => col.notNull().defaultTo(db.fn('now')))
    .addPrimaryKeyConstraint('sync_ingested_pkey', ['nodeId', 'entryId'])
    .execute();

  // Pruning reads by age only; the primary key serves the lookup.
  await db.schema
    .createIndex('idx_sync_ingested_age')
    .ifNotExists()
    .on('sync_ingested')
    .columns(['ingestedAt'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_sync_ingested_age').ifExists().execute();
  await db.schema.dropTable('sync_ingested').ifExists().execute();
}
