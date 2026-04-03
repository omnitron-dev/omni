/**
 * Migration 005: Node Health Checks — Persistent health check history
 *
 * Stores results of periodic ping/SSH/omnitron checks per node.
 * Written by the health-monitor system worker, read by daemon RPC endpoints.
 * Indexes optimized for: per-node history queries, cleanup of old rows.
 */

import type { Kysely } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('node_health_checks')
    .ifNotExists()
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(db.fn('gen_random_uuid'))
    )
    .addColumn('nodeId', 'varchar(64)', (col) => col.notNull())
    .addColumn('checkedAt', 'timestamptz', (col) => col.notNull().defaultTo(db.fn('now')))
    .addColumn('checkDurationMs', 'integer', (col) => col.notNull())

    .addColumn('pingReachable', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('pingLatencyMs', 'real')
    .addColumn('pingError', 'text')

    .addColumn('sshConnected', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('sshLatencyMs', 'real')
    .addColumn('sshError', 'text')

    .addColumn('omnitronConnected', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('omnitronVersion', 'varchar(32)')
    .addColumn('omnitronPid', 'integer')
    .addColumn('omnitronUptime', 'real')
    .addColumn('omnitronRole', 'varchar(16)')
    .addColumn('omnitronError', 'text')

    .addColumn('os', 'jsonb')
    .execute();

  // Primary query: per-node history ordered by time
  await db.schema
    .createIndex('idx_nhc_node_time')
    .ifNotExists()
    .on('node_health_checks')
    .columns(['nodeId', 'checkedAt'])
    .execute();

  // Cleanup query: rows older than retention
  await db.schema
    .createIndex('idx_nhc_checked_at')
    .ifNotExists()
    .on('node_health_checks')
    .column('checkedAt')
    .execute();

  // Add offlineTimeout to nodes table (nullable integer, ms)
  // This is a soft migration — column may not exist if nodes table is file-based
  // We add it to the PG schema for future cluster-mode nodes table
  try {
    await db.schema
      .alterTable('nodes')
      .addColumn('offlineTimeout', 'integer')
      .execute();
  } catch {
    // Column may already exist or nodes table may not exist in PG — both ok
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('idx_nhc_checked_at').ifExists().execute();
  await db.schema.dropIndex('idx_nhc_node_time').ifExists().execute();
  await db.schema.dropTable('node_health_checks').ifExists().execute();

  try {
    await db.schema
      .alterTable('nodes')
      .dropColumn('offlineTimeout')
      .execute();
  } catch {
    // Nodes table may not exist in PG
  }
}
