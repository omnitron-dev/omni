/**
 * Migration 002 — Metrics Raw Table
 *
 * Time-series storage for app/infrastructure metrics.
 * Each row = one metric sample: (timestamp, app, name, value, labels).
 *
 * Optimized for:
 * - Range queries by time + app (composite index)
 * - Label filtering via GIN index on JSONB
 * - High write throughput (no unique constraints, append-only)
 *
 * Retention: managed by MetricsCollector (deletes rows older than retention period).
 */

import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('metrics_raw')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('timestamp', 'timestamptz', (col) => col.notNull().defaultTo(sql`NOW()`))
    .addColumn('nodeId', 'uuid')
    .addColumn('app', 'text', (col) => col.notNull())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('value', 'double precision', (col) => col.notNull())
    .addColumn('labels', 'jsonb')
    .execute();

  // Primary query pattern: time-range + app + metric name
  await db.schema
    .createIndex('idx_metrics_raw_ts_app_name')
    .on('metrics_raw')
    .columns(['timestamp', 'app', 'name'])
    .execute();

  // For "show all metrics for app X in last N minutes"
  await db.schema
    .createIndex('idx_metrics_raw_app_ts')
    .on('metrics_raw')
    .columns(['app', 'timestamp'])
    .execute();

  // Label-based filtering (e.g., { instance: '0' })
  await sql`CREATE INDEX idx_metrics_raw_labels ON metrics_raw USING GIN (labels jsonb_path_ops)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('metrics_raw').ifExists().execute();
}
