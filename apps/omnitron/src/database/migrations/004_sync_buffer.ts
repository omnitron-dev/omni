/**
 * Migration 004: Sync Buffer — WAL for slave→master data replication
 *
 * The sync_buffer table acts as a write-ahead log on slave daemons.
 * Entries are written locally as data is collected, then pushed to
 * master in idempotent batches. Once synced, entries are marked with
 * syncedAt timestamp and eventually evicted.
 *
 * Design goals:
 * - Append-only writes (fast inserts, no contention)
 * - Efficient batch reads of unsynced entries (indexed on syncedAt IS NULL)
 * - Bounded growth via periodic eviction of old synced entries
 */

import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('sync_buffer')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(db.fn('gen_random_uuid'))
    )
    .addColumn('category', 'varchar(32)', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('createdAt', 'timestamptz', (col) => col.notNull().defaultTo(db.fn('now')))
    .addColumn('syncedAt', 'timestamptz')
    .execute();

  // Index for fetching unsynced entries efficiently (most common query)
  await db.schema
    .createIndex('idx_sync_buffer_pending')
    .ifNotExists()
    .on('sync_buffer')
    .columns(['syncedAt', 'createdAt'])
    .where('syncedAt', 'is', null)
    .execute()
    .catch(() =>
      db.schema
        .createIndex('idx_sync_buffer_pending')
        .ifNotExists()
        .on('sync_buffer')
        .columns(['syncedAt', 'createdAt'])
        .execute()
    );

  // Index for eviction of old synced entries
  await db.schema
    .createIndex('idx_sync_buffer_eviction')
    .ifNotExists()
    .on('sync_buffer')
    .columns(['syncedAt'])
    .execute();

  // Index by category for filtered sync
  await db.schema
    .createIndex('idx_sync_buffer_category')
    .ifNotExists()
    .on('sync_buffer')
    .columns(['category', 'createdAt'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_sync_buffer_category').ifExists().execute();
  await db.schema.dropIndex('idx_sync_buffer_eviction').ifExists().execute();
  await db.schema.dropIndex('idx_sync_buffer_pending').ifExists().execute();
  await db.schema.dropTable('sync_buffer').ifExists().execute();
}
